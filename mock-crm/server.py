"""
Mock CRM: a stand-in for a third-party recruitment CRM, for testing.

It runs on its own (port 8100, not the AI Receptionist backend on 8000)
and holds a list of applicants, each applying for a vacancy, in the nested
shape a real CRM returns. The AI Receptionist pulls them from here
(Agent Setup > Call Voice & CRM > "Fetch applicants from your CRM") and
queues a job call for each one.

Every /api/ endpoint needs the API key from config.json, sent as
    Authorization: Bearer <api_key>     (or   X-API-Key: <api_key>)

    GET    /api/v1/applicants            list (array in "data"); ?status=new  ?limit=50
    GET    /api/v1/applicants/{id}       one applicant
    POST   /api/v1/applicants            add one applicant, or a list of them
    PATCH  /api/v1/applicants/{id}       change fields, e.g. {"status": "contacted"}
    DELETE /api/v1/applicants/{id}       remove one
    POST   /api/v1/reset                 restore the sample applicants
    GET    /health                       no key needed

Run:  start-mock-crm.bat   (or: python server.py)
Data: data/applicants.json (created from the samples below on first run)
"""

import json
import secrets
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "config.json").read_text(encoding="utf-8"))
DATA = HERE / "data" / "applicants.json"
_lock = threading.Lock()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# Phone numbers: 308 and 410 are test extensions on the PBX; 07700 900xxx
# numbers are Ofcom's reserved drama range (never assigned to anyone).
SAMPLES = [
    {"id": "APP-1001", "status": "new",
     "candidate": {"firstName": "Atif", "lastName": "Qadeer", "mobile": "308", "email": "atif.test@example.com"},
     "vacancy": {"id": "VAC-501", "title": "Registered Nurse (RGN)", "company": "Oakwood Care Home", "city": "Manchester",
                 "salary": "£38,000 per year", "benefits": "28 days holiday, pension, paid training",
                 "requirements": "Active NMC registration and PIN", "experience": "At least 2 years in elderly care",
                 "employmentType": "Full-time, permanent", "hours": "Day shifts, 37.5 hours a week",
                 "startDate": "1 December 2026", "description": "Caring for 30 elderly residents in a nursing home"}},
    {"id": "APP-1002", "status": "new",
     "candidate": {"firstName": "Sara", "lastName": "Khan", "mobile": "07700 900123", "email": "sara.test@example.com"},
     "vacancy": {"id": "VAC-502", "title": "Chef", "company": "The Grand Hotel", "city": "Leeds",
                 "salary": "£30,000 per year", "benefits": "Meals on duty, 28 days holiday",
                 "requirements": "Level 2 Food Hygiene", "experience": "3 years in a busy kitchen",
                 "employmentType": "Full-time, permanent", "hours": "5 shifts a week including weekends",
                 "startDate": "Immediate", "description": "Preparing breakfast and dinner service for a 120-room hotel"}},
    {"id": "APP-1003", "status": "new",
     "candidate": {"firstName": "John", "lastName": "Smith", "mobile": "410", "email": "john.test@example.com"},
     "vacancy": {"id": "VAC-503", "title": "Sous Chef", "company": "Riverside Bistro", "city": "York",
                 "salary": "£32,000 per year", "requirements": "Level 3 Food Hygiene",
                 "experience": "2 years as a sous chef", "employmentType": "Full-time, permanent",
                 "hours": "Evenings and weekends, 45 hours a week",
                 "description": "Running the kitchen when the head chef is off"}},
    {"id": "APP-1004", "status": "contacted",
     "candidate": {"firstName": "Emma", "lastName": "Brown", "mobile": "07700 900456", "email": "emma.test@example.com"},
     "vacancy": {"id": "VAC-504", "title": "Registered Manager", "company": "Willow Lodge", "city": "Bolton",
                 "salary": "£55,000 per year", "requirements": "Level 5 Diploma in Leadership for Health and Social Care",
                 "experience": "3 years managing a CQC-registered service", "employmentType": "Full-time, permanent",
                 "description": "Leading a 40-bed residential care home"}},
]


def _load() -> list:
    if not DATA.exists():
        _save([dict(a, created_at=_now(), updated_at=_now()) for a in SAMPLES])
    return json.loads(DATA.read_text(encoding="utf-8"))


def _save(items: list) -> None:
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(json.dumps(items, indent=2, ensure_ascii=False), encoding="utf-8")


async def _json(request: Request):
    """The request body as JSON: UTF-8, or Windows-1252 (curl in a Windows
    shell sends "£" that way)."""
    raw = await request.body()
    for enc in ("utf-8-sig", "cp1252"):
        try:
            return json.loads(raw.decode(enc))
        except (UnicodeDecodeError, json.JSONDecodeError):
            continue
    raise HTTPException(status_code=400, detail="Body is not valid JSON")


