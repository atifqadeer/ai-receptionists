import { useEffect, useMemo, useRef, useState } from 'react';
import { outboundApi, CallsResponse, OutboundCall, CallNote, CrmStatus } from '../utils/outboundApi';
import { STATUS_STYLE, OUTCOME_STYLE, statusLabel, outcomeLabel } from '../utils/callStatus';

// Job Calls: contacts from your CRM (fetched from its API, set up in
// Settings > Webhooks) or a CSV are called by the AI agent
// about a matching job. Calls run through the VoIP provider set in
// Settings > Calling.

// Which import a row came from: its batch tag, or (rows imported before
// batches existed) its source and the minute it was added.
const batchOf = (c: OutboundCall) => c.batch || `${c.source}|${(c.created_at || '').slice(0, 16)}`;
const PAGE = 100;
const LIVE = ['dialing', 'ringing', 'in_progress'];

export default function OutboundCalls() {
  const [data, setData] = useState<CallsResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [transcriptOf, setTranscriptOf] = useState<OutboundCall | null>(null);
  const [previewOf, setPreviewOf] = useState<OutboundCall | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [crm, setCrm] = useState<CrmStatus | null>(null);
  const [pulling, setPulling] = useState(false);
  const [showSkipped, setShowSkipped] = useState(false);   // who the last refresh did not queue
  const [fresh, setFresh] = useState<Set<string>>(new Set());   // rows the last Refresh data added
  const loadCrm = () => outboundApi.crmStatus().then(setCrm).catch(() => {});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [show, setShow] = useState('all');          // 'all', 'last' or a batch key
  const [page, setPage] = useState(0);
  const [removing, setRemoving] = useState(false);

  // Imports (fetches / CSV uploads), newest first, with their row counts.
  const batches = useMemo(() => {
    const m = new Map<string, { key: string; source: string; at: string; count: number }>();
    for (const c of data?.calls || []) {
      const k = batchOf(c);
      const b = m.get(k) || { key: k, source: c.source, at: c.created_at, count: 0 };
      b.count += 1;
      if (c.created_at < b.at) b.at = c.created_at;
      m.set(k, b);
    }
    return [...m.values()].sort((a, b) => (a.at < b.at ? 1 : -1));
  }, [data]);
  const lastFetch = batches.find((b) => b.source === 'crm');
  // A chosen import that no longer exists (its rows were removed) falls back to all.
  const view = show === 'all' || (show === 'last' ? lastFetch : batches.some((b) => b.key === show)) ? show : 'all';
  const shown = useMemo(() => {
    const calls = data?.calls || [];
    if (view === 'all') return calls;
    const key = view === 'last' ? lastFetch?.key : view;
    return calls.filter((c) => batchOf(c) === key);
  }, [data, view, lastFetch]);
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const pageRows = shown.slice(page * PAGE, page * PAGE + PAGE);
  const selectable = shown.filter((c) => !LIVE.includes(c.status));
  const allSelected = selectable.length > 0 && selectable.every((c) => selected.has(c.id));

  // Drop selections whose rows are gone (removed elsewhere, or filtered out of the list).
  useEffect(() => {
    const ids = new Set((data?.calls || []).map((c) => c.id));
    setSelected((cur) => (([...cur].every((id) => ids.has(id))) ? cur : new Set([...cur].filter((id) => ids.has(id)))));
  }, [data]);
  useEffect(() => { setPage(0); }, [show]);

  const toggle = (id: string) => setSelected((cur) => {
    const next = new Set(cur);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectable.map((c) => c.id)));

  const removeSelected = async () => {
    const n = selected.size;
    if (!n || !window.confirm(`Remove ${n} selected contact${n === 1 ? '' : 's'} and their call records? This cannot be undone.`)) return;
    setRemoving(true);
    setNotice(null);
    try {
      const r = await outboundApi.removeMany([...selected]);
      setSelected(new Set());
      setNotice({ ok: true, text: `${r.removed} contact${r.removed === 1 ? '' : 's'} removed`
        + `${r.kept_in_progress ? `; ${r.kept_in_progress} kept because the call is in progress` : ''}.` });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setRemoving(false);
      refresh();
    }
  };

  const refresh = () =>
    outboundApi.list().then((d) => { setData(d); setError(''); })
      .catch(() => setError('Could not reach the backend at http://localhost:8000. Start it with start-app.bat.'));

  useEffect(() => {
    refresh();
    loadCrm();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  // Refresh data: fetch contacts from the CRM now, then reload the list.
  const refreshData = async () => {
    setPulling(true);
    setNotice(null);
    try {
      const r = await outboundApi.crmPull();
      await refresh();
      const added = r.ids || [];
      setFresh(new Set(added));
      if (added.length) { setShow('last'); setTimeout(() => setFresh(new Set()), 8000); }
      setNotice({ ok: true, text: r.added
        ? `Data refreshed: ${r.added} new contact${r.added === 1 ? '' : 's'} added to the list (highlighted)`
          + `${r.already_imported ? `, ${r.already_imported} already here` : ''}${r.already_called ? `, ${r.already_called} already called (not queued again)` : ''}`
          + `${r.rejected?.length ? `, ${r.rejected.length} rejected` : ''}.`
        : `Data refreshed: no new contacts (${r.fetched} fetched, ${r.already_imported} already here`
          + `${r.already_called ? `, ${r.already_called} already called` : ''}).` });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message || 'Could not fetch from your CRM.' });
      refresh();
    } finally {
      setPulling(false);
      loadCrm();
    }
  };

  const act = async (fn: () => Promise<any>, ok?: string) => {
    setNotice(null);
    try {
      await fn();
      if (ok) setNotice({ ok: true, text: ok });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    }
    refresh();
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setNotice(null);
    try {
      const r = await outboundApi.uploadCsv(file);
      const parts = [`${r.added} contact${r.added === 1 ? '' : 's'} added`];
      if (r.skipped.length) parts.push(`${r.skipped.length} already queued`);
      if (r.rejected.length) parts.push(`${r.rejected.length} rejected (${r.rejected.slice(0, 3).map((x) => `row ${x.row}: ${x.reason}`).join('; ')})`);
      setNotice({ ok: r.rejected.length === 0, text: parts.join(', ') + '.' });
    } catch (e: any) {
      setNotice({ ok: false, text: e.message });
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      refresh();
    }
  };

  if (error && !data) {
    return <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 text-sm px-4 py-3 rounded-lg">{error}</div>;
  }
  if (!data) return <div className="text-gray-400 text-sm"><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</div>;

  const counts = data.calls.reduce<Record<string, number>>((acc, c) => {
    acc[c.status] = (acc[c.status] || 0) + 1;
    if (c.outcome === 'interested') acc.interested = (acc.interested || 0) + 1;
    return acc;
  }, {});
  const queued = counts.queued || 0;

  return (
    <div className="space-y-6">
      {/* Status bar */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex flex-wrap items-center gap-3">
        <span className={`text-xs px-2.5 py-1 rounded-full ${data.configured ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}`}>
          <i className={`fa-solid ${data.configured ? 'fa-circle-check' : 'fa-triangle-exclamation'} mr-1.5`}></i>
          {data.configured ? 'VoIP ready' : `VoIP not set up: ${data.missing.join(', ')}`}
        </span>
        <span className="text-xs px-2.5 py-1 rounded-full bg-violet-500/15 text-violet-300">
          <i className="fa-solid fa-gears mr-1.5"></i>
          {data.call_mode === 'auto' ? 'Automatic calling' : 'Manual calling'}
        </span>
        {data.call_mode === 'auto' && data.configured && (
          <span className="text-xs text-gray-400">
            {data.within_calling_hours ? 'Within calling hours: queued contacts are being called.' : 'Outside calling hours: calls wait until the next calling window.'}
          </span>
        )}
        <span className="text-xs text-gray-500">Change these in Settings › Calling.</span>
        <button onClick={() => act(outboundApi.dialAll, 'Calling all queued contacts.')} disabled={!queued || !data.configured}
          className="ml-auto px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-40 flex items-center gap-2">
          <i className="fa-solid fa-phone"></i>Call all queued ({queued})
        </button>
      </div>

      {notice && (
        <div className={`text-sm px-4 py-3 rounded-lg border ${notice.ok ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-red-500/10 border-red-500/30 text-red-300'}`}>
          {notice.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Where contacts come from */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4 flex flex-col">
          <div className="flex items-start gap-3">
            <h3 className="text-lg font-semibold text-white flex items-center gap-2 flex-1">
              <i className="fa-solid fa-link text-violet-400"></i>From your CRM
            </h3>
            <button onClick={refreshData} disabled={pulling}
              className="px-4 py-2 rounded-lg bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 disabled:opacity-40 flex items-center gap-2 shrink-0">
              <i className={`fa-solid fa-rotate ${pulling ? 'fa-spin' : ''}`}></i>{pulling ? 'Refreshing…' : 'Refresh data'}
            </button>
          </div>
          <p className="text-sm text-gray-400">
            Contacts are fetched from your CRM's API and queued here; the status of each finished call is sent back to it. Anyone the agent has already called is not queued again (Settings › GuardRails).
            Refresh data fetches the latest now.
          </p>
          <div className="text-xs rounded-lg bg-gray-800/40 border border-gray-700/60 px-3 py-2.5">
            {!crm?.last ? <span className="text-gray-500">Not fetched yet.</span> : crm.last.error ? (
              <span className="text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>Last refresh {new Date(crm.last.at).toLocaleString()} failed: {crm.last.error}</span>
            ) : (
              <span className="text-gray-300">
                <i className="fa-solid fa-circle-check text-emerald-400 mr-1.5"></i>Last refresh {new Date(crm.last.at).toLocaleString()}:{' '}
                {crm.last.fetched} fetched, {crm.last.added} new, {crm.last.already_imported} already here
                {crm.last.already_called ? `, ${crm.last.already_called} already called` : ''}
                {crm.last.rejected?.length ? `, ${crm.last.rejected.length} rejected` : ''}
                {(crm.last.skipped?.length || crm.last.rejected?.length) ? (
                  <button onClick={() => setShowSkipped((v) => !v)} className="ml-2 text-violet-300 hover:text-violet-200 underline underline-offset-2">
                    {showSkipped ? 'Hide' : 'Show who'}
                  </button>
                ) : null}
              </span>
            )}
            {showSkipped && crm?.last && !crm.last.error && (
              <ul className="mt-2.5 pt-2.5 border-t border-gray-700/60 space-y-1.5">
                {[...(crm.last.skipped || []), ...(crm.last.rejected || []).map((x) => ({ ...x, reason: `rejected: ${x.reason}` }))]
                  .map((s: any, i) => (
                  <li key={i} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span className="text-gray-200 font-medium">{s.name || 'No name'}</span>
                    {s.applicant_id && <span className="text-gray-500">#{s.applicant_id}</span>}
                    {s.job_title && <span className="text-gray-400">{s.job_title}{s.job_id ? ` (job ${s.job_id})` : ''}</span>}
                    {s.phone && <span className="text-gray-500">{s.phone}</span>}
                    <span className={`ml-auto px-2 py-0.5 rounded-full ${s.reason === 'already called' ? 'bg-amber-500/15 text-amber-300'
                      : s.reason === 'already here' ? 'bg-sky-500/15 text-sky-300' : 'bg-red-500/15 text-red-300'}`}>
                      {s.reason === 'already called' && s.at ? `called ${new Date(s.at).toLocaleString()}` : s.reason}
                    </span>
                  </li>
                ))}
                {!crm.last.skipped && (
                  <li className="text-gray-500">This refresh was before names were saved: press Refresh data to see who.</li>
                )}
              </ul>
            )}
          </div>
          <ul className="text-sm text-gray-300 space-y-2.5">
            <li className="flex gap-2">
              <i className="fa-solid fa-cloud-arrow-down text-violet-400 mt-1 text-xs w-4"></i>
              <span>Fetch URL, API key and automatic refresh<span className="block text-xs text-gray-500">Settings › Webhooks</span></span>
            </li>
            <li className="flex gap-2">
              <i className="fa-solid fa-paper-plane text-violet-400 mt-1 text-xs w-4"></i>
              <span>
                Call statuses sent back: {crm?.results.sent ?? 0} accepted
                {crm?.results.unsent ? <span className="text-amber-300">, {crm.results.unsent} waiting to resend</span> : ''}
                <span className="block text-xs text-gray-500">Settings › Webhooks</span>
              </span>
            </li>
          </ul>
        </div>

        {/* CSV */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-file-csv text-violet-400"></i>Upload Contacts (CSV)
          </h3>
          <p className="text-sm text-gray-400">One row per contact with the job to offer them: name, phone, job title, salary, benefits, qualifications, experience and more.</p>
          <a href={outboundApi.templateUrl} className="inline-flex items-center gap-2 text-sm text-violet-300 hover:text-violet-200">
            <i className="fa-solid fa-download"></i>Download the CSV template
          </a>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={(e) => onUpload(e.target.files?.[0])} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="w-full border-2 border-dashed border-gray-700 hover:border-violet-500 rounded-xl py-8 text-gray-400 hover:text-violet-300 transition-all disabled:opacity-50">
            <i className={`fa-solid ${uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'} text-2xl mb-2 block`}></i>
            {uploading ? 'Uploading…' : 'Choose a .csv file'}
          </button>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[['Queued', counts.queued || 0], ['Completed', counts.completed || 0], ['Interested', counts.interested || 0]].map(([k, v]) => (
              <div key={k} className="bg-gray-800/60 rounded-lg py-2">
                <div className="text-lg font-semibold text-white">{v}</div>
                <div className="text-xs text-gray-400">{k}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Calls */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-3 flex-wrap">
          <h3 className="text-lg font-semibold text-white">Contacts & Calls</h3>
          <span className="text-xs text-gray-500">({shown.length}{view !== 'all' ? ` of ${data.calls.length}` : ''})</span>
          <select value={view} onChange={(e) => setShow(e.target.value || 'all')}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-200 max-w-[280px]">
            <option value="all">All contacts</option>
            {lastFetch && <option value="last">Last fetch from CRM ({lastFetch.count}, {new Date(lastFetch.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })})</option>}
            {batches.map((b) => (
              <option key={b.key} value={b.key}>
                {b.source === 'crm' ? 'CRM fetch' : b.source.startsWith('csv') ? 'CSV upload' : b.source} · {new Date(b.at).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} ({b.count})
              </option>
            ))}
          </select>
          <div className="ml-auto flex items-center gap-2">
            {selected.size > 0 && (
              <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-200">Clear selection</button>
            )}
            <button onClick={removeSelected} disabled={!selected.size || removing}
              className="px-3 py-1.5 rounded-lg border border-red-500/40 text-red-300 text-xs hover:bg-red-500/10 disabled:opacity-40 flex items-center gap-1.5">
              <i className={`fa-solid ${removing ? 'fa-spinner fa-spin' : 'fa-trash'}`}></i>Remove selected ({selected.size})
            </button>
          </div>
        </div>
        {shown.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">No contacts yet. Click Refresh data to fetch them from your CRM, or upload a CSV.</div>
        ) : (<>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 uppercase bg-gray-800/40">
                <tr>
                  <th className="pl-4 py-3 w-8">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={!selectable.length}
                      title={allSelected ? 'Unselect all' : `Select all ${selectable.length}${view === 'all' ? '' : ' in this view'}`}
                      className="w-4 h-4 accent-violet-500 cursor-pointer" aria-label="Select all" />
                  </th>
                  <th className="text-left px-4 py-3">Contact</th>
                  <th className="text-left px-4 py-3">Job</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Outcome</th>
                  <th className="text-left px-4 py-3">Attempts</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pageRows.map((c) => (
                  <tr key={c.id} className={`transition-colors duration-700 ${fresh.has(c.id) ? 'bg-violet-500/15' : selected.has(c.id) ? 'bg-violet-500/5' : 'hover:bg-gray-800/30'}`}>
                    <td className="pl-4 py-3">
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggle(c.id)} disabled={LIVE.includes(c.status)}
                        title={LIVE.includes(c.status) ? 'Call in progress' : 'Select'} className="w-4 h-4 accent-violet-500 cursor-pointer disabled:opacity-30"
                        aria-label={`Select ${c.applicant.first_name || c.applicant.phone}`} />
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-white">{`${c.applicant.first_name || ''} ${c.applicant.last_name || ''}`.trim() || '—'}</div>
                      <div className="text-xs text-gray-400">{c.applicant.phone}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-200">{c.job.job_title}</div>
                      <div className="text-xs text-gray-400">{[c.job.employer, c.job.location, c.job.salary].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_STYLE[c.status] || STATUS_STYLE.queued}`}>{statusLabel(c.status)}</span>
                      {c.next_attempt_at && c.status === 'queued' && (
                        <div className="text-xs text-gray-500 mt-1">retry {new Date(c.next_attempt_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                      )}
                      {c.status === 'callback' && c.callback_when && (
                        <div className="text-xs text-sky-300/80 mt-1"><i className="fa-regular fa-clock mr-1"></i>asked: {c.callback_when}</div>
                      )}
                      {c.error && <div className="text-xs text-red-300 mt-1 max-w-xs truncate" title={c.error}>{c.error}</div>}
                    </td>
                    <td className="px-4 py-3">
                      {c.outcome ? <span className={`text-xs px-2 py-0.5 rounded-full ${OUTCOME_STYLE[c.outcome] || OUTCOME_STYLE.unknown}`}>{outcomeLabel(c.outcome)}</span> : <span className="text-gray-600">—</span>}
                      {c.send_details && <div className="text-xs text-gray-400 mt-1"><i className="fa-regular fa-envelope mr-1"></i>send details</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-300">{c.attempts}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1.5">
                        {['queued', 'no_answer', 'busy', 'failed'].includes(c.status) && (
                          <button onClick={() => act(() => outboundApi.dial(c.id), `Calling ${c.applicant.first_name || c.applicant.phone}…`)} disabled={!data.configured}
                            className="px-2.5 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-600 text-white text-xs disabled:opacity-40" title={data.configured ? 'Call now' : 'Set up VoIP first'}>
                            <i className="fa-solid fa-phone mr-1"></i>Call
                          </button>
                        )}
                        <button onClick={() => setPreviewOf(c)} className="px-2.5 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs" title="Rehearse this call as a text chat">
                          <i className="fa-solid fa-comments mr-1"></i>Test script
                        </button>
                        {(c.transcript.length > 0 || (c.notes?.length ?? 0) > 0) && (
                          <button onClick={() => setTranscriptOf(c)} className="px-2.5 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-xs">
                            <i className="fa-solid fa-file-lines mr-1"></i>Notes &amp; transcript
                            {(c.notes?.length ?? 0) > 0 && <span className="ml-1 text-violet-300">({c.notes!.length})</span>}
                          </button>
                        )}
                        {c.status === 'queued' && (
                          <button onClick={() => act(() => outboundApi.cancel(c.id))} className="px-2 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-gray-800 text-xs" title="Cancel">
                            <i className="fa-solid fa-ban"></i>
                          </button>
                        )}
                        <button onClick={() => window.confirm('Delete this contact and call record?') && act(() => outboundApi.remove(c.id))}
                          className="px-2 py-1.5 rounded-lg border border-gray-700 text-gray-400 hover:bg-red-500/10 hover:text-red-300 text-xs" title="Delete">
                          <i className="fa-solid fa-trash"></i>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="px-6 py-3 border-t border-gray-800 flex items-center gap-3 text-xs text-gray-400">
              <span>{page * PAGE + 1}–{Math.min(shown.length, page * PAGE + PAGE)} of {shown.length}</span>
              <div className="ml-auto flex items-center gap-1">
                <button onClick={() => setPage(0)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30" aria-label="First page"><i className="fa-solid fa-angles-left"></i></button>
                <button onClick={() => setPage(page - 1)} disabled={page === 0} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30" aria-label="Previous page"><i className="fa-solid fa-angle-left"></i></button>
                <span className="px-2">Page {page + 1} of {pages}</span>
                <button onClick={() => setPage(page + 1)} disabled={page >= pages - 1} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30" aria-label="Next page"><i className="fa-solid fa-angle-right"></i></button>
                <button onClick={() => setPage(pages - 1)} disabled={page >= pages - 1} className="px-2 py-1 rounded border border-gray-700 disabled:opacity-30" aria-label="Last page"><i className="fa-solid fa-angles-right"></i></button>
              </div>
            </div>
          )}
        </>)}
      </div>

      {transcriptOf && (
        <Modal title={`Call notes: ${transcriptOf.applicant.first_name || transcriptOf.applicant.phone}`} onClose={() => setTranscriptOf(null)}>
          <div className="overflow-y-auto">
            <CallNotes notes={transcriptOf.notes || []} />
            {transcriptOf.transcript.length > 0 && (
              <>
                <div className="px-5 pt-4 text-xs uppercase tracking-wide text-gray-500">Full transcript</div>
                <Bubbles lines={transcriptOf.transcript} />
              </>
            )}
          </div>
        </Modal>
      )}
      {previewOf && <ScriptPreview call={previewOf} onClose={() => setPreviewOf(null)} />}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-gray-800 flex items-center">
          <h3 className="text-white font-semibold">{title}</h3>
          <button onClick={onClose} className="ml-auto text-gray-400 hover:text-white"><i className="fa-solid fa-xmark"></i></button>
        </div>
        {children}
      </div>
    </div>
  );
}

const NOTE_KIND: Record<CallNote['kind'], { label: string; style: string }> = {
  question: { label: 'Question answered', style: 'bg-sky-500/15 text-sky-300' },
  unanswered: { label: 'For the recruiter', style: 'bg-amber-500/15 text-amber-300' },
  off_topic: { label: 'Off-topic, declined', style: 'bg-gray-500/20 text-gray-300' },
  decision: { label: 'Decision', style: 'bg-emerald-500/15 text-emerald-300' },
  response: { label: 'Response', style: 'bg-violet-500/15 text-violet-300' },
  silence: { label: 'Response', style: 'bg-violet-500/15 text-violet-300' },
  unclear: { label: 'Unclear, asked to repeat', style: 'bg-orange-500/15 text-orange-300' },
};

// What the contact said during the call, one note per response.
function CallNotes({ notes }: { notes: CallNote[] }) {
  if (notes.length === 0) {
    return <div className="px-5 pt-5 text-sm text-gray-500">No notes yet: the contact hasn't said anything on this call.</div>;
  }
  return (
    <div className="p-5 space-y-2">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Contact's responses</div>
      {notes.map((n, i) => {
        const kind = NOTE_KIND[n.kind] || NOTE_KIND.response;
        return (
          <div key={i} className="rounded-lg border border-gray-800 bg-gray-950/50 px-3 py-2">
            <div className="flex flex-wrap items-center gap-1.5 mb-1">
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${kind.style}`}>{kind.label}</span>
              {n.interrupted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-300">Interrupted the agent</span>}
              <span className="ml-auto text-[10px] text-gray-500">{new Date(n.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
            <div className="text-sm text-white">"{n.applicant}"</div>
            <div className="text-xs text-gray-400 mt-0.5"><span className="text-gray-500">Agent replied:</span> {n.agent}</div>
          </div>
        );
      })}
    </div>
  );
}

function Bubbles({ lines }: { lines: Array<{ role: string; text: string; interrupted?: boolean }> }) {
  return (
    <div className="p-5 space-y-3 overflow-y-auto">
      {lines.map((t, i) => (
        <div key={i} className={`flex ${t.role === 'agent' ? 'justify-start' : 'justify-end'}`}>
          <div className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm ${t.role === 'agent' ? 'bg-gray-800 text-gray-200' : 'bg-violet-600/80 text-white'}`}>
            <div className="text-[10px] uppercase tracking-wide opacity-60 mb-0.5">
              {t.role === 'agent' ? 'AI agent' : 'Contact'}
              {t.interrupted && (t.role === 'agent' ? ' · cut off' : ' · interrupted')}
            </div>
            {t.text}
          </div>
        </div>
      ))}
    </div>
  );
}

// Rehearse a call as text: the same script and answers as the phone call,
// without dialling.
function ScriptPreview({ call, onClose }: { call: OutboundCall; onClose: () => void }) {
  const [lines, setLines] = useState<Array<{ role: string; text: string }>>([]);
  const [input, setInput] = useState('');
  const [ended, setEnded] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  const start = () => {
    setEnded(false);
    setOutcome(null);
    outboundApi.preview(call.id, { reset: true }).then((r) => setLines([{ role: 'agent', text: r.reply }]));
  };
  useEffect(start, [call.id]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || ended) return;
    setInput('');
    setLines((l) => [...l, { role: 'applicant', text: msg }]);
    const r = await outboundApi.preview(call.id, { message: msg });
    setLines((l) => [...l, { role: 'agent', text: r.reply }]);
    setEnded(r.ended);
    setOutcome(r.outcome);
  };

  return (
    <Modal title={`Test script: ${call.job.job_title} for ${call.applicant.first_name || call.applicant.phone}`} onClose={onClose}>
      <Bubbles lines={lines} />
      <div className="px-5 py-3 border-t border-gray-800 space-y-2">
        <div className="text-xs text-gray-400 flex items-center gap-2">
          Reply as the contact (e.g. "what's the salary?", "yes I'm interested", "call me later").
          {outcome && <span className={`ml-auto px-2 py-0.5 rounded-full ${OUTCOME_STYLE[outcome] || OUTCOME_STYLE.unknown}`}>{outcomeLabel(outcome)}</span>}
        </div>
        {ended ? (
          <button onClick={start} className="w-full py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm">Call ended. Start again</button>
        ) : (
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type the contact's reply…" autoFocus
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:border-violet-500 outline-none" />
            <button onClick={send} className="px-4 rounded-lg bg-violet-600 text-white text-sm"><i className="fa-solid fa-paper-plane"></i></button>
          </div>
        )}
      </div>
    </Modal>
  );
}
