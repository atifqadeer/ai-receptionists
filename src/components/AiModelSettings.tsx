import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/agentApi';

// Settings > System > AI Model: the AI model behind the agent (chats and
// calls). Saved in MySQL by the backend and used straight away. Without a
// working model the agent answers with its built-in rules.

interface Provider { name: string; base_url: string; model: string; models: string[]; key_url: string; no_key?: boolean; note?: string }
interface AiModel {
  enabled: boolean;
  provider: string;
  api_key: string;          // masked
  has_key: boolean;
  rejected_reason?: string;
  providers_with_key: string[];
  base_url: string;
  base_url_used: string;
  model: string;
  temperature: number;
  max_tokens: number;
  instructions: string;
  active: boolean;
  rejected: boolean;
  providers: Record<string, Provider>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/ai-model${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
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

const field = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:border-violet-500 outline-none';
const label = 'block text-sm font-medium text-gray-300 mb-1.5';

export default function AiModelSettings() {
  const [m, setM] = useState<AiModel | null>(null);
  const [form, setForm] = useState<Partial<AiModel>>({});
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsMsg, setModelsMsg] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelFilter, setModelFilter] = useState('');

  const apply = (d: AiModel) => {
    setM(d);
    setForm({ provider: d.provider, model: d.model, base_url: d.base_url, temperature: d.temperature,
      max_tokens: d.max_tokens, instructions: d.instructions, enabled: d.enabled });
  };
  useEffect(() => { request<AiModel>('').then(apply).catch((e) => setError(e.message)); }, []);

  if (!m) {
    return <div className="text-sm text-gray-400">{error ? <span className="text-amber-300">{error}</span> : <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</>}</div>;
  }

  const provider = m.providers[form.provider || m.provider] || m.providers.openai;
  const providerChanged = form.provider !== m.provider;
  const dirty = !!newKey.trim() || (Object.keys(form) as (keyof AiModel)[]).some((k) => form[k] !== m[k]);
  const set = (patch: Partial<AiModel>) => setForm((f) => ({ ...f, ...patch }));

  const pickProvider = (id: string) => {
    const p = m.providers[id];
    set({ provider: id, model: p.model || form.model, base_url: '' });
    setNewKey('');
    setTest(null);
    setModels(null);
    setModelsMsg('');
  };
  const keySaved = providerChanged ? m.providers_with_key.includes(form.provider || '') : m.has_key;

