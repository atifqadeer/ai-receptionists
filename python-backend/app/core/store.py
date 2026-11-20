"""
MySQL storage for everything the app keeps.

Two tables in the database named in DATABASE_URL (created on start-up,
together with the database itself):

- documents: one JSON document per name. The agent's setup
  ("agent_config"), telephony/VoIP settings ("telephony"), the live voice
  settings ("voice"), CRM import state ("crm_import") and every setting the
  web app keeps ("ui:<key>", e.g. ui:agent-identity).
- calls: one row per call, as JSON, in a list named by `kind`
  ("inbound_calls" holds inbound and dial-pad calls, "outbound_calls" the
  job calls). Rows keep their insertion order.

Call recordings stay on disk (data/call_audit): audio files don't belong
in database rows.

The services use this synchronously (they did the same with JSON files)
and from several threads; the connection pool is thread-safe. On the first
start, the old JSON files in data/ are imported once.
"""

import json
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlsplit, urlunsplit

from loguru import logger
from sqlalchemy import bindparam, create_engine, text
from sqlalchemy.engine import Engine

from app.core.config import settings

DATA_DIR = Path(__file__).resolve().parents[2] / "data"

_engine: Optional[Engine] = None
_engine_lock = threading.Lock()
# id -> JSON last written, per call list, so a save only writes changed rows
_written: dict = {}
_written_lock = threading.Lock()


class StoreError(Exception):
    pass


def _mysql_url() -> str:
    url = settings.DATABASE_URL
    if url.startswith("mysql://"):
        url = "mysql+pymysql://" + url[len("mysql://"):]
    if not url.startswith("mysql+pymysql://"):
        raise StoreError(f"DATABASE_URL must be a MySQL URL (mysql+pymysql://user:password@host:3306/db), got {url.split(':')[0]}")
    return url


def _split_db(url: str) -> tuple:
    """(URL without the database, database name)."""
    parts = urlsplit(url)
    db = parts.path.lstrip("/")
    if not db:
        raise StoreError("DATABASE_URL has no database name (…:3306/ai_receptionist)")
    return urlunsplit((parts.scheme, parts.netloc, "/", parts.query, "")), db


def engine() -> Engine:
    global _engine
    with _engine_lock:
        if _engine is None:
            _engine = create_engine(_mysql_url(), pool_pre_ping=True, pool_recycle=3600, pool_size=5,
                                    max_overflow=10, future=True)
        return _engine


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ---- set-up ----

