import { useEffect, useMemo, useState } from 'react';
import { followUpsApi, FollowUp } from '../utils/outboundApi';

// Follow-ups: callback and meeting requests from chat and every kind of
// call. Dial-pad callbacks and voicemails are dialled again by the agent
// ("Agent will call"); job-call callbacks are re-queued on Job Calls; chat
// callbacks and all meetings are for the team ("For the team").

const SOURCE_LABEL: Record<string, string> = {
  chat: 'Website chat', 'job call': 'Job call', 'dial pad': 'Dial pad call', 'inbound call': 'Inbound call',
};

const STATUS: Record<FollowUp['status'], { label: string; cls: string }> = {
  open: { label: 'For the team', cls: 'bg-amber-500/15 text-amber-300' },
  scheduled: { label: 'Scheduled', cls: 'bg-sky-500/15 text-sky-300' },
  dialled: { label: 'Calling…', cls: 'bg-violet-500/15 text-violet-300' },
  done: { label: 'Done', cls: 'bg-emerald-500/15 text-emerald-300' },
  failed: { label: 'Could not call', cls: 'bg-red-500/15 text-red-300' },
  cancelled: { label: 'Cancelled', cls: 'bg-gray-700 text-gray-400' },
};

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function FollowUpsList() {
  const [items, setItems] = useState<FollowUp[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'callback' | 'meeting'>('all');
  const [show, setShow] = useState<'active' | 'all'>('active');

  const load = () => followUpsApi.list().then((r) => { setItems(r.items); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 3000); };

  const act = async (f: FollowUp, changes: Parameters<typeof followUpsApi.update>[1], message: string) => {
    try { await followUpsApi.update(f.id, changes); flash(message); load(); } catch (e: any) { setError(e.message); }
  };
  const remove = async (f: FollowUp) => {
    if (!window.confirm(`Delete this ${f.kind} request from ${f.name || f.phone || f.email || 'this contact'}?`)) return;
    try { await followUpsApi.remove(f.id); flash('Request deleted.'); load(); } catch (e: any) { setError(e.message); }
  };

  const active = (f: FollowUp) => ['open', 'scheduled', 'dialled', 'failed'].includes(f.status);
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (items || []).filter((f) => {
      if (kind !== 'all' && f.kind !== kind) return false;
      if (show === 'active' && !active(f)) return false;
      if (!q) return true;
      return [f.name, f.phone, f.email, f.said, f.job, f.when].some((v) => (v || '').toLowerCase().includes(q));
    });
  }, [items, query, kind, show]);

  const counts = useMemo(() => {
    const a = (items || []).filter(active);
    return { meetings: a.filter((f) => f.kind === 'meeting').length, callbacks: a.filter((f) => f.kind === 'callback').length };
  }, [items]);

  const exportCsv = () => {
    const rows = [['Type', 'Status', 'Name', 'Phone', 'Email', 'Asked for', 'Due', 'From', 'Job', 'What they said', 'Note', 'Received'],
      ...list.map((f) => [f.kind, STATUS[f.status]?.label || f.status, f.name, f.phone, f.email, f.when, when(f.due_at),
        SOURCE_LABEL[f.source] || f.source, f.job, f.said, f.note, new Date(f.created_at).toLocaleString()])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `follow-ups-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const field = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-violet-500 outline-none';

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="p-6 pb-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-sky-500/20 flex items-center justify-center shrink-0"><i className="fa-solid fa-calendar-check text-sky-300"></i></div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">
            Follow-ups
            {items && <span className="ml-2 text-sm font-normal text-gray-400">{counts.meetings} meeting {counts.meetings === 1 ? 'request' : 'requests'}, {counts.callbacks} {counts.callbacks === 1 ? 'callback' : 'callbacks'} open</span>}
          </h3>
          <p className="text-sm text-gray-400">
            Callback and meeting requests from website chat and every kind of call. Dial-pad callbacks and answering machines
            are called again by the agent at the time asked for (within calling hours, up to the Call Rules limit); job-call
            callbacks are re-queued on Job Calls. Meetings and chat callbacks are for your team to arrange.
          </p>
        </div>
      </div>

      <div className="px-4 pb-4 border-b border-gray-800 flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, number, email, job or what they said"
            className={`${field} w-full pl-8`} />
        </div>
        <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs shrink-0">
          {([['all', 'All'], ['meeting', 'Meetings'], ['callback', 'Callbacks']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setKind(v)}
              className={`px-3 py-2 ${kind === v ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
          ))}
        </div>
        <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs shrink-0">
          {([['active', 'To do'], ['all', 'Everything']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setShow(v)}
              className={`px-3 py-2 ${show === v ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!list.length}
          className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40 shrink-0">
          <i className="fa-solid fa-file-csv mr-1.5"></i>Export CSV
        </button>
      </div>
      {error && <p className="text-sm text-red-300 px-4 pt-3"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
      {notice && <p className="text-sm text-emerald-300 px-4 pt-3"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}

      {!items && !error && <p className="text-sm text-gray-400 text-center py-12"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}
      {items && list.length === 0 && (
        <div className="text-center py-12 px-6">
          <i className="fa-regular fa-calendar text-3xl text-gray-600"></i>
          <p className="text-sm text-gray-300 mt-3">{items.length ? 'Nothing matches' : 'No callback or meeting requests yet'}</p>
          <p className="text-xs text-gray-500 mt-1">
            They appear here when someone says "call me back tomorrow" or "can I book a meeting with the recruiter?" in a chat or on a call.
          </p>
        </div>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 border-b border-gray-800">
              <tr>
                <th className="text-left font-medium px-4 py-3">Request</th>
                <th className="text-left font-medium px-4 py-3">Contact</th>
                <th className="text-left font-medium px-4 py-3">Asked for</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">What they said</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {list.map((f) => (
                <tr key={f.id} className="hover:bg-gray-800/30 align-top">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <span className="flex items-center gap-2 text-white font-medium">
                      <i className={`fa-solid ${f.kind === 'meeting' ? 'fa-handshake text-sky-400' : 'fa-phone text-violet-400'} text-xs`}></i>
                      {f.kind === 'meeting' ? 'Meeting' : 'Callback'}
                    </span>
                    <div className="text-[11px] text-gray-500">{SOURCE_LABEL[f.source] || f.source} · {when(f.created_at)}</div>
                    {f.job && <div className="text-[11px] text-gray-500 truncate max-w-[12rem]" title={f.job}>{f.job}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-300">
                    <div>{f.name || <span className="text-gray-600">No name</span>}</div>
                    {f.phone && <div className="text-xs text-gray-400"><i className="fa-solid fa-phone text-[10px] mr-1"></i>{f.phone}</div>}
                    {f.email && <div className="text-xs text-gray-400 truncate max-w-[14rem]" title={f.email}><i className="fa-solid fa-envelope text-[10px] mr-1"></i>{f.email}</div>}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-gray-200">{f.when || <span className="text-gray-500">No time given</span>}</div>
                    {f.due_at && <div className="text-[11px] text-gray-500">{when(f.due_at)}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${STATUS[f.status]?.cls || ''}`}>
                      {f.status === 'scheduled' && f.auto_dial ? 'Agent will call' : STATUS[f.status]?.label || f.status}
                    </span>
                    {f.round > 1 && <div className="text-[11px] text-gray-500 mt-1">Callback no. {f.round}</div>}
                    {f.result && <div className="text-[11px] text-gray-500 mt-1">Result: {f.result.replace('_', ' ')}</div>}
                    {f.note && <div className="text-[11px] text-gray-500 mt-1 max-w-[14rem]">{f.note}</div>}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs">
                    {f.said ? <span className="italic line-clamp-3" title={f.said}>"{f.said}"</span> : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {f.status === 'scheduled' && f.auto_dial && (
                      <button onClick={() => act(f, { auto_dial: false, status: 'open' }, "The agent won't call; it's now for the team.")}
                        title="Stop the agent calling; leave it for the team"
                        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-amber-300 hover:bg-amber-500/10">
                        <i className="fa-solid fa-hand mr-1"></i>Don't auto-call
                      </button>
                    )}
                    {active(f) && (
                      <button onClick={() => act(f, { status: 'done', auto_dial: false }, 'Marked as done.')}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                        <i className="fa-solid fa-check mr-1"></i>Done
                      </button>
                    )}
                    {!active(f) && (
                      <button onClick={() => act(f, { status: 'open' }, 'Reopened.')}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800">
                        <i className="fa-solid fa-rotate-left mr-1"></i>Reopen
                      </button>
                    )}
                    <button onClick={() => remove(f)} title="Delete this request"
                      className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10">
                      <i className="fa-solid fa-trash"></i>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.length > 0 && (
        <p className="text-[11px] text-gray-500 px-4 py-2.5 border-t border-gray-800">
          Showing {list.length} of {items?.length} {items?.length === 1 ? 'request' : 'requests'}
        </p>
      )}
    </div>
  );
}
