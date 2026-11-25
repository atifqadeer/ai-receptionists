import { useEffect, useMemo, useRef, useState } from 'react';
import { voiceApi, VoiceSettings, LiveVoice, TtsProvider, SttProvider, Cloud, VoiceMode } from '../utils/voiceApi';

// Settings > Calling > Call Voice. One card picks the whole voice stack:
// - Deepgram: Deepgram does everything on phone calls (Voice Agent API:
//   Nova-3 hears, an LLM run by Deepgram thinks, Aura-2 speaks)
// - Cartesia / ElevenLabs: that provider hears and speaks; the answers
//   come from Settings > System > AI Model
// - Standard: each part chosen separately, as before
// Saved in MySQL by the backend; used on phone calls and in the browser test call.

const CLOUDS: Cloud[] = ['deepgram', 'cartesia', 'elevenlabs'];

const MODE_CARDS: { id: VoiceMode; label: string; tagline: string; icon: string; parts: string[] }[] = [
  { id: 'deepgram', label: 'Deepgram', tagline: 'All-in-one Voice Agent', icon: 'fa-wave-square',
    parts: ['Hears: Nova-3', 'Thinks: LLM run by Deepgram', 'Speaks: Aura-2'] },
  { id: 'cartesia', label: 'Cartesia', tagline: 'Ultra-fast voices', icon: 'fa-bolt',
    parts: ['Hears: Ink', 'Thinks: your AI Model', 'Speaks: Sonic'] },
  { id: 'elevenlabs', label: 'ElevenLabs', tagline: 'Most expressive voices', icon: 'fa-microphone-lines',
    parts: ['Hears: Scribe', 'Thinks: your AI Model', 'Speaks: ElevenLabs voices'] },
  { id: 'standard', label: 'Standard', tagline: 'Mix & match', icon: 'fa-sliders',
    parts: ['Pick the voice and the hearing separately', 'Thinks: your AI Model'] },
];

const TTS_OPTIONS: { id: TtsProvider; label: string; sub: string; icon: string }[] = [
  { id: 'deepgram', label: 'Deepgram Aura-2', sub: 'Natural, low latency', icon: 'fa-wave-square' },
  { id: 'cartesia', label: 'Cartesia Sonic', sub: 'Expressive, ultra-fast', icon: 'fa-bolt' },
  { id: 'elevenlabs', label: 'ElevenLabs', sub: 'Most lifelike', icon: 'fa-microphone-lines' },
  { id: 'windows', label: 'Windows voice', sub: 'Offline, robotic', icon: 'fa-desktop' },
];

const STT_OPTIONS: { id: SttProvider; label: string; sub: string; icon: string }[] = [
  { id: 'deepgram', label: 'Deepgram Nova', sub: 'Most accurate on phone lines', icon: 'fa-ear-listen' },
  { id: 'cartesia', label: 'Cartesia Ink', sub: 'Whisper-based, fast', icon: 'fa-pen-nib' },
  { id: 'elevenlabs', label: 'ElevenLabs Scribe', sub: 'Many languages', icon: 'fa-closed-captioning' },
  { id: 'local', label: 'On this PC', sub: 'Whisper / Vosk, offline', icon: 'fa-microchip' },
];

const PROVIDER_NAME: Record<string, string> = {
  deepgram: 'Deepgram', cartesia: 'Cartesia', elevenlabs: 'ElevenLabs', windows: 'Windows voice', local: 'this PC',
};

const KEY_LINKS: Record<Cloud, string> = {
  deepgram: 'https://console.deepgram.com/',
  cartesia: 'https://play.cartesia.ai/keys',
  elevenlabs: 'https://elevenlabs.io/app/settings/api-keys',
};

const LLM_PROVIDER_NAME: Record<string, string> = {
  open_ai: 'OpenAI', anthropic: 'Anthropic (Claude)', google: 'Google (Gemini)', groq: 'Groq',
};

const selectCls = 'mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none';

