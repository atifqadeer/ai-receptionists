import { useCallback, useEffect, useMemo, useState } from 'react';
import { API_BASE } from '../utils/agentApi';
import { withToken } from '../utils/auth';
import { STATUS_STYLE, STATUS_LABEL, OUTCOME_LABEL, OUTCOME_STYLE, statusLabel, outcomeLabel } from '../utils/callStatus';

// Analytics: real numbers from the backend (MySQL calls and chat tables),
// see python-backend/app/services/analytics.py.

type Period = '24h' | '7d' | '30d' | '90d' | 'all';
interface Bucket { answered: number; missed: number }
interface LogRow { at: string; kind: string; type: string; name: string; number: string; job: string; status: string; outcome: string; result: string; talk_seconds: number | null; attempts: number }
interface Summary { calls: number; answered: number; answer_rate: number | null; talk_seconds: number; avg_talk_seconds: number | null; longest_talk_seconds: number | null; conversion: number | null }
interface Report {
  period: Period; timezone: string; generated_at: string;
  summary: Summary;
  previous: (Summary & { chats: number }) | null;
  trend: (Bucket & { label: string; chats: number })[];
  results: { result: string; count: number }[];
  hours: (Bucket & { hour: number })[];
  weekdays: (Bucket & { day: string })[];
  funnel: { imported: number; dialled: number; answered: number; interested: number; waiting: number; outcomes: { outcome: string; count: number }[] };
  by_kind: { kind: string; label: string; calls: number; answered: number; avg_talk_seconds: number | null; hung_up: number; dnc: number; failed: number }[];
  chats: { conversations: number; with_email: number; visitor_messages: number; avg_messages: number | null; avg_length_seconds: number | null; operator_joined: number; reply_ms: number | null; reply_samples: number; ended: { by: string; count: number }[] };
  log: LogRow[];
}

const PERIODS: { id: Period; label: string }[] = [
  { id: '24h', label: '24 Hours' }, { id: '7d', label: '7 Days' }, { id: '30d', label: '30 Days' },
  { id: '90d', label: '90 Days' }, { id: 'all', label: 'All time' },
];
// Answered = the validated violet series; not answered = neutral gray (recessive).
const ANSWERED = '#9085e9';
const MISSED = '#6b7280';   // 3.7:1 on the card surface
const ENDED_BY: Record<string, string> = {
  visitor: 'Visitor closed it', team: 'Your team closed it', goodbye: 'Said goodbye', inactive: 'Went quiet (timed out)', open: 'Still open', unknown: 'Other',
};

