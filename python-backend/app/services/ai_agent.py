"""
AI Agent Service - Core AI receptionist logic using OpenAI/Anthropic
"""

import json
import re
from pathlib import Path
from typing import AsyncGenerator, Optional
from datetime import datetime
from loguru import logger
from openai import AsyncOpenAI

from app.core.config import settings
from app.models.schemas import (
    AgentConfig, CallContext, Message, AgentResponse
)
from app.services.knowledge import KnowledgeBase, key_words
from app.services.conversation import CallState, Conversation

# The agent's configuration (identity + knowledge base + FAQs) is the
# single source the agent answers from. It is persisted to disk so the
# knowledge base set in the dashboard survives restarts — previously it
# lived only in memory and reset to the hardcoded defaults on restart.
_CONFIG_FILE = Path(__file__).resolve().parents[2] / "data" / "agent_config.json"

class AIAgent:
    """
    AI Receptionist Agent
    Handles conversation logic, intent detection, and response generation
    """
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.config = self._load_config()
        self.conversation_history: dict[str, list[dict]] = {}
        # Per-call conversation state for knowledge-base answers (role being
        # discussed, screening progress, last reply) - see conversation.py.
        self.call_state: dict[str, CallState] = {}

    def _load_config(self) -> AgentConfig:
        """Load the persisted config if present, else the defaults."""
        try:
            if _CONFIG_FILE.exists():
                data = json.loads(_CONFIG_FILE.read_text(encoding="utf-8"))
                logger.info(f"Agent config loaded from {_CONFIG_FILE}")
                return AgentConfig.model_validate(data)
        except Exception as e:
            logger.warning(f"Could not load saved agent config ({e}); using defaults")
        return self._load_default_config()

    def _save_config(self) -> None:
        """Persist the current config (knowledge base included)."""
        try:
            _CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
            _CONFIG_FILE.write_text(
                json.dumps(self.config.model_dump(), indent=2), encoding="utf-8"
            )
        except Exception as e:
            logger.warning(f"Could not save agent config: {e}")

    def _load_default_config(self) -> AgentConfig:
        """Load default agent configuration"""
        return AgentConfig(
            agent_name="Aria",
            company_name="TechCorp Solutions",
            language="English",
            voice="skylar",
            speaking_rate=1.0,
            pitch=1.0,
            greeting="Hello! Thank you for calling TechCorp Solutions. I'm Aria, your AI assistant. How can I help you today?",
            farewell="Thank you for calling! Have a wonderful day.",
            personality="professional",
            max_call_duration=15,
            silence_timeout=8,
            allow_interrupts=True,
            knowledge_base={
                "business_hours": "Monday to Friday, 9:00 AM to 6:00 PM EST",
                "address": "123 Innovation Drive, Suite 400, San Francisco, CA 94102",
                "phone": "+1 (555) 123-4567",
                "email": "support@techcorp.com",
                "services": "Web Development, Mobile Apps, Cloud Solutions, AI Integration",
                # Free-form company knowledge, written in Agent Setup >
                # Knowledge Base. Structure: one fact per line (or a short
                # paragraph per topic, blank line between topics). The
                # agent answers company questions from this text: it is
                # searched passage-by-passage before the AI model is used,
                # and it is also given to the model verbatim in the prompt.
                "company_info": (
                    "TechCorp Solutions is a software company based in San Francisco, California.\n"
                    "We build web applications, mobile apps, cloud solutions and AI integrations for startups and enterprises.\n"
                    "Our team has more than 40 engineers, designers and project managers.\n"
                    "We offer a free 30-minute consultation for every new project.\n"
                    "A basic business website starts at $2,500; full project pricing depends on the scope.\n"
                    "Every project includes 3 months of free support after launch.\n"
                    "To start a project, email support@techcorp.com or call +1 (555) 123-4567."
                )
            },
            faqs=[
                {"question": "What are your business hours?", "answer": "We are open Monday to Friday, 9 AM to 6 PM EST."},
                {"question": "How do I book an appointment?", "answer": "I can help you book an appointment right now. What date and time works best for you?"},
                {"question": "What services do you offer?", "answer": "We offer web development, mobile apps, cloud solutions, and AI integration services."},
            ]
        )
    
    def _build_system_prompt(self) -> str:
        """Build the system prompt for the AI agent"""
        config = self.config
        kb = config.knowledge_base
        
        return f"""You are {config.agent_name}, a professional and friendly AI receptionist for {config.company_name}.

YOUR ROLE:
- Answer incoming calls professionally
- Help callers with appointments, inquiries, and general information
- Route complex issues to human agents when needed
- Maintain a {config.personality} tone throughout the conversation

BUSINESS INFORMATION:
- Business Hours: {kb.get('business_hours', 'N/A')}
- Address: {kb.get('address', 'N/A')}
- Phone: {kb.get('phone', 'N/A')}
- Email: {kb.get('email', 'N/A')}
- Services: {kb.get('services', 'N/A')}

FAQs:
{chr(10).join([f"- Q: {faq['question']} A: {faq['answer']}" for faq in config.faqs])}

COMPANY KNOWLEDGE (the main source for questions about the company — its history, policies, prices, delivery, warranty and anything else written here):
{kb.get('company_info', '') or 'N/A'}

KNOWLEDGE DOCUMENTS (uploaded files; answer from them exactly as from the company knowledge above):
{chr(10).join([f"--- {d.get('name', 'document')} ---" + chr(10) + (d.get('content') or '') for d in config.knowledge_documents]) or 'None uploaded.'}

RULES:
1. Always greet the caller warmly
2. Listen carefully and identify the caller's intent
3. KNOWLEDGE BASE ONLY: answer questions using ONLY the BUSINESS INFORMATION, FAQs, COMPANY KNOWLEDGE and KNOWLEDGE DOCUMENTS above. If the answer is not in that data, say you don't have that information and offer to connect the caller with the team — never invent hours, prices, addresses, policies or services.
4. If you can't help, offer to transfer to a human agent
5. Keep responses concise and conversational (suitable for voice)
6. Never make up information you don't have
7. Always confirm important details (appointments, contact info)
8. End calls politely

RESPONSE FORMAT:
Respond in a natural, conversational way. Keep responses under 3 sentences when possible.
When you detect an intent, include it in your response.

AVAILABLE INTENTS:
- appointment_booking: Caller wants to schedule an appointment
- business_hours: Caller asking about operating hours
- general_inquiry: General questions about the company
- technical_support: Caller needs technical help
- complaint: Caller has a complaint
- transfer_request: Caller wants to speak to a human
- pricing: Caller asking about prices/services
- other: Anything else
"""

    async def process_message(
        self,
        call_id: str,
        user_message: str,
        context: Optional[CallContext] = None
    ) -> AgentResponse:
        """
        Process a caller's message and generate a response
        
        Args:
            call_id: Unique call identifier
            user_message: The caller's message (transcribed from speech)
            context: Additional call context
            
        Returns:
            AgentResponse with the agent's reply and detected intent
        """
        # Initialize conversation history for new calls
        if call_id not in self.conversation_history:
            self.conversation_history[call_id] = [
                {"role": "system", "content": self._build_system_prompt()}
            ]
            logger.info(f"New call started: {call_id}")
        
        # Add user message to history
        self.conversation_history[call_id].append({
            "role": "user",
            "content": user_message
        })

        # Knowledge base first. With a working AI model only a matching
        # FAQ is answered verbatim; every other question goes to the
        # model, which has the whole knowledge base in its prompt and
        # answers far more reliably than keyword matching. Without a
        # model, the keyword lookup answers from the same knowledge.
        llm_ready = self._llm_available()
        if llm_ready:
            kb_hit = self._faq_lookup(self._significant_words(user_message))
        else:
            kb_hit = self._converse(call_id, user_message)
        if kb_hit is not None:
            answer, intent = kb_hit
            self.conversation_history[call_id].append({
                "role": "assistant",
                "content": answer
            })
            logger.info(f"Call {call_id} - answered from knowledge base (intent: {intent})")
            return AgentResponse(
                message=answer,
                intent=intent,
                confidence=1.0,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=self._check_requires_action(intent),
                action_data=self._get_action_data(intent, user_message)
            )

        try:
            # Call OpenAI API
            response = await self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=self.conversation_history[call_id],
                temperature=settings.OPENAI_TEMPERATURE,
                max_tokens=settings.OPENAI_MAX_TOKENS,
            )
            
            agent_message = response.choices[0].message.content
            
            # Add agent response to history
            self.conversation_history[call_id].append({
                "role": "assistant",
                "content": agent_message
            })
            
            # Detect intent from the conversation
            intent = await self._detect_intent(call_id, user_message)
            
            logger.info(f"Call {call_id} - Intent: {intent} | Response: {agent_message[:50]}...")
            
            return AgentResponse(
                message=agent_message,
                intent=intent,
                confidence=0.95,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=self._check_requires_action(intent),
                action_data=self._get_action_data(intent, user_message)
            )
            
        except Exception as e:
            logger.error(f"Error processing message for call {call_id}: {e}")
            return AgentResponse(
                message="I'm sorry, I'm having trouble processing your request right now. Let me connect you with someone who can help.",
                intent="error",
                confidence=0.0,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=True,
                action_data={"action": "transfer_to_human"}
            )
    
    def _converse(self, call_id: str, message: str) -> tuple:
        """Knowledge-base answer for one caller turn, with the call's
        conversation state (no AI model configured)."""
        state = self.call_state.setdefault(call_id, CallState())
        if not state.asking:
            talk = self._small_talk(message)
            if talk:
                return talk
        kb = self.config.knowledge_base or {}
        contact = " or ".join(v for v in (kb.get("phone"), kb.get("email")) if v)
        knowledge = KnowledgeBase(self._knowledge_sources(), self.config.company_name)
        conv = Conversation(knowledge, state, lambda m, topic: self._kb_lookup(m, topic, knowledge), contact)
        return conv.reply(message)

    def _small_talk(self, message: str) -> Optional[tuple]:
        """Greetings and goodbyes, for when no AI model is available."""
        words = set(re.findall(r"[a-z']+", message.lower()))
        if words & {"bye", "goodbye", "thanks", "thank"}:
            return self.config.farewell, "other"
        if words & {"hello", "hi", "hey", "morning", "afternoon", "evening"} and len(words) <= 4:
            return "Hello! How can I help you today?", "other"
        return None

    @staticmethod
    def _llm_available() -> bool:
        """False when no real OpenAI key is set (empty, or still the
        placeholder from .env.example) — calling the API would only fail."""
        key = (settings.OPENAI_API_KEY or "").strip()
        return bool(key) and "your" not in key and key != "sk-..."

    @staticmethod
    def _significant_words(text: str) -> set:
        return key_words(text)

    def _knowledge_sources(self) -> list:
        """All free-form knowledge the agent answers from, as (name, text):
        the Company Knowledge text first, then each uploaded document."""
        kb = self.config.knowledge_base or {}
        sources = []
        info = (kb.get("company_info") or "").strip()
        if info:
            sources.append(("Company Knowledge", info))
        for doc in self.config.knowledge_documents or []:
            content = (doc.get("content") or "").strip()
            if content:
                sources.append((doc.get("name") or "document", content))
        return sources

    def _company_info_lookup(self, message: str, topic: Optional[str] = None,
                             knowledge: Optional[KnowledgeBase] = None) -> Optional[tuple]:
        """Answer from the free-form company knowledge — the Company
        Knowledge text plus every uploaded knowledge document — searched
        by section, list and Q/A pair (see app/services/knowledge.py).
        Returns (answer, intent, ref)."""
        if knowledge is None:
            sources = self._knowledge_sources()
            if not sources:
                return None
            knowledge = KnowledgeBase(sources, self.config.company_name)
        answer, ref = knowledge.search_detail(message, topic)
        return (answer, "general_inquiry", ref) if answer else None

    def _faq_lookup(self, msg_words: set) -> Optional[tuple]:
        """The FAQ whose question best matches the caller's key words.
        The best match wins (not the first one that shares a word), and
        it must cover most of the FAQ question's key words."""
        best, best_score = None, 0.0
        for faq in self.config.faqs or []:
            question = (faq.get("question") or "").strip()
            answer = (faq.get("answer") or "").strip()
            if not question or not answer:
                continue
            q_words = self._significant_words(question)
            if not q_words:
                continue
            shared = len(q_words & msg_words)
            if shared < min(2, len(q_words)) or shared * 3 < len(q_words) * 2:
                continue
            score = shared / len(q_words | msg_words)
            if score > best_score:
                best, best_score = answer, score
        return (best, "general_inquiry") if best else None

    def _kb_lookup(self, message: str, topic: Optional[str] = None,
                   knowledge: Optional[KnowledgeBase] = None) -> Optional[tuple]:
        """
        Match the caller's message against the knowledge base.

        Returns (answer, intent, ref) when an FAQ matches, a knowledge
        passage matches, or the message asks for a stored business fact
        (hours, address, phone, email, services); otherwise None. topic is
        the role being discussed in the call; ref names the knowledge
        section answered from ("tell me more" continues there).
        """
        lower = message.lower()
        msg_words = self._significant_words(message)

        # 1) FAQs.
        faq_hit = self._faq_lookup(msg_words)
        if faq_hit:
            return faq_hit[0], faq_hit[1], None

        kb = self.config.knowledge_base or {}

        def fact(key: str) -> str:
            return (kb.get(key) or "").strip()

        # 2) Contact facts — specific words, so they go before the passage
        # search. Email before address: "what is your email address".
        # "what positions are open" is about jobs, not opening hours; "where
        # do I send my CV" is about the CV, not the office address.
        place_words = {"located", "location", "address", "office", "based", "situated", "direction"}
        asks_place = bool(msg_words & place_words) or (
            "where" in lower and not msg_words - place_words - key_words(self.config.company_name))
        if any(w in lower for w in ("hour", "open", "close", "timing")) and "job" not in msg_words and fact("business_hours"):
            return f"Our business hours are {fact('business_hours')}.", "business_hours", None
        if "email" in lower and fact("email"):
            return f"Our email address is {fact('email')}.", "general_inquiry", None
        if any(w in lower for w in ("phone", "number", "contact")) and "cv" not in msg_words and fact("phone"):
            return f"You can reach us at {fact('phone')}.", "general_inquiry", None
        if asks_place and fact("address"):
            return f"We are located at {fact('address')}.", "general_inquiry", None

        # 3) Company knowledge passages, before the vague service words
        # below: "do you provide support after launch" must answer the
        # support line, not list the services because it says "provide".
        info_hit = self._company_info_lookup(message, topic, knowledge)
        if info_hit:
            return info_hit

        if any(w in lower for w in ("service", "offer", "provide")) and fact("services"):
            return f"We offer {fact('services')}.", "general_inquiry", None
        return None

    async def _detect_intent(self, call_id: str, message: str) -> str:
        """Detect the caller's intent from their message"""
        intent_prompt = f"""Analyze this caller message and return ONLY the intent category.
        
Message: "{message}"

Categories: appointment_booking, business_hours, general_inquiry, technical_support, complaint, transfer_request, pricing, other

Return only the category name, nothing else."""

        try:
            response = await self.client.chat.completions.create(
                model=settings.OPENAI_MODEL,
                messages=[{"role": "user", "content": intent_prompt}],
                temperature=0.1,
                max_tokens=20
            )
            intent = response.choices[0].message.content.strip().lower()
            valid_intents = [
                "appointment_booking", "business_hours", "general_inquiry",
                "technical_support", "complaint", "transfer_request", "pricing", "other"
            ]
            return intent if intent in valid_intents else "other"
        except Exception:
            return "other"
    
    def _check_requires_action(self, intent: str) -> bool:
        """Check if the detected intent requires an automated action"""
        action_intents = [
            "appointment_booking", "transfer_request", "complaint"
        ]
        return intent in action_intents
    
    def _get_action_data(self, intent: str, message: str) -> dict:
        """Get action data based on detected intent"""
        actions = {
            "appointment_booking": {"action": "collect_appointment_details"},
            "transfer_request": {"action": "transfer_to_human"},
            "complaint": {"action": "create_support_ticket"},
        }
        return actions.get(intent, {"action": "none"})
    
    async def stream_response(
        self,
        call_id: str,
        user_message: str
    ) -> AsyncGenerator[str, None]:
        """Stream the agent's response token by token"""
        if call_id not in self.conversation_history:
            self.conversation_history[call_id] = [
                {"role": "system", "content": self._build_system_prompt()}
            ]
        
        self.conversation_history[call_id].append({
            "role": "user",
            "content": user_message
        })
        
        stream = await self.client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=self.conversation_history[call_id],
            temperature=settings.OPENAI_TEMPERATURE,
            max_tokens=settings.OPENAI_MAX_TOKENS,
            stream=True
        )
        
        full_response = ""
        async for chunk in stream:
            if chunk.choices[0].delta.content:
                token = chunk.choices[0].delta.content
                full_response += token
                yield token
        
        # Save complete response to history
        self.conversation_history[call_id].append({
            "role": "assistant",
            "content": full_response
        })
    
    def end_call(self, call_id: str) -> dict:
        """End a call and return summary"""
        history = self.conversation_history.pop(call_id, [])
        state = self.call_state.pop(call_id, None)
        if state and state.answers:
            logger.info(f"Call {call_id} - screening answers for {state.topic}: {state.answers}")
        return {
            "call_id": call_id,
            "messages_count": len(history),
            "ended_at": datetime.utcnow().isoformat(),
            "summary": "Call ended successfully",
            "role": state.topic if state else None,
            "screening_answers": state.answers if state else {},
        }
    
    def update_config(self, config_data: dict) -> AgentConfig:
        """Update agent configuration and persist it to disk"""
        for key, value in config_data.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        self._save_config()
        logger.info("Agent configuration updated and saved")
        return self.config
    
    def get_config(self) -> AgentConfig:
        """Get current agent configuration"""
        return self.config

    # ---- Knowledge documents (.md/.txt uploads from Agent Setup) ----

    def list_knowledge_documents(self) -> list:
        """Uploaded knowledge documents (names and sizes, not content)."""
        return [
            {"name": d.get("name", ""), "characters": len(d.get("content") or "")}
            for d in self.config.knowledge_documents or []
        ]

    def add_knowledge_document(self, name: str, content: str) -> list:
        """Add or replace an uploaded knowledge document and persist it."""
        docs = [d for d in self.config.knowledge_documents or [] if d.get("name") != name]
        docs.append({"name": name, "content": content})
        self.config.knowledge_documents = docs
        self._save_config()
        logger.info(f"Knowledge document saved: {name} ({len(content)} chars)")
        return self.list_knowledge_documents()

    def remove_knowledge_document(self, name: str) -> bool:
        """Remove an uploaded knowledge document by file name."""
        docs = self.config.knowledge_documents or []
        kept = [d for d in docs if d.get("name") != name]
        if len(kept) == len(docs):
            return False
        self.config.knowledge_documents = kept
        self._save_config()
        logger.info(f"Knowledge document removed: {name}")
        return True
