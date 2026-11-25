import { useCallback, useEffect, useState } from 'react';
import DiagnosticTool from './DiagnosticTool';
import SystemStatus from './SystemStatus';
import { useClearStorage } from '../hooks/useLocalStorage';
import { API_BASE } from '../utils/agentApi';
import { STATUS_STYLE, statusLabel, outcomeLabel } from '../utils/callStatus';

// Dashboard: real numbers from the backend (MySQL calls and chat tables),
// see python-backend/app/services/dashboard.py.

type Range = 'today' | '7d' | '30d' | 'all';
interface Summary {
  calls: number; answered: number; answer_rate: number | null; avg_talk_seconds: number | null;
  interested: number; job_calls: number; chats: number; chat_messages: number;
  reply_ms: number | null; reply_samples: number;
}
interface Recent { type: 'call' | 'chat'; kind: string; name: string; number: string; job: string; status: string; outcome: string; at: string; seconds: number | null }
interface Stats {
  range: Range; timezone: string; current: Summary; previous: Summary | null;
  series: { label: string; calls: number; chats: number }[];
  results: { result: string; count: number }[];
  kinds: Record<string, number>;
  peak_hour: { hour: number; calls: number } | null;
  recent: Recent[];
  now: { live_calls: number; queued: number; callbacks: number; on_hold: number; dnc: number };
}

const RANGES: { id: Range; label: string; prev: string }[] = [
  { id: 'today', label: 'Today', prev: 'yesterday' },
  { id: '7d', label: '7 days', prev: 'previous 7 days' },
  { id: '30d', label: '30 days', prev: 'previous 30 days' },
  { id: 'all', label: 'All time', prev: '' },
];
const KIND: Record<string, { label: string; icon: string }> = {
  job: { label: 'Job call', icon: 'fa-briefcase' },
  dialpad: { label: 'Dial pad', icon: 'fa-phone' },
  inbound: { label: 'Inbound', icon: 'fa-phone-volume' },
  website: { label: 'Website chat', icon: 'fa-comments' },
};
// Validated categorical pair on the dark card surface (#111827): violet, aqua.
const SERIES = { calls: '#9085e9', chats: '#199e70' };