const dur = (s: number | null | undefined) => {
  if (s == null) return '—';
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
};
const total = (s: number) => (s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`);
const resultLabel = (r: string) => (r === 'interested' || (r in OUTCOME_LABEL && !(r in STATUS_LABEL)) ? outcomeLabel(r) : statusLabel(r || 'unknown'));
const PREV_LABEL: Record<Period, string> = { '24h': 'previous 24h', '7d': 'previous 7 days', '30d': 'previous 30 days', '90d': 'previous 90 days', all: '' };

// Change against the previous period: "+12%" / "-3 pts" with a direction colour.
// `good` says which way is better (calls up is good; nothing is bad by default).
function Delta({ now, before, unit = '%', good = 'up' }: { now: number | null; before: number | null | undefined; unit?: '%' | 'pts' | 's'; good?: 'up' | 'down' | 'none' }) {
  if (now == null || before == null) return null;
  let diff: number;
  if (unit === '%') {
    if (before === 0) return now > 0 ? <span className="text-[11px] text-emerald-400">new</span> : null;
    diff = Math.round(((now - before) / before) * 100);
  } else diff = Math.round(now - before);
  if (diff === 0) return <span className="text-[11px] text-gray-500">no change</span>;
  const better = good === 'none' ? null : (diff > 0) === (good === 'up');
  const color = better == null ? 'text-gray-400' : better ? 'text-emerald-400' : 'text-rose-400';
  return <span className={`text-[11px] ${color}`}><i className={`fa-solid fa-arrow-${diff > 0 ? 'up' : 'down'} mr-0.5 text-[9px]`}></i>{Math.abs(diff)}{unit === 'pts' ? ' pts' : unit}</span>;
}

function Card({ title, icon, children, className = '' }: { title: string; icon: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-xl border border-gray-800 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-white mb-4 flex items-center gap-2"><i className={`fa-solid ${icon} text-violet-400`}></i>{title}</h3>
      {children}
    </div>
  );
}

// Stacked answered / not answered bars, one per bucket, with a hover readout.
function StackedBars({ data, label }: { data: (Bucket & { name: string })[]; label: (i: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.answered + d.missed));
  return (
    <div className="relative">
      <div className="flex items-center gap-4 mb-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ANSWERED }}></span>Answered</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: MISSED }}></span>Not answered</span>
      </div>
      <div className="flex items-end gap-[2px] h-40 border-b border-gray-700/70">
        {data.map((d, i) => {
          const total = d.answered + d.missed;
          return (
            <div key={d.name} tabIndex={0} className="flex-1 h-full flex flex-col justify-end"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
              aria-label={`${d.name}: ${d.answered} answered, ${d.missed} not answered`}>
              {total > 0 && (
                <div className={`flex flex-col gap-[2px] ${hover != null && hover !== i ? 'opacity-50' : ''}`} style={{ height: `${(total / max) * 100}%`, minHeight: 4 }}>
                  {d.missed > 0 && <div className="rounded-t-[4px]" style={{ flex: d.missed, background: MISSED, minHeight: 2 }}></div>}
                  {d.answered > 0 && <div className={d.missed ? '' : 'rounded-t-[4px]'} style={{ flex: d.answered, background: ANSWERED, minHeight: 2 }}></div>}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] mt-1">
        {data.map((d, i) => <div key={d.name} className="flex-1 text-center text-[10px] text-gray-500 whitespace-nowrap overflow-visible">{label(i)}</div>)}
      </div>
      {hover != null && (
        <div className="absolute top-6 pointer-events-none bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-xs shadow-lg"
          style={{ left: `min(calc(${((hover + 0.5) / data.length) * 100}% + 8px), calc(100% - 150px))` }}>
          <p className="text-gray-300 font-medium mb-1">{data[hover].name}</p>
          <p className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: ANSWERED }}></span>Answered<span className="text-white ml-auto pl-3">{data[hover].answered}</span></p>
          <p className="text-gray-400 flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: MISSED }}></span>Not answered<span className="text-white ml-auto pl-3">{data[hover].missed}</span></p>
        </div>
      )}
    </div>
  );
}

function Meter({ label, value, total, note }: { label: string; value: number; total: number; note?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return (
    <div title={note}>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-gray-300">{label}</span>
        <span className="text-xs text-gray-400">{value}{total ? ` (${pct}%)` : ''}</span>
      </div>
      <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${value ? Math.max(pct, 2) : 0}%`, background: ANSWERED }}></div>
      </div>
    </div>
  );
}

