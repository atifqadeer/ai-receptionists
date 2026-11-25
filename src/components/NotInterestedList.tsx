import { useEffect, useMemo, useState } from 'react';
import { notInterestedApi, NotInterestedEntry } from '../utils/outboundApi';

// Not interested: contacts who said on a call that they are not interested.
// Shown under the Do Not Call list. They are held for the Call Rules
// "not interested" days, then may be called about other roles again.

const SOURCE_LABEL: Record<string, string> = {
  'job call': 'Job call',
  'dial pad': 'Dial pad call',
  'inbound call': 'Inbound call',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] || s || 'Call';

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

const day = (iso: string) => new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });

export default function NotInterestedList({ onDncChange }: { onDncChange?: () => void }) {
  const [entries, setEntries] = useState<NotInterestedEntry[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [held, setHeld] = useState<'all' | 'held' | 'free'>('all');

  const load = () => notInterestedApi.list().then((r) => { setEntries(r.numbers); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 3000); };
  const who = (e: NotInterestedEntry) => (e.name ? `${e.name} (${e.number})` : e.number);

  const remove = async (e: NotInterestedEntry) => {
    if (!window.confirm(`Remove ${who(e)} from the Not interested list?\n\nThe wait from Call Rules is lifted, so the agent may call this number again.`)) return;
    try { await notInterestedApi.remove(e.number); flash(`${e.number} removed. The agent may call it again.`); load(); } catch (err: any) { setError(err.message); }
  };

  const toDnc = async (e: NotInterestedEntry) => {
    if (!window.confirm(`Move ${who(e)} to the Do Not Call list?\n\nThe agent will never call this number again.`)) return;
    try { await notInterestedApi.toDnc(e.number); flash(`${e.number} moved to Do Not Call.`); load(); onDncChange?.(); } catch (err: any) { setError(err.message); }
  };

  const isHeld = (e: NotInterestedEntry) => !!e.held_until && new Date(e.held_until).getTime() > Date.now();

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (entries || []).filter((e) => {
      if (held === 'held' && !isHeld(e)) return false;
      if (held === 'free' && isHeld(e)) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (e.said || '').toLowerCase().includes(q) || (e.job || '').toLowerCase().includes(q)
        || (digits.length >= 3 && e.number.replace(/\D/g, '').includes(digits));
    });
  }, [entries, query, held]);

  const exportCsv = () => {
    const rows = [['Number', 'Name', 'Job', 'Last said', 'Times', 'Not called until', 'Source', 'What they said'],
      ...list.map((e) => [e.number, e.name, e.job || '', new Date(e.at).toLocaleString(), String(e.times || 1),
        isHeld(e) ? new Date(e.held_until!).toLocaleString() : '', sourceLabel(e.source), e.said || ''])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `not-interested-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const field = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:border-violet-500 outline-none';
  const heldCount = (entries || []).filter(isHeld).length;

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      <div className="p-6 pb-4 flex items-start gap-3">
        <div className="w-10 h-10 rounded-lg bg-slate-500/20 flex items-center justify-center shrink-0"><i className="fa-solid fa-thumbs-down text-slate-300"></i></div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-white">
            Not interested
            {entries && <span className="ml-2 text-sm font-normal text-gray-400">{entries.length} {entries.length === 1 ? 'contact' : 'contacts'}, {heldCount} on hold</span>}
          </h3>
          <p className="text-sm text-gray-400">
            People who said "I'm not interested" on a call. They are not called again for the number of days set in
            Settings &gt; Call Rules, then they may be called about other roles. Move someone to Do Not Call to block them for good.
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
          {([['all', 'All'], ['held', 'On hold'], ['free', 'Can be called']] as const).map(([v, label]) => (
            <button key={v} onClick={() => setHeld(v)}
              className={`px-3 py-2 ${held === v ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!list.length}
          className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40 shrink-0">
          <i className="fa-solid fa-file-csv mr-1.5"></i>Export CSV
        </button>
      </div>
      {error && <p className="text-sm text-red-300 px-4 pt-3"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
      {notice && <p className="text-sm text-emerald-300 px-4 pt-3"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}

      {!entries && !error && <p className="text-sm text-gray-400 text-center py-12"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}
      {entries && entries.length === 0 && (
        <div className="text-center py-12 px-6">
          <i className="fa-regular fa-face-smile text-3xl text-gray-600"></i>
          <p className="text-sm text-gray-300 mt-3">Nobody has said they're not interested yet</p>
          <p className="text-xs text-gray-500 mt-1">Contacts appear here when they turn a role down on a call.</p>
        </div>
      )}
      {entries && entries.length > 0 && list.length === 0 && (
        <p className="text-sm text-gray-500 text-center py-10">No contacts match your search.</p>
      )}
      {list.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-400 border-b border-gray-800">
              <tr>
                <th className="text-left font-medium px-4 py-3">Number</th>
                <th className="text-left font-medium px-4 py-3">Name</th>
                <th className="text-left font-medium px-4 py-3">Job</th>
                <th className="text-left font-medium px-4 py-3">Said</th>
                <th className="text-left font-medium px-4 py-3">Status</th>
                <th className="text-left font-medium px-4 py-3">What they said</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              {list.map((e) => (
                <tr key={e.number} className="hover:bg-gray-800/30">
                  <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                    <i className="fa-solid fa-thumbs-down text-slate-400 text-xs mr-2"></i>{e.number}
                  </td>
                  <td className="px-4 py-3 text-gray-300">{e.name || <span className="text-gray-600">—</span>}</td>
                  <td className="px-4 py-3 text-gray-300 max-w-[14rem] truncate" title={e.job}>{e.job || <span className="text-gray-600">—</span>}</td>
                  <td className="px-4 py-3 text-gray-400 whitespace-nowrap" title={new Date(e.at).toLocaleString()}>
                    {day(e.at)}
                    {(e.times || 1) > 1 && <span className="ml-1.5 text-[11px] text-gray-500">×{e.times}</span>}
                    <div className="text-[11px] text-gray-500">{sourceLabel(e.source)}</div>
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    {e.on_dnc ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/15 text-red-300">On Do Not Call</span>
                    ) : isHeld(e) ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300" title={new Date(e.held_until!).toLocaleString()}>
                        Not called until {day(e.held_until!)}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">Can be called</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-gray-400 max-w-xs">
                    {e.said ? <span className="italic line-clamp-2" title={e.said}>"{e.said}"</span> : <span className="text-gray-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {!e.on_dnc && (
                      <button onClick={() => toDnc(e)} title="Never call this number again"
                        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10">
                        <i className="fa-solid fa-ban mr-1"></i>Do Not Call
                      </button>
                    )}
                    <button onClick={() => remove(e)} title="Remove from the list and lift the wait (the agent may call again)"
                      className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800">
                      <i className="fa-solid fa-trash mr-1"></i>Remove
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
          Showing {list.length} of {entries?.length} {entries?.length === 1 ? 'contact' : 'contacts'}
        </p>
      )}
    </div>
  );
}
