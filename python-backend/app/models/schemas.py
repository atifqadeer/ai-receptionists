"""
Pydantic schemas for request/response models
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum


class CallStatus(str, Enum):
    RINGING = "ringing"
    ACTIVE = "active"
    ON_HOLD = "on_hold"
    TRANSFERRING = "transferring"
    ENDED = "ended"
    MISSED = "missed"


class IntentType(str, Enum):
    APPOINTMENT_BOOKING = "appointment_booking"
    BUSINESS_HOURS = "business_hours"
    GENERAL_INQUIRY = "general_inquiry"
    TECHNICAL_SUPPORT = "technical_support"
    COMPLAINT = "complaint"
    TRANSFER_REQUEST = "transfer_request"
    PRICING = "pricing"
    OTHER = "other"
    ERROR = "error"


class Personality(str, Enum):
    PROFESSIONAL = "professional"
    FRIENDLY = "friendly"
    CASUAL = "casual"
    EMPATHETIC = "empathetic"


# ---- Agent Config ----
class KnowledgeBase(BaseModel):
    business_hours: str = "Monday to Friday, 9:00 AM to 6:00 PM EST"
    address: str = ""
    phone: str = ""
    email: str = ""
    services: str = ""


class FAQ(BaseModel):
    question: str
    answer: str


class AgentConfig(BaseModel):
    agent_name: str = "Aria"
    company_name: str = "TechCorp Solutions"
    language: str = "English"
    voice: str = "female-1"
    speaking_rate: float = 1.0
    pitch: float = 1.0
    greeting: str = "Hello! Thank you for calling. How can I help you today?"
    farewell: str = "Thank you for calling! Have a wonderful day."
    personality: str = "professional"
    max_call_duration: int = 15
    silence_timeout: int = 8
    allow_interrupts: bool = True
    knowledge_base: Dict[str, str] = {}
    faqs: List[Dict[str, str]] = []


# ---- Call Models ----
class CallContext(BaseModel):
    call_id: str
    caller_number: Optional[str] = None
    caller_name: Optional[str] = None
    status: CallStatus = CallStatus.ACTIVE
    started_at: datetime = Field(default_factory=datetime.utcnow)
    duration_seconds: int = 0


class Message(BaseModel):
    id: str
    sender: str  # "agent", "caller", "system"
    text: str
    timestamp: str
    intent: Optional[str] = None


class AgentResponse(BaseModel):
    message: str
    intent: str = "other"
    confidence: float = 0.0
    call_id: str
    timestamp: str
    requires_action: bool = False
    action_data: Dict[str, Any] = {}


# ---- Automation Models ----
class AutomationRule(BaseModel):
    id: int
    name: str
    trigger: str
    action: str
    enabled: bool = True
    priority: int = 1


class Workflow(BaseModel):
    id: int
    name: str
    steps: int
    status: str = "active"
    calls: int = 0


# ---- Analytics Models ----
class CallLog(BaseModel):
    id: str
    caller: str
    number: str
    time: str
    duration: str
    status: str
    intent: str
    satisfaction: int = 0


class DashboardStats(BaseModel):
    total_calls: int = 0
    calls_handled: int = 0
    avg_response_time: float = 0.0
    satisfaction_rate: float = 0.0
    resolution_rate: float = 0.0
    transfer_rate: float = 0.0


# ---- Settings Models ----
class TelephonyConfig(BaseModel):
    provider: str = "twilio"
    account_sid: str = ""
    auth_token: str = ""
    phone_number: str = ""
    webhook_url: str = ""
    max_concurrent_calls: int = 10
    enable_sip: bool = False


class AIModelConfig(BaseModel):
    provider: str = "openai"
    model: str = "gpt-4-turbo-preview"
    api_key: str = ""
    temperature: float = 0.7
    max_tokens: int = 500
    system_prompt: str = ""
    enable_function_calling: bool = True
    enable_memory: bool = True


class TeamMember(BaseModel):
    id: int
    name: str
    role: str
    email: str
    status: str = "active"


# ---- WebSocket Models ----
class WSMessage(BaseModel):
    type: str  # "text", "audio", "intent", "status", "error"
    data: Dict[str, Any] = {}
    call_id: Optional[str] = None
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
