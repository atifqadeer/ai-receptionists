// Client for the Python backend's AI agent (python-backend, port 8000).
// The backend answers from the knowledge base set in Agent Setup — with
// the AI model when an OpenAI key is configured, and from the knowledge
// base alone when it is not — so the simulators send every caller
// question here instead of guessing in the browser.

export const API_BASE: string =
  (import.meta as any).env?.VITE_API_URL || 'http://localhost:8000';

export interface AgentSettings {
  identity: { agentName?: string; companyName?: string; language?: string; voice?: string };
  behavior: { greeting?: string; farewell?: string; allowInterrupts?: boolean; personality?: string };
  knowledge: {
    businessHours?: string;
    phone?: string;
    email?: string;
    address?: string;
    services?: string;
    companyInfo?: string;
    documents?: Array<{ name: string; content: string }>;
    faqs?: Array<{ q: string; a: string }>;
  };
}

async function request<T>(path: string, init: RequestInit, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// Send the Agent Setup data (stored in the browser) to the backend, so
// the agent answers from what the user actually entered. Returns false
// when the backend is not reachable.
export async function syncAgentSettings({ identity, behavior, knowledge }: AgentSettings): Promise<boolean> {
  try {
    await request('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify({
        agent_name: identity.agentName,
        company_name: identity.companyName,
        language: identity.language || 'English',
        voice: identity.voice,
        greeting: behavior.greeting,
        farewell: behavior.farewell,
        personality: behavior.personality || 'professional',
        allow_interrupts: behavior.allowInterrupts !== false,
        knowledge_base: {
          business_hours: knowledge.businessHours || '',
          phone: knowledge.phone || '',
          email: knowledge.email || '',
          address: knowledge.address || '',
          services: knowledge.services || '',
          company_info: knowledge.companyInfo || '',
        },
        faqs: (knowledge.faqs || [])
          .filter(f => f.q?.trim() && f.a?.trim())
          .map(f => ({ question: f.q.trim(), answer: f.a.trim() })),
        knowledge_documents: knowledge.documents || [],
      }),
    }, 8000);
    return true;
  } catch {
    return false;
  }
}

export async function startAgentCall(callerName?: string, callerNumber?: string): Promise<string | null> {
  try {
    const data = await request<{ call_id: string }>('/api/agent/call/start', {
      method: 'POST',
      body: JSON.stringify({ caller_name: callerName || null, caller_number: callerNumber || null }),
    }, 8000);
    return data.call_id;
  } catch {
    return null;
  }
}

// The agent's answer to one caller message, or null when the backend
// could not be reached (the caller then falls back to local matching).
export async function askAgent(callId: string, message: string): Promise<{ message: string; intent: string } | null> {
  try {
    const data = await request<{ message: string; intent: string }>('/api/agent/chat', {
      method: 'POST',
      body: JSON.stringify({ call_id: callId, message }),
    });
    return data?.message ? { message: data.message, intent: data.intent } : null;
  } catch {
    return null;
  }
}

export async function endAgentCall(callId: string): Promise<void> {
  try {
    await request(`/api/agent/call/${encodeURIComponent(callId)}/end`, { method: 'POST' }, 5000);
  } catch { /* ending is best-effort */ }
}
