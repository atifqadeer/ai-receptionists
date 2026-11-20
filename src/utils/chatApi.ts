// Chat › Test chat history, saved in MySQL by the backend (/api/chats).
import { API_BASE } from './agentApi';

export interface ChatMessage {
  id: number;
  sender: 'agent' | 'caller' | 'system';
  text: string;
  at: string;          // ISO time
  intent?: string;
  ms?: number;         // how long the agent took to answer
}

export interface Chat {
  id: string;
  title: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at: string | null;
  duration: number;
  agent_name: string;
  company_name: string;
  online: boolean;     // answered by the backend AI agent (false: offline answers)
  messages: ChatMessage[];
}

export interface ChatSummary {
  id: string;
  title: string;
  status: 'active' | 'ended';
  started_at: string;
  ended_at: string | null;
  duration: number;
  agent_name: string;
  message_count: number;
  intents: string[];
  last_message: { sender: string; text: string } | null;
  online: boolean;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/chats${path}`, {
      ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch {
    throw new Error('The backend is not running, so chat history can\'t be loaded or saved.');
  }
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try { detail = (await res.json()).detail || detail; } catch { /* not JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

export const chatApi = {
  list: () => call<{ chats: ChatSummary[] }>(''),
  get: (id: string) => call<Chat>(`/${id}`),
  save: (chat: Chat) => call<ChatSummary>(`/${chat.id}`, { method: 'PUT', body: JSON.stringify(chat) }),
  remove: (id: string) => call(`/${id}`, { method: 'DELETE' }),
  clear: () => call<{ deleted: number }>('', { method: 'DELETE' }),
};

export const newChatId = () =>
  `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
