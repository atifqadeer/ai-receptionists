# Mock CRM (third-party test API)

A pretend recruitment CRM that holds applicants. It runs separately from the
AI Receptionist, on **port 8100**. The AI Receptionist pulls applicants from it
and queues a job call for each new one.

## Run it

Double-click `start-mock-crm.bat` in the project folder (or run
`python-backend\.venv\Scripts\python.exe mock-crm\server.py`).

Interactive API docs: http://127.0.0.1:8100/docs

## API key

In `mock-crm/config.json` (`api_key`). Send it as
`Authorization: Bearer <api_key>` (or `X-API-Key: <api_key>`).

## Postman (Import > Raw text)

List the new applicants (an array in `data`):

```bash
curl "http://127.0.0.1:8100/api/v1/applicants?status=new" -H "Authorization: Bearer YOUR_CRM_API_KEY"
```

Add an applicant:

```bash
curl -X POST "http://127.0.0.1:8100/api/v1/applicants" -H "Authorization: Bearer YOUR_CRM_API_KEY" -H "Content-Type: application/json" -d "{\"candidate\": {\"firstName\": \"Ali\", \"lastName\": \"Raza\", \"mobile\": \"07700 900321\", \"email\": \"ali.test@example.com\"}, \"vacancy\": {\"id\": \"VAC-701\", \"title\": \"Solicitor\", \"company\": \"Smith & Co Law\", \"city\": \"London\", \"salary\": \"£60,000 per year\", \"requirements\": \"Qualified solicitor (SRA)\", \"experience\": \"3 years in conveyancing\", \"employmentType\": \"Full-time, permanent\", \"hours\": \"Monday to Friday, 9 to 5\", \"description\": \"Handling residential property transactions\"}}"
```

See the call results the AI Receptionist sent back:

```bash
curl "http://127.0.0.1:8100/api/v1/call-results" -H "Authorization: Bearer YOUR_CRM_API_KEY"
```

The AI Receptionist posts each finished call to `POST /api/v1/call-results`
(set as its Result webhook URL); the applicant's `status` is updated from the
outcome (interested, not_interested, callback_requested, do_not_call).

Other endpoints: `GET /api/v1/applicants/{id}`, `PATCH /api/v1/applicants/{id}`
(e.g. `{"status": "contacted"}`), `DELETE /api/v1/applicants/{id}`,
`POST /api/v1/reset` (restore the 4 samples), `GET /health` (no key).

## Connect the AI Receptionist

Settings > Calling > Webhooks > **Fetch applicants from your CRM (API)**:

- CRM API URL: `http://127.0.0.1:8100/api/v1/applicants?status=new`
- CRM API key: the `api_key` from `config.json`
- Fetch automatically: off, or every 1 / 5 / 15 / 60 minutes

**Fetch now** queues every applicant not imported before on the Job Calls page.
The backend endpoint behind it: `POST http://127.0.0.1:8000/api/outbound/crm/pull`.
