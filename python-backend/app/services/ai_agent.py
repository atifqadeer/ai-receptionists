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

# The agent's configuration (identity + knowledge base + FAQs) is the
# single source the agent answers from. It is persisted to disk so the
# knowledge base set in the dashboard survives restarts — previously it
# lived only in memory and reset to the hardcoded defaults on restart.
_CONFIG_FILE = Path(__file__).resolve().parents[2] / "data" / "agent_config.json"

_STOPWORDS = {
    "what", "when", "where", "which", "your", "yours", "about", "there",
    "their", "this", "that", "with", "have", "does", "did", "will",
    "would", "could", "should", "please", "thanks", "thank",
}


class AIAgent:
    """
    AI Receptionist Agent
    Handles conversation logic, intent detection, and response generation
    """
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.config = self._load_config()
        self.conversation_history: dict[str, list[dict]] = {}

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

RULES:
1. Always greet the caller warmly
2. Listen carefully and identify the caller's intent
3. KNOWLEDGE BASE ONLY: answer questions using ONLY the BUSINESS INFORMATION and FAQs above. If the answer is not in that data, say you don't have that information and offer to connect the caller with the team — never invent hours, prices, addresses, policies or services.
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

        # Knowledge base first: if the caller's question matches a
        # configured FAQ or asks for a stored business fact, answer
        # verbatim from the knowledge base. Chat and phone calls both
        # come through here, so both speak from the same data — and
        # these answers work even when the AI provider is unavailable.
        kb_hit = self._kb_lookup(user_message)
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
    
    @staticmethod
    def _significant_words(text: str) -> set:
        words = set()
        for w in re.findall(r"[a-z0-9]+", text.lower()):
            if len(w) <= 3 or w in _STOPWORDS:
                continue
            # Light stemming so "deliver" matches "delivery"-style plurals
            # and simple plural forms ("charges" -> "charge").
            if len(w) > 4 and w.endswith("s"):
                w = w[:-1]
            words.add(w)
        return words

    @staticmethod
    def _kb_passages(text: str) -> list:
        """Split free-form company knowledge into searchable passages.

        Structure the agent reads: one fact per line; a long line is
        split into its sentences; blank lines separate topics.
        """
        passages = []
        for line in (text or "").splitlines():
            line = line.strip(" \t-•*")
            if not line:
                continue
            if len(line) > 220:
                parts = re.split(r"(?<=[.!?])\s+", line)
                passages.extend(p.strip() for p in parts if len(p.strip()) > 15)
            else:
                passages.append(line)
        return passages

    def _company_info_lookup(self, message: str, msg_words: set) -> Optional[tuple]:
        """Answer from the free-form company knowledge text, if it matches."""
        kb = self.config.knowledge_base or {}
        info = (kb.get("company_info") or "").strip()
        if not info:
            return None
        passages = self._kb_passages(info)
        if not passages:
            return None

        lower = message.lower()
        # "Tell me about your company" style questions get the overview:
        # the first passage(s) of the knowledge text.
        if ("about" in lower and ("company" in lower or "business" in lower)) or \
           "who are you" in lower or "your company" in lower or "your business" in lower:
            overview = passages[0]
            if len(passages) > 1 and len(overview) < 160:
                overview = overview + " " + passages[1]
            return overview, "general_inquiry"

        if not msg_words:
            return None
        best, best_shared = None, 0
        for passage in passages:
            shared = len(self._significant_words(passage) & msg_words)
            if shared > best_shared:
                best, best_shared = passage, shared
        # Accept a passage when at least two of the caller's key words
        # appear in it and they cover at least half of those key words
        # (a single key word must match exactly).
        needed = 1 if len(msg_words) == 1 else 2
        if best is not None and best_shared >= needed and best_shared * 2 >= len(msg_words):
            return best, "general_inquiry"
        return None

    def _kb_lookup(self, message: str) -> Optional[tuple]:
        """
        Match the caller's message against the knowledge base.

        Returns (answer, intent) when an FAQ matches or the message asks
        for a stored business fact (hours, address, phone, email,
        services); otherwise None so the AI model handles it — grounded
        by the same knowledge base in its system prompt.
        """
        lower = message.lower()
        msg_words = self._significant_words(message)

        # 1) FAQs: match on the FAQ question's significant words.
        for faq in self.config.faqs or []:
            question = (faq.get("question") or "").strip()
            answer = (faq.get("answer") or "").strip()
            if not question or not answer:
                continue
            q_words = self._significant_words(question)
            if not q_words:
                continue
            shared = len(q_words & msg_words)
            if shared >= min(2, len(q_words)):
                return answer, "general_inquiry"

        # 2) Stored business facts.
        kb = self.config.knowledge_base or {}

        def fact(key: str) -> str:
            return (kb.get(key) or "").strip()

        if any(w in lower for w in ("hour", "open", "close", "timing")) and fact("business_hours"):
            return f"Our business hours are {fact('business_hours')}.", "business_hours"
        if any(w in lower for w in ("where", "address", "location", "located", "direction")) and fact("address"):
            return f"We are located at {fact('address')}.", "general_inquiry"
        if any(w in lower for w in ("phone", "number", "contact")) and fact("phone"):
            return f"You can reach us at {fact('phone')}.", "general_inquiry"
        if "email" in lower and fact("email"):
            return f"Our email address is {fact('email')}.", "general_inquiry"
        if any(w in lower for w in ("service", "offer", "provide")) and fact("services"):
            return f"We offer {fact('services')}.", "general_inquiry"
        # 3) Free-form company knowledge written in Agent Setup: any
        # other company question is answered from that text.
        return self._company_info_lookup(message, msg_words)

    async def _detect_intent(self, call_id: str, message: str) -> str:
        """Detect the caller's intent from their message"""
        intent_prompt = f"""Analyze this caller message and return ONLY the intent category.
        
Message: "{message}"

Categories: appointment_booking, business_hours, general_inquiry, technical_support, complaint, transfer_request, pricing, other

Return only the category name, nothing else."""

        try:
            response = await self.client.chat.completions.create(
                model="gpt-3.5-turbo",
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
        return {
            "call_id": call_id,
            "messages_count": len(history),
            "ended_at": datetime.utcnow().isoformat(),
            "summary": "Call ended successfully"
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
