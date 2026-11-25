"""
The login page (app/services/auth.py).

GET  /api/auth/status   {setup_needed}: no account yet (the page asks for the first one)
POST /api/auth/setup    create the first (admin) account, signed in straight away
POST /api/auth/login    {email, password, remember} -> {token, expires_at, user}
GET  /api/auth/me       the signed-in user (needs the token)
"""

import asyncio

from fastapi import APIRouter, HTTPException, Request

from app.services import auth

auth_router = APIRouter()


def _signed_in(user: dict, remember: bool) -> dict:
    token, expires = auth.issue_token(user, remember)
    return {"token": token, "expires_at": expires, "user": user}


@auth_router.get("/status")
async def status():
    return {"setup_needed": await asyncio.to_thread(auth.setup_needed)}


@auth_router.post("/setup")
async def setup(data: dict):
    try:
        user = await asyncio.to_thread(auth.create_first_admin, str(data.get("email") or ""),
                                       str(data.get("password") or ""), str(data.get("name") or ""))
    except auth.AuthError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return await asyncio.to_thread(_signed_in, user, bool(data.get("remember")))


@auth_router.post("/login")
async def login(request: Request, data: dict):
    address = request.client.host if request.client else ""
    try:
        user = await asyncio.to_thread(auth.login, str(data.get("email") or ""), str(data.get("password") or ""), address)
    except auth.AuthError as e:
        raise HTTPException(status_code=401, detail=str(e))
    return await asyncio.to_thread(_signed_in, user, bool(data.get("remember")))


@auth_router.get("/me")
async def me(request: Request):
    return {"user": request.scope.get("state", {}).get("user")}
