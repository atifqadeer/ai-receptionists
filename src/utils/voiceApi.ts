// Client for the backend's live voice (python-backend app/services/voice.py):
// Deepgram, Cartesia or ElevenLabs for the agent's voice and for hearing
// callers, and the Deepgram Voice Agent (app/services/deepgram_agent.py).
import { API_BASE } from './agentApi';
import { withToken } from './auth';

export type Cloud = 'deepgram' | 'cartesia' | 'elevenlabs';
/** The voice card: one provider for everything, or Standard (each part chosen separately). */
export type VoiceMode = 'standard' | Cloud;
export type TtsProvider = Cloud | 'windows';
export type SttProvider = Cloud | 'local';

export interface ProviderKeyInfo {
  api_key: string;          // masked
  key_source: '' | 'saved' | 'env';
  key_rejected: boolean;
}

export interface VoiceSettings {
  mode: VoiceMode;
  tts_provider: TtsProvider;     // the Standard card's choices
  stt_provider: SttProvider;
  language: string;
  deepgram: ProviderKeyInfo & {
    tts_voice: string; stt_model: string;
    agent_llm_provider: string; agent_llm_model: string; agent_temperature: string;
  };
  cartesia: ProviderKeyInfo & {
    tts_model: string; voice_id: string; voice_name: string; voice_gender: string;
    stt_model: string; speed: string;
  };
  elevenlabs: ProviderKeyInfo & {
    tts_model: string; voice_id: string; voice_name: string; voice_gender: string; stt_model: string;
  };
  tts_chosen: TtsProvider;       // what the selected card uses
  stt_chosen: SttProvider;
  tts_active: TtsProvider;       // what calls actually use (fallback when not set up)
  stt_active: SttProvider;
  agent_active: boolean;         // phone calls run on the Deepgram Voice Agent
  agent_llms: Record<string, string[]>;
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
  voices: (provider: Cloud) =>
    call<{ provider: string; voices: LiveVoice[]; needs_key: boolean }>(`/voices?provider=${provider}`),
  test: (provider: Cloud) =>
    call<{ ok: boolean; message: string }>('/test', { method: 'POST', body: JSON.stringify({ provider }) }),
  /** Connect to the Deepgram Voice Agent with the saved settings (the Deepgram card). */
  testAgent: () => call<{ ok: boolean; message: string }>('/agent-test', { method: 'POST' }),
  /** URL that streams `text` as MP3 in the live voice (for an <audio> element). */
  speakUrl: (text: string, opts: { provider?: string; voiceId?: string; model?: string } = {}) => {
    const q = new URLSearchParams({ text });
    if (opts.provider) q.set('provider', opts.provider);
    if (opts.voiceId) q.set('voice_id', opts.voiceId);
    if (opts.model) q.set('model', opts.model);
    return withToken(`${API_BASE}/api/voice/speak?${q.toString()}`);
  },
};
