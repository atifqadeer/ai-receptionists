// Dashboard login (python-backend app/services/auth.py).
//
// The sign-in token is kept in the browser: in localStorage when "Keep me
// signed in" is ticked, otherwise only for this browser tab (sessionStorage).
// installFetchAuth() adds it to every request to the dashboard API, so the
// existing fetch calls need no changes; a 401 signs the user out.
import { API_BASE } from './agentApi';

const KEY = 'auth-session';

export interface AuthUser { email: string; name: string; role: string }
interface Session { token: string; expires_at: string; user: AuthUser }

function read(): Session | null {
  for (const s of [window.sessionStorage, window.localStorage]) {
    try {
      const raw = s.getItem(KEY);
      if (raw) {
        const v = JSON.parse(raw) as Session;
        if (v.token && new Date(v.expires_at).getTime() > Date.now()) return v;
        s.removeItem(KEY);
      }
    } catch { /* blocked storage */ }
  }
  return null;
}

export const getSession = read;
export const getToken = () => read()?.token || '';

export function saveSession(s: Session, remember: boolean) {
  clearSession();
  (remember ? window.localStorage : window.sessionStorage).setItem(KEY, JSON.stringify(s));
}

export function clearSession() {
  try { window.localStorage.removeItem(KEY); window.sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}

/** Sign out: forget the token and show the login page. */
export function signOut() {
  clearSession();
  window.dispatchEvent(new Event('auth-signed-out'));
}

const isApi = (url: string) =>
  url.startsWith(`${API_BASE}/api/`) || url.startsWith('/api/');

/** A dashboard API URL used as a link or <audio> source (no headers there). */
export function withToken(url: string): string {
  const t = getToken();
  if (!t || !isApi(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(t)}`;
}

let installed = false;

/** Add the token to every dashboard API request; a 401 signs out. */
export function installFetchAuth() {
  if (installed) return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (!isApi(url) || url.includes('/api/auth/')) return original(input, init);
    const token = getToken();
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);
    const res = await original(input, { ...init, headers });
    if (res.status === 401 && token) signOut();
    return res;
  };
}

async function post<T>(path: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/auth/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach the backend at ${API_BASE}. Start it with start-app.bat.`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as any)?.detail || `Sign-in failed (${res.status})`);
  return data as T;
}

export const authApi = {
  status: async (): Promise<{ setup_needed: boolean }> => {
    const res = await fetch(`${API_BASE}/api/auth/status`);
    if (!res.ok) throw new Error(`The backend answered ${res.status}`);
    return res.json();
  },
  login: (email: string, password: string, remember: boolean) => post<Session>('login', { email, password, remember }),
  setup: (name: string, email: string, password: string, remember: boolean) =>
    post<Session>('setup', { name, email, password, remember }),
  me: async (): Promise<AuthUser | null> => {
    const res = await fetch(`${API_BASE}/api/auth/me`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) return null;
    return (await res.json()).user || null;
  },
};