  const save = async (): Promise<AiModel | null> => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = { ...form };
      if (newKey.trim()) body.api_key = newKey.trim();
      let d = await request<AiModel>('', { method: 'PUT', body: JSON.stringify(body) });
      setNewKey('');
      setError('');
      if (d.enabled && (d.has_key || d.providers[d.provider]?.no_key)) {
        const t = await request<{ ok: boolean; message: string }>('/test', { method: 'POST' });
        setTest(t);
        d = await request<AiModel>('');
        setNotice(t.ok ? 'Saved and checked: new messages use this model straight away.' : '');
      } else {
        setTest(null);
        setNotice('AI model settings saved.');
      }
      apply(d);
      setTimeout(() => setNotice(''), 4000);
      return d;
    } catch (e: any) {
      setError(e.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    if (dirty) { await save(); return; }
    setTesting(true);
    setTest(null);
    try {
      setTest(await request<{ ok: boolean; message: string }>('/test', { method: 'POST' }));
      apply(await request<AiModel>(''));
    } catch (e: any) {
      setTest({ ok: false, message: e.message });
    } finally {
      setTesting(false);
    }
  };

  const loadModels = async () => {
    if (dirty && !(await save())) return;
    setLoadingModels(true);
    setModelsMsg('');
    try {
      const r = await request<{ ok: boolean; message: string; models: string[] }>('/models');
      setModels(r.ok ? r.models : null);
      setModelsMsg(r.message);
    } catch (e: any) {
      setModelsMsg(e.message);
    } finally {
      setLoadingModels(false);
    }
  };

  const removeKey = async () => {
    if (!window.confirm('Remove the saved API key? The agent goes back to its built-in answers.')) return;
    try { apply(await request<AiModel>('', { method: 'PUT', body: JSON.stringify({ api_key: '' }) })); } catch (e: any) { setError(e.message); }
  };

  // What the agent uses right now.
  const status = !m.enabled
    ? { cls: 'bg-gray-700/60 text-gray-300 border-gray-600', icon: 'fa-power-off', text: 'Switched off: the agent uses its built-in answers.' }
    : m.rejected
      ? { cls: 'bg-red-500/10 text-red-300 border-red-500/30', icon: 'fa-circle-xmark', text: `${m.rejected_reason || `${m.providers[m.provider]?.name} rejected the API key or model.`} Until then the agent uses its built-in answers.` }
      : m.active
        ? { cls: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30', icon: 'fa-circle-check', text: `Active: the agent answers with ${m.providers[m.provider]?.name}, model ${m.model}.` }
        : { cls: 'bg-amber-500/10 text-amber-300 border-amber-500/30', icon: 'fa-triangle-exclamation', text: 'Not set up: add an API key. Until then the agent uses its built-in answers (knowledge base, phrase book).' };

  return (
    <div className="space-y-6">
      <div className={`text-sm px-4 py-3 rounded-lg border flex items-start gap-2 ${status.cls}`}>
        <i className={`fa-solid ${status.icon} mt-0.5`}></i><span>{status.text}</span>
      </div>

      {/* Provider and key */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-brain text-violet-400"></i>AI Model
            </h3>
            <p className="text-sm text-gray-400 mt-1">The AI that writes the agent's answers in chats and on calls, from your knowledge base.</p>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
            Use the AI model
            <button type="button" onClick={() => set({ enabled: !form.enabled })} aria-pressed={!!form.enabled}
              className={`relative w-11 h-6 rounded-full transition-all ${form.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
              <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: form.enabled ? 'translateX(20px)' : 'none' }}></span>
            </button>
          </label>
        </div>

        <div>
          <p className={label}>Provider</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {Object.entries(m.providers).map(([id, p]) => {
              const on = (form.provider || m.provider) === id;
              return (
                <button key={id} type="button" onClick={() => pickProvider(id)}
                  className={`text-left rounded-lg border px-3 py-2.5 text-sm transition-all ${on ? 'border-violet-500 bg-violet-500/10 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-600 bg-gray-800/40'}`}>
                  {p.name}
                  {p.no_key && <span className="block text-[11px] text-gray-500">No key needed</span>}
                </button>
              );
            })}
          </div>
        </div>

        {!provider.no_key && (
          <div>
            <div className="flex items-center justify-between">
              <label className={label}>API key</label>
              {provider.key_url && (
                <a href={provider.key_url} target="_blank" rel="noreferrer" className="text-xs text-violet-300 hover:text-violet-200">
                  Get a {provider.name} key <i className="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
                </a>
              )}
            </div>
            <div className="flex gap-2">
              <input type={showKey ? 'text' : 'password'} value={newKey} onChange={(e) => setNewKey(e.target.value)} autoComplete="new-password"
                placeholder={keySaved
                  ? (providerChanged ? `Your saved ${provider.name} key will be used (type a new one to replace it)`
                    : m.rejected ? `Saved key ${m.api_key} does not work: paste a new key` : `Saved key ${m.api_key} (type a new one to replace it)`)
                  : `Paste your ${provider.name} API key`}
                className={`${field} font-mono`} />
              <button type="button" onClick={() => setShowKey(!showKey)} title={showKey ? 'Hide' : 'Show'}
                className="px-3 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">
                <i className={`fa-regular ${showKey ? 'fa-eye-slash' : 'fa-eye'}`}></i>
              </button>
              {m.has_key && !providerChanged && (
                <button type="button" onClick={removeKey} title="Remove the saved key"
                  className="px-3 rounded-lg border border-gray-700 text-gray-400 hover:text-red-300 hover:border-red-500/50">
                  <i className="fa-solid fa-trash"></i>
                </button>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-1">Each provider keeps its own key. Saved in your database and only sent to {provider.name}.</p>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={label}>Model</label>
            <input list="ai-model-suggestions" value={form.model || ''} onChange={(e) => set({ model: e.target.value })}
              placeholder={provider.model || 'model name'} className={field} />
            <datalist id="ai-model-suggestions">
              {(models || provider.models).map((x) => <option key={x} value={x} />)}
            </datalist>
            <div className="flex items-center gap-2 mt-2">
              <button type="button" onClick={loadModels} disabled={loadingModels || (!provider.no_key && !keySaved && !newKey.trim())}
                className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 hover:border-violet-500 disabled:opacity-40">
                <i className={`fa-solid ${loadingModels ? 'fa-spinner fa-spin' : 'fa-list'} mr-1.5`}></i>Load models from {provider.name}
              </button>
              {modelsMsg && <span className={`text-[11px] ${models ? 'text-emerald-300' : 'text-amber-300'}`}>{modelsMsg}</span>}
            </div>
            {models && models.length > 0 && (
              <div className="mt-2 rounded-lg border border-gray-800 bg-gray-950/40 p-2">
                <input value={modelFilter} onChange={(e) => setModelFilter(e.target.value)} placeholder={`Search ${models.length} models`}
                  className="w-full bg-gray-800 border border-gray-700 rounded-md px-2.5 py-1.5 text-xs text-white mb-2 outline-none focus:border-violet-500" />
                <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
                  {models.filter((x) => x.toLowerCase().includes(modelFilter.trim().toLowerCase())).slice(0, 120).map((x) => (
                    <button key={x} type="button" onClick={() => set({ model: x })}
                      className={`text-[11px] px-2 py-0.5 rounded-full border ${form.model === x ? 'border-violet-500 text-violet-200 bg-violet-500/10' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}>{x}</button>
                  ))}
                </div>
              </div>
            )}
            {provider.note && <p className="text-xs text-gray-500 mt-2">{provider.note}</p>}
            {!models && provider.models.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {provider.models.map((x) => (
                  <button key={x} type="button" onClick={() => set({ model: x })}
                    className={`text-[11px] px-2 py-0.5 rounded-full border ${form.model === x ? 'border-violet-500 text-violet-200 bg-violet-500/10' : 'border-gray-700 text-gray-400 hover:text-gray-200'}`}>{x}</button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className={label}>API address {provider.base_url && <span className="text-xs font-normal text-gray-500">(optional)</span>}</label>
            <input value={form.base_url || ''} onChange={(e) => set({ base_url: e.target.value })}
              placeholder={provider.base_url || 'https://your-provider.example.com/v1'} className={`${field} font-mono text-xs`} />
            <p className="text-xs text-gray-500 mt-1">{provider.base_url ? 'Leave blank to use the provider\'s address.' : 'Any service with an OpenAI-compatible API.'}</p>
          </div>
        </div>
      </div>

      {/* Behaviour */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2"><i className="fa-solid fa-sliders text-violet-400"></i>How it answers</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className={label}>Creativity: {Number(form.temperature ?? 0.5).toFixed(1)}</label>
            <input type="range" min={0} max={1} step={0.1} value={form.temperature ?? 0.5}
              onChange={(e) => set({ temperature: parseFloat(e.target.value) })} className="w-full accent-violet-500" />
            <div className="flex justify-between text-xs text-gray-500 mt-1"><span>Precise, sticks to facts</span><span>Creative</span></div>
          </div>
          <div>
            <label className={label}>Longest answer: {form.max_tokens} tokens (about {Math.round((form.max_tokens || 400) * 0.75)} words)</label>
            <input type="range" min={100} max={1500} step={50} value={form.max_tokens ?? 400}
              onChange={(e) => set({ max_tokens: parseInt(e.target.value) })} className="w-full accent-violet-500" />
            <div className="flex justify-between text-xs text-gray-500 mt-1"><span>Short</span><span>Long</span></div>
          </div>
        </div>
        <div>
          <label className={label}>Extra instructions <span className="text-xs font-normal text-gray-500">(optional)</span></label>
          <textarea value={form.instructions || ''} onChange={(e) => set({ instructions: e.target.value })} rows={4}
            placeholder={'For example:\nAlways mention that we also recruit on weekends.\nNever discuss salaries above the advertised range.'}
            className={`${field} resize-y`} />
          <p className="text-xs text-gray-500 mt-1">Added to the agent's own instructions (identity, knowledge base, language rules and guardrails stay in force).</p>
        </div>
      </div>

      {error && <p className="text-sm text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
      {notice && <p className="text-sm text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
      {test && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${test.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          <i className={`fa-solid ${test.ok ? 'fa-circle-check' : 'fa-circle-xmark'} mr-2`}></i>{test.message}
        </div>
      )}
      <div className="flex justify-end gap-3">
        <button onClick={runTest} disabled={testing || saving}
          className="px-5 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50">
          <i className={`fa-solid ${testing ? 'fa-spinner fa-spin' : 'fa-vial'} mr-2`}></i>{dirty ? 'Save & test' : 'Test'}
        </button>
        <button onClick={save} disabled={saving || !dirty}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-50">
          <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i>{saving ? 'Saving & checking…' : 'Save AI model'}
        </button>
      </div>
    </div>
  );
}
