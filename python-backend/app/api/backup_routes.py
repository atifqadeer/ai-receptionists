"""
GET /api/backup/database   the whole MySQL database as a gzip-compressed .sql file (.sql.gz)
                           (the sidebar's "Download Database"; signed-in users only)
"""

import asyncio

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from loguru import logger

from app.services import db_backup

backup_router = APIRouter()


@backup_router.get("/database")
async def download_database():
    try:
        name = await asyncio.to_thread(db_backup.filename)
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"The database can't be reached: {e}")
    logger.info(f"Database backup downloaded: {name}")

    gen = db_backup.gzipped(db_backup.dump())

    async def body():
        while True:
            part = await asyncio.to_thread(next, gen, None)
            if part is None:
                break
            yield part

    return StreamingResponse(body(), media_type="application/gzip",
                             headers={"Content-Disposition": f'attachment; filename="{name}"',
                                      "Cache-Control": "no-store"})