def init() -> None:
    """Create the database and tables if needed, and import the old JSON files once."""
    server_url, db = _split_db(_mysql_url())
    if not db.replace("_", "").isalnum():
        raise StoreError(f"Unusual database name {db!r}: use letters, digits and _")
    boot = create_engine(server_url, future=True)
    try:
        with boot.begin() as c:
            c.execute(text(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"))
    finally:
        boot.dispose()
    with engine().begin() as c:
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS documents (
                name VARCHAR(191) NOT NULL PRIMARY KEY,
                value LONGTEXT NOT NULL,
                updated_at DATETIME NOT NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS calls (
                seq BIGINT NOT NULL AUTO_INCREMENT,
                id VARCHAR(64) NOT NULL,
                kind VARCHAR(32) NOT NULL,
                status VARCHAR(32) NULL,
                created_at VARCHAR(40) NULL,
                data LONGTEXT NOT NULL,
                updated_at DATETIME NOT NULL,
                PRIMARY KEY (id),
                UNIQUE KEY uq_calls_seq (seq),
                KEY ix_calls_kind (kind, seq)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
    _import_json_files()
    logger.info(f"MySQL storage ready (database {db})")


def _import_json_files() -> None:
    """The JSON files the app used before MySQL, imported once each."""
    for name in ("agent_config", "telephony", "crm_import"):
        path = DATA_DIR / f"{name}.json"
        if path.exists() and get_doc(name) is None:
            try:
                put_doc(name, json.loads(path.read_text(encoding="utf-8")))
                logger.info(f"Imported {path.name} into MySQL")
            except Exception as e:
                logger.warning(f"Could not import {path.name}: {e}")
    for kind in ("inbound_calls", "outbound_calls"):
        path = DATA_DIR / f"{kind}.json"
        if path.exists() and get_doc(f"imported:{kind}") is None:
            try:
                rows = json.loads(path.read_text(encoding="utf-8"))
                if not load_list(kind):
                    save_list(kind, rows)
                put_doc(f"imported:{kind}", {"at": _now().isoformat(), "rows": len(rows)})
                logger.info(f"Imported {len(rows)} call(s) from {path.name} into MySQL")
            except Exception as e:
                logger.warning(f"Could not import {path.name}: {e}")


# ---- documents ----

def get_doc(name: str, default: Any = None) -> Any:
    with engine().connect() as c:
        row = c.execute(text("SELECT value FROM documents WHERE name = :n"), {"n": name}).first()
    return json.loads(row[0]) if row else default


def put_doc(name: str, value: Any) -> None:
    with engine().begin() as c:
        c.execute(text("""INSERT INTO documents (name, value, updated_at) VALUES (:n, :v, :t)
                          ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)"""),
                  {"n": name, "v": json.dumps(value, ensure_ascii=False), "t": _now()})


def delete_doc(name: str) -> None:
    with engine().begin() as c:
        c.execute(text("DELETE FROM documents WHERE name = :n"), {"n": name})


def list_docs(prefix: str) -> dict:
    with engine().connect() as c:
        rows = c.execute(text("SELECT name, value FROM documents WHERE name LIKE :p"),
                         {"p": prefix.replace("%", r"\%").replace("_", r"\_") + "%"}).all()
    return {name[len(prefix):]: json.loads(value) for name, value in rows}


# ---- call lists ----

def load_list(kind: str) -> list:
    with engine().connect() as c:
        rows = c.execute(text("SELECT id, data FROM calls WHERE kind = :k ORDER BY seq"), {"k": kind}).all()
    with _written_lock:
        _written[kind] = {r[0]: r[1] for r in rows}
    return [json.loads(r[1]) for r in rows]


def save_list(kind: str, items: list) -> None:
    """Make the rows of `kind` equal `items` (each has an "id"): writes
    only the rows that changed and deletes the ones that are gone."""
    with _written_lock:
        known = _written.get(kind)
    if known is None:
        load_list(kind)
        with _written_lock:
            known = _written[kind]
    new = {}
    for item in items:
        if item.get("id"):
            new[str(item["id"])] = (item, json.dumps(item, ensure_ascii=False))
    changed = [(i, item, raw) for i, (item, raw) in new.items() if known.get(i) != raw]
    gone = [i for i in known if i not in new]
    if not changed and not gone:
        return
    now = _now()
    with engine().begin() as c:
        for i, item, raw in changed:
            c.execute(text("""INSERT INTO calls (id, kind, status, created_at, data, updated_at)
                              VALUES (:id, :k, :s, :c, :d, :t)
                              ON DUPLICATE KEY UPDATE kind = VALUES(kind), status = VALUES(status),
                                  data = VALUES(data), updated_at = VALUES(updated_at)"""),
                      {"id": i, "k": kind, "s": str(item.get("status") or "")[:32] or None,
                       "c": str(item.get("created_at") or item.get("started_at") or "")[:40] or None,
                       "d": raw, "t": now})
        if gone:
            c.execute(text("DELETE FROM calls WHERE kind = :k AND id IN :ids").bindparams(
                bindparam("ids", expanding=True)), {"k": kind, "ids": gone})
    with _written_lock:
        _written[kind] = {i: raw for i, (_, raw) in new.items()}


def get_item(kind: str, item_id: str) -> Optional[dict]:
    with engine().connect() as c:
        row = c.execute(text("SELECT data FROM calls WHERE kind = :k AND id = :i"), {"k": kind, "i": item_id}).first()
    return json.loads(row[0]) if row else None


def put_item(kind: str, item: dict) -> None:
    """Insert or update one row of `kind` (for lists too long to rewrite whole)."""
    raw = json.dumps(item, ensure_ascii=False)
    with engine().begin() as c:
        c.execute(text("""INSERT INTO calls (id, kind, status, created_at, data, updated_at)
                          VALUES (:id, :k, :s, :c, :d, :t)
                          ON DUPLICATE KEY UPDATE status = VALUES(status), data = VALUES(data),
                              updated_at = VALUES(updated_at)"""),
                  {"id": str(item["id"]), "k": kind, "s": str(item.get("status") or "")[:32] or None,
                   "c": str(item.get("started_at") or item.get("created_at") or "")[:40] or None,
                   "d": raw, "t": _now()})
    with _written_lock:
        if kind in _written:
            _written[kind][str(item["id"])] = raw


def delete_items(kind: str, ids: Optional[list] = None) -> int:
    """Delete the given rows of `kind`, or all of them."""
    with engine().begin() as c:
        if ids is None:
            n = c.execute(text("DELETE FROM calls WHERE kind = :k"), {"k": kind}).rowcount
        else:
            n = c.execute(text("DELETE FROM calls WHERE kind = :k AND id IN :ids").bindparams(
                bindparam("ids", expanding=True)), {"k": kind, "ids": ids}).rowcount if ids else 0
    with _written_lock:
        _written.pop(kind, None)
    return n


def status() -> dict:
    """For /health: is the database reachable."""
    try:
        with engine().connect() as c:
            c.execute(text("SELECT 1"))
        return {"ok": True, "database": _split_db(_mysql_url())[1]}
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}
