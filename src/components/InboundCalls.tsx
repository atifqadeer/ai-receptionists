import { useEffect, useMemo, useState } from 'react';
import { telephonyApi, InboundCall, InboundCallDetail, InboundStats, InboundStatus } from '../utils/outboundApi';

// Inbound Calls page: every call the agent answered on the inbound
// extension, live and past. Search, filter, open a call to read its
// transcript, play its recording and see what happened moment by moment.

type Range = 'today' | '7d' | '30d' | 'all';
type StatusFilter = 'all' | 'live' | 'completed' | 'failed';

const input = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none';

const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');

function seconds(c: InboundCall) {
  if (!c.answered_at) return 0;
  const end = c.ended_at ? new Date(c.ended_at).getTime() : Date.now();
  return Math.max(0, Math.round((end - new Date(c.answered_at).getTime()) / 1000));
}
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const isLive = (c: InboundCall) => c.status === 'ringing' || c.status === 'in_progress';
const cleanName = (n: string) => (n || '').trim().replace(/^["']+|["']+$/g, '').trim();
const who = (c: InboundCall) => (cleanName(c.caller_name) ? `${cleanName(c.caller_name)} (${c.caller_number})` : c.caller_number);

const STATUS_STYLE: Record<string, string> = {
  ringing: 'bg-amber-500/15 text-amber-300',
  in_progress: 'bg-emerald-500/15 text-emerald-300',
  completed: 'bg-gray-700/60 text-gray-300',
  failed: 'bg-red-500/15 text-red-300',
};
const STATUS_LABEL: Record<string, string> = { ringing: 'Ringing', in_progress: 'Live', completed: 'Completed', failed: 'Failed' };

// What each event-log entry means, for the timeline.
function describe(e: any): string {
  switch (e.event) {
    case 'incoming': return `Incoming call from ${e.target}`;
    case 'answered': return 'Agent answered';
    case 'agent_speaks': return `Agent: "${e.text}"`;
    case 'agent_done': return 'Agent finished speaking';
    case 'listening': return e.after_barge_in ? 'Listening (caller interrupted)' : 'Listening';
    case 'heard': return e.text ? `Heard: "${e.text}"${e.unclear ? ' (unclear)' : ''}` : 'Heard nothing (silence)';
    case 'barge_in': return `Caller interrupted the agent: "${e.heard}"`;
    case 'talk_ignored': return `Ignored line noise / echo: "${e.heard}"`;
    case 'error': return `Error: ${e.error}`;
    case 'call_ended': return `Call ended by ${e.by}`;
    default: return e.event;
  }
}

function toCsv(calls: InboundCall[]) {
  const q = (v: string) => `"${(v || '').replace(/"/g, '""')}"`;
  const rows = calls.map((c) => [c.started_at, c.caller_number, c.caller_name, c.extension, STATUS_LABEL[c.status] || c.status,
    mmss(seconds(c)), c.ended_by || '', c.transcript.map((m) => `${m.role === 'agent' ? 'Agent' : 'Caller'}: ${m.text}`).join(' | ')].map(String).map(q).join(','));
  return ['Started,Caller number,Caller name,Extension,Status,Duration,Ended by,Transcript', ...rows].join('\n');
}

export default function InboundCalls() {
  const [calls, setCalls] = useState<InboundCall[]>([]);
  const [stats, setStats] = useState<InboundStats | null>(null);
  const [line, setLine] = useState<InboundStatus | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [range, setRange] = useState<Range>('all');
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboundCallDetail | null>(null);
  const [showEvents, setShowEvents] = useState(false);

  // The list refreshes every few seconds, so live calls appear by themselves.
  useEffect(() => {
    let alive = true;
    const poll = () => telephonyApi.inbound().then((r) => {
      if (!alive) return;
      setCalls(r.calls); setStats(r.stats); setLine(r.status); setError('');
    }).catch(() => alive && setError('Could not reach the backend at http://localhost:8000. Start it with start-app.bat.'));
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // The open call's details (refreshed while it is live).
  const selectedCall = calls.find((c) => c.id === selected);
  const selectedLive = selectedCall ? isLive(selectedCall) : false;
  const selectedStatus = selectedCall?.status;
  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let alive = true;
    const load = () => telephonyApi.inboundCall(selected).then((d) => alive && setDetail(d)).catch(() => alive && setDetail(null));
    load();
    const t = selectedLive ? setInterval(load, 3000) : undefined;
    return () => { alive = false; if (t) clearInterval(t); };
  }, [selected, selectedLive, selectedStatus]);

  const filtered = useMemo(() => {
    const now = Date.now();
    const since = range === 'today' ? new Date(new Date().toDateString()).getTime()
      : range === '7d' ? now - 7 * 864e5 : range === '30d' ? now - 30 * 864e5 : 0;
    const q = query.trim().toLowerCase();
    return calls.filter((c) => {
      if (new Date(c.started_at).getTime() < since) return false;
      if (status === 'live' && !isLive(c)) return false;
      if ((status === 'completed' || status === 'failed') && c.status !== status) return false;
      if (!q) return true;
      return c.caller_number.toLowerCase().includes(q) || (c.caller_name || '').toLowerCase().includes(q)
        || c.transcript.some((m) => m.text.toLowerCase().includes(q));
    });
  }, [calls, query, status, range]);

  const callsFromSameNumber = selectedCall ? calls.filter((c) => c.caller_number === selectedCall.caller_number).length : 0;

  const exportCsv = () => {
    const blob = new Blob([toCsv(filtered)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `inbound-calls-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this call from the history? Its transcript is removed; this cannot be undone.')) return;
    await telephonyApi.deleteInboundCall(id);
    setCalls((cs) => cs.filter((c) => c.id !== id));
    setSelected(null);
  };

  const cards: Array<[string, string | number, string]> = stats ? [
    ['Live now', stats.live, 'fa-phone-volume text-emerald-400'],
    ['Today', stats.today, 'fa-calendar-day text-violet-400'],
    ['All calls', stats.total, 'fa-phone text-indigo-400'],
    ['Completed', stats.completed, 'fa-circle-check text-gray-300'],
    ['Failed', stats.failed, 'fa-triangle-exclamation text-red-400'],
    ['Avg. length', mmss(stats.avg_seconds), 'fa-stopwatch text-amber-400'],
    ['Unique callers', stats.unique_callers, 'fa-users text-sky-400'],
  ] : [];

  return (
    <div className="space-y-5">
      {error && (
        <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-4 py-3 rounded-lg">
          <i className="fa-solid fa-triangle-exclamation mr-2"></i>{error}
        </div>
      )}

      {/* The line */}
      {line && (
        <div className={`flex items-center gap-3 text-sm px-4 py-3 rounded-lg border ${
          line.state === 'registered' ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300'
            : line.state === 'error' ? 'border-red-500/30 bg-red-500/5 text-red-300' : 'border-gray-700 bg-gray-900 text-gray-400'}`}>
          <i className={`fa-solid ${line.state === 'registered' ? 'fa-signal' : line.state === 'error' ? 'fa-plug-circle-xmark' : 'fa-power-off'}`}></i>
          <span>{line.state === 'disabled' ? 'Inbound calls are turned off. Turn them on in Settings › Calling › Inbound Calls.' : line.message}</span>
        </div>
      )}

      {/* Totals */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {cards.map(([label, value, icon]) => (
          <div key={label} className="bg-gray-900 border border-gray-800 rounded-xl p-4">
            <div className="text-xs text-gray-400 flex items-center gap-2"><i className={`fa-solid ${icon}`}></i>{label}</div>
            <div className="text-2xl font-semibold text-white mt-1">{value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm"></i>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search caller number, name or what was said…"
            className={`${input} w-full pl-9`} />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={input}>
          <option value="all">All statuses</option>
          <option value="live">Live now</option>
          <option value="completed">Completed</option>
          <option value="failed">Failed</option>
        </select>
        <select value={range} onChange={(e) => setRange(e.target.value as Range)} className={input}>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="all">All time</option>
        </select>
        <button onClick={exportCsv} disabled={!filtered.length}
          className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
          <i className="fa-solid fa-file-csv"></i>Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Call list */}
        <div className="lg:col-span-2 bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-800 text-sm text-gray-400">
            {filtered.length} call{filtered.length === 1 ? '' : 's'}
          </div>
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-gray-500">
              <i className="fa-solid fa-phone-slash text-2xl mb-2 block"></i>
              {calls.length ? 'No calls match these filters.' : 'No inbound calls yet. Calls to the inbound extension appear here as they happen.'}
            </div>
          ) : (
            <div className="divide-y divide-gray-800 max-h-[600px] overflow-y-auto">
              {filtered.map((c) => (
                <button key={c.id} onClick={() => setSelected(c.id)}
                  className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-gray-800/50 ${selected === c.id ? 'bg-violet-600/10 border-l-2 border-violet-500' : ''}`}>
                  <i className={`fa-solid mt-1 ${isLive(c) ? 'fa-phone-volume text-emerald-400 animate-pulse' : c.status === 'failed' ? 'fa-phone-slash text-red-400' : 'fa-phone text-gray-500'}`}></i>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white truncate">{who(c)}</span>
                      <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status] || ''}`}>{STATUS_LABEL[c.status] || c.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">{fmtTime(c.started_at)} · {mmss(seconds(c))}</div>
                    <div className="text-xs text-gray-400 mt-1 truncate">
                      {c.transcript.find((m) => m.role === 'caller')?.text || 'No words from the caller'}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Call details */}
        <div className="lg:col-span-3 bg-gray-900 border border-gray-800 rounded-xl p-5">
          {!selectedCall ? (
            <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-sm text-gray-500">
              <i className="fa-solid fa-hand-pointer text-2xl mb-2"></i>
              Pick a call to see its transcript, recording and timeline.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-full bg-violet-600/20 flex items-center justify-center">
                  <i className="fa-solid fa-user text-violet-300"></i>
                </div>
                <div className="flex-1">
                  <div className="text-lg font-semibold text-white">{who(selectedCall)}</div>
                  <div className="text-xs text-gray-400">
                    Called extension {selectedCall.extension} · {fmtTime(selectedCall.started_at)}
                  </div>
                  {callsFromSameNumber > 1 && (
                    <button onClick={() => { setQuery(selectedCall.caller_number); setStatus('all'); setRange('all'); }}
                      className="text-xs text-violet-300 hover:underline mt-1">
                      {callsFromSameNumber} calls from this number: show them all
                    </button>
                  )}
                </div>
                <button onClick={() => remove(selectedCall.id)} title="Delete from history"
                  className="text-gray-500 hover:text-red-400 px-2 py-1"><i className="fa-solid fa-trash"></i></button>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                {[
                  ['Status', STATUS_LABEL[selectedCall.status] || selectedCall.status],
                  ['Duration', mmss(seconds(selectedCall))],
                  ['Answered', selectedCall.answered_at ? new Date(selectedCall.answered_at).toLocaleTimeString() : '—'],
                  ['Ended by', selectedCall.ended_by ? (selectedCall.ended_by === 'agent' ? 'Agent' : 'Caller') : isLive(selectedCall) ? 'In progress' : '—'],
                ].map(([k, v]) => (
                  <div key={k} className="bg-gray-800/60 rounded-lg px-3 py-2">
                    <div className="text-xs text-gray-500">{k}</div>
                    <div className="text-white">{v}</div>
                  </div>
                ))}
              </div>

              {selectedCall.error && (
                <div className="text-sm text-red-300 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">{selectedCall.error}</div>
              )}

              {/* Recording */}
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Recording</h4>
                {detail?.has_recording ? (
                  <div className="flex items-center gap-3">
                    <audio controls preload="none" src={telephonyApi.inboundRecordingUrl(selectedCall.id)} className="flex-1 h-10" />
                    <a href={telephonyApi.inboundRecordingUrl(selectedCall.id)} download
                      className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">
                      <i className="fa-solid fa-download mr-1.5"></i>WAV
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    {isLive(selectedCall) ? 'The recording is saved when the call ends.' : 'No recording kept (the newest 100 calls keep their recordings).'}
                  </p>
                )}
                {detail?.has_recording && <p className="text-xs text-gray-500 mt-1">Stereo: caller on the left, agent on the right.</p>}
              </div>

              {/* Transcript */}
              <div>
                <h4 className="text-sm font-medium text-gray-300 mb-2">Transcript</h4>
                <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
                  {selectedCall.transcript.length === 0 && <p className="text-xs text-gray-500">Nothing was said.</p>}
                  {selectedCall.transcript.map((m, i) => (
                    <div key={i} className={`flex ${m.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`max-w-[80%] rounded-xl px-3 py-2 text-sm ${m.role === 'agent' ? 'bg-violet-600/20 text-violet-100' : 'bg-gray-800 text-gray-100'}`}>
                        <div className="text-[11px] opacity-60 mb-0.5">
                          {m.role === 'agent' ? 'Agent' : 'Caller'}
                          {m.interrupted && ' · interrupted'}{m.unclear && ' · unclear'}
                        </div>
                        {m.text}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Timeline */}
              <div>
                <button onClick={() => setShowEvents(!showEvents)} className="text-sm font-medium text-gray-300 flex items-center gap-2">
                  <i className={`fa-solid ${showEvents ? 'fa-chevron-down' : 'fa-chevron-right'} text-xs`}></i>
                  Call timeline {detail ? `(${detail.events.length} events)` : ''}
                </button>
                {showEvents && (
                  <div className="mt-2 border-l border-gray-700 ml-1.5 space-y-1.5 max-h-[300px] overflow-y-auto">
                    {(detail?.events || []).length === 0 && <p className="text-xs text-gray-500 pl-4">No timeline kept for this call.</p>}
                    {(detail?.events || []).map((e, i) => (
                      <div key={i} className="pl-4 relative text-xs">
                        <span className={`absolute -left-[5px] top-1 w-2.5 h-2.5 rounded-full ${e.event === 'error' ? 'bg-red-400' : e.event === 'barge_in' ? 'bg-amber-400' : e.event === 'heard' ? 'bg-sky-400' : 'bg-gray-600'}`}></span>
                        <span className="text-gray-500 font-mono mr-2">{mmss(Math.round(e.t || 0))}</span>
                        <span className="text-gray-300">{describe(e)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
