import { useEffect, useMemo, useState } from 'react';
import { hungUpApi, HungUpCall } from '../utils/outboundApi';

// Hung up: calls where the other person put the phone down mid-conversation
// (job calls, dial pad and inbound). Call Rules makes the number wait before
// it is called again; the wait can be lifted here.

const KIND_LABEL: Record<string, string> = {
  'job call': 'Job call',
  'dial pad': 'Dial pad',
  'inbound call': 'Inbound',
  call: 'Call (deleted)',
};
const kindLabel = (k: string) => KIND_LABEL[k] || k;
const OUTCOME_LABEL: Record<string, string> = {
  interested: 'Was interested', callback: 'Asked for a callback', not_interested: 'Not interested', undecided: 'Undecided',
};

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const when = (iso: string) => (iso ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const dur = (s: number | null) => (s == null ? '—' : s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`);

export default function HungUpList() {
  const [calls, setCalls] = useState<HungUpCall[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<'all' | 'job call' | 'dial pad' | 'inbound call'>('all');
  const [open, setOpen] = useState<string | null>(null);

  const load = () => hungUpApi.list().then((r) => { setCalls(r.calls); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 3000); };

  const isHeld = (c: HungUpCall) => !!c.held_until && new Date(c.held_until).getTime() > Date.now();

  const release = async (c: HungUpCall) => {
    if (!window.confirm(`Lift the wait for ${c.name ? `${c.name} (${c.number})` : c.number}?\n\nThe agent may call this number again straight away.`)) return;
    try { await hungUpApi.release(c.number); flash(`${c.number} can be called again.`); load(); } catch (e: any) { setError(e.message); }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (calls || []).filter((c) => {
      if (kind !== 'all' && c.kind !== kind) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.job.toLowerCase().includes(q) || c.contact_last.toLowerCase().includes(q)
        || (digits.length >= 3 && c.number.replace(/\D/g, '').includes(digits));
    });
  }, [calls, query, kind]);

  const stats = useMemo(() => {
    const all = calls || [];
    const day = Date.now() - 864e5;
    const timed = all.filter((c) => c.talk_seconds != null);
    return {
      total: all.length,
      today: all.filter((c) => c.at && new Date(c.at).getTime() >= day).length,
      held: all.filter(isHeld).length,
      avg: timed.length ? Math.round(timed.reduce((s, c) => s + (c.talk_seconds || 0), 0) / timed.length) : null,
    };
  }, [calls]);

  const exportCsv = () => {
    const rows = [['Number', 'Name', 'Type', 'Job', 'Hung up', 'Talked', 'Before hanging up', 'Their last words', 'Agent last said', 'Not called until'],
      ...list.map((c) => [c.number, c.name, kindLabel(c.kind), c.job, c.at ? new Date(c.at).toLocaleString() : '', dur(c.talk_seconds),
        OUTCOME_LABEL[c.outcome] || c.outcome, c.contact_last, c.agent_last, isHeld(c) ? new Date(c.held_until!).toLocaleString() : ''])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `hung-up-calls-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const field = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-violet-500 outline-none';

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {([
          ['Hung-up calls', stats.total, 'fa-phone-slash', 'text-rose-300', 'bg-rose-500/15'],
          ['In the last 24 hours', stats.today, 'fa-clock', 'text-amber-300', 'bg-amber-500/15'],
          ['Waiting before next call', stats.held, 'fa-hourglass-half', 'text-sky-300', 'bg-sky-500/15'],
          ['Average time before hang-up', stats.avg == null ? '—' : dur(stats.avg), 'fa-stopwatch', 'text-violet-300', 'bg-violet-500/15'],
        ] as const).map(([label, value, icon, color, bg]) => (
          <div key={label} className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}><i className={`fa-solid ${icon} ${color}`}></i></div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-white leading-tight">{calls ? value : '—'}</p>
              <p className="text-xs text-gray-400 truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-6 pb-4 flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-rose-500/15 flex items-center justify-center shrink-0"><i className="fa-solid fa-phone-slash text-rose-300"></i></div>
          <div>
            <h3 className="text-lg font-semibold text-white">Calls where the contact hung up</h3>
            <p className="text-sm text-gray-400">
              The person put the phone down before the agent finished. Their number waits for the time set in
              Settings &gt; Call Rules before it is called again. Click a row to see the last thing each side said.
            </p>
          </div>
        </div>

        <div className="px-4 pb-4 border-b border-gray-800 flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number, name, job or what they said"
              className={`${field} w-full pl-8`} />
          </div>
          <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs shrink-0">
            {([['all', 'All'], ['job call', 'Job calls'], ['dial pad', 'Dial pad'], ['inbound call', 'Inbound']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setKind(v)}
                className={`px-3 py-2 ${kind === v ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={!list.length}
            className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40 shrink-0">
            <i className="fa-solid fa-file-csv mr-1.5"></i>Export CSV
          </button>
        </div>
        {error && <p className="text-sm text-red-300 px-4 pt-3"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
        {notice && <p className="text-sm text-emerald-300 px-4 pt-3"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}

        {!calls && !error && <p className="text-sm text-gray-400 text-center py-12"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}
        {calls && calls.length === 0 && (
          <div className="text-center py-12 px-6">
            <i className="fa-regular fa-face-smile text-3xl text-gray-600"></i>
            <p className="text-sm text-gray-300 mt-3">Nobody has hung up on the agent</p>
            <p className="text-xs text-gray-500 mt-1">Calls appear here when the other person puts the phone down mid-conversation.</p>
          </div>
        )}
        {calls && calls.length > 0 && list.length === 0 && <p className="text-sm text-gray-500 text-center py-10">No calls match your search.</p>}
        {list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Number</th>
                  <th className="text-left font-medium px-4 py-3">Name</th>
                  <th className="text-left font-medium px-4 py-3">Job</th>
                  <th className="text-left font-medium px-4 py-3">Hung up</th>
                  <th className="text-left font-medium px-4 py-3">Talked</th>
                  <th className="text-left font-medium px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {list.map((c) => {
                  const id = c.call_id + c.number;
                  return [
                    <tr key={id} onClick={() => setOpen(open === id ? null : id)} className="hover:bg-gray-800/30 cursor-pointer">
                      <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                        <i className={`fa-solid fa-chevron-${open === id ? 'down' : 'right'} text-[10px] text-gray-500 mr-2`}></i>
                        {c.number}
                        <div className="text-[11px] text-gray-500 font-normal ml-4">{kindLabel(c.kind)}</div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">{c.name || <span className="text-gray-600">—</span>}</td>
                      <td className="px-4 py-3 text-gray-300 max-w-[14rem] truncate" title={c.job}>{c.job || <span className="text-gray-600">—</span>}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{when(c.at)}</td>
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {dur(c.talk_seconds)}
                        {c.turns > 0 && <div className="text-[11px] text-gray-500">{c.turns} {c.turns === 1 ? 'reply' : 'replies'}</div>}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {c.on_dnc ? <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">On Do Not Call</span>
                          : isHeld(c) ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300" title={new Date(c.held_until!).toLocaleString()}>Not called until {when(c.held_until!)}</span>
                          : <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">Can be called</span>}
                        {OUTCOME_LABEL[c.outcome] && <div className="text-[11px] text-gray-500 mt-1">{OUTCOME_LABEL[c.outcome]}</div>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {isHeld(c) && !c.on_dnc && (
                          <button onClick={(e) => { e.stopPropagation(); release(c); }} title="Lift the wait: the agent may call again now"
                            className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-emerald-300 hover:bg-emerald-500/10">
                            <i className="fa-solid fa-unlock mr-1"></i>Lift wait
                          </button>
                        )}
                      </td>
                    </tr>,
                    open === id && (
                      <tr key={id + '-d'} className="bg-gray-950/40">
                        <td colSpan={7} className="px-6 py-3 text-xs space-y-1.5">
                          <p><span className="text-gray-500">Their last words: </span>
                            {c.contact_last ? <span className="text-gray-200 italic">"{c.contact_last}"</span> : <span className="text-gray-600">nothing (hung up during the agent's opening)</span>}</p>
                          <p><span className="text-gray-500">Agent was saying: </span>
                            {c.agent_last ? <span className="text-gray-300">"{c.agent_last}"</span> : <span className="text-gray-600">—</span>}</p>
                          {c.kind === 'call' && <p className="text-gray-500">This call has been deleted from the history; only the wait is left.</p>}
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          </div>
        )}
        {list.length > 0 && (
          <p className="text-[11px] text-gray-500 px-4 py-2.5 border-t border-gray-800">Showing {list.length} of {calls?.length} calls</p>
        )}
      </div>
    </div>
  );
}
