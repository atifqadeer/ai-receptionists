"""
Analytics page (app/services/analytics.py).

GET /api/analytics?period=24h|7d|30d|90d|all       the report
GET /api/analytics/calls.csv?period=...             the call log as CSV
"""

import asyncio

from fastapi import APIRouter
from fastapi.responses import PlainTextResponse

from app.services import analytics

analytics_report_router = APIRouter()


@analytics_report_router.get("")
async def get_analytics(period: str = "7d"):
    return await asyncio.to_thread(analytics.report, period)


@analytics_report_router.get("/calls.csv")
async def calls_csv(period: str = "7d"):
    body = await asyncio.to_thread(analytics.report_csv, period)
    return PlainTextResponse(body, media_type="text/csv",
                             headers={"Content-Disposition": f'attachment; filename="calls-{period}.csv"'})