def _auth(request: Request) -> None:
    given = request.headers.get("x-api-key") or ""
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        given = given or auth[7:].strip()
    if not given or not secrets.compare_digest(given, CONFIG["api_key"]):
        raise HTTPException(status_code=401, detail="Invalid or missing API key")


app = FastAPI(title="Mock CRM", version="1.0", description="A pretend third-party recruitment CRM for testing.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health():
    return {"ok": True, "service": "mock-crm", "time": _now()}


@app.get("/api/v1/applicants")
def list_applicants(request: Request, status: Optional[str] = None, limit: int = 100):
    _auth(request)
    with _lock:
        items = _load()
    if status:
        items = [a for a in items if a.get("status") == status]
    return {"data": items[:max(1, min(limit, 1000))], "total": len(items)}


@app.get("/api/v1/applicants/{applicant_id}")
def get_applicant(request: Request, applicant_id: str):
    _auth(request)
    with _lock:
        found = next((a for a in _load() if a["id"] == applicant_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="Applicant not found")
    return found


@app.post("/api/v1/applicants", status_code=201)
async def add_applicants(request: Request):
    """One applicant object, a list, or {"data": [...]}. Each needs
    candidate.mobile and vacancy.title; "id" is created if missing."""
    _auth(request)
    body = await _json(request)
    items = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), list) else body
    items = items if isinstance(items, list) else [items]
    created, errors = [], []
    with _lock:
        stored = _load()
        for i, a in enumerate(items, start=1):
            if not isinstance(a, dict) or not (a.get("candidate") or {}).get("mobile") or not (a.get("vacancy") or {}).get("title"):
                errors.append({"item": i, "error": "needs candidate.mobile and vacancy.title"})
                continue
            a = dict(a)
            a.setdefault("id", f"APP-{secrets.randbelow(900000) + 100000}")
            if any(s["id"] == a["id"] for s in stored):
                errors.append({"item": i, "error": f"id {a['id']} already exists"})
                continue
            a.setdefault("status", "new")
            a["created_at"] = a["updated_at"] = _now()
            stored.append(a)
            created.append(a)
        _save(stored)
    return {"created": created, "errors": errors}


@app.patch("/api/v1/applicants/{applicant_id}")
async def update_applicant(request: Request, applicant_id: str):
    _auth(request)
    changes = await _json(request)
    with _lock:
        stored = _load()
        found = next((a for a in stored if a["id"] == applicant_id), None)
        if not found:
            raise HTTPException(status_code=404, detail="Applicant not found")
        for k, v in (changes or {}).items():
            if k in ("candidate", "vacancy") and isinstance(v, dict):
                found.setdefault(k, {}).update(v)
            elif k not in ("id", "created_at"):
                found[k] = v
        found["updated_at"] = _now()
        _save(stored)
    return found


@app.delete("/api/v1/applicants/{applicant_id}")
def delete_applicant(request: Request, applicant_id: str):
    _auth(request)
    with _lock:
        stored = _load()
        kept = [a for a in stored if a["id"] != applicant_id]
        if len(kept) == len(stored):
            raise HTTPException(status_code=404, detail="Applicant not found")
        _save(kept)
    return {"deleted": applicant_id}


RESULTS = HERE / "data" / "call_results.json"
_OUTCOME_STATUS = {"interested": "interested", "not_interested": "not_interested", "callback": "callback_requested",
                   "do_not_call": "do_not_call", "no_response": "no_response"}


@app.post("/api/v1/call-results", status_code=201)
async def receive_call_result(request: Request):
    """The AI Receptionist posts here when a call finishes (its "Result
    webhook URL"). The applicant's status is updated from the outcome."""
    _auth(request)
    result = await _json(request)
    if not isinstance(result, dict):
        raise HTTPException(status_code=400, detail="Expected a JSON object")
    result["received_at"] = _now()
    with _lock:
        results = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else []
        results.append(result)
        RESULTS.parent.mkdir(parents=True, exist_ok=True)
        RESULTS.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
        stored = _load()
        found = next((a for a in stored if a["id"] == result.get("applicant_id")), None)
        if found:
            found["status"] = _OUTCOME_STATUS.get(result.get("outcome") or "", "contacted")
            found["last_call"] = {k: result.get(k) for k in ("call_id", "status", "outcome", "notes_summary", "finished_at")}
            found["updated_at"] = _now()
            _save(stored)
    return {"received": True, "applicant_updated": bool(found)}


@app.get("/api/v1/call-results")
def list_call_results(request: Request):
    _auth(request)
    results = json.loads(RESULTS.read_text(encoding="utf-8")) if RESULTS.exists() else []
    return {"data": list(reversed(results)), "total": len(results)}


@app.post("/api/v1/reset")
def reset(request: Request):
    _auth(request)
    with _lock:
        _save([dict(a, created_at=_now(), updated_at=_now()) for a in SAMPLES])
    return {"reset": True, "total": len(SAMPLES)}


if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=int(CONFIG.get("port", 8100)))
