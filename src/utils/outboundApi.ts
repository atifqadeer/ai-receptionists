// Client for VoIP settings and outbound job calls (python-backend:
// /api/telephony and /api/outbound).
import { API_BASE } from './agentApi';
import { withToken } from './auth';

export interface ProviderField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  multiline?: boolean;
  optional?: boolean;
}

export interface TelephonySettings {
  provider: string;
  credentials: Record<string, Record<string, string>>;
  from_number: string;
  public_url: string;
  default_country_code: string;
  call_mode: 'auto' | 'manual';
  calling_hours_start: string;
  calling_hours_end: string;
  calling_days: number[];
  timezone: string;
  max_concurrent_calls: number;
  max_attempts: number;
  retry_minutes: number;
  language: string;
  voice: string;
  result_webhook_url: string;
  crm_api_url: string;
  crm_api_key: string;
  crm_result_key?: string;
  crm_poll_minutes: number;
  crm_id_field?: string;
  sip_domain: string;
  inbound: InboundSettings;
  providers: Record<string, { name: string; fields: ProviderField[] }>;
  configured: boolean;
  missing: string[];
  within_calling_hours?: boolean;
}

/** Incoming calls: the agent registers this extension and answers it. */
export interface InboundSettings {
  enabled: boolean;
  extension: string;
  password: string;
  server: string;
  port: string;
  local_port: string;
  greeting: string;
  max_concurrent: number;
  max_minutes: number;
}

export interface InboundStatus {
  state: 'disabled' | 'registered' | 'error';
  message: string;
  enabled: boolean;
  extension: string;
  active_calls: number;
}

export interface InboundCall {
  id: string;
  caller_number: string;
  caller_name: string;
  extension: string;
  // also dnc / not_interested / wrong_number / callback / voicemail (see utils/callStatus.ts)
  status: string;
  direction?: 'inbound' | 'outbound';
  outcome?: string;
  outcome_said?: string;
  callback_when?: string;
  reason?: string;
  started_at: string;
  answered_at: string | null;
  ended_at: string | null;
  ended_by?: 'agent' | 'caller';
  error: string | null;
  transcript: Array<{ role: 'agent' | 'caller'; text: string; interrupted?: boolean; unclear?: boolean }>;
}

export interface InboundStats {
  total: number;
  today: number;
  completed: number;
  failed: number;
  live: number;
  avg_seconds: number;
  unique_callers: number;
}

/** A moment in a call's event log (data/call_audit/.../events.jsonl). */
export interface CallEvent {
  t: number;
  event: string;
  [key: string]: any;
}

export interface InboundCallDetail extends InboundCall {
  events: CallEvent[];
  has_recording: boolean;
}

/** One applicant response during a call, saved by the agent. */
export interface CallNote {
  at: string;
  kind: 'question' | 'unanswered' | 'off_topic' | 'decision' | 'response' | 'silence' | 'unclear';
  applicant: string;
  agent: string;
  interrupted: boolean;
}

export interface OutboundCall {
  id: string;
  source: string;
  batch?: string;
  applicant: { applicant_id?: string; first_name?: string; last_name?: string; phone: string; email?: string };
  job: Record<string, string>;
  status: string;
  outcome: string | null;
  callback_when?: string;
  send_details?: boolean;
  attempts: number;
  next_attempt_at: string | null;
  error: string | null;
  transcript: Array<{ role: 'agent' | 'applicant'; text: string; interrupted?: boolean }>;
  notes?: CallNote[];
  created_at: string;
  updated_at: string;
}

export interface CallsResponse {
  calls: OutboundCall[];
  call_mode: 'auto' | 'manual';
  configured: boolean;
  missing: string[];
  within_calling_hours: boolean;
}

// A backend that accepts the connection but never answers (frozen or
// paused) would otherwise leave pages on "Loading…" forever.
const TIMEOUT_MS = 20000;

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: init.body instanceof FormData ? init.headers : { 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
  } catch (e: any) {
    throw new Error(e?.name === 'AbortError'
      ? `The backend at ${API_BASE} is not responding (no answer in ${TIMEOUT_MS / 1000}s). Restart it with start-app.bat.`
      : `Could not reach the backend at ${API_BASE}. Start it with start-app.bat.`);
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.detail || `Request failed (${res.status})`);
  return data as T;
}

export const telephonyApi = {
  get: () => call<TelephonySettings>('/api/telephony/settings'),
  save: (s: Partial<TelephonySettings>) => call<TelephonySettings>('/api/telephony/settings', { method: 'PUT', body: JSON.stringify(s) }),
  test: () => call<{ ok: boolean; message: string }>('/api/telephony/test', { method: 'POST' }),
  inbound: () => call<{ status: InboundStatus; calls: InboundCall[]; stats: InboundStats }>('/api/telephony/inbound'),
  clearInbound: () => call('/api/telephony/inbound/calls', { method: 'DELETE' }),
  inboundCall: (id: string) => call<InboundCallDetail>(`/api/telephony/inbound/calls/${id}`),
  deleteInboundCall: (id: string) => call(`/api/telephony/inbound/calls/${id}`, { method: 'DELETE' }),
  inboundRecordingUrl: (id: string) => withToken(`${API_BASE}/api/telephony/inbound/calls/${id}/recording`),
  // Make a Call dial pad: the agent phones a number over the SIP Account.
  dialed: () => call<{ calls: InboundCall[] }>('/api/telephony/dialed'),
  dial: (number: string, name = '', opening = '') => call<{ id: string }>('/api/telephony/dial', { method: 'POST', body: JSON.stringify({ number, name, opening }) }),
  dialOpening: () => call<{ opening: string }>('/api/telephony/dial/opening'),
  hangup: (id: string) => call(`/api/telephony/dialed/${id}/hangup`, { method: 'POST' }),
  clearDialed: () => call('/api/telephony/dialed', { method: 'DELETE' }),
};

