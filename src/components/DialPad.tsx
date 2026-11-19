import { useEffect, useRef, useState } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { telephonyApi, InboundCall } from '../utils/outboundApi';

// Make a Call > start screen: a phone dial pad. "Call" makes the AI agent
// phone the number over the SIP Account (a real call, logged below with
// its transcript); "Test in browser" talks to the agent with your mic.

const KEYS: Array<[string, string]> = [
  ['1', ''], ['2', 'ABC'], ['3', 'DEF'],
  ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'],
  ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'],
  ['*', ''], ['0', '+'], ['#', ''],
];

const LIVE = ['dialing', 'ringing', 'in_progress'];

const STATUS: Record<string, [string, string]> = {
  dialing: ['text-amber-300', 'Dialling…'],
  ringing: ['text-amber-300', 'Ringing…'],
  in_progress: ['text-emerald-300', 'Connected'],
  completed: ['text-gray-400', 'Completed'],
  no_answer: ['text-orange-300', 'No answer'],
  cancelled: ['text-gray-400', 'Cancelled'],
  failed: ['text-red-300', 'Failed'],
};

const clean = (v: string) => v.replace(/[^\d+*#]/g, '').replace(/(?!^)\+/g, '').slice(0, 20);

function seconds(c: InboundCall) {
  if (!c.answered_at) return 0;
  const end = c.ended_at ? new Date(c.ended_at).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(c.answered_at).getTime()) / 1000));
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function DialPad({ agentName, companyName, voice, browserReady, onBrowserCall }: {
  agentName: string;
  companyName: string;
  voice: string;
  browserReady: boolean;
  onBrowserCall: (number: string, name: string) => void;
}) {
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  // What the agent says first on dial-pad calls ({name}, {agent}, {company}
  // are filled in). Blank: the backend's default outbound opening.
  const [opening, setOpening] = useLocalStorage('dial-opening', '');
  const [defaultOpening, setDefaultOpening] = useState('');
  const [editOpening, setEditOpening] = useState(false);
  const [calls, setCalls] = useState<InboundCall[]>([]);
  const [sip, setSip] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [, tick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const holdRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; plus: boolean }>({ timer: null, plus: false });
  const liveEndRef = useRef<HTMLDivElement>(null);

  // SIP Account status, so the Call button says why it can't dial.
  useEffect(() => {
    telephonyApi.get().then((s: any) => {
      const missing: string[] = s.missing || [];
      if (s.provider !== 'sip') setSip({ ok: false, text: 'Real calls go through the SIP / VoIP Account. Choose SIP as the provider in Settings › Calling › SIP / VoIP Account.' });
      else if (missing.length) setSip({ ok: false, text: `SIP Account is missing: ${missing.join(', ')} (Settings › Calling › SIP / VoIP Account).` });
      else setSip({ ok: true, text: `Calls go out from your SIP Account${s.credentials?.sip?.username ? ` (extension ${s.credentials.sip.username})` : ''}.` });
    }).catch(() => setSip({ ok: false, text: 'Backend not reachable (http://localhost:8000). Start it to place real calls.' }));
  }, []);

  // Recent dial-pad calls; quicker refresh while one is live.
  const live = calls.find((c) => LIVE.includes(c.status));
  useEffect(() => {
    let alive = true;
    const poll = () => telephonyApi.dialed().then((r) => { if (alive) setCalls(r.calls); }).catch(() => {});
    poll();
    const t = setInterval(poll, live ? 1500 : 5000);
    return () => { alive = false; clearInterval(t); };
  }, [!!live]);

  useEffect(() => { telephonyApi.dialOpening().then((r) => setDefaultOpening(r.opening)).catch(() => {}); }, []);

  const fill = (t: string) => t.replace(/\{name\}/g, (name.trim().split(/\s+/)[0] || ''))
    .replace(/\{agent\}/g, agentName).replace(/\{company\}/g, companyName)
    .replace(/\s{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();

  // Call timer.
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [live?.id]);

  useEffect(() => { liveEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, [live?.transcript.length]);

  const press = (k: string) => { setNumber((n) => clean(n + k)); setError(''); inputRef.current?.focus(); };
  const back = () => setNumber((n) => n.slice(0, -1));

  // Hold 0 for "+".
  const down = (k: string) => {
    if (k !== '0') return;
    holdRef.current.plus = false;
    holdRef.current.timer = setTimeout(() => { holdRef.current.plus = true; press('+'); }, 550);
  };
  const up = (k: string) => {
    if (holdRef.current.timer) clearTimeout(holdRef.current.timer);
    holdRef.current.timer = null;
    if (k === '0' && holdRef.current.plus) return;
    press(k);
  };

  const dial = async (to = number, who = name) => {
    if (!to || busy || live) return;
    setBusy(true);
    setError('');
    try {
      await telephonyApi.dial(to, who, opening.trim());
      const r = await telephonyApi.dialed();
      setCalls(r.calls);
    } catch (e: any) {
      setError(e.message || 'Could not place the call');
    } finally {
      setBusy(false);
    }
  };

  // Hang up, then refresh at once: the call may already have ended on the
  // backend (e.g. the ring timeout) a moment before the poll showed it.
  const hangup = () => {
    if (!live) return;
    setCalls((cs) => cs.map((c) => (c.id === live.id ? { ...c, status: c.answered_at ? 'completed' : 'cancelled' } : c)));
    telephonyApi.hangup(live.id).catch(() => {}).finally(() =>
      telephonyApi.dialed().then((r) => setCalls(r.calls)).catch(() => {}));
  };

  const canCall = !!number && !!sip?.ok && !busy && !live;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
      {/* Dial pad */}
      <div className="lg:col-span-2 bg-gray-900 rounded-2xl border border-gray-800 p-6 flex flex-col">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-grip text-violet-400"></i> Dial pad
          </h3>
          <span className={`text-xs px-2.5 py-1 rounded-full ${sip === null ? 'bg-gray-800 text-gray-400' : sip.ok ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {sip === null ? 'Checking line…' : sip.ok ? 'SIP line ready' : 'SIP not set up'}
          </span>
        </div>

        <div className="relative mb-2">
          <input
            ref={inputRef}
            value={number}
            onChange={(e) => { setNumber(clean(e.target.value)); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') dial(); }}
            placeholder="Enter number"
            inputMode="tel"
            autoFocus
            className="w-full bg-transparent text-center text-3xl font-light tracking-wider text-white placeholder-gray-600 placeholder:text-xl placeholder:tracking-normal outline-none py-3 px-10"
          />
          {number && (
            <button onClick={back} onDoubleClick={() => setNumber('')} title="Delete (double-click to clear)"
              className="absolute right-0 top-1/2 -translate-y-1/2 w-10 h-10 rounded-full text-gray-400 hover:text-white hover:bg-gray-800">
              <i className="fa-solid fa-delete-left text-lg"></i>
            </button>
          )}
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Name (optional)"
          className="w-full bg-gray-800/60 border border-gray-700/60 rounded-lg px-3 py-2 text-sm text-center text-white placeholder-gray-500 outline-none focus:border-violet-500 mb-5"
        />

        <div className="grid grid-cols-3 gap-3 mx-auto w-full max-w-[280px]">
          {KEYS.map(([k, sub]) => (
            <button
              key={k}
              onPointerDown={() => down(k)}
              onPointerUp={() => up(k)}
              onPointerLeave={() => { if (holdRef.current.timer) clearTimeout(holdRef.current.timer); holdRef.current.timer = null; }}
              className="aspect-square rounded-full bg-gray-800 hover:bg-gray-700 active:bg-violet-600 active:scale-95 transition-all flex flex-col items-center justify-center select-none border border-gray-700/50"
            >
              <span className="text-2xl text-white leading-none">{k}</span>
              <span className="text-[10px] tracking-[0.2em] text-gray-500 h-3 mt-1">{sub}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center justify-center gap-6 mt-6">
          {live ? (
            <button onClick={hangup} title="Hang up"
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg shadow-red-500/30 flex items-center justify-center">
              <i className="fa-solid fa-phone-slash text-2xl"></i>
            </button>
          ) : (
            <button onClick={() => dial()} disabled={!canCall} title={sip?.ok ? `${agentName} calls this number` : sip?.text}
              className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/30 flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">
              <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-phone'} text-2xl`}></i>
            </button>
          )}
        </div>
        <p className="text-xs text-gray-500 text-center mt-3">
          {live ? 'A call is in progress' : `${agentName} calls the number and talks to whoever answers`}
        </p>

        {error && <p className="mt-3 text-xs text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{error}</p>}
        {sip && !sip.ok && <p className="mt-3 text-xs text-amber-300 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">{sip.text}</p>}

        <div className="mt-auto pt-5">
          <div className="flex items-center gap-3 text-xs text-gray-600 mb-3"><div className="flex-1 h-px bg-gray-800"></div>or<div className="flex-1 h-px bg-gray-800"></div></div>
          <button onClick={() => onBrowserCall(number, name)} disabled={!browserReady}
            className="w-full py-2.5 rounded-xl border border-violet-500/40 text-violet-200 text-sm hover:bg-violet-500/10 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            <i className="fa-solid fa-microphone"></i> Test in browser with your microphone
          </button>
        </div>
      </div>

      {/* Right side: live call or agent, then recent calls */}
      <div className="lg:col-span-3 space-y-6">
        {live ? (
          <div className="bg-gray-900 rounded-2xl border border-emerald-500/30 overflow-hidden">
            <div className="p-5 flex items-center gap-4 bg-gradient-to-r from-emerald-600/10 to-teal-600/5 border-b border-gray-800">
              <div className="w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <i className={`fa-solid fa-phone-volume text-emerald-300 text-xl ${live.status === 'in_progress' ? '' : 'animate-pulse'}`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold truncate">{live.caller_name || live.caller_number}</p>
                <p className="text-xs text-gray-400">{live.caller_name ? `${live.caller_number} · ` : ''}<span className={STATUS[live.status]?.[0]}>{STATUS[live.status]?.[1]}</span>{live.status === 'in_progress' && ` · ${mmss(seconds(live))}`}</p>
              </div>
              <button onClick={hangup} className="px-4 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-sm hover:bg-red-500/20 flex items-center gap-2">
                <i className="fa-solid fa-phone-slash"></i> Hang up
              </button>
            </div>
            <div className="p-5 space-y-3 max-h-[420px] overflow-y-auto">
              {live.transcript.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-6">{live.status === 'in_progress' ? `${agentName} is about to speak…` : 'Waiting for the call to be answered…'}</p>
              )}
              {live.transcript.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                  <div className={`max-w-[80%] px-4 py-2.5 rounded-2xl text-sm ${m.role === 'agent' ? 'bg-gray-800 border border-gray-700 text-white rounded-bl-md' : 'bg-violet-600 text-white rounded-br-md'}`}>
                    <p className="text-[10px] uppercase tracking-wide opacity-60 mb-0.5">{m.role === 'agent' ? agentName : 'Them'}</p>
                    {m.text}
                    {m.unclear && <span className="opacity-60"> (unclear)</span>}
                    {m.interrupted && <span className="opacity-60"> (interrupted)</span>}
                  </div>
                </div>
              ))}
              <div ref={liveEndRef} />
            </div>
          </div>
        ) : (
          <div className="bg-gradient-to-br from-violet-600/10 to-indigo-600/10 rounded-2xl border border-violet-500/30 p-6 flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center flex-shrink-0">
              <i className="fa-solid fa-robot text-white text-2xl"></i>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-lg font-bold text-white">{agentName}</p>
              <p className="text-sm text-gray-300">{companyName} · <span className="capitalize">{voice}</span> voice</p>
              <p className="text-xs text-gray-400 mt-1">Type or tap a number, then press the green button. The agent greets them and answers from your knowledge base.</p>
            </div>
          </div>
        )}

        {!live && (
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-semibold text-white flex items-center gap-2"><i className="fa-solid fa-comment-dots text-violet-400"></i> Opening message</h3>
              <div className="flex items-center gap-3 text-xs">
                {opening && <button onClick={() => setOpening('')} className="text-gray-500 hover:text-gray-300">Use default</button>}
                <button onClick={() => { if (!editOpening && !opening) setOpening(defaultOpening); setEditOpening(!editOpening); }} className="text-violet-300 hover:text-violet-200">
                  {editOpening ? 'Done' : 'Edit'}
                </button>
              </div>
            </div>
            {editOpening ? (
              <>
                <textarea value={opening} onChange={(e) => setOpening(e.target.value)} rows={3} maxLength={600}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-violet-500" />
                <p className="text-xs text-gray-500 mt-1">{'{name}'} = first name from the Name field, {'{agent}'} = {agentName}, {'{company}'} = {companyName}. End with a question they can answer.</p>
              </>
            ) : (
              <p className="text-sm text-gray-300 italic">“{fill(opening || defaultOpening || '…')}”</p>
            )}
            <p className="text-xs text-gray-500 mt-2">What {agentName} says first on calls from the dial pad. Inbound calls keep the greeting from Settings › Agent.</p>
          </div>
        )}

        <div className="bg-gray-900 rounded-2xl border border-gray-800">
          <div className="px-5 py-4 border-b border-gray-800 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><i className="fa-solid fa-clock-rotate-left text-violet-400"></i> Recent calls</h3>
            {calls.length > 0 && !live && (
              <button onClick={() => telephonyApi.clearDialed().then(() => setCalls([]))} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
            )}
          </div>
          {calls.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-10">No calls yet. Calls you place from the dial pad appear here with their transcript.</p>
          ) : (
            <div className="divide-y divide-gray-800 max-h-[460px] overflow-y-auto">
              {calls.map((c) => {
                const [cls, base] = STATUS[c.status] || ['text-gray-400', c.status];
                const label = c.status === 'no_answer' && c.reason ? c.reason : base;
                return (
                  <div key={c.id}>
                    <div className="px-5 py-3 flex items-center gap-3 hover:bg-gray-800/40 cursor-pointer" onClick={() => setOpen(open === c.id ? null : c.id)}>
                      <div className="w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center flex-shrink-0">
                        <i className={`fa-solid ${c.status === 'failed' ? 'fa-phone-slash text-red-400' : c.status === 'no_answer' ? 'fa-phone-slash text-orange-400' : 'fa-arrow-up-right text-emerald-400'} text-sm`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{c.caller_name || c.caller_number}</p>
                        <p className="text-xs text-gray-500">{c.caller_name && `${c.caller_number} · `}{when(c.started_at)}</p>
                      </div>
                      <div className="text-right">
                        <p className={`text-xs ${cls}`}>{label}</p>
                        {c.answered_at && <p className="text-xs text-gray-500">{mmss(seconds(c))}</p>}
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); setNumber(c.caller_number); setName(c.caller_name || ''); dial(c.caller_number, c.caller_name || ''); }}
                        disabled={!sip?.ok || !!live || busy} title="Call again"
                        className="w-9 h-9 rounded-full text-emerald-400 hover:bg-emerald-500/10 disabled:opacity-30 disabled:hover:bg-transparent">
                        <i className="fa-solid fa-phone text-sm"></i>
                      </button>
                    </div>
                    {open === c.id && (
                      <div className="px-5 pb-4 pl-[4.25rem] space-y-1.5 text-xs">
                        {c.error && <p className="text-red-300">{c.error}</p>}
                        {c.transcript.length === 0 && !c.error && <p className="text-gray-500">No conversation.</p>}
                        {c.transcript.map((m, i) => (
                          <p key={i} className={m.role === 'agent' ? 'text-violet-200' : 'text-gray-200'}>
                            <strong>{m.role === 'agent' ? agentName : 'Them'}:</strong> {m.text}
                          </p>
                        ))}
                        {c.answered_at && (
                          <a href={telephonyApi.inboundRecordingUrl(c.id)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-violet-300 hover:text-violet-200 mt-1">
                            <i className="fa-solid fa-download"></i> Recording (WAV)
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
