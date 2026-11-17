"""
Local-only access guard for the dashboard API.

The dashboard API (/api/... and /ws/...) has no user accounts, so it must
only be reachable by the dashboard running on this computer. This guard
rejects a request unless:

  * it comes from this computer (a loopback address),
  * it did not arrive through a tunnel or proxy (ngrok, cloudflared, ...
    add X-Forwarded-For / Forwarded headers; tunnels connect from
    127.0.0.1, so the address alone is not enough), and
  * if a browser sent it, the page's Origin is one of ALLOWED_ORIGINS,
    so other websites open in your browser cannot call the API.

Paths that outside services must reach stay public, and carry their own
checks: /webhooks/... (VoIP provider callbacks) and the CRM webhook
/api/outbound/webhook (X-Webhook-Token).
"""

import ipaddress
import json
import os

DEFAULT_ORIGINS = (
    "http://localhost:3000,http://127.0.0.1:3000,"
    "http://localhost:5173,http://127.0.0.1:5173"
)

# Extra dashboard origins can be added with APP_ALLOWED_ORIGINS (comma list).
ALLOWED_ORIGINS = sorted({
    o.strip().rstrip("/")
    for o in (DEFAULT_ORIGINS + "," + os.getenv("APP_ALLOWED_ORIGINS", "")).split(",")
    if o.strip()
})

PROTECTED_PREFIXES = ("/api/", "/ws/", "/docs", "/redoc", "/openapi.json")
PUBLIC_PATHS = ("/api/outbound/webhook",)
PROXY_HEADERS = (b"x-forwarded-for", b"x-forwarded-host", b"forwarded",
                 b"x-real-ip", b"cf-connecting-ip", b"true-client-ip")


def _is_loopback(host: str) -> bool:
    if not host:
        return False
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.split("%")[0]).is_loopback
    except ValueError:
        return False


def check_request(path: str, client_host: str, headers: dict) -> str:
    """Return "" when allowed, else the reason it was refused.
    `headers` maps lower-case byte names to byte values."""
    if not path.startswith(PROTECTED_PREFIXES) or path in PUBLIC_PATHS:
        return ""
    if not _is_loopback(client_host):
        return "The dashboard API only accepts requests from this computer."
    if any(h in headers for h in PROXY_HEADERS):
        return "The dashboard API cannot be reached through a tunnel or proxy."
    origin = headers.get(b"origin", b"").decode("latin-1").rstrip("/")
    if origin and origin != "null" and origin not in ALLOWED_ORIGINS:
        return f"Origin {origin} is not allowed. Add it to APP_ALLOWED_ORIGINS."
    if origin == "null":
        return "Requests from sandboxed or file:// pages are not allowed."
    return ""


class LocalOnlyMiddleware:
    """ASGI middleware (covers both HTTP and WebSocket) applying check_request."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        client = scope.get("client") or ("", 0)
        headers = {k.lower(): v for k, v in scope.get("headers") or []}
        reason = check_request(scope.get("path", ""), client[0], headers)
        if not reason:
            return await self.app(scope, receive, send)
        if scope["type"] == "websocket":
            await send({"type": "websocket.close", "code": 1008})
            return
        body = json.dumps({"detail": reason}).encode()
        await send({"type": "http.response.start", "status": 403,
                    "headers": [(b"content-type", b"application/json"),
                                (b"content-length", str(len(body)).encode())]})
        await send({"type": "http.response.body", "body": body})