function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string; sub: string; icon: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2">
      {options.map((o) => {
        const active = o.id === value;
        return (
          <button key={o.id} type="button" onClick={() => onChange(o.id)}
            className={`text-left rounded-lg border px-3 py-2.5 transition-all ${
              active ? 'border-violet-500 bg-violet-500/10' : 'border-gray-700 hover:border-gray-600 bg-gray-800/40'
            }`}>
            <span className={`flex items-center gap-2 text-sm font-medium ${active ? 'text-violet-200' : 'text-gray-200'}`}>
              <i className={`fa-solid ${o.icon} text-xs ${active ? 'text-violet-400' : 'text-gray-500'}`}></i>
              {o.label}
            </span>
            <span className="block text-xs text-gray-500 mt-0.5">{o.sub}</span>
          </button>
        );
      })}
    </div>
  );
}

function Result({ r }: { r?: { ok: boolean; message: string } }) {
  if (!r) return null;
  return (
    <p className={`text-xs ${r.ok ? 'text-emerald-300' : 'text-red-300'}`}>
      <i className={`fa-solid ${r.ok ? 'fa-circle-check' : 'fa-circle-xmark'} mr-1.5`}></i>{r.message}
    </p>
  );
}

export default function LiveVoiceSettings({ agentName, companyName }: { agentName: string; companyName: string }) {
  const [settings, setSettings] = useState<VoiceSettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [keys, setKeys] = useState<Record<Cloud, string>>({ deepgram: '', cartesia: '', elevenlabs: '' });
  const [testing, setTesting] = useState<Cloud | 'agent' | ''>('');
  const [testResult, setTestResult] = useState<Partial<Record<Cloud | 'agent', { ok: boolean; message: string }>>>({});
  const [voices, setVoices] = useState<Partial<Record<Cloud, LiveVoice[]>>>({});
  const [voicesError, setVoicesError] = useState('');
  const [loadingVoices, setLoadingVoices] = useState(false);
  const [search, setSearch] = useState('');
  const [playing, setPlaying] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const load = () => voiceApi.getSettings().then((s) => { setSettings(s); setLoadError(''); })
    .catch((e) => setLoadError(e.message));

  useEffect(() => { load(); return () => { audioRef.current?.pause(); }; }, []);

  const flash = (text: string) => { setNotice(text); setTimeout(() => setNotice(''), 2500); };

  const save = async (changes: Record<string, unknown>, message = 'Voice settings saved') => {
    try {
      setSettings(await voiceApi.saveSettings(changes));
      flash(message);
    } catch (e: any) {
      setLoadError(e.message);
    }
  };

  const mode: VoiceMode = settings?.mode ?? 'standard';
  // The voice provider of the selected card (or the Standard card's choice).
  const ttsCloud: Cloud | null = settings && settings.tts_chosen !== 'windows' ? settings.tts_chosen as Cloud : null;
  const sttChosen: SttProvider | undefined = settings?.stt_chosen;

  useEffect(() => {
    if (!ttsCloud || voices[ttsCloud]) return;
    setLoadingVoices(true);
    setVoicesError('');
    voiceApi.voices(ttsCloud)
      .then((r) => {
        setVoices((v) => ({ ...v, [ttsCloud]: r.voices }));
        if (r.needs_key && ttsCloud !== 'deepgram') setVoicesError(`Add your ${PROVIDER_NAME[ttsCloud]} API key above to load its voices.`);
      })
      .catch((e) => setVoicesError(e.message))
      .finally(() => setLoadingVoices(false));
  }, [ttsCloud, voices]);

  const runTest = async (p: Cloud) => {
    setTesting(p);
    try {
      const r = await voiceApi.test(p);
      setTestResult((t) => ({ ...t, [p]: r }));
      load();
    } catch (e: any) {
      setTestResult((t) => ({ ...t, [p]: { ok: false, message: e.message } }));
    } finally {
      setTesting('');
    }
  };

  const runAgentTest = async () => {
    setTesting('agent');
    try {
      const r = await voiceApi.testAgent();
      setTestResult((t) => ({ ...t, agent: r }));
      load();
    } catch (e: any) {
      setTestResult((t) => ({ ...t, agent: { ok: false, message: e.message } }));
    } finally {
      setTesting('');
    }
  };

  const saveKey = async (p: Cloud) => {
    const key = keys[p].trim();
    if (!key) return;
    await save({ [p]: { api_key: key } }, `${PROVIDER_NAME[p]} API key saved`);
    setKeys((k) => ({ ...k, [p]: '' }));
    setVoices((v) => ({ ...v, [p]: undefined }));     // reload the voices with the new key
    runTest(p);
  };

  const ttsModel = (p: Cloud) =>
    p === 'cartesia' ? settings?.cartesia.tts_model : p === 'elevenlabs' ? settings?.elevenlabs.tts_model : undefined;

  const preview = (v: LiveVoice) => {
    if (!ttsCloud) return;
    audioRef.current?.pause();
    if (playing === v.id) { setPlaying(''); return; }
    const sample = `Hello! I'm ${agentName || 'your assistant'} from ${companyName || 'our company'}. How can I help you today?`;
    const audio = new Audio(voiceApi.speakUrl(sample, { provider: ttsCloud, voiceId: v.id, model: ttsModel(ttsCloud) }));
    audioRef.current = audio;
    setPlaying(v.id);
    audio.onended = () => setPlaying('');
    audio.onerror = () => { setPlaying(''); setVoicesError('Preview failed: check the API key with Test.'); };
    audio.play().catch(() => setPlaying(''));
  };

  const selectVoice = (v: LiveVoice) => {
    if (ttsCloud === 'deepgram') save({ deepgram: { tts_voice: v.id } }, `Voice set to ${v.name}`);
    if (ttsCloud === 'cartesia' || ttsCloud === 'elevenlabs')
      save({ [ttsCloud]: { voice_id: v.id, voice_name: v.name, voice_gender: v.gender } }, `Voice set to ${v.name}`);
  };

  const list = useMemo(() => {
    const all = (ttsCloud && voices[ttsCloud]) || [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((v) => `${v.name} ${v.gender} ${v.accent} ${v.description}`.toLowerCase().includes(q)) : all;
  }, [ttsCloud, voices, search]);

  if (!settings) {
    return (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2 mb-3">
          <i className="fa-solid fa-microphone text-violet-400"></i>
          Live Voice
        </h3>
        {loadError ? (
          <p className="text-sm text-amber-300 flex items-start gap-2">
            <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>
            <span>{loadError} <button onClick={load} className="underline ml-1">Retry</button></span>
          </p>
        ) : (
          <p className="text-sm text-gray-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading voice settings…</p>
        )}
      </div>
    );
  }

  const selectedVoiceId = ttsCloud === 'deepgram' ? settings.deepgram.tts_voice
    : ttsCloud ? settings[ttsCloud].voice_id : '';
  const fellBack = settings.tts_chosen !== settings.tts_active;
  const sttFellBack = settings.stt_chosen !== settings.stt_active;
  const keyClouds: Cloud[] = mode === 'standard' ? CLOUDS : [mode];
  const dg = settings.deepgram;
  const llmModels = settings.agent_llms[dg.agent_llm_provider] || [];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-6 relative">
      {notice && (
        <div className="absolute top-4 right-4 text-xs bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-3 py-1.5 rounded-lg z-10">
          <i className="fa-solid fa-check mr-1.5"></i>{notice}
        </div>
      )}
      <div>
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-microphone text-violet-400"></i>
          Live Voice
        </h3>
        <p className="text-sm text-gray-400 mt-1">
          Choose who hears callers, thinks of the answers and speaks them on phone calls and in the browser test call.
          Saved instantly to the database.
        </p>
      </div>

      {loadError && (
        <p className="text-sm text-amber-300 flex items-start gap-2">
          <i className="fa-solid fa-triangle-exclamation mt-0.5"></i>{loadError}
        </p>
      )}

      {/* Voice stack cards */}
      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <i className="fa-solid fa-layer-group text-xs text-gray-500"></i>Voice stack
        </h4>
        <div role="radiogroup" aria-label="Voice stack" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {MODE_CARDS.map((c) => {
            const active = c.id === mode;
            const ready = c.id === 'standard' || !!settings[c.id as Cloud]?.key_source;
            return (
              <button key={c.id} type="button" role="radio" aria-checked={active}
                onClick={() => !active && save({ mode: c.id }, `${c.label} selected`)}
                className={`relative text-left rounded-xl border p-4 transition-all overflow-hidden ${
                  active
                    ? 'border-violet-500/60 bg-gradient-to-br from-violet-600/20 via-indigo-600/10 to-transparent shadow-lg shadow-violet-900/20'
                    : 'border-gray-700/80 bg-gray-800/30 hover:border-gray-600'}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                    active ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white' : 'bg-gray-800 text-gray-400'}`}>
                    <i className={`fa-solid ${c.icon} text-sm`}></i>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-200'}`}>{c.label}</p>
                    <p className="text-xs text-gray-500 truncate">{c.tagline}</p>
                  </div>
                  {active && <i className="fa-solid fa-circle-check text-violet-400"></i>}
                </div>
                <ul className="mt-3 space-y-1">
                  {c.parts.map((part) => (
                    <li key={part} className="text-xs text-gray-400 flex items-start gap-1.5">
                      <i className="fa-solid fa-angle-right text-[10px] text-gray-600 mt-1"></i>{part}
                    </li>
                  ))}
                </ul>
                {!ready && <p className="mt-2 text-[11px] text-amber-300/90">Needs an API key</p>}
              </button>
            );
          })}
        </div>
        {mode === 'deepgram' && (
          <p className={`text-xs flex items-start gap-2 ${settings.agent_active ? 'text-emerald-300' : 'text-amber-300'}`}>
            <i className={`fa-solid ${settings.agent_active ? 'fa-circle-check' : 'fa-triangle-exclamation'} mt-0.5`}></i>
            {settings.agent_active
              ? 'Phone calls run on the Deepgram Voice Agent: Deepgram hears the caller, thinks of the answer and speaks it, over one connection. Your agent\'s instructions, knowledge base and Call Rules still apply.'
              : 'Add a working Deepgram API key: until then calls use the Standard pipeline.'}
          </p>
        )}
        {(mode === 'cartesia' || mode === 'elevenlabs') && (
          <p className="text-xs text-gray-500 flex items-start gap-2">
            <i className="fa-solid fa-circle-info mt-0.5"></i>
            {PROVIDER_NAME[mode]} hears and speaks; the answers come from Settings › System › AI Model.
          </p>
        )}
      </section>

      {/* API keys */}
      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
          <i className="fa-solid fa-key text-xs text-gray-500"></i>{keyClouds.length > 1 ? 'API keys' : 'API key'}
        </h4>
        {keyClouds.map((p) => {
          const info = settings[p];
          return (
            <div key={p} className="rounded-lg border border-gray-700/70 bg-gray-800/40 p-3 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-white w-24">{PROVIDER_NAME[p]}</span>
                {info.key_rejected ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">Key rejected</span>
                ) : info.key_source ? (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300">
                    Key {info.api_key} {info.key_source === 'env' ? '(from .env)' : ''}
                  </span>
                ) : (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-gray-700 text-gray-300">No key</span>
                )}
                <a href={KEY_LINKS[p]} target="_blank" rel="noreferrer" className="text-xs text-violet-300 hover:text-violet-200 ml-auto">
                  Get a key <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
              </div>
              <div className="flex gap-2">
                <input type="password" autoComplete="off" value={keys[p]} placeholder={`Paste a ${PROVIDER_NAME[p]} API key`}
                  onChange={(e) => setKeys((k) => ({ ...k, [p]: e.target.value }))}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveKey(p); }}
                  className="flex-1 min-w-0 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none" />
                <button type="button" onClick={() => saveKey(p)} disabled={!keys[p].trim()}
                  className="px-3 py-2 rounded-lg bg-violet-600 text-white text-sm hover:bg-violet-700 disabled:opacity-40">
                  Save
                </button>
                <button type="button" onClick={() => runTest(p)} disabled={testing === p || !info.key_source}
                  className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-40">
                  {testing === p ? <i className="fa-solid fa-spinner fa-spin"></i> : 'Test'}
                </button>
              </div>
              <Result r={testResult[p]} />
            </div>
          );
        })}
      </section>

      {/* Deepgram Voice Agent brain */}
      {mode === 'deepgram' && (
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
              <i className="fa-solid fa-brain text-xs text-gray-500"></i>AI model (run by Deepgram)
            </h4>
            <button type="button" onClick={runAgentTest} disabled={testing === 'agent' || !dg.key_source}
              className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-40">
              {testing === 'agent' ? <i className="fa-solid fa-spinner fa-spin"></i> : <><i className="fa-solid fa-plug mr-1.5"></i>Test Voice Agent</>}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <label className="text-xs text-gray-400">Provider
              <select value={dg.agent_llm_provider} className={selectCls}
                onChange={(e) => save({ deepgram: { agent_llm_provider: e.target.value,
                  agent_llm_model: (settings.agent_llms[e.target.value] || [''])[0] } })}>
                {Object.keys(settings.agent_llms).map((p) => <option key={p} value={p}>{LLM_PROVIDER_NAME[p] || p}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-400">Model
              <select value={dg.agent_llm_model} className={selectCls}
                onChange={(e) => save({ deepgram: { agent_llm_model: e.target.value } })}>
                {!llmModels.includes(dg.agent_llm_model) && <option value={dg.agent_llm_model}>{dg.agent_llm_model}</option>}
                {llmModels.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="text-xs text-gray-400">Creativity ({dg.agent_temperature})
              <input type="range" min={0} max={1} step={0.1} value={Number(dg.agent_temperature) || 0}
                onChange={(e) => setSettings({ ...settings, deepgram: { ...dg, agent_temperature: e.target.value } })}
                onMouseUp={(e) => save({ deepgram: { agent_temperature: (e.target as HTMLInputElement).value } })}
                onKeyUp={(e) => save({ deepgram: { agent_temperature: (e.target as HTMLInputElement).value } })}
                className="mt-3 w-full accent-violet-500" />
            </label>
          </div>
          <Result r={testResult.agent} />
          <p className="text-xs text-gray-500 leading-relaxed">
            Deepgram runs and bills this model with your Deepgram key; no other AI key is needed. It gets your agent's
            instructions and knowledge (Agent Setup), can look up the knowledge base, and records the call outcome
            (interested, call back, do not call…). Settings › System › AI Model is still used for website chat.
          </p>
        </section>
      )}

      {/* Agent voice */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <i className="fa-solid fa-volume-high text-xs text-gray-500"></i>Agent voice
          </h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${fellBack ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
            {fellBack ? `Using ${PROVIDER_NAME[settings.tts_active]} until ${PROVIDER_NAME[settings.tts_chosen]} is set up`
              : `Live: ${PROVIDER_NAME[settings.tts_active]}`}
          </span>
        </div>
        {mode === 'standard' && (
          <Segmented options={TTS_OPTIONS} value={settings.tts_provider} onChange={(v) => save({ tts_provider: v })} />
        )}

        {ttsCloud === 'cartesia' && (
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-400">Model
              <select value={settings.cartesia.tts_model} onChange={(e) => save({ cartesia: { tts_model: e.target.value } })} className={selectCls}>
                <option value="sonic-2">Sonic 2 (best quality)</option>
                <option value="sonic-turbo">Sonic Turbo (lowest latency)</option>
                <option value="sonic-3">Sonic 3</option>
              </select>
            </label>
            <label className="text-xs text-gray-400">Speaking speed
              <select value={settings.cartesia.speed} onChange={(e) => save({ cartesia: { speed: e.target.value } })} className={selectCls}>
                <option value="slowest">Slowest</option>
                <option value="slow">Slow</option>
                <option value="normal">Normal</option>
                <option value="fast">Fast</option>
                <option value="fastest">Fastest</option>
              </select>
            </label>
          </div>
        )}
        {ttsCloud === 'elevenlabs' && (
          <label className="block text-xs text-gray-400 max-w-xs">Model
            <select value={settings.elevenlabs.tts_model} onChange={(e) => save({ elevenlabs: { tts_model: e.target.value } })} className={selectCls}>
              <option value="eleven_flash_v2_5">Flash v2.5 (lowest latency)</option>
              <option value="eleven_turbo_v2_5">Turbo v2.5</option>
              <option value="eleven_multilingual_v2">Multilingual v2 (best quality)</option>
            </select>
          </label>
        )}

        {ttsCloud && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search voices (name, accent, style)"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:border-violet-500 outline-none" />
              </div>
              <span className="text-xs text-gray-500 shrink-0">{list.length} voices</span>
            </div>
            {voicesError && <p className="text-xs text-amber-300">{voicesError}</p>}
            {loadingVoices ? (
              <p className="text-sm text-gray-400 py-4 text-center"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading voices…</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-80 overflow-y-auto pr-1">
                {list.map((v) => {
                  const selected = v.id === selectedVoiceId;
                  return (
                    <div key={v.id}
                      className={`flex items-center gap-3 rounded-lg border p-2.5 transition-all ${
                        selected ? 'border-violet-500 bg-violet-500/10' : 'border-gray-700/70 hover:border-gray-600'}`}>
                      <button type="button" onClick={() => preview(v)} title={`Preview ${v.name}`}
                        className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-sm transition-all ${
                          playing === v.id ? 'bg-violet-500 text-white' : 'bg-gray-800 text-gray-300 hover:bg-violet-600 hover:text-white'}`}>
                        <i className={`fa-solid ${playing === v.id ? 'fa-stop' : 'fa-play'}`}></i>
                      </button>
                      <button type="button" onClick={() => selectVoice(v)} className="text-left min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-sm font-medium text-white">
                          <span className="truncate">{v.name}</span>
                          {selected && <i className="fa-solid fa-circle-check text-violet-400 text-xs"></i>}
                        </span>
                        <span className="block text-xs text-gray-500 truncate">
                          {[v.gender, v.accent].filter(Boolean).join(' · ')}{v.description ? ` — ${v.description}` : ''}
                        </span>
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            {(ttsCloud === 'cartesia' || ttsCloud === 'elevenlabs') && !settings[ttsCloud].voice_id && (
              <p className="text-xs text-amber-300">Pick a {PROVIDER_NAME[ttsCloud]} voice{ttsCloud === 'cartesia' ? ': calls use the Windows voice until one is chosen.' : ' (otherwise the default voice from .env is used).'}</p>
            )}
          </div>
        )}
        {settings.tts_chosen === 'windows' && (
          <p className="text-xs text-gray-500">The agent uses the voices installed in Windows (and the browser's own voices in test calls). Choose a live voice for natural speech.</p>
        )}
      </section>

      {/* Speech-to-text */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-gray-200 flex items-center gap-2">
            <i className="fa-solid fa-ear-listen text-xs text-gray-500"></i>Hearing callers (speech-to-text)
          </h4>
          <span className={`text-xs px-2 py-0.5 rounded-full ${sttFellBack ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/10 text-emerald-300'}`}>
            {sttFellBack ? `Using ${PROVIDER_NAME[settings.stt_active]} until ${PROVIDER_NAME[settings.stt_chosen]} has a key`
              : `Active: ${PROVIDER_NAME[settings.stt_active]}`}
          </span>
        </div>
        {mode === 'standard' && (
          <Segmented options={STT_OPTIONS} value={settings.stt_provider} onChange={(v) => save({ stt_provider: v })} />
        )}
        {sttChosen === 'deepgram' && (
          <label className="block text-xs text-gray-400 max-w-xs">Model
            <select value={dg.stt_model} onChange={(e) => save({ deepgram: { stt_model: e.target.value } })} className={selectCls}>
              <option value="nova-3">Nova-3 (most accurate)</option>
              <option value="nova-2">Nova-2</option>
            </select>
          </label>
        )}
        <p className="text-xs text-gray-500 leading-relaxed">
          {mode === 'deepgram' && settings.agent_active
            ? 'On phone calls Deepgram also notices when the caller talks over the agent and stops it straight away. If Deepgram can\'t be reached, the call carries on the Standard way.'
            : 'On phone calls the PC still notices instantly when the caller starts and stops talking (for interruptions); the chosen service then writes down what they said. If it can\'t be reached, the call carries on with the recogniser on this PC.'}
        </p>
      </section>
    </div>
  );
}
