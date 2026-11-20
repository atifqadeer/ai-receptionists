"""
Database set-up: MySQL (see app/core/store.py for the tables).
"""

import asyncio

from app.core import chat_store, store


async def init_db():
    """Create the MySQL database and tables (and import old JSON data once)."""
    await asyncio.to_thread(store.init)
    await asyncio.to_thread(chat_store.init)   # chat_conversations / chat_messages
