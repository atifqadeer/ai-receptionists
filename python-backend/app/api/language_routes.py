"""
Settings > Agent > Languages: which languages the agent may use in chats
and on calls (app/services/language_settings.py).

GET /api/languages   the selection, the catalog, and whether an AI model is set up
PUT /api/languages   {"chat": [...], "chat_default": "...", "calls": [...]}
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.services import language_settings

languages_router = APIRouter()


def _view(request: Request, value: dict) -> dict:
    return {**value, "catalog": language_settings.CATALOG, "calls_note": language_settings.CALLS_NOTE,
            "ai_model": request.app.state.ai_agent._llm_available()}


@languages_router.get("")
async def get_languages(request: Request):
    return _view(request, await asyncio.to_thread(language_settings.get, True))


@languages_router.put("")
async def save_languages(request: Request, data: dict):
    try:
        value = await asyncio.to_thread(language_settings.save, data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _view(request, value)
