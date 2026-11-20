"""
Settings > GuardRails > Call Rules (app/services/call_rules.py).

GET    /api/call-rules              the rules and the numbers on hold now
PUT    /api/call-rules              save changes
DELETE /api/call-rules/holds/{num}  let a number on hold be called again
"""

import asyncio

from fastapi import APIRouter, HTTPException

from app.services import call_rules

call_rules_router = APIRouter()


def _view() -> dict:
    return {"rules": call_rules.get(), "defaults": call_rules.DEFAULTS, "holds": call_rules.holds()}


@call_rules_router.get("")
async def get_call_rules():
    return await asyncio.to_thread(_view)


@call_rules_router.put("")
async def save_call_rules(data: dict):
    try:
        await asyncio.to_thread(call_rules.save, data)
    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Check the numbers: {e}")
    return await asyncio.to_thread(_view)


@call_rules_router.delete("/holds/{number}")
async def release_hold(number: str):
    if not await asyncio.to_thread(call_rules.release, number):
        raise HTTPException(status_code=404, detail="That number is not on hold")
    return await asyncio.to_thread(_view)
