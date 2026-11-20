import { useEffect, useMemo, useState } from 'react';
import { dncApi, DncEntry } from '../utils/outboundApi';

// Do Not Call: numbers that asked on a call or chat not to be contacted
// again (or were added here). The agent never dials them: job calls to
// them are stopped and the dial pad refuses them.

const SOURCE_LABEL: Record<string, string> = {
  'job call': 'Job call',
  'dial pad': 'Dial pad call',
  'inbound call': 'Inbound call',
  'added in the dashboard': 'Added manually',
};
const sourceLabel = (s: string) => SOURCE_LABEL[s] || s || 'Unknown';
const isManual = (s: string) => s === 'added in the dashboard';

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function DncList() {
  const [entries, setEntries] = useState<DncEntry[] | null>(null);
  const [error, setError] = useState('');
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | 'calls' | 'manual'>('all');
  const [notice, setNotice] = useState('');

  const load = () => dncApi.list().then((r) => { setEntries(r.numbers); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 3000); };

  const add = async () => {
    if (!number.trim()) return;
    setAdding(true);
    try {
      await dncApi.add(number.trim(), name.trim());
      flash(`${number.trim()} added. The agent won't call it.`);
      setNumber(''); setName('');
      load();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (e: DncEntry) => {
    if (!window.confirm(`Remove ${e.name ? `${e.name} (${e.number})` : e.number} from the Do Not Call list?\n\nThe agent will be able to call this number again. Only do this if they have agreed to be contacted.`)) return;
    try { await dncApi.remove(e.number); flash(`${e.number} removed from the list.`); load(); } catch (err: any) { setError(err.message); }
  };

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const digits = q.replace(/\D/g, '');
    return (entries || []).filter((e) => {
      if (source === 'manual' && !isManual(e.source)) return false;
      if (source === 'calls' && isManual(e.source)) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || (e.said || '').toLowerCase().includes(q)
        || (digits.length >= 3 && e.number.replace(/\D/g, '').includes(digits));
    });
  }, [entries, query, source]);

  const stats = useMemo(() => {
    const all = entries || [];
    const week = Date.now() - 7 * 864e5;
    return {
      total: all.length,
      week: all.filter((e) => new Date(e.added_at).getTime() >= week).length,
      calls: all.filter((e) => !isManual(e.source)).length,
      manual: all.filter((e) => isManual(e.source)).length,
    };
  }, [entries]);

  const exportCsv = () => {
    const rows = [['Number', 'Name', 'Added', 'Source', 'What they said'],
      ...list.map((e) => [e.number, e.name, new Date(e.added_at).toLocaleString(), sourceLabel(e.source), e.said || ''])];
    const url = URL.createObjectURL(new Blob([rows.map((r) => r.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `do-not-call-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const field = 'bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-sm text-white placeholder-gray-500 focus:border-violet-500 outline-none';

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          ['Numbers on the list', stats.total, 'fa-ban', 'text-red-300', 'bg-red-500/15'],
          ['Added in the last 7 days', stats.week, 'fa-calendar-week', 'text-amber-300', 'bg-amber-500/15'],
          ['Asked during a call', stats.calls, 'fa-phone-slash', 'text-sky-300', 'bg-sky-500/15'],
          ['Added manually', stats.manual, 'fa-user-pen', 'text-violet-300', 'bg-violet-500/15'],
        ].map(([label, value, icon, color, bg]) => (
          <div key={label as string} className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center shrink-0`}>
              <i className={`fa-solid ${icon} ${color}`}></i>
            </div>
            <div className="min-w-0">
              <p className="text-2xl font-bold text-white leading-tight">{entries ? value : '—'}</p>
              <p className="text-xs text-gray-400 truncate">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* How it works + add */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/15 flex items-center justify-center shrink-0"><i className="fa-solid fa-shield-halved text-red-300"></i></div>
          <div>
            <h3 className="text-lg font-semibold text-white">Never call these numbers</h3>
            <p className="text-sm text-gray-400">
              When someone says "don't call me again" on a call, the agent ends the call and adds their number here automatically.
              Numbers on this list are never dialled: their job calls are stopped, new imports are rejected and the dial pad refuses them.
              Numbers match in any format (+44 7700 900123 and 07700 900123 are the same).
            </p>
          </div>
        </div>
        <div className="flex flex-col md:flex-row gap-2">
          <input value={number} onChange={(e) => setNumber(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Phone number, e.g. 07700 900123" className={`${field} md:w-64`} inputMode="tel" />
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }}
            placeholder="Name (optional)" className={`${field} flex-1`} maxLength={80} />
          <button onClick={add} disabled={!number.trim() || adding}
            className="px-5 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-40 whitespace-nowrap">
            <i className={`fa-solid ${adding ? 'fa-spinner fa-spin' : 'fa-plus'} mr-2`}></i>Add to the list
          </button>
        </div>
        {error && <p className="text-sm text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
        {notice && <p className="text-sm text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
      </div>

      {/* The list */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="p-4 border-b border-gray-800 flex flex-col md:flex-row md:items-center gap-3">
          <div className="relative flex-1">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search number, name or what they said"
              className={`${field} w-full pl-8 py-2`} />
          </div>
          <div className="flex rounded-lg border border-gray-700 overflow-hidden text-xs shrink-0">
            {([['all', 'All'], ['calls', 'From calls'], ['manual', 'Added manually']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setSource(v)}
                className={`px-3 py-2 ${source === v ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{label}</button>
            ))}
          </div>
          <button onClick={exportCsv} disabled={!list.length}
            className="px-3 py-2 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-gray-500 disabled:opacity-40 shrink-0">
            <i className="fa-solid fa-file-csv mr-1.5"></i>Export CSV
          </button>
        </div>

        {!entries && !error && <p className="text-sm text-gray-400 text-center py-12"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</p>}
        {entries && entries.length === 0 && (
          <div className="text-center py-14 px-6">
            <i className="fa-regular fa-face-smile text-3xl text-gray-600"></i>
            <p className="text-sm text-gray-300 mt-3">Nobody has asked not to be called</p>
            <p className="text-xs text-gray-500 mt-1">Numbers appear here when someone says "don't call me again", or when you add one above.</p>
          </div>
        )}
        {entries && entries.length > 0 && list.length === 0 && (
          <p className="text-sm text-gray-500 text-center py-10">No numbers match your search.</p>
        )}
        {list.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 border-b border-gray-800">
                <tr>
                  <th className="text-left font-medium px-4 py-3">Number</th>
                  <th className="text-left font-medium px-4 py-3">Name</th>
                  <th className="text-left font-medium px-4 py-3">Added</th>
                  <th className="text-left font-medium px-4 py-3">Source</th>
                  <th className="text-left font-medium px-4 py-3">What they said</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {list.map((e) => (
                  <tr key={e.number} className="hover:bg-gray-800/30">
                    <td className="px-4 py-3 text-white font-medium whitespace-nowrap">
                      <i className="fa-solid fa-ban text-red-400/80 text-xs mr-2"></i>{e.number}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{e.name || <span className="text-gray-600">—</span>}</td>
                    <td className="px-4 py-3 text-gray-400 whitespace-nowrap" title={new Date(e.added_at).toLocaleString()}>
                      {new Date(e.added_at).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${isManual(e.source) ? 'bg-violet-500/15 text-violet-300' : 'bg-sky-500/15 text-sky-300'}`}>
                        {sourceLabel(e.source)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 max-w-xs">
                      {e.said ? <span className="italic line-clamp-2" title={e.said}>"{e.said}"</span> : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button onClick={() => remove(e)} title="Remove from the list (the agent may call again)"
                        className="px-2.5 py-1.5 rounded-lg text-xs text-gray-400 hover:text-red-300 hover:bg-red-500/10">
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
            Showing {list.length} of {entries?.length} {entries?.length === 1 ? 'number' : 'numbers'}
          </p>
        )}
      </div>
    </div>
  );
}
