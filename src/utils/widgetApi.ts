// Website chat widget (python-backend app/api/widget_routes.py): settings,
// and the conversations visitors had, grouped by their email address.
import { API_BASE } from './agentApi';

export interface WidgetSettings {
  enabled: boolean;
  site_key: string;
  title: string;
  subtitle: string;
  welcome: string;
  goodbye: string;
  color: string;
  position: 'left' | 'right';
  ask_name: boolean;
  launcher_text: string;
  allowed_origins: string[];
  quick_replies: string[];
  typing_delay: 'off' | 'short' | 'natural' | 'long';
  logo_url: string;
  logo_version: number;
  script_url: string;
  demo_url: string;
  snippet: string;
  local_only: boolean;
}

export interface WidgetVisitor {
  email: string;
  name: string;
  conversations: number;
  messages: number;
  unread: number;
  online: boolean;
  ai_paused: boolean;
  open_chats: number;
  typing: boolean;
  first_at: string;
  last_at: string;
  last_message: { sender: string; text: string } | null;
}

export interface WidgetMessage {
  id: number;
  sender: 'visitor' | 'agent' | 'operator' | 'system';
  text: string;
  at: string;
  page?: string;
}

export interface WidgetConversation {
  id: string;
  email: string;
  name: string;
  status: 'open' | 'closed';
  ended_by?: 'visitor' | 'goodbye' | 'team' | 'inactive' | null;
  ended_at?: string | null;
  ai_enabled: boolean;
  started_at: string;
  last_at: string;
  origin: string;
  pages: string[];
  unread: number;
  online: boolean;
  visitor_messages: number;
  visitor_typing: boolean;
  messages: WidgetMessage[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/widget${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new Error(`Could not reach the backend at ${API_BASE}. Start it with start-app.bat.`);
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

export const widgetApi = {
  settings: () => call<WidgetSettings>('/settings'),
  saveSettings: (s: Partial<WidgetSettings>) => call<WidgetSettings>('/settings', { method: 'PUT', body: JSON.stringify(s) }),
  rotateKey: () => call<WidgetSettings>('/settings/rotate-key', { method: 'POST' }),
  visitors: () => call<{ visitors: WidgetVisitor[]; total_conversations: number }>('/visitors'),
  conversations: (email: string) =>
    call<{ email: string; conversations: WidgetConversation[] }>(`/conversations?email=${encodeURIComponent(email)}`),
  reply: (id: string, text: string) =>
    call<WidgetConversation>(`/conversations/${id}/reply`, { method: 'POST', body: JSON.stringify({ text }) }),
  update: (id: string, changes: { ai_enabled?: boolean; read?: boolean; status?: 'open' | 'closed' }) =>
    call<WidgetConversation>(`/conversations/${id}`, { method: 'PUT', body: JSON.stringify(changes) }),
  removeConversation: (id: string) => call(`/conversations/${id}`, { method: 'DELETE' }),
  removeVisitor: (email: string) => call<{ deleted: number }>(`/visitors/${encodeURIComponent(email)}`, { method: 'DELETE' }),
  /** Tell the visitor's widget that a team member is typing (or stopped). */
  typing: (id: string, typing: boolean) =>
    call<{ visitor_typing: boolean }>(`/conversations/${id}/typing`, { method: 'POST', body: JSON.stringify({ typing }) }),
  uploadLogo: async (file: File): Promise<WidgetSettings> => {
    const form = new FormData();
    form.append('file', file);
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/api/widget/logo`, { method: 'POST', body: form });
    } catch {
      throw new Error(`Could not reach the backend at ${API_BASE}. Start it with start-app.bat.`);
    }
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
      throw new Error(detail);
    }
    return res.json();
  },
  removeLogo: () => call<WidgetSettings>('/logo', { method: 'DELETE' }),
};
