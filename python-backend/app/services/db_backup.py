"""
"Download Database" (the sidebar button): the whole MySQL database as one
.sql file, like mysqldump makes, generated here so it works without
mysqldump installed. It is read from one consistent snapshot (like
mysqldump --single-transaction) and downloaded gzip-compressed (.sql.gz;
phpMyAdmin imports .gz directly).

For every table: DROP TABLE IF EXISTS + its CREATE TABLE + its rows as
INSERT statements (500 rows each). Foreign keys are switched off while it
loads, so the tables can come in any order. Restore it with phpMyAdmin
(Import, the .gz as it is) or unzip it and:  mysql -u root ai_receptionist < backup.sql

It holds everything: settings (API keys included), calls, chats and the
users table (password hashes), so keep the file safe.
"""

import zlib
from datetime import datetime
from typing import Iterator

from pymysql.converters import escape_item
from sqlalchemy import text

from app.core.store import engine

BATCH = 500


def filename() -> str:
    with engine().connect() as c:
        db = c.execute(text("SELECT DATABASE()")).scalar() or "database"
    return f"{db}-{datetime.now():%Y-%m-%d_%H%M}.sql.gz"


def gzipped(parts: Iterator[str]) -> Iterator[bytes]:
    """The .sql text as a .gz stream, compressed as it is made."""
    z = zlib.compressobj(6, zlib.DEFLATED, 31)          # wbits 31: gzip format
    for part in parts:
        out = z.compress(part.encode("utf-8"))
        if out:
            yield out
    yield z.flush()


def _q(name: str) -> str:
    return "`" + name.replace("`", "``") + "`"


def dump() -> Iterator[str]:
    """The .sql text, a piece at a time (big tables aren't held in memory)."""
    with engine().connect() as c:
        db = c.execute(text("SELECT DATABASE()")).scalar()
        version = c.execute(text("SELECT VERSION()")).scalar()
        tables = [r[0] for r in c.execute(text("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'"))]
        # One consistent snapshot for every table (like mysqldump
        # --single-transaction): a call or chat saved while the export runs
        # can't leave the tables out of step. Nothing is locked; the app
        # keeps working. The transaction is rolled back when the connection closes.
        c.execute(text("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ"))
        c.execute(text("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY"))
        yield (f"-- AI Receptionist database backup\n"
               f"-- Database: {db}   Server: {version}   Made: {datetime.now():%Y-%m-%d %H:%M:%S}\n"
               f"-- Tables: {', '.join(tables)}\n"
               f"-- Restore: phpMyAdmin > Import, or  mysql -u root {db} < this-file.sql\n"
               f"-- Contains settings (API keys), calls, chats and user accounts (password hashes): keep it safe.\n\n"
               "SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n"
               "SET time_zone = '+00:00';\nSTART TRANSACTION;\n\n")
        for t in tables:
            create = c.execute(text(f"SHOW CREATE TABLE {_q(t)}")).fetchone()[1]
            count = c.execute(text(f"SELECT COUNT(*) FROM {_q(t)}")).scalar()
            yield f"-- ----------------------------\n-- Table {t} ({count} rows)\n-- ----------------------------\n"
            yield f"DROP TABLE IF EXISTS {_q(t)};\n{create};\n\n"
            if not count:
                continue
            result = c.execution_options(stream_results=True).execute(text(f"SELECT * FROM {_q(t)}"))
            cols = ", ".join(_q(k) for k in result.keys())
            while True:
                rows = result.fetchmany(BATCH)
                if not rows:
                    break
                values = ",\n".join("(" + ", ".join(escape_item(v, "utf8mb4") for v in row) + ")" for row in rows)
                yield f"INSERT INTO {_q(t)} ({cols}) VALUES\n{values};\n"
            yield "\n"
        yield "COMMIT;\nSET FOREIGN_KEY_CHECKS = 1;\n"
