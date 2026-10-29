"""
AI Agent Service - Core AI receptionist logic using OpenAI/Anthropic
"""

import json
from typing import AsyncGenerator, Optional
from datetime import datetime
from loguru import logger
from openai import AsyncOpenAI

from app.core.config import settings
from app.models.schemas import (
    AgentConfig, CallContext, Message, Intent, AgentResponse
)


class AIAgent:
    """
    AI Receptionist Agent
    Handles conversation logic, intent detection, and response generation
    """
    
    def __init__(self):
        self.client = AsyncOpenAI(api_key=settings.OPENAI_API_KEY)
        self.config = self._load_default_config()
        self.conversation_history: dict[str, list[dict]] = {}
        
    def _load_default_config(self) -> AgentConfig:
        """Load default agent configuration"""
        return AgentConfig(
            agent_name="Aria",
            company_name="TechCorp Solutions",
            language="English",
            voice="female-1",
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
                "services": "Web Development, Mobile Apps, Cloud Solutions, AI Integration"
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

RULES:
1. Always greet the caller warmly
2. Listen carefully and identify the caller's intent
3. Provide accurate information from the knowledge base
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
        """Update agent configuration"""
        for key, value in config_data.items():
            if hasattr(self.config, key):
                setattr(self.config, key, value)
        logger.info("Agent configuration updated")
        return self.config
    
    def get_config(self) -> AgentConfig:
        """Get current agent configuration"""
        return self.config
