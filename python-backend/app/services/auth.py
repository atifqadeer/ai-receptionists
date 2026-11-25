"""
Dashboard login (the login page): user accounts and sign-in tokens.

- Accounts are rows of the MySQL table "users" (email unique, name, role,
  password_hash, is_active, created/updated/last-login times, failed
  logins); passwords are stored as PBKDF2-SHA256 hashes (600,000 rounds,
  random salt), never as text. A switched-off account (is_active = 0)
  can't sign in, and its open sessions stop working.
- No account yet: the login page asks for the first (admin) account once
  (setup); after that, only signing in.
- Signing in returns a JWT (HS256) the dashboard sends as
  "Authorization: Bearer ..." (or ?token=... for links and <audio> sources).
  The signing secret is made at random on first use and kept in MySQL
  ("auth_secret"), unless JWT_SECRET_KEY in .env sets one.
- Too many wrong passwords from one address: a short lock-out.

AuthMiddleware lets nothing under /api/ through without a valid token,
except signing in itself and the CRM webhook (which has its own token).
"""

import hashlib
import hmac
import json
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from loguru import logger
from sqlalchemy import text

from app.core import store
from app.core.config import settings

_USERS = "users"
_SECRET = "auth_secret"
_lock = threading.Lock()
ITERATIONS = 600_000
TOKEN_HOURS = 12
REMEMBER_DAYS = 30
FAILS_MAX = 5                 # wrong passwords from one address...
FAILS_WINDOW = 300            # ...within 5 minutes lock it out for:
LOCK_SECONDS = 300
_fails: dict = {}             # address -> [times]
_EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

PUBLIC_API = ("/api/auth/status", "/api/auth/login", "/api/auth/setup", "/api/outbound/webhook")


class AuthError(Exception):
    pass


# ---- passwords ----

def _hash(password: str, salt: Optional[str] = None) -> str:
    salt = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), ITERATIONS)
    return f"pbkdf2_sha256${ITERATIONS}${salt}${digest.hex()}"


