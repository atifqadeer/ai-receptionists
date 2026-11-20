"""
Settings > System > AI Model (app/services/ai_model.py).

GET  /api/ai-model        the settings (key masked) and the providers
PUT  /api/ai-model        save changes
POST /api/ai-model/test   ask the model for a one-word reply
GET  /api/ai-model/models the models the provider offers to the saved key
"""

import asyncio

from fastapi import APIRouter, HTTPException

from app.services import ai_model

ai_model_router = APIRouter()


@ai_model_router.get("")
async def get_ai_model():
    return await asyncio.to_thread(ai_model.public)


@ai_model_router.put("")
async def save_ai_model(data: dict):
    try:
        return await asyncio.to_thread(ai_model.save, data)
    except (ValueError, TypeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@ai_model_router.post("/test")
async def test_ai_model():
    return await asyncio.to_thread(ai_model.test)


@ai_model_router.get("/models")
async def list_ai_models():
    return await asyncio.to_thread(ai_model.list_models)