const dur = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  if (m < 1440) return `${Math.round(m / 60)} h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};
const resultLabel = (r: string) => (r === 'interested' ? outcomeLabel(r) : statusLabel(r));

function Change({ now, before, prev, inverse }: { now: number | null; before: number | null | undefined; prev: string; inverse?: boolean }) {
  if (!prev || before == null || now == null) return null;
  if (before === 0) return now === 0 ? <span className="text-xs text-gray-500">same as {prev}</span> : <span className="text-xs text-gray-400">new vs {prev}</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const good = inverse ? pct < 0 : pct > 0;
  return (
    <span className={`text-xs font-medium ${pct === 0 ? 'text-gray-500' : good ? 'text-emerald-400' : 'text-amber-400'}`} title={`${before} in the ${prev}`}>
      {pct > 0 ? '+' : ''}{pct}% <span className="text-gray-500 font-normal">vs {prev}</span>
    </span>
  );
}

function ActivityChart({ series }: { series: Stats['series'] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const max = Math.max(1, ...series.map((s) => s.calls + s.chats));
  const step = series.length > 14 ? Math.ceil(series.length / 8) : 1;   // label every nth bucket
  return (
    <div>
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES.calls }}></span>Calls</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SERIES.chats }}></span>Website chats</span>
        <button onClick={() => setTable(!table)} className="ml-auto text-gray-400 hover:text-gray-200">
          <i className={`fa-solid ${table ? 'fa-chart-column' : 'fa-table'} mr-1`}></i>{table ? 'Chart' : 'Table'}
        </button>
      </div>
      {table ? (
        <div className="max-h-56 overflow-y-auto text-sm">
          <table className="w-full">
            <thead><tr className="text-xs text-gray-500 text-left"><th className="py-1 font-medium">Period</th><th className="font-medium text-right">Calls</th><th className="font-medium text-right">Chats</th></tr></thead>
            <tbody>{series.map((s) => (
              <tr key={s.label} className="border-t border-gray-800 text-gray-300"><td className="py-1">{s.label}</td><td className="text-right">{s.calls}</td><td className="text-right">{s.chats}</td></tr>
            ))}</tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <div className="flex items-end gap-[2px] h-40 border-b border-gray-700/70">
            {series.map((s, i) => {
              const total = s.calls + s.chats;
              return (
                <div key={s.label} className="flex-1 h-full flex flex-col justify-end cursor-default" tabIndex={0}
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                  aria-label={`${s.label}: ${s.calls} calls, ${s.chats} chats`}>
                  {total > 0 && (
                    <div className={`flex flex-col gap-[2px] transition-opacity ${hover != null && hover !== i ? 'opacity-50' : ''}`}
                      style={{ height: `${(total / max) * 100}%`, minHeight: 4 }}>
                      {s.chats > 0 && <div className="rounded-t-[4px]" style={{ flex: s.chats, background: SERIES.chats, minHeight: 2 }}></div>}
                      {s.calls > 0 && <div className={s.chats ? '' : 'rounded-t-[4px]'} style={{ flex: s.calls, background: SERIES.calls, minHeight: 2 }}></div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-[2px] mt-1">
            {series.map((s, i) => (
              <div key={s.label} className="flex-1 text-center text-[10px] text-gray-500 truncate">{i % step === 0 ? s.label : ''}</div>
            ))}
          </div>
          {hover != null && (
            <div className="absolute top-0 pointer-events-none bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg"
              style={{ left: `min(calc(${((hover + 0.5) / series.length) * 100}% + 8px), calc(100% - 140px))` }}>
              <p className="text-gray-300 font-medium mb-1">{series[hover].label}</p>
              <p className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: SERIES.calls }}></span>Calls <span className="text-white ml-auto pl-3">{series[hover].calls}</span></p>
              <p className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: SERIES.chats }}></span>Chats <span className="text-white ml-auto pl-3">{series[hover].chats}</span></p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function Dashboard() {
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [range, setRange] = useState<Range>('7d');
  const [data, setData] = useState<Stats | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { clearAll } = useClearStorage();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/dashboard?range=${range}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError('');
    } catch {
      setError(`Could not load the numbers: the backend at ${API_BASE} is not reachable.`);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);     // keep it current while open
    return () => clearInterval(t);
  }, [load]);

  const prevName = RANGES.find((r) => r.id === range)?.prev || '';
  const c = data?.current;
  const p = data?.previous;
  const totalResults = (data?.results || []).reduce((a, r) => a + r.count, 0);

  const cards = c ? [
    { label: 'Calls', value: c.calls.toLocaleString(), icon: 'fa-phone', color: 'from-violet-500 to-indigo-600',
      sub: data && Object.entries(data.kinds).map(([k, n]) => `${n} ${k === 'job' ? (n === 1 ? 'job call' : 'job calls') : KIND[k]?.label.toLowerCase() || k}`).join(' · '),
      now: c.calls, before: p?.calls },
    { label: 'Answered', value: c.answer_rate == null ? '—' : `${c.answer_rate}%`, icon: 'fa-headset', color: 'from-emerald-500 to-teal-600',
      sub: `${c.answered} of ${c.calls} calls`, now: c.answer_rate, before: p?.answer_rate },
    { label: 'Avg talk time', value: dur(c.avg_talk_seconds), icon: 'fa-clock', color: 'from-amber-500 to-orange-600',
      sub: 'answered calls', now: c.avg_talk_seconds, before: p?.avg_talk_seconds },
    { label: 'Interested contacts', value: c.interested.toLocaleString(), icon: 'fa-user-check', color: 'from-pink-500 to-rose-600',
      sub: `from ${c.job_calls} job call${c.job_calls === 1 ? '' : 's'}`, now: c.interested, before: p?.interested },
    { label: 'Website chats', value: c.chats.toLocaleString(), icon: 'fa-comments', color: 'from-sky-500 to-blue-600',
      sub: `${c.chat_messages} visitor message${c.chat_messages === 1 ? '' : 's'}`, now: c.chats, before: p?.chats },
    { label: 'AI reply time', value: c.reply_ms == null ? '—' : c.reply_ms < 1000 ? `${c.reply_ms} ms` : `${(c.reply_ms / 1000).toFixed(1)}s`,
      icon: 'fa-bolt', color: 'from-fuchsia-500 to-purple-600', inverse: true,
      sub: c.reply_samples ? `average of ${c.reply_samples} chat repl${c.reply_samples === 1 ? 'y' : 'ies'}` : 'no timed chat replies yet',
      now: c.reply_ms, before: p?.reply_ms },
  ] : [];

  return (
    <div className="space-y-6">
      {/* What is working right now (live from the backend) */}
      <SystemStatus />

      {/* Period */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 bg-gray-900 border border-gray-800 rounded-lg p-1">
          {RANGES.map((r) => (
            <button key={r.id} onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-all ${range === r.id ? 'bg-violet-600 text-white' : 'text-gray-400 hover:bg-gray-800'}`}>
              {r.label}
            </button>
          ))}
        </div>
        <button onClick={load} disabled={loading} className="text-xs px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50">
          <i className={`fa-solid fa-rotate mr-1.5 ${loading ? 'fa-spin' : ''}`}></i>Refresh
        </button>
        {data && <span className="text-xs text-gray-500">Live from the database · times in {data.timezone} · updates every 30 s</span>}
      </div>

      {error && (
        <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3">
          <i className="fa-solid fa-triangle-exclamation mr-2"></i>{error}
        </div>
      )}
      {!data && !error && <p className="text-sm text-gray-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}

      {data && c && (<>
        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {cards.map((s) => (
            <div key={s.label} className="bg-gray-900 rounded-xl border border-gray-800 p-5 hover:border-gray-700 transition-all">
              <div className="flex items-center justify-between mb-3 gap-2">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${s.color} flex items-center justify-center shrink-0`}>
                  <i className={`fa-solid ${s.icon} text-white text-sm`}></i>
                </div>
                <Change now={s.now} before={s.before} prev={prevName} inverse={s.inverse} />
              </div>
              <p className="text-2xl font-bold text-white">{s.value}</p>
              <p className="text-sm text-gray-400 mt-1">{s.label}</p>
              {s.sub && <p className="text-xs text-gray-500 mt-0.5 truncate" title={s.sub}>{s.sub}</p>}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Activity over time */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h3 className="font-semibold text-white mb-1">Activity</h3>
            <p className="text-xs text-gray-500 mb-4">
              {range === 'today' ? 'By hour, today' : range === 'all' ? 'By week, last 12 weeks' : `By day, last ${range === '7d' ? 7 : 30} days`}
            </p>
            <ActivityChart series={data.series} />
          </div>

          {/* Right now */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h3 className="font-semibold text-white mb-4">Right now</h3>
            <div className="space-y-3">
              {[
                { label: 'Calls in progress', value: data.now.live_calls, icon: 'fa-circle-dot text-emerald-400' },
                { label: 'Job calls waiting to dial', value: data.now.queued, icon: 'fa-list-ol text-violet-400' },
                { label: 'Callbacks scheduled', value: data.now.callbacks, icon: 'fa-clock-rotate-left text-sky-400' },
                { label: 'Numbers on hold (Call Rules)', value: data.now.on_hold, icon: 'fa-hand text-amber-400' },
                { label: 'Do Not Call list', value: data.now.dnc, icon: 'fa-ban text-red-400' },
              ].map((r) => (
                <div key={r.label} className="flex items-center gap-3 text-sm">
                  <i className={`fa-solid ${r.icon} w-4 text-center`}></i>
                  <span className="text-gray-300 flex-1">{r.label}</span>
                  <span className="text-white font-semibold">{r.value}</span>
                </div>
              ))}
              <div className="pt-3 border-t border-gray-800 text-sm flex items-center gap-3">
                <i className="fa-solid fa-bolt text-amber-400 w-4 text-center"></i>
                <span className="text-gray-300 flex-1">Busiest hour</span>
                <span className="text-white font-semibold">
                  {data.peak_hour ? `${String(data.peak_hour.hour).padStart(2, '0')}:00 (${data.peak_hour.calls} call${data.peak_hour.calls === 1 ? '' : 's'})` : '—'}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Recent activity */}
          <div className="lg:col-span-2 bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h3 className="font-semibold text-white mb-4">Recent activity</h3>
            {data.recent.length === 0 ? <p className="text-sm text-gray-500">No calls or chats yet.</p> : (
              <div className="space-y-2">
                {data.recent.map((r, i) => {
                  const k = KIND[r.kind] || KIND.job;
                  const label = r.type === 'chat' ? (r.status === 'open' ? 'Open' : 'Ended') : r.outcome === 'interested' ? outcomeLabel('interested') : statusLabel(r.status);
                  const style = r.type === 'chat' ? (r.status === 'open' ? 'bg-sky-500/15 text-sky-300' : 'bg-gray-700/60 text-gray-300')
                    : r.outcome === 'interested' ? 'bg-emerald-500/15 text-emerald-300' : STATUS_STYLE[r.status] || 'bg-gray-700/60 text-gray-300';
                  return (
                    <div key={i} className="flex items-center gap-3 p-3 rounded-lg bg-gray-800/50">
                      <div className="w-9 h-9 rounded-full bg-gray-700 flex items-center justify-center shrink-0">
                        <i className={`fa-solid ${k.icon} text-gray-300 text-sm`}></i>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-white truncate">{r.name || r.number || 'Unknown'}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {k.label}{r.name && r.number ? ` · ${r.number}` : ''}{r.job ? ` · ${r.job}` : ''}
                        </p>
                      </div>
                      <span className="text-xs text-gray-400 hidden sm:block">{dur(r.seconds)}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${style}`}>{label}</span>
                      <span className="text-xs text-gray-500 w-16 text-right whitespace-nowrap">{r.at ? ago(r.at) : ''}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Call results */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
            <h3 className="font-semibold text-white mb-1">Call results</h3>
            <p className="text-xs text-gray-500 mb-4">How the {totalResults} call{totalResults === 1 ? '' : 's'} in this period ended</p>
            {totalResults === 0 ? <p className="text-sm text-gray-500">No calls in this period.</p> : (
              <div className="space-y-3">
                {data.results.map((r) => {
                  const pct = Math.round((r.count / totalResults) * 100);
                  return (
                    <div key={r.result} title={`${r.count} of ${totalResults} calls`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm text-gray-300">{resultLabel(r.result)}</span>
                        <span className="text-xs text-gray-400">{r.count} ({pct}%)</span>
                      </div>
                      <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: SERIES.calls }}></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </>)}

      {/* Diagnostic Tool */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-wrench text-violet-400"></i>
            Troubleshooting
          </h3>
          <button
            onClick={() => setShowDiagnostics(!showDiagnostics)}
            className="px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs hover:bg-violet-700 transition-all flex items-center gap-1"
          >
            <i className={`fa-solid ${showDiagnostics ? 'fa-eye-slash' : 'fa-eye'}`}></i>
            {showDiagnostics ? 'Hide' : 'Show'} Diagnostics
          </button>
        </div>

        {showDiagnostics && <DiagnosticTool />}

        {!showDiagnostics && (
          <div className="space-y-2">
            <p className="text-sm text-gray-400">
              Having issues with buttons or features not working? Use the diagnostic tool to identify problems.
            </p>
            <div className="flex flex-wrap gap-2">
              <a href="/TROUBLESHOOTING.md" target="_blank" className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                <i className="fa-solid fa-book"></i>
                View Troubleshooting Guide
              </a>
              <span className="text-xs text-gray-600">•</span>
              <button onClick={() => window.location.reload()} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                <i className="fa-solid fa-rotate"></i>
                Refresh Page
              </button>
              <span className="text-xs text-gray-600">•</span>
              <button onClick={clearAll} className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1">
                <i className="fa-solid fa-trash"></i>
                Clear Cache & Reload
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
