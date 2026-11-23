import { useEffect, useState } from 'react';
import { API_BASE } from '../utils/agentApi';

// Settings > GuardRails > Call Rules: when a number may be called (again).
// Saved in MySQL by the backend (app/services/call_rules.py) and enforced on
// every call: the auto dialer, Call / Call all on Job Calls, and the dial pad.

interface Rules {
  hangup_wait_minutes: number;
  callback_enabled: boolean;
  callback_default_minutes: number;
  callback_max: number;
  not_interested_days: number;
  wrong_number_to_dnc: boolean;
  voicemail_retry_minutes: number;
  max_calls_per_day: number;
  recall_after_days: number;
}
interface Hold { number: string; reason: string; since: string; until: string }
interface View { rules: Rules; defaults: Rules; holds: Hold[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/call-rules${path}`, { ...init, headers: { 'Content-Type': 'application/json' } });
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

const input = 'w-24 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white text-right focus:border-violet-500 outline-none';

const fmt = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" aria-pressed={on} onClick={() => onChange(!on)}
      className={`relative w-11 h-6 rounded-full transition-all shrink-0 ${on ? 'bg-emerald-500' : 'bg-gray-700'}`}>
      <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: on ? 'translateX(20px)' : 'none' }}></span>
    </button>
  );
}

function Rule({ icon, title, desc, children, off }: { icon: string; title: string; desc: string; children: React.ReactNode; off?: boolean }) {
  return (
    <div className={`flex flex-col md:flex-row md:items-center gap-3 p-4 rounded-lg border ${off ? 'border-gray-800 bg-gray-900/40 opacity-70' : 'border-gray-700/60 bg-gray-800/30'}`}>
      <div className="w-9 h-9 rounded-lg bg-violet-500/10 text-violet-300 flex items-center justify-center shrink-0">
        <i className={`fa-solid ${icon}`}></i>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
      </div>
      <div className="flex items-center gap-2 text-sm text-gray-300 shrink-0">{children}</div>
    </div>
  );
}

export default function CallRules() {
  const [view, setView] = useState<View | null>(null);
  const [form, setForm] = useState<Rules | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (v: View) => { setView(v); setForm(v.rules); };
  const load = () => request<View>('').then(apply).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  if (!view || !form) {
    return <div className="text-sm text-gray-400">{error ? <span className="text-amber-300">{error}</span> : <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</>}</div>;
  }

  const set = (patch: Partial<Rules>) => setForm({ ...form, ...patch });
  const num = (k: keyof Rules) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: Number(e.target.value) } as Partial<Rules>);
  const dirty = (Object.keys(form) as (keyof Rules)[]).some((k) => form[k] !== view.rules[k]);

  const save = async () => {
    setSaving(true);
    try {
      apply(await request<View>('', { method: 'PUT', body: JSON.stringify(form) }));
      setError('');
      setNotice('Call rules saved. They apply to the next call straight away.');
      setTimeout(() => setNotice(''), 3500);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const release = async (number: string) => {
    if (!window.confirm(`Let ${number} be called again now?`)) return;
    try { apply(await request<View>(`/holds/${encodeURIComponent(number)}`, { method: 'DELETE' })); } catch (e: any) { setError(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-scale-balanced text-violet-400"></i>Call Rules
          </h3>
          <p className="text-sm text-gray-400 mt-1">
            When a number may be called again. Checked before every call: the auto dialer, Call / Call all on Job Calls, and the dial pad.
          </p>
        </div>

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-1">After a call</p>
        <Rule icon="fa-phone-slash" title="They hung up" off={!form.hangup_wait_minutes}
          desc="Put the phone down on the agent mid-conversation. 0 = no wait.">
          wait <input type="number" min={0} max={1440} value={form.hangup_wait_minutes} onChange={num('hangup_wait_minutes')} className={input} /> minutes
        </Rule>
        <Rule icon="fa-clock-rotate-left" title="They asked to be called back" off={!form.callback_enabled}
          desc={'The agent calls back at the time they said ("in 2 hours", "tomorrow morning", "at 3pm", "on Monday"), within calling hours, even in manual call mode. Job calls only.'}>
          <Switch on={form.callback_enabled} onChange={(v) => set({ callback_enabled: v })} />
        </Rule>
        {form.callback_enabled && (
          <div className="grid grid-cols-1 2xl:grid-cols-2 gap-3 md:pl-12">
            <Rule icon="fa-hourglass-half" title="No time given" desc={'"Call me back later", "I\'m busy".'}>
              after <input type="number" min={5} max={10080} value={form.callback_default_minutes} onChange={num('callback_default_minutes')} className={input} /> min
            </Rule>
            <Rule icon="fa-repeat" title="Callbacks per contact" desc="Then the call stays as Callback for your team.">
              up to <input type="number" min={0} max={5} value={form.callback_max} onChange={num('callback_max')} className={input} />
            </Rule>
          </div>
        )}
        <Rule icon="fa-thumbs-down" title="They said they're not interested" off={!form.not_interested_days}
          desc="Not called about other jobs for this long. 0 = other jobs can still call them.">
          wait <input type="number" min={0} max={365} value={form.not_interested_days} onChange={num('not_interested_days')} className={input} /> days
        </Rule>
        <Rule icon="fa-user-xmark" title="Wrong number" off={!form.wrong_number_to_dnc}
          desc="Add the number to the Do Not Call list, so the person isn't called again by mistake.">
          <Switch on={form.wrong_number_to_dnc} onChange={(v) => set({ wrong_number_to_dnc: v })} />
        </Rule>
        <Rule icon="fa-voicemail" title="Voicemail answered" desc="Try again later (counts as an attempt, like no answer).">
          retry after <input type="number" min={5} max={10080} value={form.voicemail_retry_minutes} onChange={num('voicemail_retry_minutes')} className={input} /> min
        </Rule>

        <Rule icon="fa-user-check" title="Same contact fetched again"
          desc="When your portal or a CSV sends a contact (for the same job) that the agent has already called. Remembered even if you remove the row from Job Calls.">
          <select value={form.recall_after_days} onChange={(e) => set({ recall_after_days: Number(e.target.value) })}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none">
            <option value={0}>Never call again</option>
            <option value={30}>Call again after 30 days</option>
            <option value={60}>Call again after 60 days</option>
            <option value={90}>Call again after 90 days</option>
          </select>
        </Rule>

        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 pt-2">Limits</p>
        <Rule icon="fa-gauge-high" title="Calls to one number per day" off={!form.max_calls_per_day}
          desc="Across all jobs and the dial pad, so nobody gets rung again and again. 0 = no limit.">
          at most <input type="number" min={0} max={20} value={form.max_calls_per_day} onChange={num('max_calls_per_day')} className={input} />
        </Rule>

        <div className="text-xs text-gray-400 bg-gray-800/40 border border-gray-700/60 rounded-lg p-3 space-y-1">
          <p><i className="fa-solid fa-shield-halved text-emerald-400 mr-1.5"></i>Always applied as well:</p>
          <p>• <strong className="text-gray-300">Do Not Call list</strong>: "don't call me again" adds the number, and it is never called (Do Not Call page).</p>
          <p>• <strong className="text-gray-300">Calling hours and days</strong>, <strong className="text-gray-300">attempts</strong> and <strong className="text-gray-300">retry after no answer</strong>: Settings › Calling › Outbound Calling.</p>
        </div>

        {error && <p className="text-sm text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
        {notice && <p className="text-sm text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
        <div className="flex justify-end gap-3">
          <button onClick={() => set(view.defaults)} className="px-4 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800">
            Recommended values
          </button>
          <button onClick={save} disabled={saving || !dirty}
            className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-50">
            <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i>Save call rules
          </button>
        </div>
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <div className="flex items-center gap-3 mb-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-hand text-amber-400"></i>Numbers waiting now
          </h3>
          <span className="text-xs text-gray-500">{view.holds.length} on hold</span>
          <button onClick={load} className="ml-auto text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800">
            <i className="fa-solid fa-rotate mr-1.5"></i>Refresh
          </button>
        </div>
        {view.holds.length === 0 ? (
          <p className="text-sm text-gray-500">No number is waiting because of a rule.</p>
        ) : (
          <div className="divide-y divide-gray-800">
            {view.holds.map((h) => (
              <div key={h.number} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="font-mono text-white">{h.number}</span>
                <span className="text-gray-400 flex-1 min-w-0 truncate">{h.reason}</span>
                <span className="text-xs text-gray-500">until {fmt(h.until)}</span>
                <button onClick={() => release(h.number)} className="text-xs px-2.5 py-1 rounded-lg border border-gray-700 text-gray-300 hover:border-violet-500">
                  Allow now
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