def _verify(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, digest = stored.split("$")
        test = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(test.hex(), digest)
    except (ValueError, TypeError):
        return False


def check_password_rules(password: str) -> None:
    if len(password or "") < 8:
        raise AuthError("The password must be at least 8 characters.")
    if not (re.search(r"[A-Za-z]", password) and re.search(r"\d", password)):
        raise AuthError("The password must contain letters and numbers.")


# ---- accounts: the MySQL table "users" ----

def init() -> None:
    """Create the users table (at start-up), and move any account saved in
    the old "users" settings document into it."""
    with store.engine().begin() as c:
        c.execute(text("""
            CREATE TABLE IF NOT EXISTS users (
                id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                name VARCHAR(120) NOT NULL DEFAULT '',
                role VARCHAR(32) NOT NULL DEFAULT 'admin',
                password_hash VARCHAR(255) NOT NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                created_at DATETIME(3) NOT NULL,
                updated_at DATETIME(3) NOT NULL,
                last_login_at DATETIME(3) NULL,
                last_login_ip VARCHAR(64) NULL,
                failed_logins INT NOT NULL DEFAULT 0,
                UNIQUE KEY uq_users_email (email)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""))
    old = store.get_doc(_USERS)
    if old:
        for u in old.values():
            try:
                _insert(u["email"], u.get("name", ""), u.get("role", "admin"), u["password"])
            except Exception:
                pass                       # already moved
        store.delete_doc(_USERS)
        logger.info(f"Login: moved {len(old)} account(s) into the users table")


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _insert(email: str, name: str, role: str, password_hash: str) -> None:
    now = _now()
    with store.engine().begin() as c:
        c.execute(text("""INSERT INTO users (email, name, role, password_hash, created_at, updated_at)
                          VALUES (:email, :name, :role, :ph, :now, :now)"""),
                  {"email": email, "name": name[:120], "role": role, "ph": password_hash, "now": now})


_COLS = "id, email, name, role, password_hash, is_active, created_at, last_login_at"
_cache: dict = {}          # email -> (when read, row or None): every API request checks the account
CACHE_SECONDS = 5


def _get(email: str, fresh: bool = False) -> Optional[dict]:
    email = (email or "").strip().lower()
    hit = _cache.get(email)
    if hit and not fresh and time.time() - hit[0] < CACHE_SECONDS:
        return hit[1]
    with store.engine().connect() as c:
        row = c.execute(text(f"SELECT {_COLS} FROM users WHERE email = :e"), {"e": email}).mappings().first()
    user = dict(row) if row else None
    _cache[email] = (time.time(), user)
    return user


def _count() -> int:
    with store.engine().connect() as c:
        return int(c.execute(text("SELECT COUNT(*) FROM users")).scalar() or 0)


def setup_needed() -> bool:
    return _count() == 0


def _public(u: dict) -> dict:
    return {"email": u["email"], "name": u.get("name", "") or "", "role": u.get("role", "admin")}


def create_first_admin(email: str, password: str, name: str = "") -> dict:
    """The first account (only while there is none)."""
    email = (email or "").strip().lower()
    if not _EMAIL.match(email):
        raise AuthError("Enter a valid email address.")
    check_password_rules(password)
    with _lock:
        if _count():
            raise AuthError("An account already exists. Sign in instead.")
        _insert(email, (name or "").strip(), "admin", _hash(password))
    _cache.pop(email, None)
    return _public(_get(email, fresh=True))


def login(email: str, password: str, address: str = "") -> dict:
    """The account for these details, or AuthError (the same message for a
    wrong email, a wrong password and a switched-off account)."""
    now = time.time()
    recent = [t for t in _fails.get(address, []) if now - t < FAILS_WINDOW]
    if len(recent) >= FAILS_MAX and now - recent[-1] < LOCK_SECONDS:
        wait = int(LOCK_SECONDS - (now - recent[-1])) // 60 + 1
        raise AuthError(f"Too many failed attempts. Try again in {wait} minute{'s' if wait > 1 else ''}.")
    user = _get(email, fresh=True)
    ok = bool(user) and _verify(password or "", user["password_hash"]) and bool(user["is_active"])
    if not user:
        _verify(password or "", _hash("timing"))      # same time as a real check
    if not ok:
        _fails[address] = recent + [now]
        if user:
            with store.engine().begin() as c:
                c.execute(text("UPDATE users SET failed_logins = failed_logins + 1 WHERE id = :id"), {"id": user["id"]})
        raise AuthError("Incorrect email or password.")
    _fails.pop(address, None)
    with store.engine().begin() as c:
        c.execute(text("""UPDATE users SET last_login_at = :now, last_login_ip = :ip, failed_logins = 0
                          WHERE id = :id"""), {"now": _now(), "ip": address[:64], "id": user["id"]})
    return _public(user)


# ---- tokens ----

def _secret() -> str:
    configured = (settings.JWT_SECRET_KEY or "").strip()
    if configured and configured != "jwt-secret-key":
        return configured
    doc = store.get_doc(_SECRET) or {}
    if not doc.get("key"):
        with _lock:
            doc = store.get_doc(_SECRET) or {}
            if not doc.get("key"):
                doc = {"key": secrets.token_urlsafe(48)}
                store.put_doc(_SECRET, doc)
    return doc["key"]


def issue_token(user: dict, remember: bool = False) -> tuple:
    exp = datetime.now(timezone.utc) + (timedelta(days=REMEMBER_DAYS) if remember else timedelta(hours=TOKEN_HOURS))
    token = jwt.encode({"sub": user["email"], "name": user.get("name", ""), "role": user.get("role", "admin"),
                        "exp": exp}, _secret(), algorithm="HS256")
    return token, exp.isoformat(timespec="seconds")


def user_for_token(token: str) -> Optional[dict]:
    """The signed-in account, or None (missing, expired, forged, or the
    account was removed)."""
    if not token:
        return None
    try:
        data = jwt.decode(token, _secret(), algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    user = _get(data.get("sub", ""))
    return _public(user) if user and user["is_active"] else None


# ---- the middleware ----

def _token_from(scope) -> str:
    headers = {k.lower(): v for k, v in scope.get("headers") or []}
    auth = headers.get(b"authorization", b"").decode("latin-1")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    from urllib.parse import parse_qs
    q = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    return (q.get("token") or [""])[0]


class AuthMiddleware:
    """Every /api/ request needs a signed-in user (except signing in and the
    CRM webhook). Browser pre-flight (OPTIONS) requests pass, so the CORS
    middleware outside this one can answer them."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope.get("path", "")
        if not path.startswith("/api/") or path in PUBLIC_API or scope.get("method") == "OPTIONS":
            return await self.app(scope, receive, send)
        import asyncio
        user = await asyncio.to_thread(user_for_token, _token_from(scope))
        if user is None:
            body = json.dumps({"detail": "Please sign in."}).encode()
            await send({"type": "http.response.start", "status": 401,
                        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
            await send({"type": "http.response.body", "body": body})
            return
        scope.setdefault("state", {})["user"] = user
        return await self.app(scope, receive, send)
