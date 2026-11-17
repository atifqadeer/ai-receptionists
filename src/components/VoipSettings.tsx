import { useEffect, useState } from 'react';
import { telephonyApi, TelephonySettings } from '../utils/outboundApi';
import InboundSettings from './InboundSettings';

// Agent Setup > VoIP & Calling: the VoIP provider the agent calls
// applicants through, and when it calls. Stored by the backend
// (python-backend/data/telephony.json); secrets come back masked.

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const input = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-4 py-2.5 text-sm text-white focus:border-violet-500 focus:ring-1 focus:ring-violet-500 outline-none';
const label = 'block text-sm font-medium text-gray-300 mb-1.5';

export type VoipSection = 'provider' | 'inbound' | 'rules' | 'voice';

// One instance is kept across the Agent Setup tabs, so edits on one tab
// are still there on the others until saved.
export default function VoipSettings({ section }: { section: VoipSection }) {
  const [s, setS] = useState<TelephonySettings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');

  const load = () => {
    setLoadError('');
    telephonyApi.get().then(setS).catch(() =>
      setLoadError('Could not reach the backend at http://localhost:8000. Start the backend (start-app.bat) and reload this tab.'));
  };
  useEffect(load, []);

  if (loadError) {
    return (
      <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-4 py-3 rounded-lg flex items-center justify-between gap-3">
        <span><i className="fa-solid fa-triangle-exclamation mr-2"></i>{loadError}</span>
        <button onClick={load} className="px-3 py-1.5 rounded-lg border border-amber-500/40 hover:bg-amber-500/10">Retry</button>
      </div>
    );
  }
  if (!s) return <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading VoIP settings…</div>;

  const provider = s.providers[s.provider];
  const isSip = s.provider === 'sip';
  const creds = s.credentials[s.provider] || {};
  const set = (patch: Partial<TelephonySettings>) => setS({ ...s, ...patch });
  const setCred = (key: string, value: string) =>
    set({ credentials: { ...s.credentials, [s.provider]: { ...creds, [key]: value } } });

  const persist = async () => {
    const { providers, configured, missing, within_calling_hours, webhook_token, ...body } = s;
    const saved = await telephonyApi.save(body);
    setS(saved);
    return saved;
  };

  const save = async () => {
    setBusy('save');
    setStatus(null);
    try {
      const saved = await persist();
      setStatus({ ok: true, message: saved.missing.length ? `Saved. Still needed before calls can be placed: ${saved.missing.join(', ')}.` : 'Saved. VoIP is ready for calls.' });
    } catch (e: any) {
      setStatus({ ok: false, message: e.message });
    } finally {
      setBusy('');
    }
  };

  const test = async () => {
    setBusy('test');
    setStatus(null);
    try {
      await persist(); // test what is on screen, not the last saved values
      setStatus(await telephonyApi.test());
    } catch (e: any) {
      setStatus({ ok: false, message: e.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="space-y-6">
      {/* Provider */}
      {section === 'provider' && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-phone-volume text-violet-400"></i>
          VoIP Provider
          <span className={`ml-auto text-xs px-2.5 py-1 rounded-full ${s.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
            {s.configured ? 'Ready for calls' : 'Not set up yet'}
          </span>
        </h3>
        <div>
          <label className={label}>Provider</label>
          <select value={s.provider} onChange={(e) => set({ provider: e.target.value })} className={input}>
            {Object.entries(s.providers).map(([id, p]) => <option key={id} value={id}>{p.name}</option>)}
          </select>
          <p className="text-xs text-gray-500 mt-1.5">Credentials are saved per provider, so you can switch back without retyping them.</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {provider.fields.map((f) => (
            <div key={f.key} className={f.multiline ? 'md:col-span-2' : ''}>
              <label className={label}>{f.label}</label>
              {f.multiline ? (
                <textarea rows={5} value={creds[f.key] || ''} placeholder="-----BEGIN PRIVATE KEY-----"
                  onChange={(e) => setCred(f.key, e.target.value)} className={`${input} font-mono text-xs resize-none`} />
              ) : (
                <input type={f.secret ? 'password' : 'text'} value={creds[f.key] || ''} placeholder={f.placeholder || ''}
                  onChange={(e) => setCred(f.key, e.target.value)} className={input} autoComplete="off" />
              )}
            </div>
          ))}
          {isSip && (
            <div className="md:col-span-2 text-xs text-gray-400 bg-gray-800/50 border border-gray-700 rounded-lg p-3 space-y-1">
              <p><i className="fa-solid fa-circle-info text-violet-400 mr-1.5"></i>Use the same server, username and password as your softphone (e.g. MicroSIP). Transport is <strong className="text-gray-200">UDP</strong>.</p>
              <p>Use a <strong className="text-gray-200">separate extension</strong> for the AI agent if you can. Many PBXs (Asterisk PJSIP <code>max_contacts=1</code>) allow one registration per extension, so the agent would sign MicroSIP out, and vice versa.</p>
              <p>Calls go straight to the PBX from this PC: no caller ID number or public URL is needed. Extensions are dialled as they are; phone numbers in national format (07…), with the outside-line prefix if set.</p>
            </div>
          )}
          {!isSip && (
          <div>
            <label className={label}>Caller ID number (your VoIP number)</label>
            <input type="text" value={s.from_number} placeholder="+44 20 7946 0000" onChange={(e) => set({ from_number: e.target.value })} className={input} />
          </div>
          )}
          <div>
            <label className={label}>Default country code</label>
            <input type="text" value={s.default_country_code} onChange={(e) => set({ default_country_code: e.target.value })} className={input} />
            <p className="text-xs text-gray-500 mt-1">Used for local numbers like 07700 900123.</p>
          </div>
          {!isSip && (<>
          <div className="md:col-span-2">
            <label className={label}>Public webhook URL</label>
            <input type="text" value={s.public_url} placeholder="https://your-subdomain.ngrok.app" onChange={(e) => set({ public_url: e.target.value })} className={input} />
            <p className="text-xs text-gray-500 mt-1">
              The HTTPS address where the provider can reach this backend during a call (for local testing, run <code className="text-gray-300">ngrok http 8000</code> and paste its https URL).
            </p>
          </div>
          <div className="md:col-span-2">
            <label className={label}>PBX SIP domain (for extensions)</label>
            <input type="text" value={s.sip_domain || ''} placeholder="pbx.yourcompany.com" onChange={(e) => set({ sip_domain: e.target.value })} className={input} />
            <p className="text-xs text-gray-500 mt-1">
              Applicants with a 3–6 digit extension (e.g. 204 or 1234) are called as <code className="text-gray-300">sip:1234@{s.sip_domain || 'pbx.yourcompany.com'}</code> through your provider's SIP connection to your PBX.
            </p>
          </div>
          </>)}
        </div>
      </div>

      )}

      {/* Inbound: the extension the agent answers */}
      {section === 'inbound' && s.inbound && (
        <InboundSettings value={s.inbound} onChange={(inbound) => set({ inbound })}
          sipServer={s.credentials.sip?.server || ''} />
      )}

      {/* When to call */}
      {section === 'rules' && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-clock text-violet-400"></i>
          Calling Rules
        </h3>
        <div>
          <label className={label}>When an applicant arrives from the webhook or CSV</label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {([
              ['auto', 'Call automatically', 'Dial new applicants straight away, within the calling hours below.'],
              ['manual', 'Call manually', 'Queue applicants; you press Call or Call all on the Job Calls page.'],
            ] as const).map(([mode, title, desc]) => (
              <button key={mode} onClick={() => set({ call_mode: mode })}
                className={`text-left p-4 rounded-lg border transition-all ${s.call_mode === mode ? 'border-violet-500 bg-violet-600/10' : 'border-gray-700 hover:border-gray-600'}`}>
                <div className="text-sm font-medium text-white flex items-center gap-2">
                  <i className={`fa-solid ${s.call_mode === mode ? 'fa-circle-dot text-violet-400' : 'fa-circle text-gray-600'}`}></i>{title}
                </div>
                <div className="text-xs text-gray-400 mt-1">{desc}</div>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <label className={label}>Calling hours from</label>
            <input type="time" value={s.calling_hours_start} onChange={(e) => set({ calling_hours_start: e.target.value })} className={input} />
          </div>
          <div>
            <label className={label}>to</label>
            <input type="time" value={s.calling_hours_end} onChange={(e) => set({ calling_hours_end: e.target.value })} className={input} />
          </div>
          <div className="col-span-2">
            <label className={label}>Time zone</label>
            <input type="text" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })} className={input} />
          </div>
        </div>
        <div>
          <label className={label}>Calling days</label>
          <div className="flex flex-wrap gap-2">
            {DAYS.map((d, i) => {
              const on = s.calling_days.includes(i);
              return (
                <button key={d} onClick={() => set({ calling_days: on ? s.calling_days.filter((x) => x !== i) : [...s.calling_days, i].sort() })}
                  className={`px-3 py-1.5 rounded-lg text-sm border ${on ? 'border-violet-500 bg-violet-600/20 text-violet-200' : 'border-gray-700 text-gray-400'}`}>{d}</button>
              );
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className={label}>Calls at the same time</label>
            <input type="number" min={1} max={20} value={s.max_concurrent_calls} onChange={(e) => set({ max_concurrent_calls: Number(e.target.value) })} className={input} />
          </div>
          <div>
            <label className={label}>Attempts per applicant</label>
            <input type="number" min={1} max={5} value={s.max_attempts} onChange={(e) => set({ max_attempts: Number(e.target.value) })} className={input} />
          </div>
          <div>
            <label className={label}>Retry unanswered after (minutes)</label>
            <input type="number" min={5} value={s.retry_minutes} onChange={(e) => set({ retry_minutes: Number(e.target.value) })} className={input} />
          </div>
        </div>
      </div>

      )}

      {/* Voice + CRM */}
      {section === 'voice' && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <i className="fa-solid fa-microphone-lines text-violet-400"></i>
          Voice & CRM
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={label}>Speech language</label>
            <select value={s.language} onChange={(e) => set({ language: e.target.value })} className={input}>
              <option value="en-GB">English (UK)</option>
              <option value="en-US">English (US)</option>
              <option value="en-AU">English (Australia)</option>
              <option value="en-IN">English (India)</option>
            </select>
          </div>
          <div>
            <label className={label}>Voice (optional)</label>
            <input type="text" value={s.voice} placeholder={s.provider === 'telnyx' ? 'female' : s.provider === 'vonage' ? 'provider default' : isSip ? 'Windows voice, e.g. Hazel' : 'Polly.Amy'}
              onChange={(e) => set({ voice: e.target.value })} className={input} />
          </div>
          <div className="md:col-span-2">
            <label className={label}>Result webhook URL (your CRM)</label>
            <input type="text" value={s.result_webhook_url} placeholder="https://your-crm.example.com/webhooks/ai-call-result"
              onChange={(e) => set({ result_webhook_url: e.target.value })} className={input} />
            <p className="text-xs text-gray-500 mt-1">When a call finishes, its outcome (interested, not interested, call back, do not call) and transcript are POSTed here as JSON.</p>
          </div>
        </div>
      </div>

      )}

      {status && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${status.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          <i className={`fa-solid ${status.ok ? 'fa-circle-check' : 'fa-circle-exclamation'} mr-2`}></i>{status.message}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <button onClick={test} disabled={!!busy}
          className="px-6 py-2.5 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all disabled:opacity-50 flex items-center gap-2">
          <i className={`fa-solid ${busy === 'test' ? 'fa-spinner fa-spin' : 'fa-plug-circle-check'}`}></i>
          Test Connection
        </button>
        <button onClick={save} disabled={!!busy}
          className="px-6 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium hover:from-violet-700 hover:to-indigo-700 transition-all flex items-center gap-2 disabled:opacity-50">
          <i className={`fa-solid ${busy === 'save' ? 'fa-spinner fa-spin' : 'fa-save'}`}></i>
          Save VoIP Settings
        </button>
      </div>
    </div>
  );
}
