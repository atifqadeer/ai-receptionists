import { useEffect, useRef, useState } from 'react';
import { outboundApi, CallsResponse, OutboundCall, CallNote } from '../utils/outboundApi';
import { STATUS_STYLE, OUTCOME_STYLE, statusLabel, outcomeLabel } from '../utils/callStatus';

// Job Calls: applicants from your CRM (webhook or API fetch, set up in
// Settings > Calling > Webhooks) or a CSV are called by the AI agent
// about a matching job. Calls run through the VoIP provider set in
// Settings > Calling.

export default function OutboundCalls() {
  const [data, setData] = useState<CallsResponse | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [transcriptOf, setTranscriptOf] = useState<OutboundCall | null>(null);
  const [previewOf, setPreviewOf] = useState<OutboundCall | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    outboundApi.list().then((d) => { setData(d); setError(''); })
      .catch(() => setError('Could not reach the backend at http://localhost:8000. Start it with start-app.bat.'));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

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
      const parts = [`${r.added} applicant${r.added === 1 ? '' : 's'} added`];
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
            {data.within_calling_hours ? 'Within calling hours: queued applicants are being called.' : 'Outside calling hours: calls wait until the next calling window.'}
          </span>
        )}
        <span className="text-xs text-gray-500">Change these in Settings › Calling.</span>
        <button onClick={() => act(outboundApi.dialAll, 'Calling all queued applicants.')} disabled={!queued || !data.configured}
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
        {/* Where applicants come from */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4 flex flex-col">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-link text-violet-400"></i>From your CRM
          </h3>
          <p className="text-sm text-gray-400">
            Applicants your CRM sends to the webhook, or that the agent fetches from your CRM's API, are queued here automatically.
          </p>
          <ul className="text-sm text-gray-300 space-y-2.5">
            <li className="flex gap-2">
              <i className="fa-solid fa-link text-violet-400 mt-1 text-xs w-4"></i>
              <span>Receive applicants by webhook, and send call results back<span className="block text-xs text-gray-500">Settings › Calling › Webhooks</span></span>
            </li>
            <li className="flex gap-2">
              <i className="fa-solid fa-cloud-arrow-down text-violet-400 mt-1 text-xs w-4"></i>
              <span>Fetch applicants from your CRM's API<span className="block text-xs text-gray-500">Settings › Calling › Webhooks</span></span>
            </li>
          </ul>
        </div>

        {/* CSV */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <i className="fa-solid fa-file-csv text-violet-400"></i>Upload Applicants (CSV)
          </h3>
          <p className="text-sm text-gray-400">One row per applicant with the job to offer them: name, phone, job title, salary, benefits, qualifications, experience and more.</p>
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
        <div className="px-6 py-4 border-b border-gray-800 flex items-center gap-2">
          <h3 className="text-lg font-semibold text-white">Applicants & Calls</h3>
          <span className="text-xs text-gray-500">({data.calls.length})</span>
        </div>
        {data.calls.length === 0 ? (
          <div className="p-10 text-center text-gray-500 text-sm">No applicants yet. Upload a CSV or send one from your CRM webhook.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-400 uppercase bg-gray-800/40">
                <tr>
                  <th className="text-left px-4 py-3">Applicant</th>
                  <th className="text-left px-4 py-3">Job</th>
                  <th className="text-left px-4 py-3">Status</th>
                  <th className="text-left px-4 py-3">Outcome</th>
                  <th className="text-left px-4 py-3">Attempts</th>
                  <th className="text-right px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {data.calls.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-800/30">
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
                        <button onClick={() => window.confirm('Delete this applicant and call record?') && act(() => outboundApi.remove(c.id))}
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
        )}
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

// What the applicant said during the call, one note per response.
function CallNotes({ notes }: { notes: CallNote[] }) {
  if (notes.length === 0) {
    return <div className="px-5 pt-5 text-sm text-gray-500">No notes yet: the applicant hasn't said anything on this call.</div>;
  }
  return (
    <div className="p-5 space-y-2">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Applicant's responses</div>
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
              {t.role === 'agent' ? 'AI agent' : 'Applicant'}
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
          Reply as the applicant (e.g. "what's the salary?", "yes I'm interested", "call me later").
          {outcome && <span className={`ml-auto px-2 py-0.5 rounded-full ${OUTCOME_STYLE[outcome] || OUTCOME_STYLE.unknown}`}>{outcomeLabel(outcome)}</span>}
        </div>
        {ended ? (
          <button onClick={start} className="w-full py-2 rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 text-sm">Call ended. Start again</button>
        ) : (
          <div className="flex gap-2">
            <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
              placeholder="Type the applicant's reply…" autoFocus
              className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-2 text-sm text-white focus:border-violet-500 outline-none" />
            <button onClick={send} className="px-4 rounded-lg bg-violet-600 text-white text-sm"><i className="fa-solid fa-paper-plane"></i></button>
          </div>
        )}
      </div>
    </Modal>
  );
}