export interface CrmPull {
  at: string;
  url: string;
  fetched?: number;
  added?: number;
  already_imported?: number;
  already_called?: number;
  ids?: string[];
  rejected?: Array<{ row: number; reason: string; name: string }>;
  /** Contacts not queued on this refresh, and why. */
  skipped?: CrmSkipped[];
  error?: string;
}

export interface CrmSkipped {
  reason: 'already here' | 'already called' | string;
  name: string;
  applicant_id?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  phone?: string | null;
  /** When the agent last called them (already called only). */
  at?: string;
}

export interface CrmResultsStatus {
  url: string;
  sent: number;
  unsent: number;
  last: { at: string; call_id: string; ok: boolean; error: string | null; status: string; outcome: string | null; name: string } | null;
}
export interface CrmStatus { last: CrmPull | null; imported_total: number; results: CrmResultsStatus }

export interface DncEntry {
  number: string;
  name: string;
  added_at: string;
  source: string;
  said: string;
  call_id: string;
}

export const dncApi = {
  list: () => call<{ numbers: DncEntry[] }>('/api/outbound/dnc'),
  add: (number: string, name = '') => call<DncEntry>('/api/outbound/dnc', { method: 'POST', body: JSON.stringify({ number, name }) }),
  remove: (number: string) => call(`/api/outbound/dnc/${encodeURIComponent(number)}`, { method: 'DELETE' }),
};

export interface NotInterestedEntry {
  number: string;
  name: string;
  /** Last time they said it. */
  at: string;
  first_at: string;
  times: number;
  source: string;
  said?: string;
  job?: string;
  call_id: string;
  /** While Call Rules still holds the number (not called until then). */
  held_until: string | null;
  on_dnc: boolean;
}

export interface HungUpCall {
  call_id: string;
  /** 'job call' | 'dial pad' | 'inbound call' | 'call' (call no longer in the history) */
  kind: string;
  number: string;
  name: string;
  job: string;
  /** What they had decided before hanging up (e.g. interested). */
  outcome: string;
  at: string;
  talk_seconds: number | null;
  agent_last: string;
  contact_last: string;
  turns: number;
  held_until: string | null;
  on_dnc: boolean;
}

export const hungUpApi = {
  list: () => call<{ calls: HungUpCall[] }>('/api/outbound/hung-up'),
  release: (number: string) => call(`/api/outbound/hung-up/${encodeURIComponent(number)}/release`, { method: 'POST' }),
};

export const notInterestedApi = {
  list: () => call<{ numbers: NotInterestedEntry[] }>('/api/outbound/not-interested'),
  remove: (number: string) => call(`/api/outbound/not-interested/${encodeURIComponent(number)}`, { method: 'DELETE' }),
  toDnc: (number: string) => call(`/api/outbound/not-interested/${encodeURIComponent(number)}/dnc`, { method: 'POST' }),
};

/** A callback or meeting request from chat or a call (python-backend app/services/follow_ups.py). */
export interface FollowUp {
  id: string;
  kind: 'callback' | 'meeting';
  source: string;              // chat / job call / dial pad / inbound call
  name: string;
  phone: string;
  email: string;
  when: string;                // the time they asked for, as they said it
  due_at: string | null;
  said: string;
  ref: string;                 // the call or chat it came from
  job: string;
  auto_dial: boolean;          // the agent dials it again itself
  round: number;
  status: 'open' | 'scheduled' | 'dialled' | 'done' | 'failed' | 'cancelled';
  note: string;
  result: string;
  created_at: string;
  updated_at: string;
}

export const followUpsApi = {
  list: () => call<{ items: FollowUp[] }>('/api/outbound/follow-ups'),
  update: (id: string, changes: Partial<Pick<FollowUp, 'status' | 'auto_dial' | 'note'>>) =>
    call<FollowUp>(`/api/outbound/follow-ups/${id}`, { method: 'PATCH', body: JSON.stringify(changes) }),
  remove: (id: string) => call(`/api/outbound/follow-ups/${id}`, { method: 'DELETE' }),
};

export const outboundApi = {
  crmPull: () => call<CrmPull>('/api/outbound/crm/pull', { method: 'POST' }),
  crmStatus: () => call<CrmStatus>('/api/outbound/crm/status'),
  crmResend: () => call<{ tried: number; sent: number; failed: number; status: CrmStatus }>('/api/outbound/crm/resend', { method: 'POST' }),
  list: () => call<CallsResponse>('/api/outbound/calls'),
  uploadCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return call<{ added: number; skipped: any[]; rejected: Array<{ row: number; reason: string; name: string }> }>(
      '/api/outbound/upload-csv', { method: 'POST', body: form });
  },
  dial: (id: string) => call<OutboundCall>(`/api/outbound/calls/${id}/dial`, { method: 'POST' }),
  dialAll: () => call<{ requested: number }>('/api/outbound/dial-all', { method: 'POST' }),
  cancel: (id: string) => call<OutboundCall>(`/api/outbound/calls/${id}/cancel`, { method: 'POST' }),
  remove: (id: string) => call(`/api/outbound/calls/${id}`, { method: 'DELETE' }),
  removeMany: (ids: string[]) => call<{ removed: number; kept_in_progress: number }>('/api/outbound/calls/delete', { method: 'POST', body: JSON.stringify({ ids }) }),
  preview: (id: string, body: { reset?: boolean; message?: string }) =>
    call<{ reply: string; ended: boolean; outcome: string | null }>(`/api/outbound/calls/${id}/preview`, { method: 'POST', body: JSON.stringify(body) }),
  get templateUrl() { return withToken(`${API_BASE}/api/outbound/template.csv`); },
};
