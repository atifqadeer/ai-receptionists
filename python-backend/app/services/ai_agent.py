"""
AI Agent Service - Core AI receptionist logic using OpenAI/Anthropic
"""

import json
import re
from pathlib import Path
from typing import AsyncGenerator, Optional
from datetime import datetime
from loguru import logger
from openai import AsyncOpenAI, OpenAI

from app.core.config import settings
from app.core import store
from app.services import language_settings
from app.services import ai_model
from app.models.schemas import (
    AgentConfig, CallContext, Message, AgentResponse
)
from app.services.knowledge import KnowledgeBase, key_words
from app.services import company_facts
from app.services.conversation import CallState, Conversation

# The agent's configuration (identity + knowledge base + FAQs) is the
# single source the agent answers from. It is persisted to disk so the
# knowledge base set in the dashboard survives restarts — previously it
# lived only in memory and reset to the hardcoded defaults on restart.

class AIAgent:
    """
    AI Receptionist Agent
    Handles conversation logic, intent detection, and response generation
    """
    
    def __init__(self):
        self.config = self._load_config()
        self.conversation_history: dict[str, list[dict]] = {}
        # Per-call conversation state for knowledge-base answers (role being
        # discussed, screening progress, last reply) - see conversation.py.
        self.call_state: dict[str, CallState] = {}
        # Text chats (the test chat in the dashboard) started with
        # channel "chat"; website chats have ids starting "widget-".
        self.chat_sessions: set = set()
        # Chat callback / meeting requests: the visitor's contact details
        # (the website chat knows their email and name) and a request still
        # waiting for a phone number or a time.
        self.chat_contacts: dict[str, dict] = {}
        self.chat_requests: dict[str, dict] = {}

    def _load_config(self) -> AgentConfig:
        """Load the persisted config if present, else the defaults."""
        try:
            data = store.get_doc("agent_config")
            if data is not None:
                logger.info("Agent config loaded from MySQL")
                return AgentConfig.model_validate(data)
        except Exception as e:
            logger.warning(f"Could not load saved agent config ({e}); using defaults")
        return self._load_default_config()

    def _save_config(self) -> None:
        """Persist the current config (knowledge base included)."""
        try:
            store.put_doc("agent_config", self.config.model_dump())
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
    
    def _build_system_prompt(self, channel: str = "calls") -> str:
        """The AI model's instructions, with the language rules for `channel`
        ("chat" or "calls", Settings > Agent > Languages)."""
        extra = (ai_model.get().get("instructions") or "").strip()
        extra = f"\n\nADDITIONAL INSTRUCTIONS FROM THE BUSINESS:\n{extra}" if extra else ""
        return self._base_system_prompt() + extra + language_settings.prompt_rules(channel)

    @property
    def client(self):
        """The AI model client (Settings > System > AI Model)."""
        return ai_model.client()

    def _base_system_prompt(self) -> str:
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
3. COMPANY FACTS FROM THE KNOWLEDGE ONLY: anything about the company (its name, roles, hours, prices, addresses, policies, services) comes ONLY from the BUSINESS INFORMATION, FAQs, COMPANY KNOWLEDGE and KNOWLEDGE DOCUMENTS above. If a company fact is not there, say you don't have that information and offer to connect the caller with the team — never invent it.
3b. OTHER QUESTIONS: a general question that is not about the company (general knowledge, a word's meaning, a simple calculation, small talk) — think it through and answer it briefly and helpfully from your own knowledge in one or two sentences, then offer to help with anything about the company. Only decline what is harmful or inappropriate.
3c. LANGUAGE: follow the LANGUAGE RULES at the end of these instructions strictly.
3d. STAY ON CAMPAIGN: you represent {config.company_name}'s current hiring campaign. For small talk or questions unrelated to the company (weather, sports, jokes, politics...), give at most one short friendly sentence, then bring the conversation back to the roles the company is hiring for and how to apply. For gibberish, ask them politely to rephrase. Never send the same sentence twice; vary your wording.
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
            prompt = self._build_system_prompt("chat" if self.is_chat(call_id) else "calls")
            if self.is_chat(call_id):
                prompt += ("\n\nThis is a TEXT CHAT on the company website, not a phone call: never say "
                           "\"thank you for calling\"; when the chat ends say something like \"Thanks for chatting with us\". "
                           "Keep answers short and friendly.")
            self.conversation_history[call_id] = [{"role": "system", "content": prompt}]
            logger.info(f"New call started: {call_id}")
        
        # Add user message to history
        self.conversation_history[call_id].append({
            "role": "user",
            "content": user_message
        })

        # "Who are you?", "how are you?", "can I talk to a human?"
        own = self._self_turn(call_id, user_message)
        if own:
            text, intent, action = own
            self.conversation_history[call_id].append({"role": "assistant", "content": text})
            return AgentResponse(message=text, intent=intent, confidence=1.0, call_id=call_id,
                                 timestamp=datetime.utcnow().isoformat(),
                                 requires_action=action.get("action") != "none", action_data=action)

        # Chat: "call me back tomorrow", "can I book a meeting with the recruiter?"
        if self.is_chat(call_id):
            follow = self._chat_follow_up(call_id, user_message)
            if follow:
                self.conversation_history[call_id].append({"role": "assistant", "content": follow})
                return AgentResponse(message=follow, intent="appointment_booking", confidence=1.0, call_id=call_id,
                                     timestamp=datetime.utcnow().isoformat(), requires_action=False,
                                     action_data={"action": "follow_up_recorded"
                                                  if call_id not in self.chat_requests else "collecting_details"})

        # Knowledge base first. With a working AI model only a matching
        # FAQ is answered verbatim; every other question goes to the
        # model, which has the whole knowledge base in its prompt and
        # answers far more reliably than keyword matching. Without a
        # model, the keyword lookup answers from the same knowledge.
        llm_ready = self._llm_available()
        # Company name, address, contact details, hours, roles: straight
        # from Agent Setup, before any search or AI model.
        # The language guardrail (Settings > Agent > Languages) applies with or
        # without the AI model: the model sometimes replied in a language
        # that isn't switched on.
        kb_hit = self._conversation(call_id).guard(user_message)
        if kb_hit is None:
            kb_hit = self._company_fact(call_id, user_message)
        if kb_hit is None:
            if llm_ready:
                kb_hit = self._faq_lookup(self._significant_words(user_message))
                if kb_hit is None:
                    # An FAQ in the knowledge documents asking this very
                    # question is answered as written (the model sometimes
                    # answered "how can I apply" with just the role list).
                    sources = self._knowledge_sources()
                    doc_faq = KnowledgeBase(sources, self.config.company_name).faq_answer(user_message) if sources else None
                    if doc_faq:
                        kb_hit = (doc_faq, "general_inquiry")
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
            m = ai_model.get()
            response = await self.client.chat.completions.create(
                model=m["model"],
                messages=self.conversation_history[call_id],
                temperature=m["temperature"],
                max_tokens=m["max_tokens"],
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
            # The AI model failed (bad key, quota, timeout...): answer with the
            # built-in agent instead, so the caller or visitor still gets a reply.
            logger.warning(f"AI model failed for {call_id} ({e}); answering with the built-in agent")
            ai_model.report_failure(e)
            history = self.conversation_history.get(call_id) or []
            if history and history[-1].get("role") == "user":
                history.pop()      # _converse adds the turn itself through the Conversation
            answer, intent = self._converse(call_id, user_message)
            self.conversation_history.setdefault(call_id, []).extend(
                [{"role": "user", "content": user_message}, {"role": "assistant", "content": answer}])
            return AgentResponse(
                message=answer,
                intent=intent,
                confidence=0.8,
                call_id=call_id,
                timestamp=datetime.utcnow().isoformat(),
                requires_action=self._check_requires_action(intent),
                action_data=self._get_action_data(intent, user_message)
            )
    
    def think(self, question: str, situation: str, history: Optional[list] = None) -> Optional[str]:
        """A short spoken answer the AI model thinks up itself, for a
        question no rule or knowledge-base passage answers (used by the
        job calls). Company facts only from the knowledge; general
        questions from the model's own knowledge. None without a working
        AI model, or when the model can't be reached in time (the call
        carries on with its own fallback). Synchronous: runs in the call's
        own thread."""
        if not self._llm_available():
            return None
        cfg = self.config
        kb = cfg.knowledge_base or {}
        facts = "\n".join(f"- {k.replace('_', ' ').title()}: {kb[k]}" for k in
                          ("address", "phone", "email", "business_hours", "services") if kb.get(k))
        docs = "\n\n".join(f"--- {name} ---\n{text}" for name, text in self._knowledge_sources())[:12000]
        system = (
            f"You are {cfg.agent_name}, an AI assistant phoning on behalf of {cfg.company_name}. {situation}\n\n"
            f"COMPANY DETAILS:\n- Company name: {cfg.company_name}\n{facts}\n\n"
            f"COMPANY KNOWLEDGE:\n{docs or 'None.'}\n\n"
            "HOW TO ANSWER (this is a live phone call, your words are spoken aloud):\n"
            "- Think about what the person actually asked and answer that, in one or two short, natural sentences.\n"
            "- Facts about the company (name, roles, address, contact details, process, pay, policies) come ONLY "
            "from COMPANY DETAILS and COMPANY KNOWLEDGE. If a company fact isn't there, say the recruiter will confirm it.\n"
            "- Any other question (general knowledge, a word's meaning, a simple sum, small talk): answer it briefly "
            "and helpfully from your own knowledge.\n"
            "- Decline only what is harmful, offensive or inappropriate, politely.\n"
            "- No lists, no markdown, no emojis. Do NOT end with a question: the call adds its own follow-up."
        ) + language_settings.prompt_rules("calls")
        messages = [{"role": "system", "content": system}]
        for turn in (history or [])[-6:]:
            messages.append(turn)
        messages.append({"role": "user", "content": question})
        try:
            response = ai_model.client(sync=True, timeout=5.0).chat.completions.create(
                model=ai_model.get()["model"], messages=messages, temperature=0.4, max_tokens=90)
            answer = re.sub(r"\s+", " ", (response.choices[0].message.content or "")).strip()
            return answer or None
        except Exception as e:
            logger.warning(f"AI model could not answer {question!r}: {e}")
            ai_model.report_failure(e)
            return None

    # Questions about the agent itself, and asking for a person: answered
    # before any knowledge search ("what is your name?" used to find the
    # screening checklist "The candidate provides: full name, ...").
    _HUMAN = re.compile(
        r"\b((live|real|human)( chat)? (agent|person|operator|support|team member)|"
        r"(talk|speak|chat) (to|with) (a |an |the |your |some )?(human|person|real person|live agent|agent|operator|"
        r"someone|somebody|team|staff|representative|advisor|adviser|recruiter|consultant|member of (your|the) team)|"
        r"transfer (me|the chat|this chat|chat|my chat)|customer (service|support)|connect me (to|with)|"
        r"(get|want|need) (a |an )?(human|real person|live agent|person))\b", re.I)
    _IDENTITY = re.compile(
        r"\b(who (are|r) (you|u)|what('?s| is) (your|ur) name|(tell me )?your name\b|"
        r"who am i (talking|speaking|chatting) (to|with)|"
        r"are (you|u) (a |an )?(robot|bot|real|human|person|machine|computer|ai|chatbot|chat bot)|"
        r"is this (a |an )?(bot|robot|real person|human|ai|chatbot))", re.I)
    _HOW_ARE_YOU = re.compile(r"\b(how are (you|u)|how r u|how('?s| is) it going|how (have|'?ve) you been|"
                              r"what about you|and you\s*\??$|how('?s| is) your day)", re.I)

    def _self_turn(self, call_id: str, message: str) -> Optional[tuple]:
        """(reply, intent, action) for "who are you?", "are you a bot?", "how
        are you?" and, in a chat, "can I talk to a human?"; else None."""
        cfg = self.config
        agent, company = cfg.agent_name or "the assistant", cfg.company_name or "our company"
        chat = self.is_chat(call_id)
        if chat and self._HUMAN.search(message):
            email = (self.chat_contacts.get(call_id) or {}).get("email")
            return (("Of course. I'm passing this chat to a member of our team now; they'll reply right here as "
                     "soon as they can." + (f" If they're away, they'll get back to you at {email}." if email else "")),
                    "transfer_request", {"action": "transfer_to_human"})
        if self._IDENTITY.search(message):
            roles = KnowledgeBase(self._knowledge_sources(), company).roles()
            offer = (f"I can tell you about our {company_facts._join(roles)} roles, how to apply"
                     + (", or pass you to a member of our team" if chat else "") + ". ") if roles else ""
            if re.search(r"\b(robot|bot|real|human|person|machine|computer|ai|chatbot)\b", message, re.I):
                return (f"I'm {agent}, an AI assistant for {company}. {offer}How can I help you?").replace("  ", " "), \
                    "general_inquiry", {"action": "none"}
            return (f"I'm {agent}, the AI assistant for {company}. {offer}What would you like to know?"), \
                "general_inquiry", {"action": "none"}
        if self._HOW_ARE_YOU.search(message) and len(message.split()) <= 12:
            return "I'm doing well, thank you for asking! How can I help you today?", "other", {"action": "none"}
        # "Do you have nurse jobs in London?": where the vacancies are (the
        # role description used to come back instead).
        place = self._JOBS_IN.search(message)
        if place and (place.group(1)[0].isupper() or place.group(1).lower() in self._UK_PLACES):
            kb = KnowledgeBase(self._knowledge_sources(), company)
            where = kb.faq_answer("Do you have vacancies throughout the UK?", 0.5) or ""
            role = kb.find_role(message)
            if where:
                return (f"{where} Our recruitment team can tell you about current "
                        f"{role + ' ' if role else ''}vacancies in {place.group(1).title()}"
                        f"{' and take your details' if role else ''}. "
                        + ("Would you like the requirements for the role, or shall I take a few details?" if role
                           else "Which role are you interested in?")), "general_inquiry", {"action": "none"}
        # "Are there jobs in healthcare?": the roles in that sector (a role
        # document's "Category: Healthcare." line used to come back).
        sector = self._SECTOR.search(message) or self._SECTOR_BEFORE.search(message)
        if sector:
            from app.services import role_categories
            cat = role_categories.category(sector.group(1) or "")
            kb = KnowledgeBase(self._knowledge_sources(), company)
            roles = kb.roles()
            low = message.lower()
            named = any(re.search(rf"\b{re.escape(r.lower())}s?\b", low) for r in roles)
            if cat and not named:
                same = [r for r in roles if role_categories.category(r) == cat]
                if same:
                    return (f"Yes! In {cat}, we recruit for {company_facts._join(same)} positions. "
                            "Which one would you like to know more about?"), "general_inquiry", {"action": "none"}
                if roles:
                    return (f"We don't currently recruit in {cat}, I'm afraid. We recruit for "
                            f"{company_facts._join(roles)} positions. Would any of those interest you?"), \
                        "general_inquiry", {"action": "none"}
        return None

    _SECTOR = re.compile(r"\b(?:jobs?|roles?|vacanc\w+|positions?|work|opportunit\w+|openings?)\b[^?.!]*?"
                         r"\b(?:in|for|within)\s+(?:the\s+)?([a-z]+(?:\s[a-z]+)?)", re.I)
    _SECTOR_BEFORE = re.compile(r"\b([a-z]+)\s+(?:jobs|roles|vacancies|positions)\b", re.I)

    _JOBS_IN = re.compile(r"\b(?:jobs?|vacanc\w+|roles?|positions?|work|openings?|opportunit\w+)\b[^?.!]*?"
                          r"\b(?:in|near|around|based in)\s+([A-Za-z][a-z]+)")
    _UK_PLACES = {"london", "manchester", "birmingham", "leeds", "liverpool", "glasgow", "edinburgh", "bristol",
                  "cardiff", "sheffield", "newcastle", "nottingham", "leicester", "coventry", "belfast", "bradford",
                  "southampton", "brighton", "oxford", "cambridge", "reading", "york", "uk", "england", "scotland",
                  "wales"}

    _PHONE = re.compile(r"(?<![\w@])\+?\d[\d\s().-]{6,}\d(?![\w@])")
    _EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
    _NAME = re.compile(r"\b(?:my name is|my name's|i am|i'm|im|this is|name:)\s+([A-Za-z][A-Za-z'-]+(?:\s+[A-Za-z][A-Za-z'-]+)?)",
                       re.I)
    _NOT_NAMES = {"busy", "driving", "interested", "looking", "free", "available", "here", "not", "at", "in", "on",
                  "a", "an", "the", "working", "out", "fine", "good", "ok", "okay", "sorry", "calling", "trying"}

    def _chat_follow_up(self, conv_id: str, text: str) -> Optional[str]:
        """A callback or meeting request in a text chat: collect what the
        team needs (a phone number for a callback; a time and a way to reach
        them for a meeting), then put it on the Follow-ups page. Returns the
        reply, or None when this message isn't part of one."""
        from app.services import call_intents, follow_ups
        contact = self.chat_contacts.setdefault(conv_id, {})
        phone = self._PHONE.search(text)
        email = self._EMAIL.search(text)
        name = self._NAME.search(text)
        if phone and len(re.sub(r"\D", "", phone.group(0))) >= 7:
            contact["phone"] = phone.group(0).strip()
        if email:
            contact["email"] = email.group(0)
        if name and name.group(1).split()[0].lower() not in self._NOT_NAMES:
            contact["name"] = name.group(1).title()

        low = text.lower()
        req = self.chat_requests.get(conv_id)
        if req is None:
            if call_intents.is_meeting_request(text):
                kind = "meeting"
            elif call_intents.detect(text, allow_voicemail=False) == "callback" or \
                    re.search(r"\b(call|ring|phone) me\b|\b(a |request a )?call ?back\b", low):
                kind = "callback"
            else:
                return None
            req = self.chat_requests[conv_id] = {"kind": kind, "when": call_intents.callback_when(text),
                                                 "said": text[:300], "asked": 0}
        else:
            when = call_intents.callback_when(text)
            req["when"] = req["when"] or when
            req["said"] = (req["said"] + " / " + text)[:400]
            gave_details = bool(phone or email or name or when)
            if not gave_details and (low.rstrip().endswith("?") or req["asked"] >= 2):
                # They moved on: keep what we have if it's enough, else let it go.
                self.chat_requests.pop(conv_id, None)
                if req["kind"] == "meeting" and (contact.get("email") or contact.get("phone")):
                    self._save_chat_follow_up(conv_id, req, contact)
                return None
            if not gave_details and req["asked"] >= 1 and not req["when"]:
                req["when"] = text.strip().rstrip(".")[:80]       # "any time", "the 3rd": as they said it

        needs_phone = req["kind"] == "callback" and not contact.get("phone")
        needs_contact = req["kind"] == "meeting" and not (contact.get("phone") or contact.get("email"))
        needs_time = not req["when"] and req["asked"] == 0
        if (needs_phone or needs_contact or needs_time) and req["asked"] < 2:
            req["asked"] += 1
            ask = []
            if needs_phone:
                ask.append("the best phone number to call you on")
            elif needs_contact:
                ask.append("a phone number or email address we can reach you on")
            if needs_time:
                ask.append("what day and time suits you" if req["kind"] == "meeting" else "when suits you best")
            lead = ("Of course! I'll ask our recruitment team to arrange a meeting with you."
                    if req["kind"] == "meeting" else "Of course! I'll ask our recruitment team to call you back.")
            if req["asked"] > 1:
                lead = "Sorry, I didn't quite get that."
            return f"{lead} Could you tell me {' and '.join(ask)}?"
        if needs_phone or needs_contact:
            self.chat_requests.pop(conv_id, None)
            kb = self.config.knowledge_base or {}
            reach = " or ".join(v for v in (kb.get("phone"), kb.get("email")) if v)
            return ("No problem. " + (f"You can reach our recruitment team on {reach} whenever suits you. " if reach else "")
                    + "Is there anything else I can help you with?")
        self.chat_requests.pop(conv_id, None)
        self._save_chat_follow_up(conv_id, req, contact)
        who = f", {contact['name'].split()[0]}" if contact.get("name") else ""
        when = req["when"]
        if req["kind"] == "callback":
            return (f"Thanks{who}! I've asked our recruitment team to call you on {contact['phone']}"
                    f"{' ' + when if when else ' as soon as they can'}. Is there anything else I can help you with?")
        how = contact.get("phone") or contact.get("email")
        return (f"Thanks{who}! I've passed your request for a meeting {follow_ups._for(when) if when else ''} to our "
                f"recruitment team. They'll contact you on {how} to confirm it. Is there anything else I can help you with?"
                ).replace("meeting  to", "meeting to")

    def _save_chat_follow_up(self, conv_id: str, req: dict, contact: dict) -> None:
        from app.services import follow_ups
        try:
            follow_ups.add(req["kind"], "chat", phone=contact.get("phone", ""), name=contact.get("name", ""),
                           email=contact.get("email", ""), when=req.get("when", ""), said=req.get("said", ""),
                           ref=conv_id)
        except Exception as e:
            logger.warning(f"Chat {conv_id}: follow-up not recorded: {e}")

    def _company_fact(self, call_id: str, message: str) -> Optional[tuple]:
        """(answer, intent) for a question about the company itself, else
        None. Calls the agent places itself (dial pad) have call ids that
        start with "dialed-": there the agent is the one calling."""
        intent = company_facts.detect(message, self.config.company_name)
        if not intent:
            return None
        roles, overview = None, ""
        if intent in ("roles", "company_services"):
            kb = KnowledgeBase(self._knowledge_sources(), self.config.company_name)
            roles = kb.roles()
            overview = (kb.overview() or "") if intent == "company_services" else ""
        text = company_facts.answer(intent, self.config.company_name, self.config.knowledge_base or {}, roles,
                                    calling=call_id.startswith("dialed-"), overview=overview)
        if not text:
            return None
        state = self.call_state.get(call_id)
        if state is not None and state.language != "english":
            from app.services import chat_language
            return chat_language.localize(state.language, text, state.turns), "general_inquiry"
        if state is not None and state.asking:
            text += f" Now, back to your application: {state.asking}"
        elif intent == "roles":
            text += " Which role are you interested in?"
        return text, "general_inquiry"

    def _converse(self, call_id: str, message: str) -> tuple:
        """Knowledge-base answer for one caller turn, with the call's
        conversation state (no AI model configured)."""
        # Greetings, thanks, language changes, gibberish and off-topic
        # questions are handled in the Conversation (in the visitor's language).
        return self._conversation(call_id).reply(message)

    def _conversation(self, call_id: str) -> Conversation:
        state = self.call_state.setdefault(call_id, CallState())
        kb = self.config.knowledge_base or {}
        contact = " or ".join(v for v in (kb.get("phone"), kb.get("email")) if v)
        knowledge = KnowledgeBase(self._knowledge_sources(), self.config.company_name)
        channel = "chat" if self.is_chat(call_id) else "calls"
        return Conversation(knowledge, state, lambda m, topic: self._kb_lookup(m, topic, knowledge), contact,
                            company=self.config.company_name, agent=self.config.agent_name,
                            farewell=self.chat_goodbye() if self.is_chat(call_id) else self.config.farewell,
                            allowed=language_settings.allowed(channel), default_lang=language_settings.default(channel),
                            medium="chat" if channel == "chat" else "call")

    def _small_talk(self, message: str) -> Optional[tuple]:
        """Greetings and goodbyes, for when no AI model is available."""
        words = set(re.findall(r"[a-z']+", message.lower()))
        if words & {"bye", "goodbye", "thanks", "thank"}:
            return self.config.farewell, "other"
        if words & {"hello", "hi", "hey", "morning", "afternoon", "evening"} and len(words) <= 4:
            return "Hello! How can I help you today?", "other"
        return None

    def is_chat(self, call_id: str) -> bool:
        """A text chat (website widget or the dashboard's test chat), not a phone call."""
        return call_id.startswith("widget-") or call_id in self.chat_sessions

    def chat_welcome(self) -> str:
        """The first message of a text chat (Chat > Widget setup > Welcome message)."""
        w = (store.get_doc("widget") or {}).get("welcome") or ""
        cfg = self.config
        return w.strip() or f"Hi! I'm {cfg.agent_name or 'the assistant'} from {cfg.company_name or 'our team'}. How can I help you today?"

    def chat_goodbye(self) -> str:
        """How a text chat ends (Chat > Widget setup > Goodbye message): the
        phone farewell says "thank you for calling"."""
        g = (store.get_doc("widget") or {}).get("goodbye") or ""
        return g.strip() or f"Thanks for chatting with {self.config.company_name or 'us'}! Have a wonderful day."

    @staticmethod
    def _llm_available() -> bool:
        """An AI model is set up and switched on (Settings > System > AI
        Model); otherwise the agent uses its built-in rules."""
        return ai_model.available()

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
                model=ai_model.get()["model"],
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
        
        m = ai_model.get()
        stream = await self.client.chat.completions.create(
            model=m["model"],
            messages=self.conversation_history[call_id],
            temperature=m["temperature"],
            max_tokens=m["max_tokens"],
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
        self.chat_sessions.discard(call_id)
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
