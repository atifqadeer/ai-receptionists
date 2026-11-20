import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/agentApi';

// Settings > Agent > Languages: which languages the agent may use in chats
// and on calls. Anything not selected is refused politely (the agent says
// which languages it can use) and never answered in.

interface LanguageInfo { id: string; name: string; native: string; builtin: boolean; calls: boolean }
interface LanguageSetup {
  chat: string[];
  chat_default: string;
  calls: string[];
  catalog: LanguageInfo[];
  calls_note: string;
  ai_model: boolean;
}

async function request(init?: RequestInit): Promise<LanguageSetup> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/languages`, { ...init, headers: { 'Content-Type': 'application/json' } });
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

const join = (names: string[], last = 'and') =>
  names.length <= 1 ? (names[0] || '') : `${names.slice(0, -1).join(', ')} ${last} ${names[names.length - 1]}`;

export default function LanguageSettings() {
  const [data, setData] = useState<LanguageSetup | null>(null);
  const [chat, setChat] = useState<string[]>([]);
  const [chatDefault, setChatDefault] = useState('english');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (d: LanguageSetup) => { setData(d); setChat(d.chat); setChatDefault(d.chat_default); };
  useEffect(() => { request().then(apply).catch((e) => setError(e.message)); }, []);

  if (!data) {
    return <div className="text-sm text-gray-400">{error ? <span className="text-amber-300">{error}</span> : <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</>}</div>;
  }

  const byId = Object.fromEntries(data.catalog.map((l) => [l.id, l]));
  const usable = (id: string) => byId[id]?.builtin || data.ai_model;
  const activeChat = chat.filter(usable);
  const dirty = JSON.stringify([...chat].sort()) !== JSON.stringify([...data.chat].sort()) || chatDefault !== data.chat_default;

  const toggle = (id: string) => {
    const next = chat.includes(id) ? chat.filter((x) => x !== id) : [...chat, id];
    setChat(next);
    if (!next.includes(chatDefault)) setChatDefault(next.find((x) => byId[x]?.builtin) || next[0] || 'english');
  };

  const save = async () => {
    setSaving(true);
    try {
      apply(await request({ method: 'PUT', body: JSON.stringify({ chat, chat_default: chatDefault, calls: data.calls }) }));
      setError('');
      setNotice('Languages saved. New messages follow them straight away.');
      setTimeout(() => setNotice(''), 3000);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const names = activeChat.map((id) => byId[id].name);
  const defaultName = byId[activeChat.includes(chatDefault) ? chatDefault : activeChat[0]]?.name || 'English';

  return (
    <div className="space-y-6">
      {!data.ai_model && (
        <div className="text-sm text-sky-200 bg-sky-500/10 border border-sky-500/30 rounded-lg px-4 py-3">
          <i className="fa-solid fa-circle-info mr-2"></i>
          English, Urdu and Roman Urdu work now. The other languages need a working AI model
          (<strong className="text-sky-100">Settings › System › AI Model</strong>) to write replies; until then they stay switched off even if selected.
        </div>
      )}

      {/* Chat */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <i className="fa-solid fa-comments text-violet-400"></i>Chat languages
            </h3>
            <p className="text-sm text-gray-400 mt-1">Website chat and the test chat. Pick every language the agent may chat in.</p>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300">{chat.length} selected</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {data.catalog.map((l) => {
            const on = chat.includes(l.id);
            const needsAi = !l.builtin && !data.ai_model;
            return (
              <button key={l.id} type="button" onClick={() => toggle(l.id)} aria-pressed={on}
                className={`text-left rounded-xl border p-3.5 transition-all ${on
                  ? 'border-violet-500 bg-violet-500/10'
                  : 'border-gray-700 hover:border-gray-600 bg-gray-800/40'}`}>
                <div className="flex items-center gap-2">
                  <span className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${on ? 'bg-violet-600 border-violet-500' : 'border-gray-600'}`}>
                    {on && <i className="fa-solid fa-check text-[10px] text-white"></i>}
                  </span>
                  <span className={`text-sm font-medium ${on ? 'text-white' : 'text-gray-200'}`}>{l.name}</span>
                  {chatDefault === l.id && on && (
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-300">default</span>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-1.5 pl-7 truncate" dir="auto">{l.native}</p>
                <p className={`text-[11px] mt-1 pl-7 ${needsAi ? 'text-amber-300/90' : 'text-gray-500'}`}>
                  {l.builtin ? 'Works now' : needsAi ? 'Needs an AI model' : 'Via the AI model'}
                </p>
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="text-xs text-gray-400">Start chats in
            <select value={chatDefault} onChange={(e) => setChatDefault(e.target.value)}
              className="mt-1 w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none">
              {chat.filter((id) => byId[id]?.builtin).map((id) => <option key={id} value={id}>{byId[id].name}</option>)}
            </select>
            <span className="block text-[11px] text-gray-500 mt-1">Used until the visitor writes in, or asks for, another selected language.</span>
          </label>
          <div className="rounded-lg border border-gray-800 bg-gray-950/40 p-3">
            <p className="text-[11px] uppercase tracking-wide text-gray-500 mb-1.5"><i className="fa-solid fa-shield-halved mr-1"></i>Guardrail</p>
            <p className="text-xs text-gray-400">If a visitor writes in, or asks for, any other language, the agent replies in {defaultName}:</p>
            <p className="text-sm text-gray-200 mt-1.5 italic">"Sorry, I can only chat in {join(names)}. Could you write your message in {join(names, 'or')}?"</p>
          </div>
        </div>
      </div>

      {/* Calls */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-phone-volume text-violet-400"></i>Call languages
          </h3>
          <p className="text-sm text-gray-400 mt-1">Inbound calls, the dial pad and job calls.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {data.catalog.map((l) => {
            const on = data.calls.includes(l.id);
            return (
              <span key={l.id} title={l.calls ? '' : data.calls_note}
                className={`text-sm px-3 py-1.5 rounded-lg border flex items-center gap-2 ${on
                  ? 'border-violet-500 bg-violet-500/10 text-white'
                  : 'border-gray-800 text-gray-600 cursor-not-allowed'}`}>
                <i className={`fa-solid ${on ? 'fa-check text-violet-300' : 'fa-lock text-gray-700'} text-xs`}></i>{l.name}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-gray-500"><i className="fa-solid fa-circle-info mr-1.5"></i>{data.calls_note} A caller who asks for
          another language hears: "I'm sorry, I can only speak English on this call."</p>
      </div>

      {error && <p className="text-sm text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
      {notice && <p className="text-sm text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving || !dirty || chat.length === 0}
          className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-50">
          <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i>Save languages
        </button>
      </div>
    </div>
  );
}
