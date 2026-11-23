"""
Dashboard (app/services/dashboard.py).

GET /api/dashboard?range=today|7d|30d|all   real stats from MySQL
"""

import asyncio

from fastapi import APIRouter

from app.services import dashboard

dashboard_router = APIRouter()


@dashboard_router.get("")
async def get_dashboard(range: str = "7d"):
    return await asyncio.to_thread(dashboard.stats, range)
