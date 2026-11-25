import { useCallback, useEffect, useState } from 'react';
import { API_BASE } from '../utils/agentApi';
import { outboundApi, telephonyApi } from '../utils/outboundApi';
import { voiceApi } from '../utils/voiceApi';
import { widgetApi } from '../utils/widgetApi';

// Dashboard: what is actually working right now,
// read live from the backend (not from what was typed into a form).

type State = 'ok' | 'warn' | 'error' | 'off';
interface Tile { name: string; icon: string; state: State; label: string; detail: string; where?: string }

const STYLE: Record<State, { box: string; icon: string; pill: string }> = {
  ok: { box: 'bg-emerald-500/5 border-emerald-500/30', icon: 'text-emerald-400', pill: 'bg-emerald-500/10 text-emerald-300' },
  warn: { box: 'bg-amber-500/5 border-amber-500/30', icon: 'text-amber-400', pill: 'bg-amber-500/10 text-amber-300' },
  error: { box: 'bg-red-500/5 border-red-500/30', icon: 'text-red-400', pill: 'bg-red-500/10 text-red-300' },
  off: { box: 'bg-gray-800/30 border-gray-700/50', icon: 'text-gray-500', pill: 'bg-gray-700 text-gray-400' },
};

const NAMES: Record<string, string> = { deepgram: 'Deepgram', cartesia: 'Cartesia', elevenlabs: 'ElevenLabs', windows: 'Windows voice', local: 'this PC (Whisper / Vosk)' };

// Where to change it: a Settings tab, or ("@...") a page in the sidebar.
const place = (where: string) => (where.startsWith('@') ? where.slice(1) : `Settings › ${where}`);