export default function Analytics() {
  const [period, setPeriod] = useState<Period>('7d');
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/analytics?period=${period}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
      setError('');
    } catch {
      if (!silent) setError(`Could not load analytics: the backend at ${API_BASE} is not reachable.`);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [period]);
  useEffect(() => { setData(null); load(); }, [load]);
  // Keep the numbers current while the page is open (quietly, every minute).
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden) load(true); }, 60_000);
    return () => window.clearInterval(t);
  }, [load]);

  const log = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (data?.log || []).filter((c) => (type === 'all' || c.kind === type)
      && (!q || [c.name, c.number, c.job, resultLabel(c.result)].some((x) => (x || '').toLowerCase().includes(q))));
  }, [data, search, type]);

  const s = data?.summary;
  const f = data?.funnel;
  const ch = data?.chats;
  const p = data?.previous;

  return (
    <div className="space-y-6">
      {/* Period */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${period === p.id ? 'bg-violet-600 text-white' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'}`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => load()} disabled={loading} className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50" title="Refresh">
            <i className={`fa-solid fa-rotate ${loading ? 'fa-spin' : ''}`}></i>
          </button>
          {data?.generated_at && (
            <span className="self-center text-xs text-gray-500" title="Refreshes every minute while this page is open">
              Updated {new Date(data.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
        <a href={withToken(`${API_BASE}/api/analytics/calls.csv?period=${period}`)} download
          className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 transition-all flex items-center gap-2">
          <i className="fa-solid fa-download"></i>Export calls (CSV)
        </a>
      </div>

      {error && <div className="text-sm text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-4 py-3"><i className="fa-solid fa-triangle-exclamation mr-2"></i>{error}</div>}
      {!data && !error && <p className="text-sm text-gray-400"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}

      {data && s && f && ch && (<>
        {/* Summary */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: 'Calls', value: s.calls.toLocaleString(), delta: <Delta now={s.calls} before={p?.calls} /> },
            { label: 'Answered', value: s.answer_rate == null ? '—' : `${s.answer_rate}%`, note: `${s.answered} of ${s.calls}`, delta: <Delta now={s.answer_rate} before={p?.answer_rate} unit="pts" /> },
            { label: 'Total talk time', value: s.talk_seconds ? total(s.talk_seconds) : '—', delta: <Delta now={s.talk_seconds} before={p?.talk_seconds} /> },
            { label: 'Avg talk time', value: dur(s.avg_talk_seconds), note: s.longest_talk_seconds ? `longest ${dur(s.longest_talk_seconds)}` : '', delta: <Delta now={s.avg_talk_seconds} before={p?.avg_talk_seconds} unit="s" good="none" /> },
            { label: 'Job-call conversion', value: s.conversion == null ? '—' : `${s.conversion}%`, note: 'interested ÷ answered job calls', delta: <Delta now={s.conversion} before={p?.conversion} unit="pts" /> },
            { label: 'Website chats', value: ch.conversations.toLocaleString(), note: `${ch.visitor_messages} visitor messages`, delta: <Delta now={ch.conversations} before={p?.chats} /> },
          ].map((x) => (
            <div key={x.label} className="bg-gray-900 rounded-xl border border-gray-800 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-gray-400">{x.label}</p>
                {p && <span title={`vs the ${PREV_LABEL[data.period]}`}>{x.delta}</span>}
              </div>
              <p className="text-xl font-bold text-white mt-1">{x.value}</p>
              {x.note && <p className="text-[11px] text-gray-500 mt-0.5 truncate" title={x.note}>{x.note}</p>}
            </div>
          ))}
        </div>
        {p && <p className="text-[11px] text-gray-500 -mt-3">Arrows compare with the {PREV_LABEL[data.period]}.</p>}

        {/* Activity over time + how calls ended */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card title={data.period === '24h' ? 'Last 24 hours, by hour' : 'Calls over time'} icon="fa-chart-column" className="lg:col-span-2">
            {s.calls === 0 && ch.conversations === 0 ? <p className="text-sm text-gray-500">No calls or chats in this period.</p> : (<>
              <StackedBars data={data.trend.map((t) => ({ ...t, name: t.label }))}
                label={(i) => { const step = Math.ceil(data.trend.length / 8); return i % step === 0 || i === data.trend.length - 1 ? data.trend[i].label : ''; }} />
              <p className="text-xs text-gray-500 mt-3">
                Website chats started: {data.trend.map((t) => t.chats).reduce((a, b) => a + b, 0)}
                {(() => { const top = data.trend.reduce((a, b) => (b.answered + b.missed > a.answered + a.missed ? b : a), data.trend[0]);
                  return top && top.answered + top.missed > 0 ? ` · busiest: ${top.label} (${top.answered + top.missed} calls)` : ''; })()}
              </p>
            </>)}
          </Card>
          <Card title="How calls ended" icon="fa-flag-checkered">
            {data.results.length === 0 ? <p className="text-sm text-gray-500">No calls in this period.</p> : (
              <div className="space-y-2.5">
                {data.results.map((r) => (
                  <div key={r.result} className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${r.result === 'interested' ? 'bg-emerald-500/15 text-emerald-300' : STATUS_STYLE[r.result] || OUTCOME_STYLE[r.result] || 'bg-gray-700/60 text-gray-300'}`}>{resultLabel(r.result)}</span>
                    <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (100 * r.count) / s.calls)}%`, background: ANSWERED }}></div>
                    </div>
                    <span className="text-xs text-gray-300 w-14 text-right">{r.count} <span className="text-gray-500">({Math.round((100 * r.count) / s.calls)}%)</span></span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* When calls happen */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title={`Calls by hour (${data.timezone})`} icon="fa-clock">
            <StackedBars data={data.hours.map((h) => ({ ...h, name: `${String(h.hour).padStart(2, '0')}:00` }))}
              label={(i) => (i % 6 === 0 ? `${String(i).padStart(2, '0')}:00` : '')} />
          </Card>
          <Card title="Calls by day of the week" icon="fa-calendar-week">
            <StackedBars data={data.weekdays.map((d) => ({ ...d, name: d.day }))} label={(i) => data.weekdays[i].day} />
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Job-call funnel */}
          <Card title="Job-call funnel" icon="fa-filter">
            <p className="text-xs text-gray-500 -mt-2 mb-4">Contacts imported in this period and how far they got</p>
            {f.imported === 0 ? <p className="text-sm text-gray-500">No contacts imported in this period.</p> : (
              <div className="space-y-3">
                <Meter label="Imported" value={f.imported} total={f.imported} />
                <Meter label="Dialled" value={f.dialled} total={f.imported} />
                <Meter label="Answered" value={f.answered} total={f.imported} />
                <Meter label="Interested" value={f.interested} total={f.imported} />
                {f.waiting > 0 && <p className="text-xs text-gray-500">{f.waiting} still waiting to be called.</p>}
                {f.outcomes.length > 0 && (
                  <div className="pt-3 border-t border-gray-800 flex flex-wrap gap-1.5">
                    {f.outcomes.map((o) => (
                      <span key={o.outcome} className="text-[11px] px-2 py-0.5 rounded-full bg-gray-800 text-gray-300">{resultLabel(o.outcome)} · {o.count}</span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Card>

          {/* By call type */}
          <Card title="By call type" icon="fa-table-columns" className="lg:col-span-2">
            {data.by_kind.length === 0 ? <p className="text-sm text-gray-500">No calls in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-500 text-left">
                      <th className="py-2 font-medium">Type</th><th className="font-medium text-right">Calls</th><th className="font-medium text-right">Answered</th>
                      <th className="font-medium text-right">Avg talk</th><th className="font-medium text-right">Hung up</th><th className="font-medium text-right">DNC</th>
                      <th className="font-medium text-right">Not connected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.by_kind.map((k) => (
                      <tr key={k.kind} className="border-t border-gray-800 text-gray-300">
                        <td className="py-2.5 text-white">{k.label}</td>
                        <td className="text-right">{k.calls}</td>
                        <td className="text-right">{k.answered} <span className="text-gray-500">({Math.round((100 * k.answered) / k.calls)}%)</span></td>
                        <td className="text-right">{dur(k.avg_talk_seconds)}</td>
                        <td className="text-right">{k.hung_up}</td>
                        <td className="text-right">{k.dnc}</td>
                        <td className="text-right" title="failed, no answer, busy or cancelled">{k.failed}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        {/* Website chats */}
        <Card title="Website chats" icon="fa-comments">
          {ch.conversations === 0 ? <p className="text-sm text-gray-500">No website chats in this period.</p> : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
                {[
                  { label: 'Conversations', value: ch.conversations },
                  { label: 'Gave an email', value: `${ch.with_email}` },
                  { label: 'Visitor messages', value: ch.visitor_messages },
                  { label: 'Messages per chat', value: ch.avg_messages ?? '—' },
                  { label: 'Typical chat length', value: ch.avg_length_seconds == null ? '—' : total(ch.avg_length_seconds), note: 'median, first to last message' },
                  { label: 'Operator joined', value: ch.operator_joined, note: 'chats a person from your team replied in' },
                  { label: 'AI reply time', value: ch.reply_ms == null ? '—' : `${(ch.reply_ms / 1000).toFixed(1)}s`, note: ch.reply_samples ? `${ch.reply_samples} timed replies` : 'no timed replies yet' },
                ].map((x) => (
                  <div key={x.label} className="p-3 rounded-lg bg-gray-800/40 border border-gray-700/50" title={x.note}>
                    <p className="text-xs text-gray-400">{x.label}</p>
                    <p className="text-lg font-semibold text-white mt-0.5">{x.value}</p>
                  </div>
                ))}
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-3">How chats ended</p>
                <div className="space-y-3">
                  {ch.ended.map((e) => <Meter key={e.by} label={ENDED_BY[e.by] || e.by} value={e.count} total={ch.conversations} />)}
                </div>
              </div>
            </div>
          )}
        </Card>

        {/* Call log */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="p-5 border-b border-gray-800 flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2"><i className="fa-solid fa-list text-violet-400"></i>Call log</h3>
            <span className="text-xs text-gray-500">{log.length} of {data.log.length}</span>
            <select value={type} onChange={(e) => setType(e.target.value)} className="ml-auto bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200">
              <option value="all">All types</option><option value="job">Job calls</option><option value="dialpad">Dial pad</option><option value="inbound">Inbound</option>
            </select>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, number, job, result"
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-white w-56 outline-none focus:border-violet-500" />
          </div>
          {log.length === 0 ? <p className="text-sm text-gray-500 p-5">No calls match.</p> : (
            <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-gray-900">
                  <tr className="border-b border-gray-800">
                    {['Time', 'Type', 'Who', 'Job', 'Talk', 'Result', 'Attempts'].map((h) => (
                      <th key={h} className="text-left text-xs font-medium text-gray-400 px-5 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {log.map((c, i) => (
                    <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30">
                      <td className="px-5 py-2.5 text-xs text-gray-400 whitespace-nowrap">{new Date(c.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                      <td className="px-5 py-2.5 text-xs text-gray-300 whitespace-nowrap">{c.type}</td>
                      <td className="px-5 py-2.5 text-sm text-white">{c.name || c.number}{c.name && <span className="block text-xs text-gray-500">{c.number}</span>}</td>
                      <td className="px-5 py-2.5 text-xs text-gray-400">{c.job || '—'}</td>
                      <td className="px-5 py-2.5 text-xs text-gray-300">{dur(c.talk_seconds)}</td>
                      <td className="px-5 py-2.5">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${c.result === 'interested' ? 'bg-emerald-500/15 text-emerald-300' : STATUS_STYLE[c.result] || 'bg-gray-700/60 text-gray-300'}`}>
                          {resultLabel(c.result)}
                        </span>
                      </td>
                      <td className="px-5 py-2.5 text-xs text-gray-400">{c.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
