import { useEffect, useState } from 'react';
import { telephonyApi, InboundCall, InboundSettings as Inbound, InboundStatus } from '../utils/outboundApi';

// Agent Setup > Inbound Calls tab: the extension the agent
// answers. The backend registers it on the PBX (its own local SIP port)
// and answers every call to it automatically.

const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none';
const label = 'block text-sm font-medium text-gray-300 mb-1.5';

const STATE_BADGE: Record<string, [string, string]> = {
  registered: ['bg-emerald-500/15 text-emerald-300', 'Answering calls'],
  error: ['bg-red-500/15 text-red-300', 'Not registered'],
  disabled: ['bg-gray-700/60 text-gray-300', 'Off'],
};

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '');

function duration(c: InboundCall) {
  if (!c.answered_at) return '';
  const end = c.ended_at ? new Date(c.ended_at).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(c.answered_at).getTime()) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function InboundSettings({ value, onChange, sipServer }: {
  value: Inbound;
  onChange: (v: Inbound) => void;
  sipServer: string;
}) {
  const [status, setStatus] = useState<InboundStatus | null>(null);
  const [calls, setCalls] = useState<InboundCall[]>([]);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const poll = () => telephonyApi.inbound().then((r) => {
      if (alive) { setStatus(r.status); setCalls(r.calls); }
    }).catch(() => {});
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const set = (patch: Partial<Inbound>) => onChange({ ...value, ...patch });
  const [badgeClass, badgeText] = STATE_BADGE[status?.state || 'disabled'];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
        <i className="fa-solid fa-headset text-violet-400"></i>
        Inbound Calls (Auto-Answer)
        <span className={`ml-auto text-xs px-2.5 py-1 rounded-full ${badgeClass}`}>
          {badgeText}{status?.active_calls ? ` · ${status.active_calls} on a call` : ''}
        </span>
      </h3>

      <label className="flex items-center gap-3 cursor-pointer select-none">
        <input type="checkbox" checked={value.enabled} onChange={(e) => set({ enabled: e.target.checked })}
          className="w-4 h-4 accent-violet-500" />
        <span className="text-sm text-white">Answer calls to this extension automatically</span>
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className={label}>Extension</label>
          <input type="text" value={value.extension} placeholder="428" onChange={(e) => set({ extension: e.target.value })} className={input} autoComplete="off" />
          <p className="text-xs text-gray-500 mt-1">The number people dial. Create it on your PBX first.</p>
        </div>
        <div>
          <label className={label}>Extension password</label>
          <input type="password" value={value.password} onChange={(e) => set({ password: e.target.value })} className={input} autoComplete="new-password" />
          <p className="text-xs text-gray-500 mt-1">Leave blank if it's the same extension as the SIP Account above: that one registration then places and answers calls.</p>
        </div>
        <div>
          <label className={label}>SIP server (optional)</label>
          <input type="text" value={value.server} placeholder={sipServer ? `same as SIP Account: ${sipServer}` : '192.168.1.10 or pbx.example.com'}
            onChange={(e) => set({ server: e.target.value })} className={input} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={label}>SIP port</label>
            <input type="text" value={value.port} placeholder={value.server ? '5060' : 'as SIP Account'} onChange={(e) => set({ port: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>Local SIP port</label>
            <input type="text" value={value.local_port} placeholder="5064" onChange={(e) => set({ local_port: e.target.value })} className={input} />
          </div>
        </div>
        <div className="md:col-span-2">
          <label className={label}>Greeting (optional)</label>
          <input type="text" value={value.greeting} placeholder="Blank: the agent's greeting from Settings › Agent"
            onChange={(e) => set({ greeting: e.target.value })} className={input} />
        </div>
        <div>
          <label className={label}>Calls at the same time</label>
          <input type="number" min={1} max={10} value={value.max_concurrent} onChange={(e) => set({ max_concurrent: Number(e.target.value) })} className={input} />
          <p className="text-xs text-gray-500 mt-1">More callers than this hear "busy".</p>
        </div>
        <div>
          <label className={label}>Longest call (minutes)</label>
          <input type="number" min={1} max={120} value={value.max_minutes} onChange={(e) => set({ max_minutes: Number(e.target.value) })} className={input} />
        </div>
      </div>

      {status && status.state !== 'disabled' && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${status.state === 'registered' ? 'border-emerald-500/30 text-emerald-300 bg-emerald-500/5' : 'border-red-500/30 text-red-300 bg-red-500/5'}`}>
          {status.message}
        </div>
      )}
      <div className="text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-1">
        <p><i className="fa-solid fa-circle-info text-violet-400 mr-1.5"></i>Press <strong className="text-gray-200">Save VoIP Settings</strong> below to register the extension. The agent stays registered while the backend runs and re-registers by itself if the PBX restarts.</p>
        <p>Don't register the same extension in a softphone (MicroSIP) at the same time: most PBXs ring only one of them.</p>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-medium text-gray-300">Latest inbound calls <span className="text-xs font-normal text-gray-500">· full history, search and recordings on the <strong className="text-gray-300">Inbound Calls</strong> page in the sidebar</span></h4>
          {calls.length > 0 && (
            <button onClick={() => telephonyApi.clearInbound().then(() => setCalls([]))} className="text-xs text-gray-500 hover:text-gray-300">Clear</button>
          )}
        </div>
        {calls.length === 0 ? (
          <p className="text-xs text-gray-500">No inbound calls yet.</p>
        ) : (
          <div className="divide-y divide-gray-800 border border-gray-800 rounded-lg">
            {calls.slice(0, 5).map((c) => (
              <div key={c.id}>
                <button onClick={() => setOpen(open === c.id ? null : c.id)} className="w-full text-left px-3 py-2 flex items-center gap-3 hover:bg-gray-800/50 text-sm">
                  <i className={`fa-solid ${c.status === 'in_progress' ? 'fa-phone-volume text-emerald-400 animate-pulse' : c.status === 'failed' ? 'fa-phone-slash text-red-400' : 'fa-phone text-gray-500'}`}></i>
                  <span className="text-white">{c.caller_name ? `${c.caller_name} (${c.caller_number})` : c.caller_number}</span>
                  <span className="text-gray-500 text-xs">{time(c.started_at)}</span>
                  <span className="ml-auto text-gray-400 text-xs">{duration(c)} {c.status === 'in_progress' ? 'live' : c.status}</span>
                </button>
                {open === c.id && (
                  <div className="px-4 pb-3 space-y-1.5 text-xs">
                    {c.error && <p className="text-red-300">{c.error}</p>}
                    {c.transcript.length === 0 && <p className="text-gray-500">No transcript.</p>}
                    {c.transcript.map((m, i) => (
                      <p key={i} className={m.role === 'agent' ? 'text-violet-200' : 'text-gray-200'}>
                        <strong>{m.role === 'agent' ? 'Agent' : 'Caller'}:</strong> {m.text}
                        {m.unclear && <span className="text-gray-500"> (unclear)</span>}
                        {m.interrupted && <span className="text-gray-500"> (interrupted)</span>}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
