// Client for the backend's live voice (python-backend app/services/voice.py):
// Deepgram or Cartesia for the agent's voice and for hearing callers.
import { API_BASE } from './agentApi';

export type TtsProvider = 'deepgram' | 'cartesia' | 'windows';
export type SttProvider = 'deepgram' | 'cartesia' | 'local';

export interface ProviderKeyInfo {
  api_key: string;          // masked
  key_source: '' | 'saved' | 'env';
  key_rejected: boolean;
}

export interface VoiceSettings {
  tts_provider: TtsProvider;
  stt_provider: SttProvider;
  language: string;
  deepgram: ProviderKeyInfo & { tts_voice: string; stt_model: string };
  cartesia: ProviderKeyInfo & {
    tts_model: string; voice_id: string; voice_name: string; voice_gender: string;
    stt_model: string; speed: string;
  };
  tts_active: TtsProvider;
  stt_active: SttProvider;
}

export interface LiveVoice {
  id: string;
  name: string;
  gender: string;
  accent: string;
  description: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/voice${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
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

export const voiceApi = {
  getSettings: () => call<VoiceSettings>('/settings'),
  saveSettings: (changes: Record<string, unknown>) =>
    call<VoiceSettings>('/settings', { method: 'PUT', body: JSON.stringify(changes) }),
  voices: (provider: 'deepgram' | 'cartesia') =>
    call<{ provider: string; voices: LiveVoice[]; needs_key: boolean }>(`/voices?provider=${provider}`),
  test: (provider: 'deepgram' | 'cartesia') =>
    call<{ ok: boolean; message: string }>('/test', { method: 'POST', body: JSON.stringify({ provider }) }),
  /** URL that streams `text` as MP3 in the live voice (for an <audio> element). */
  speakUrl: (text: string, opts: { provider?: string; voiceId?: string; model?: string } = {}) => {
    const q = new URLSearchParams({ text });
    if (opts.provider) q.set('provider', opts.provider);
    if (opts.voiceId) q.set('voice_id', opts.voiceId);
    if (opts.model) q.set('model', opts.model);
    return `${API_BASE}/api/voice/speak?${q.toString()}`;
  },
};
