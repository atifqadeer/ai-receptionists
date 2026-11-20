import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { widgetApi, WidgetSettings, WidgetVisitor, WidgetConversation } from '../utils/widgetApi';
import CallSimulator from './CallSimulator';

// Chat: everything about text chat in one place.
// - Conversations: the website chat widget's visitors, listed by email. The
//   AI agent answers live; a person can read along, reply and take over.
// - Test chat: chat with the agent yourself, exactly as a visitor would
//   (saved to its own history).
// - Widget setup: the script tag for your website, wording and appearance.

const POLL_LIST = 2500;
const POLL_OPEN = 1500;          // fast enough to show "typing…" as it happens
const TYPING_PING = 1500;        // how often "still typing" is sent to the visitor

const ago = (iso?: string) => {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
};
const when = (iso: string) => new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const host = (url: string) => { try { return new URL(url).host; } catch { return url; } };
const path = (url: string) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const ENDED_BY: Record<string, string> = {
  visitor: 'ended by the visitor', goodbye: 'visitor said goodbye', team: 'closed by you', inactive: 'closed after 30 min of inactivity',
};
const letter = (v: WidgetVisitor | null, email = '') => ((v?.name || v?.email || email || '?').trim().charAt(0) || '?').toUpperCase();

export default function WebsiteChat() {
  const [tab, setTab] = useState<'conversations' | 'test' | 'setup'>(() => {
    try { return (localStorage.getItem('chat-tab') as any) || 'conversations'; } catch { return 'conversations'; }
  });
  useEffect(() => { try { localStorage.setItem('chat-tab', tab); } catch { /* blocked */ } }, [tab]);
  const [unreadTotal, setUnreadTotal] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-1 border-b border-gray-800">
        {([['conversations', 'Website conversations', 'fa-comments'], ['test', 'Test chat', 'fa-flask'], ['setup', 'Widget setup', 'fa-code']] as const).map(([id, label, icon]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-all ${
              tab === id ? 'border-violet-500 text-violet-300' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            <i className={`fa-solid ${icon} text-xs`}></i>{label}
            {id === 'conversations' && unreadTotal > 0 && (
              <span className="text-[11px] px-1.5 rounded-full bg-red-500 text-white">{unreadTotal}</span>
            )}
          </button>
        ))}
      </div>
      {tab === 'conversations' && <Conversations onUnread={setUnreadTotal} onSetup={() => setTab('setup')} />}
      {tab === 'test' && <CallSimulator />}
      {tab === 'setup' && <Setup />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Conversations({ onUnread, onSetup }: { onUnread: (n: number) => void; onSetup: () => void }) {
  const [visitors, setVisitors] = useState<WidgetVisitor[] | null>(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [selected, setSelected] = useState<string>('');
  const [convs, setConvs] = useState<WidgetConversation[]>([]);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [showPages, setShowPages] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const lastCount = useRef(0);

  const loadVisitors = useCallback(() => widgetApi.visitors()
    .then((r) => { setVisitors(r.visitors); setError(''); onUnread(r.visitors.reduce((a, v) => a + v.unread, 0)); })
    .catch((e) => setError(e.message)), [onUnread]);

  const loadConvs = useCallback(async (email: string, markRead = true) => {
    try {
      const r = await widgetApi.conversations(email);
      setConvs(r.conversations);
      if (markRead) {
        const unread = r.conversations.filter((c) => c.unread > 0);
        if (unread.length) {
          await Promise.all(unread.map((c) => widgetApi.update(c.id, { read: true })));
          loadVisitors();
        }
      }
    } catch (e: any) {
      setError(e.message);
    }
  }, [loadVisitors]);

  useEffect(() => {
    loadVisitors();
    const t = setInterval(loadVisitors, POLL_LIST);
    return () => clearInterval(t);
  }, [loadVisitors]);

  useEffect(() => {
    if (!selected) return;
    loadConvs(selected);
    const t = setInterval(() => loadConvs(selected), POLL_OPEN);
    return () => clearInterval(t);
  }, [selected, loadConvs]);

  const messageCount = convs.reduce((a, c) => a + c.messages.length, 0);
  useEffect(() => {
    if (messageCount !== lastCount.current) endRef.current?.scrollIntoView({ behavior: 'smooth' });
    lastCount.current = messageCount;
  }, [messageCount]);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (visitors || []).filter((v) => (!q || `${v.email} ${v.name} ${v.last_message?.text || ''}`.toLowerCase().includes(q))
      && (statusFilter === 'all' || (statusFilter === 'open' ? v.open_chats > 0 : v.open_chats === 0)));
  }, [visitors, search, statusFilter]);

  const visitor = visitors?.find((v) => v.email === selected) || null;
  const latest = convs[convs.length - 1];

  const lastPing = useRef(0);
  const signalTyping = (on: boolean) => {
    if (!latest || latest.status !== 'open') return;
    const now = Date.now();
    if (on && now - lastPing.current < TYPING_PING) return;
    if (!on && !lastPing.current) return;
    lastPing.current = on ? now : 0;
    widgetApi.typing(latest.id, on).catch(() => { /* best-effort */ });
  };

  const sendReply = async () => {
    lastPing.current = 0;
    const text = reply.trim();
    if (!text || !latest) return;
    setBusy(true);
    try {
      await widgetApi.reply(latest.id, text);
      setReply('');
      await loadConvs(selected, false);
      loadVisitors();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleAi = async () => {
    if (!latest) return;
    await widgetApi.update(latest.id, { ai_enabled: !latest.ai_enabled }).catch((e) => setError(e.message));
    loadConvs(selected, false);
    loadVisitors();
  };

  const closeChat = async () => {
    if (!latest || !window.confirm('Close this chat? The visitor sees that the chat has ended and can start a new one.')) return;
    await widgetApi.update(latest.id, { status: 'closed' }).catch((e) => setError(e.message));
    loadConvs(selected, false);
    loadVisitors();
  };

  const reopenChat = async () => {
    if (!latest) return;
    await widgetApi.update(latest.id, { status: 'open' }).catch((e) => setError(e.message));
    loadConvs(selected, false);
    loadVisitors();
  };

  const removeVisitor = async () => {
    if (!visitor || !window.confirm(`Delete all ${visitor.conversations} conversation(s) with ${visitor.email}? This cannot be undone.`)) return;
    await widgetApi.removeVisitor(visitor.email).catch((e) => setError(e.message));
    setSelected('');
    setConvs([]);
    loadVisitors();
  };

  const exportTranscript = () => {
    if (!visitor) return;
    const lines = [`Website chat with ${visitor.name ? `${visitor.name} <${visitor.email}>` : visitor.email}`, ''];
    convs.forEach((c) => {
      lines.push(`=== ${when(c.started_at)}${c.origin ? ` · ${host(c.origin)}` : ''} ===`);
      c.messages.forEach((m) => lines.push(m.sender === 'system' ? `--- ${m.text} ---`
        : `[${clock(m.at)}] ${m.sender === 'visitor' ? (visitor.name || 'Visitor') : m.sender === 'operator' ? 'Team' : 'AI agent'}: ${m.text}`));
      lines.push('');
    });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url; a.download = `website-chat-${visitor.email}.txt`; a.click();
    URL.revokeObjectURL(url);
  };

  const pages = useMemo(() => Array.from(new Set(convs.flatMap((c) => c.pages))), [convs]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4 lg:h-[calc(100vh-200px)]">
      {/* Visitors, by email */}
      <aside className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden max-h-[440px] lg:max-h-none">
        <div className="p-3 border-b border-gray-800">
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by email, name or message"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:border-violet-500 outline-none" />
          </div>
          {visitors && (
            <div className="flex items-center justify-between gap-2 mt-2 px-1">
              <p className="text-[11px] text-gray-500">
                {visitors.length} {visitors.length === 1 ? 'visitor' : 'visitors'} · {visitors.filter((v) => v.online).length} online · {visitors.filter((v) => v.open_chats > 0).length} open
              </p>
              <div className="flex rounded-md border border-gray-700 overflow-hidden text-[11px]">
                {(['all', 'open', 'closed'] as const).map((f) => (
                  <button key={f} onClick={() => setStatusFilter(f)}
                    className={`px-2 py-0.5 capitalize ${statusFilter === f ? 'bg-violet-600 text-white' : 'text-gray-400 hover:text-gray-200'}`}>{f}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {error && <p className="text-xs text-amber-300 px-2 py-2"><i className="fa-solid fa-triangle-exclamation mr-1.5"></i>{error}</p>}
          {!visitors && !error && <p className="text-xs text-gray-500 text-center py-8"><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading…</p>}
          {visitors && visitors.length === 0 && (
            <div className="text-center py-10 px-5">
              <i className="fa-regular fa-comments text-3xl text-gray-600"></i>
              <p className="text-sm text-gray-300 mt-3">No website chats yet</p>
              <p className="text-xs text-gray-500 mt-1">Add the widget to your website, then conversations appear here, filed by the visitor's email.</p>
              <button onClick={onSetup} className="mt-4 px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs">
                <i className="fa-solid fa-code mr-1.5"></i>Get the widget code
              </button>
            </div>
          )}
          {list.map((v) => (
            <button key={v.email} onClick={() => { setSelected(v.email); setShowPages(false); }}
              className={`w-full text-left rounded-lg px-3 py-2.5 border transition-all ${
                v.email === selected ? 'bg-violet-600/15 border-violet-500/30' : 'border-transparent hover:bg-gray-800/70'}`}>
              <div className="flex items-center gap-2.5">
                <div className="relative shrink-0">
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-sm font-semibold text-white">{letter(v)}</div>
                  {v.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-900"></span>}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm truncate flex-1 ${v.unread ? 'text-white font-semibold' : 'text-gray-200'}`}>{v.email}</p>
                    <span className="text-[11px] text-gray-500 shrink-0">{ago(v.last_at)}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className={`text-xs truncate flex-1 ${v.unread ? 'text-gray-200' : 'text-gray-500'}`}>
                      {v.typing ? <span className="text-emerald-400 italic">typing…</span>
                        : v.last_message ? `${v.last_message.sender === 'visitor' ? '' : v.last_message.sender === 'operator' ? 'You: ' : 'AI: '}${v.last_message.text}` : (v.name || '—')}
                    </p>
                    {v.unread > 0 && <span className="text-[11px] min-w-[18px] text-center px-1.5 rounded-full bg-violet-500 text-white">{v.unread}</span>}
                  </div>
                  <p className="text-[11px] text-gray-600 mt-0.5">
                    {v.name && <span className="text-gray-500">{v.name} · </span>}
                    {v.conversations} {v.conversations === 1 ? 'chat' : 'chats'} · {v.messages} msgs
                    {v.ai_paused && <span className="text-amber-400"> · you're replying</span>}
                    {' · '}{v.open_chats > 0
                      ? <span className="text-emerald-400">open</span>
                      : <span className="text-gray-500">closed</span>}
                  </p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Conversation(s) with the selected email */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden min-h-[560px]">
        {!visitor ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
            <div className="w-14 h-14 rounded-2xl bg-gray-800 flex items-center justify-center"><i className="fa-regular fa-envelope text-xl text-gray-500"></i></div>
            <p className="text-sm text-gray-300 mt-3">Select a visitor</p>
            <p className="text-xs text-gray-500 mt-1 max-w-xs">Every conversation from the same email address is shown together, newest at the bottom.</p>
          </div>
        ) : (
          <>
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3 flex-wrap">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center font-semibold text-white">{letter(visitor)}</div>
                {visitor.online && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-emerald-400 border-2 border-gray-900"></span>}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">
                  {visitor.email}
                  <button onClick={() => navigator.clipboard?.writeText(visitor.email)} title="Copy email" className="ml-2 text-gray-500 hover:text-gray-300 text-xs">
                    <i className="fa-regular fa-copy"></i>
                  </button>
                </p>
                <p className="text-xs text-gray-400 truncate">
                  {visitor.name && <>{visitor.name} · </>}
                  {visitor.online ? <span className="text-emerald-300">Online now</span> : `Last seen ${ago(visitor.last_at)}`}
                  {' · '}first chat {when(visitor.first_at)} · {visitor.conversations} {visitor.conversations === 1 ? 'chat' : 'chats'}
                </p>
              </div>
              {latest && (
                <button onClick={toggleAi} title={latest.ai_enabled ? 'Stop the AI answering, so you can reply yourself' : 'Let the AI answer again'}
                  className={`px-3 py-1.5 rounded-lg text-xs border flex items-center gap-1.5 ${latest.ai_enabled
                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20'}`}>
                  <i className={`fa-solid ${latest.ai_enabled ? 'fa-robot' : 'fa-headset'}`}></i>
                  {latest.ai_enabled ? 'AI answering' : 'You are answering'}
                </button>
              )}
              {latest && (latest.status === 'open' ? (
                <button onClick={closeChat} title="End this chat for the visitor"
                  className="px-3 py-1.5 rounded-lg text-xs border border-gray-700 text-gray-300 hover:border-red-500/50 hover:text-red-300 flex items-center gap-1.5">
                  <i className="fa-solid fa-circle-stop"></i>Close chat
                </button>
              ) : (
                <span className="px-2.5 py-1 rounded-full text-[11px] bg-gray-800 text-gray-400 border border-gray-700" title={latest.ended_by ? ENDED_BY[latest.ended_by] : ''}>
                  <i className="fa-solid fa-lock mr-1"></i>Closed
                </span>
              ))}
              <button onClick={() => setShowPages(!showPages)} title="Pages visited" className={`w-8 h-8 rounded-lg hover:bg-gray-800 ${showPages ? 'text-violet-300' : 'text-gray-400'}`}>
                <i className="fa-solid fa-globe text-sm"></i>
              </button>
              <button onClick={exportTranscript} title="Download transcript" className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"><i className="fa-solid fa-download text-sm"></i></button>
              <button onClick={removeVisitor} title="Delete this visitor's chats" className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800"><i className="fa-solid fa-trash text-sm"></i></button>
            </div>

            {showPages && (
              <div className="px-4 py-3 border-b border-gray-800 bg-gray-950/40 text-xs">
                <p className="text-gray-400 mb-1.5"><i className="fa-solid fa-globe mr-1.5"></i>Pages this visitor chatted from</p>
                {pages.length === 0 ? <p className="text-gray-500">None recorded.</p> : (
                  <ul className="space-y-1">
                    {pages.map((p) => (
                      <li key={p} className="truncate"><a href={p} target="_blank" rel="noreferrer" className="text-violet-300 hover:text-violet-200">{host(p)}<span className="text-gray-400">{path(p)}</span></a></li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {convs.map((c) => (
                <div key={c.id} className="space-y-3">
                  <div className="flex items-center gap-3 py-1">
                    <div className="flex-1 h-px bg-gray-800"></div>
                    <span className="text-[11px] text-gray-500">
                      Chat started {when(c.started_at)}{c.origin && <> · {host(c.origin)}</>}
                    </span>
                    <div className="flex-1 h-px bg-gray-800"></div>
                  </div>
                  {c.messages.map((m) => {
                    if (m.sender === 'system') {
                      return <div key={m.id} className="flex justify-center"><span className="text-[11px] text-gray-400 bg-gray-800/80 px-3 py-1 rounded-full">{m.text}</span></div>;
                    }
                    const visitorMsg = m.sender === 'visitor';
                    return (
                      <div key={m.id} className={`flex items-end gap-2 ${visitorMsg ? '' : 'flex-row-reverse'}`}>
                        <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white ${
                          visitorMsg ? 'bg-gradient-to-br from-sky-500 to-indigo-600' : m.sender === 'operator' ? 'bg-teal-600' : 'bg-gradient-to-br from-violet-500 to-indigo-600'}`}>
                          {visitorMsg ? letter(visitor) : m.sender === 'operator' ? <i className="fa-solid fa-user text-[10px]"></i> : <i className="fa-solid fa-robot text-[10px]"></i>}
                        </div>
                        <div className={`max-w-[75%] flex flex-col ${visitorMsg ? 'items-start' : 'items-end'}`}>
                          <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            visitorMsg ? 'bg-gray-800 border border-gray-700/70 text-gray-100 rounded-bl-md'
                              : m.sender === 'operator' ? 'bg-teal-600 text-white rounded-br-md' : 'bg-violet-600/90 text-white rounded-br-md'}`}>
                            {m.text}
                          </div>
                          <span className="text-[11px] text-gray-500 mt-1 px-1">
                            {visitorMsg ? (visitor.name || 'Visitor') : m.sender === 'operator' ? 'You' : 'AI agent'} · {clock(m.at)}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {c.status === 'closed' && (
                    <div className="flex items-center gap-3 py-1">
                      <div className="flex-1 h-px bg-gray-800"></div>
                      <span className="text-[11px] text-gray-500">
                        <i className="fa-solid fa-lock mr-1"></i>Chat closed{c.ended_by ? `, ${ENDED_BY[c.ended_by] || c.ended_by}` : ''}
                        {c.ended_at ? ` · ${clock(c.ended_at)}` : ''}
                      </span>
                      <div className="flex-1 h-px bg-gray-800"></div>
                    </div>
                  )}
                </div>
              ))}
              {latest?.visitor_typing && (
                <div className="flex items-end gap-2">
                  <div className="w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold text-white bg-gradient-to-br from-sky-500 to-indigo-600">{letter(visitor)}</div>
                  <div>
                    <div className="px-3.5 py-3 rounded-2xl rounded-bl-md bg-gray-800 border border-gray-700/70 flex gap-1">
                      {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }}></span>)}
                    </div>
                    <span className="text-[11px] text-emerald-400 mt-1 px-1 block">{visitor.name || visitor.email} is typing…</span>
                  </div>
                </div>
              )}
              <div ref={endRef} />
            </div>

            <div className="border-t border-gray-800 p-3">
              {latest && latest.status === 'closed' && latest.ended_by !== 'inactive' ? (
                <div className="flex items-center justify-between gap-3 px-1 py-1">
                  <p className="text-xs text-gray-500"><i className="fa-solid fa-lock mr-1.5"></i>
                    This chat is closed{latest.ended_by ? ` (${ENDED_BY[latest.ended_by]})` : ''}. The visitor can start a new chat from your website.</p>
                  <button onClick={reopenChat} className="shrink-0 px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:border-violet-500">Reopen</button>
                </div>
              ) : (<>
              {latest && !latest.ai_enabled && (
                <p className="text-[11px] text-amber-300/90 mb-2 px-1"><i className="fa-solid fa-circle-info mr-1"></i>
                  The AI is paused for this chat: the visitor only gets your replies. Switch it back with "You are answering".</p>
              )}
              <div className="flex items-end gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-violet-500">
                <textarea value={reply} rows={1} onChange={(e) => { setReply(e.target.value); signalTyping(!!e.target.value.trim()); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                  placeholder={visitor.online ? `Reply to ${visitor.name || visitor.email} (takes over from the AI)…` : `Reply… (${visitor.email} is not on the website right now)`}
                  className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none resize-none max-h-32 py-1" />
                <button onClick={sendReply} disabled={!reply.trim() || busy}
                  className="w-9 h-9 shrink-0 rounded-lg bg-teal-600 hover:bg-teal-700 text-white disabled:opacity-40 flex items-center justify-center">
                  <i className={`fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-paper-plane'} text-sm`}></i>
                </button>
              </div>
              </>)}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------

const COLORS = ['#7c3aed', '#4f46e5', '#2563eb', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#111827'];

function Setup() {
  const [s, setS] = useState<WidgetSettings | null>(null);
  const [origins, setOrigins] = useState('');
  const [quick, setQuick] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);

  const apply = (r: WidgetSettings) => { setS(r); setOrigins(r.allowed_origins.join('\n')); setQuick((r.quick_replies || []).join('\n')); };
  useEffect(() => { widgetApi.settings().then(apply).catch((e) => setError(e.message)); }, []);
  const flash = (t: string) => { setNotice(t); setTimeout(() => setNotice(''), 2500); };

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      apply(await widgetApi.saveSettings({ ...s, allowed_origins: origins.split(/[\s,]+/).filter(Boolean),
        quick_replies: quick.split('\n').map((q) => q.trim()).filter(Boolean) }));
      setError('');
      flash('Widget settings saved: websites using the widget pick them up on their next page load.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const rotate = async () => {
    if (!window.confirm('Make a new site key? The widget stops working on websites until you paste the new code there.')) return;
    try { apply(await widgetApi.rotateKey()); flash('New site key created. Update the code on your website.'); } catch (e: any) { setError(e.message); }
  };

  const copy = (t: string) => { navigator.clipboard?.writeText(t); flash('Copied to the clipboard.'); };

  const logoInput = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    setLogoBusy(true);
    try { apply(await widgetApi.uploadLogo(file)); setError(''); flash('Logo uploaded. Websites show it on their next page load.'); }
    catch (e: any) { setError(e.message); }
    finally { setLogoBusy(false); if (logoInput.current) logoInput.current.value = ''; }
  };
  const removeLogo = async () => {
    if (!window.confirm('Remove the logo? The widget shows the agent\'s initial instead.')) return;
    try { apply(await widgetApi.removeLogo()); flash('Logo removed.'); } catch (e: any) { setError(e.message); }
  };

  if (!s) {
    return <div className="text-sm text-gray-400">{error ? <span className="text-amber-300">{error}</span> : <><i className="fa-solid fa-spinner fa-spin mr-2"></i>Loading…</>}</div>;
  }

  const set = (k: keyof WidgetSettings, v: any) => setS({ ...s, [k]: v });
  const quickList = quick.split('\n').map((q) => q.trim()).filter(Boolean);
  const field = 'w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none';

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
      <div className="space-y-6">
        {/* Embed code */}
        <div className="bg-gray-900 rounded-xl border border-violet-500/30 p-6 space-y-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0"><i className="fa-solid fa-code text-white"></i></div>
            <div>
              <h3 className="text-lg font-semibold text-white">Add the chat to your website</h3>
              <p className="text-sm text-gray-400">Paste this line into your website's footer (just before <code className="text-gray-300">&lt;/body&gt;</code>) on every page where the chat should appear.</p>
            </div>
          </div>
          <div className="relative">
            <pre className="bg-gray-950 border border-gray-800 rounded-lg p-4 pr-24 text-xs text-emerald-300 whitespace-pre-wrap break-all font-mono">{s.snippet}</pre>
            <button onClick={() => copy(s.snippet)} className="absolute top-2.5 right-2.5 px-3 py-1.5 rounded-md bg-violet-600 hover:bg-violet-700 text-white text-xs">
              <i className="fa-regular fa-copy mr-1.5"></i>Copy
            </button>
          </div>
          {s.local_only && (
            <div className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2.5 leading-relaxed">
              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>
              The code points to <code>localhost</code>, so it only works on this computer (fine for testing). For a real website,
              the backend must be reachable on the internet: set its public address in <strong>Settings › Calling</strong>, and the code here updates.
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <a href={s.demo_url} target="_blank" rel="noreferrer" className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-200 hover:border-violet-500">
              <i className="fa-solid fa-arrow-up-right-from-square mr-1.5 text-xs"></i>Open test page
            </a>
            <button onClick={() => copy(s.site_key)} className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-gray-500">
              Site key <code className="text-gray-400 ml-1">{s.site_key.slice(0, 10)}…</code>
            </button>
            <button onClick={rotate} className="px-3 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-red-500 hover:text-red-300">
              <i className="fa-solid fa-rotate mr-1.5 text-xs"></i>New key
            </button>
          </div>
        </div>

        {/* Logo */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Logo</h3>
          <p className="text-sm text-gray-400 mb-4">Shown in the chat window's header and next to the agent's messages. A square image works best (at least 96 × 96 px).</p>
          <div className="flex items-center gap-5 flex-wrap">
            <div className="w-20 h-20 rounded-full flex items-center justify-center overflow-hidden border border-gray-700 shrink-0"
              style={{ background: s.logo_url ? '#fff' : s.color }}>
              {s.logo_url
                ? <img src={s.logo_url} alt="Widget logo" className="w-full h-full object-contain p-2" />
                : <span className="text-2xl font-bold text-white">A</span>}
            </div>
            <div className="space-y-2">
              <div className="flex gap-2 flex-wrap">
                <button type="button" onClick={() => logoInput.current?.click()} disabled={logoBusy}
                  className="px-4 py-2 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-sm disabled:opacity-60">
                  <i className={`fa-solid ${logoBusy ? 'fa-spinner fa-spin' : 'fa-upload'} mr-2`}></i>{s.logo_url ? 'Replace logo' : 'Upload logo'}
                </button>
                {s.logo_url && (
                  <button type="button" onClick={removeLogo} className="px-4 py-2 rounded-lg border border-gray-700 text-sm text-gray-300 hover:border-red-500 hover:text-red-300">
                    <i className="fa-solid fa-trash mr-2"></i>Remove
                  </button>
                )}
              </div>
              <p className="text-[11px] text-gray-500">PNG, JPG, GIF, WebP or SVG, up to 300 KB.</p>
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden"
                onChange={(e) => uploadLogo(e.target.files?.[0])} />
            </div>
          </div>
        </div>

        {/* Settings */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Appearance and behaviour</h3>
            <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              Chat on
              <button type="button" onClick={() => set('enabled', !s.enabled)}
                className={`relative w-11 h-6 rounded-full transition-all ${s.enabled ? 'bg-emerald-500' : 'bg-gray-700'}`}>
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform" style={{ transform: s.enabled ? 'translateX(20px)' : 'none' }}></span>
              </button>
            </label>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="text-xs text-gray-400">Title<input className={`${field} mt-1`} value={s.title} placeholder="Blank: your company name" onChange={(e) => set('title', e.target.value)} /></label>
            <label className="text-xs text-gray-400">Subtitle<input className={`${field} mt-1`} value={s.subtitle} onChange={(e) => set('subtitle', e.target.value)} /></label>
            <label className="text-xs text-gray-400 md:col-span-2">Welcome message
              <textarea className={`${field} mt-1 resize-none`} rows={2} value={s.welcome} placeholder="Blank: Hi! I'm <agent> from <company>. How can I help you today?" onChange={(e) => set('welcome', e.target.value)} />
            </label>
            <label className="text-xs text-gray-400 md:col-span-2">Goodbye message
              <input className={`${field} mt-1`} value={s.goodbye || ''} onChange={(e) => set('goodbye', e.target.value)}
                placeholder="Blank: Thanks for chatting with <company>! Have a wonderful day." />
              <span className="block text-[11px] text-gray-500 mt-1">What the agent says when a visitor says goodbye (chats never say "thank you for calling").</span>
            </label>
            <label className="text-xs text-gray-400">Button text<input className={`${field} mt-1`} value={s.launcher_text} placeholder="Blank: icon only" onChange={(e) => set('launcher_text', e.target.value)} /></label>
            <div className="text-xs text-gray-400">Position
              <div className="mt-1 grid grid-cols-2 gap-2">
                {(['left', 'right'] as const).map((p) => (
                  <button key={p} type="button" onClick={() => set('position', p)}
                    className={`py-2 rounded-lg border text-sm capitalize ${s.position === p ? 'border-violet-500 bg-violet-500/10 text-white' : 'border-gray-700 text-gray-300'}`}>Bottom {p}</button>
                ))}
              </div>
            </div>
            <div className="text-xs text-gray-400 md:col-span-2">Colour
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {COLORS.map((c) => (
                  <button key={c} type="button" onClick={() => set('color', c)} title={c}
                    className={`w-8 h-8 rounded-full border-2 ${s.color.toLowerCase() === c ? 'border-white scale-110' : 'border-transparent'}`} style={{ background: c }}></button>
                ))}
                <input type="color" value={s.color} onChange={(e) => set('color', e.target.value)} className="w-9 h-9 bg-transparent cursor-pointer" title="Custom colour" />
              </div>
            </div>
            <label className="md:col-span-2 flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
              <input type="checkbox" checked={s.ask_name} onChange={(e) => set('ask_name', e.target.checked)} className="accent-violet-500" />
              Also ask for the visitor's name (optional for them). The email is always required.
            </label>
            <label className="text-xs text-gray-400 md:col-span-2">Quick replies
              <textarea className={`${field} mt-1 resize-none`} rows={4} value={quick} onChange={(e) => setQuick(e.target.value)}
                placeholder={'What jobs do you have?\nHow do I apply?'} />
              <span className="block text-[11px] text-gray-500 mt-1">
                One per line, up to 6 (60 characters each). Shown as buttons visitors can tap instead of typing, until they send their first message.
                {quickList.length > 6 && <span className="text-amber-300"> Only the first 6 are used.</span>}
              </span>
            </label>
            <div className="text-xs text-gray-400 md:col-span-2">Typing pause before each reply
              <div className="mt-1 grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([['off', 'Off', 'Instant'], ['short', 'Short', '0.3–1.2 s'], ['natural', 'Natural', '0.7–2.6 s'], ['long', 'Long', '1.2–4 s']] as const).map(([v, label, hint]) => (
                  <button key={v} type="button" onClick={() => set('typing_delay', v)}
                    className={`py-2 rounded-lg border text-sm ${s.typing_delay === v ? 'border-violet-500 bg-violet-500/10 text-white' : 'border-gray-700 text-gray-300 hover:border-gray-600'}`}>
                    {label}<span className="block text-[10px] text-gray-500">{hint}</span>
                  </button>
                ))}
              </div>
              <span className="block text-[11px] text-gray-500 mt-1">The "typing…" dots show for a moment before each answer (longer for longer answers), so the chat feels like talking to a person.</span>
            </div>
            <label className="text-xs text-gray-400 md:col-span-2">Allowed websites
              <textarea className={`${field} mt-1 resize-none font-mono text-xs`} rows={3} value={origins} onChange={(e) => setOrigins(e.target.value)}
                placeholder={'https://www.yourcompany.com\nhttps://yourcompany.com'} />
              <span className="block text-[11px] text-gray-500 mt-1">One per line. Only these websites can use your widget. Leave empty to allow any website (fine while testing).</span>
            </label>
          </div>
          {error && <p className="text-sm text-red-300"><i className="fa-solid fa-circle-xmark mr-1.5"></i>{error}</p>}
          {notice && <p className="text-sm text-emerald-300"><i className="fa-solid fa-circle-check mr-1.5"></i>{notice}</p>}
          <div className="flex justify-end">
            <button onClick={save} disabled={saving} className="px-5 py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-60">
              <i className={`fa-solid ${saving ? 'fa-spinner fa-spin' : 'fa-save'} mr-2`}></i>Save widget settings
            </button>
          </div>
        </div>
      </div>

      {/* Preview */}
      <div className="xl:sticky xl:top-24">
        <p className="text-xs uppercase tracking-wide text-gray-500 mb-2">Preview</p>
        <div className="rounded-2xl bg-gradient-to-br from-slate-200 to-slate-300 p-4 h-[560px] relative overflow-hidden">
          <div className={`absolute bottom-4 ${s.position === 'left' ? 'left-4 items-start' : 'right-4 items-end'} flex flex-col gap-3 w-[300px]`}>
            <div className="w-full bg-white rounded-2xl shadow-2xl overflow-hidden text-gray-900">
              <div className="px-4 py-3.5 flex items-center gap-3 text-white" style={{ background: s.color }}>
                <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold overflow-hidden shrink-0 ${s.logo_url ? 'bg-white p-1' : 'bg-white/20'}`}>
                  {s.logo_url ? <img src={s.logo_url} alt="" className="w-full h-full object-contain" /> : 'A'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold truncate">{s.title || 'Your company'}</p>
                  <p className="text-[11px] opacity-85 truncate">{s.subtitle}</p>
                </div>
              </div>
              <div className="bg-[#f7f7fb] p-3.5 space-y-2.5">
                <div className="bg-white rounded-xl p-3 shadow-sm">
                  <p className="text-[12.5px] text-gray-700 mb-2.5">{s.welcome || "Hi! I'm your assistant. How can I help you today?"}</p>
                  {s.ask_name && <div className="h-8 rounded-lg border border-gray-300 mb-2 px-2 flex items-center text-[11px] text-gray-400">Your name (optional)</div>}
                  <div className="h-8 rounded-lg border border-gray-300 px-2 flex items-center text-[11px] text-gray-400">you@example.com</div>
                  <div className="mt-2.5 h-8 rounded-lg text-white text-xs font-semibold flex items-center justify-center" style={{ background: s.color }}>Start chat</div>
                </div>
                {quickList.length > 0 && (
                  <div className="flex flex-col gap-1 pl-6 pr-2">
                    <span className="text-[10px] font-semibold text-gray-500 pl-0.5">Suggested questions</span>
                    {quickList.slice(0, 6).map((q) => (
                      <span key={q} className="flex items-center justify-between gap-2 text-[11px] font-medium text-gray-800 px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 shadow-sm">
                        <span className="truncate">{q}</span>
                        <i className="fa-solid fa-arrow-right text-[9px]" style={{ color: s.color }}></i>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 rounded-full text-white text-sm font-semibold shadow-lg px-4 py-3" style={{ background: s.color }}>
              <i className="fa-regular fa-message"></i>{s.launcher_text}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
