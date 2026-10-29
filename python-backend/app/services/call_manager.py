"""
Call Manager Service - Handles call lifecycle and routing
"""

import uuid
from datetime import datetime
from typing import Dict, Optional, List
from loguru import logger

from app.models.schemas import CallContext, CallStatus, CallLog


class CallManager:
    """
    Manages active calls, call routing, and call history
    """
    
    def __init__(self):
        self.active_calls: Dict[str, CallContext] = {}
        self.call_history: List[CallLog] = []
        self.max_concurrent_calls = 10
        
    async def start_call(
        self,
        caller_number: Optional[str] = None,
        caller_name: Optional[str] = None
    ) -> CallContext:
        """Start a new call"""
        if len(self.active_calls) >= self.max_concurrent_calls:
            raise Exception("Maximum concurrent calls reached")
        
        call_id = str(uuid.uuid4())
        call = CallContext(
            call_id=call_id,
            caller_number=caller_number,
            caller_name=caller_name,
            status=CallStatus.ACTIVE,
            started_at=datetime.utcnow()
        )
        
        self.active_calls[call_id] = call
        logger.info(f"Call started: {call_id} from {caller_number or 'unknown'}")
        return call
    
    async def end_call(self, call_id: str) -> Optional[CallLog]:
        """End an active call"""
        if call_id not in self.active_calls:
            return None
        
        call = self.active_calls.pop(call_id)
        duration = (datetime.utcnow() - call.started_at).total_seconds()
        
        # Create call log entry
        log = CallLog(
            id=call_id[:8].upper(),
            caller=call.caller_name or "Unknown Caller",
            number=call.caller_number or "Unknown",
            time=call.started_at.strftime("%Y-%m-%d %H:%M"),
            duration=f"{int(duration // 60)}:{int(duration % 60):02d}",
            status="resolved",
            intent="general_inquiry",
            satisfaction=4
        )
        
        self.call_history.insert(0, log)
        logger.info(f"Call ended: {call_id} - Duration: {duration:.1f}s")
        return log
    
    async def get_active_calls(self) -> List[CallContext]:
        """Get all active calls"""
        return list(self.active_calls.values())
    
    async def get_call_history(self, limit: int = 50) -> List[CallLog]:
        """Get call history"""
        return self.call_history[:limit]
    
    async def get_call_stats(self) -> dict:
        """Get call statistics"""
        total = len(self.call_history)
        resolved = len([c for c in self.call_history if c.status == "resolved"])
        transferred = len([c for c in self.call_history if c.status == "transferred"])
        
        return {
            "total_calls": total + len(self.active_calls),
            "active_calls": len(self.active_calls),
            "resolved": resolved,
            "transferred": transferred,
            "resolution_rate": (resolved / total * 100) if total > 0 else 0,
            "transfer_rate": (transferred / total * 100) if total > 0 else 0,
        }
    
    async def transfer_call(self, call_id: str, target: str) -> bool:
        """Transfer a call to a human agent or department"""
        if call_id not in self.active_calls:
            return False
        
        self.active_calls[call_id].status = CallStatus.TRANSFERRING
        logger.info(f"Transferring call {call_id} to {target}")
        return True
    
    async def hold_call(self, call_id: str) -> bool:
        """Put a call on hold"""
        if call_id not in self.active_calls:
            return False
        
        self.active_calls[call_id].status = CallStatus.ON_HOLD
        logger.info(f"Call {call_id} placed on hold")
        return True
    
    async def resume_call(self, call_id: str) -> bool:
        """Resume a held call"""
        if call_id not in self.active_calls:
            return False
        
        self.active_calls[call_id].status = CallStatus.ACTIVE
        logger.info(f"Call {call_id} resumed")
        return True