async function json<T>(path: string): Promise<T> {
  const r = await fetch(`${API_BASE}${path}`);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

export default function SystemStatus() {
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [checkedAt, setCheckedAt] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  // Open or closed is remembered in this browser (closed by default).
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('dashboard-status-open') === '1'; } catch { return false; }
  });
  const toggle = () => setOpen((o) => {
    try { localStorage.setItem('dashboard-status-open', o ? '0' : '1'); } catch { /* storage blocked */ }
    return !o;
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const health = await json<{ database: string }>('/health');
      setOffline(false);
      const [ai, voice, calls, inbound, widget] = await Promise.allSettled([
        json<any>('/api/ai-model'), voiceApi.getSettings(), outboundApi.list(), telephonyApi.inbound(), widgetApi.settings(),
      ]);
      const out: Tile[] = [];

      const dbOk = health.database === 'connected';
      out.push({ name: 'Database', icon: 'fa-database', state: dbOk ? 'ok' : 'error', label: dbOk ? 'Connected' : 'Error',
        detail: dbOk ? 'MySQL: settings, chats and calls are saved' : health.database });

      if (ai.status === 'fulfilled') {
        const a = ai.value;
        const p = a.providers?.[a.provider]?.name || a.provider;
        out.push(!a.enabled
          ? { name: 'AI model', icon: 'fa-brain', state: 'off', label: 'Off', detail: 'Switched off: built-in answers', where: 'System › AI Model' }
          : a.rejected
            ? { name: 'AI model', icon: 'fa-brain', state: 'error', label: 'Key rejected', detail: a.rejected_reason || `${p} refused the key: built-in answers for now`, where: 'System › AI Model' }
            : a.active
              ? { name: 'AI model', icon: 'fa-brain', state: 'ok', label: 'Ready', detail: `${p} · ${a.model}`, where: 'System › AI Model' }
              : { name: 'AI model', icon: 'fa-brain', state: 'warn', label: 'Not set up', detail: 'No API key: built-in answers', where: 'System › AI Model' });
      }

      if (voice.status === 'fulfilled') {
        const v = voice.value;
        out.push(v.tts_active === 'windows'
          ? { name: 'Agent voice', icon: 'fa-volume-high', state: 'warn', label: 'Fallback', detail: 'Windows voice (no live voice key)', where: 'Agent › Identity & Voice' }
          : { name: 'Agent voice', icon: 'fa-volume-high', state: 'ok', label: 'Live', detail: NAMES[v.tts_active] || v.tts_active, where: 'Agent › Identity & Voice' });
        out.push(v.stt_active === 'local'
          ? { name: 'Speech recognition', icon: 'fa-ear-listen', state: 'ok', label: 'On this PC', detail: NAMES.local, where: 'Agent › Identity & Voice' }
          : { name: 'Speech recognition', icon: 'fa-ear-listen', state: 'ok', label: 'Live', detail: NAMES[v.stt_active] || v.stt_active, where: 'Agent › Identity & Voice' });
      }

      if (calls.status === 'fulfilled') {
        const c = calls.value;
        out.push(c.configured
          ? { name: 'Phone line (VoIP)', icon: 'fa-phone', state: 'ok', label: 'Ready', detail: 'Calls can be placed', where: 'Calling › SIP / VoIP Account' }
          : { name: 'Phone line (VoIP)', icon: 'fa-phone', state: 'error', label: 'Not set up', detail: `Missing: ${c.missing.join(', ')}`, where: 'Calling › SIP / VoIP Account' });
      }

      if (inbound.status === 'fulfilled') {
        const st = inbound.value.status;
        out.push(st.state === 'registered'
          ? { name: 'Inbound line', icon: 'fa-headset', state: 'ok', label: 'Answering', detail: `Extension ${st.extension || ''}`.trim(), where: 'Calling › Inbound Calls' }
          : st.state === 'disabled'
            ? { name: 'Inbound line', icon: 'fa-headset', state: 'off', label: 'Off', detail: 'Calls are not answered', where: 'Calling › Inbound Calls' }
            : { name: 'Inbound line', icon: 'fa-headset', state: 'error', label: 'Not registered', detail: st.message || 'Check the extension', where: 'Calling › Inbound Calls' });
      }

      if (widget.status === 'fulfilled') {
        const w = widget.value;
        out.push(!w.enabled
          ? { name: 'Website chat', icon: 'fa-comments', state: 'off', label: 'Off', detail: 'The widget is switched off', where: '@Chat page › Widget setup' }
          : w.local_only
            ? { name: 'Website chat', icon: 'fa-comments', state: 'warn', label: 'This PC only', detail: 'No public address yet', where: '@Chat page › Widget setup' }
            : { name: 'Website chat', icon: 'fa-comments', state: 'ok', label: 'On', detail: 'Widget is live', where: '@Chat page › Widget setup' });
      }

      setTiles(out);
    } catch {
      setOffline(true);
      setTiles([]);
    } finally {
      setCheckedAt(new Date());
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const problems = (tiles || []).filter((t) => t.state === 'error').length;
  const warnings = (tiles || []).filter((t) => t.state === 'warn').length;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800">
      <div className="flex items-center gap-3 px-6 py-4 flex-wrap">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="system-status-body"
          className="flex items-center gap-3 flex-wrap text-left flex-1 min-w-0 group">
          <i className={`fa-solid fa-chevron-right text-xs text-gray-500 group-hover:text-gray-300 transition-transform ${open ? 'rotate-90' : ''}`}></i>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className={`fa-solid ${offline || problems ? 'fa-circle-exclamation text-red-400' : warnings ? 'fa-circle-info text-amber-400' : 'fa-circle-check text-emerald-400'}`}></i>
            System Status
          </h3>
          {offline ? (
            <span className="text-xs text-red-300">Backend not running</span>
          ) : tiles && (
            <span className="text-xs text-gray-400">
              {problems ? `${problems} need${problems === 1 ? 's' : ''} attention` : warnings ? `${warnings} using a fallback` : 'Everything is working'}
            </span>
          )}
          {/* Closed: one icon per service, coloured by its state */}
          {!open && tiles && !offline && (
            <span className="flex items-center gap-2.5 ml-1">
              {tiles.map((t) => (
                <i key={t.name} className={`fa-solid ${t.icon} text-xs ${STYLE[t.state].icon}`} title={`${t.name}: ${t.label}`}></i>
              ))}
            </span>
          )}
        </button>
        <button onClick={load} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50">
          <i className={`fa-solid fa-rotate mr-1.5 ${loading ? 'fa-spin' : ''}`}></i>Refresh
        </button>
      </div>

      {open && (
      <div id="system-status-body" className="px-6 pb-6">
      {offline ? (
        <div className="text-sm text-red-300 bg-red-500/5 border border-red-500/30 rounded-lg px-4 py-3">
          <i className="fa-solid fa-plug-circle-xmark mr-2"></i>The backend at {API_BASE} is not running. Start it with start-app.bat.
        </div>
      ) : !tiles ? (
        <p className="text-sm text-gray-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Checking…</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {tiles.map((t) => {
            const s = STYLE[t.state];
            return (
              <div key={t.name} className={`p-3 rounded-lg border ${s.box}`} title={t.where ? `Set up in ${place(t.where)}` : ''}>
                <div className="flex items-center gap-2 mb-1">
                  <i className={`fa-solid ${t.icon} ${s.icon} w-4 text-center`}></i>
                  <span className="text-sm font-medium text-white">{t.name}</span>
                  <span className={`ml-auto text-[11px] px-1.5 py-0.5 rounded ${s.pill}`}>{t.label}</span>
                </div>
                <p className="text-xs text-gray-400 truncate" title={t.detail}>{t.detail}</p>
                {t.where && <p className="text-[11px] text-gray-600 mt-0.5 truncate">{place(t.where)}</p>}
              </div>
            );
          })}
        </div>
      )}
      {checkedAt && <p className="text-[11px] text-gray-600 mt-3">Checked {checkedAt.toLocaleTimeString()}</p>}
      </div>
      )}
    </div>
  );
}
