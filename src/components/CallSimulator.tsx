import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useLocalStorage } from '../hooks/useLocalStorage';
import { DEFAULT_IDENTITY, DEFAULT_BEHAVIOR, DEFAULT_KNOWLEDGE } from '../utils/agentDefaults';
import { syncAgentSettings, startAgentChat, askAgent, endAgentCall } from '../utils/agentApi';
import { widgetApi } from '../utils/widgetApi';
import { FormattedMessage } from '../utils/messageFormat';
import { chatApi, newChatId, Chat, ChatMessage, ChatSummary } from '../utils/chatApi';

// Chat > Test chat: chat with the AI agent exactly as a website visitor
// would (same welcome, goodbye and quick replies as the chat widget). Every
// chat is saved to the database as it goes (history on the left), so past
// conversations can be opened, searched, exported or deleted.

// Words ignored when matching a caller question against FAQ questions.
const KB_STOPWORDS = new Set([
  'what', 'when', 'where', 'which', 'your', 'yours', 'about', 'there',
  'their', 'this', 'that', 'with', 'have', 'does', 'will', 'would',
  'could', 'should', 'please', 'thanks', 'thank',
]);

const QUICK_PROMPTS = [
  "I'd like to book an appointment",
  'What are your business hours?',
  'What services do you offer?',
  'Can I speak to a manager?',
  'Where are you located?',
  'I have a complaint',
];

const SAVE_DELAY = 400;

const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const formatDuration = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

function dayGroup(iso: string): string {
  const d = new Date(iso);
  const today = new Date(new Date().toDateString());
  const diff = (today.getTime() - new Date(d.toDateString()).getTime()) / 864e5;
  if (diff <= 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  if (diff < 7) return 'Previous 7 days';
  return d.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

function relative(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

const titleFrom = (text: string) => {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > 48 ? t.slice(0, 46).trimEnd() + '…' : t;
};

export default function CallSimulator() {
  const [identity] = useLocalStorage('agent-identity', DEFAULT_IDENTITY);
  const [behavior] = useLocalStorage('agent-behavior', DEFAULT_BEHAVIOR);
  const [knowledge] = useLocalStorage('agent-knowledge', DEFAULT_KNOWLEDGE);

  // History
  const [summaries, setSummaries] = useState<ChatSummary[]>([]);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');

  // The open chat
  const [chat, setChat] = useState<Chat | null>(null);
  const [opening, setOpening] = useState(false);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [tick, setTick] = useState(0);
  const [showInsights, setShowInsights] = useState(true);

  // Greeting editor (welcome screen)
  const [editingGreeting, setEditingGreeting] = useState(false);
  const [tempGreeting, setTempGreeting] = useState('');
  // The chat wording, shared with the website widget (Chat > Widget setup).
  const defaultWelcome = `Hi! I'm ${identity.agentName || 'the assistant'} from ${identity.companyName || 'our team'}. How can I help you today?`;
  const [chatWords, setChatWords] = useState({ welcome: '', goodbye: '', quick: [] as string[] });
  const welcome = chatWords.welcome || defaultWelcome;
  const goodbye = chatWords.goodbye || `Thanks for chatting with ${identity.companyName || 'us'}! Have a wonderful day.`;
  const quickPrompts = chatWords.quick.length ? chatWords.quick : QUICK_PROMPTS;
  const goodbyeRef = useRef('');
  useEffect(() => {
    widgetApi.settings()
      .then((s) => setChatWords({ welcome: s.welcome || '', goodbye: s.goodbye || '', quick: s.quick_replies || [] }))
      .catch(() => { /* backend offline: defaults */ });
  }, []);
  const saveWelcome = async () => {
    const text = tempGreeting.trim();
    setEditingGreeting(false);
    setChatWords((w) => ({ ...w, welcome: text }));
    try { await widgetApi.saveSettings({ welcome: text }); } catch { /* shown again on next load */ }
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatRef = useRef<Chat | null>(null);
  chatRef.current = chat;
  // Backend call session: every question goes to the backend agent,
  // which answers from the knowledge base; null = backend offline.
  const backendCallIdRef = useRef<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- history ----

  const loadHistory = useCallback(() => {
    chatApi.list()
      .then((r) => { setSummaries(r.chats); setHistoryError(''); })
      .catch((e) => setHistoryError(e.message))
      .finally(() => setHistoryLoading(false));
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  const persist = useCallback((c: Chat) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setSaveState('saving');
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      chatApi.save(c)
        .then((summary) => {
          setSaveState('saved');
          setSummaries((list) => [summary, ...list.filter((s) => s.id !== summary.id)]
            .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || '')));
        })
        .catch(() => setSaveState('offline'));
    }, SAVE_DELAY);
  }, []);

  // Change the open chat and save it.
  const update = useCallback((fn: (c: Chat) => Chat) => {
    setChat((prev) => {
      if (!prev) return prev;
      const next = fn(prev);
      persist(next);
      return next;
    });
  }, [persist]);

  // End the backend session when leaving the page.
  useEffect(() => () => {
    if (backendCallIdRef.current) endAgentCall(backendCallIdRef.current);
    const c = chatRef.current;
    if (c && c.status === 'active') {
      chatApi.save({ ...c, status: 'ended', ended_at: new Date().toISOString(), duration: secondsOf(c) }).catch(() => {});
    }
  }, []);

  // Live call timer
  useEffect(() => {
    if (chat?.status !== 'active') return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [chat?.status]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat?.messages.length, isTyping]);

  const secondsOf = (c: Chat) => c.status === 'active'
    ? Math.max(0, Math.round((Date.now() - new Date(c.started_at).getTime()) / 1000))
    : c.duration;

  // ---- offline answers (backend not running) ----
  // Knowledge base first: FAQs and stored business facts entered in Setup
  // are the source of truth.

  const significantWords = (t: string) =>
    t.toLowerCase().split(/[^a-z0-9]+/)
      .filter(w => w.length > 3 && !KB_STOPWORDS.has(w))
      .map(w => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));

  // The free-form knowledge from Agent Setup (Company Knowledge text +
  // uploaded .md documents), split into the passages the agent searches.
  const kbPassages = (info: string): string[] => {
    const clean = (s: string) => s
      .replace(/^#+\s*/, '')
      .replace(/^\s*>\s?/, '')
      .replace(/^[\s\-•*]+|[\s\-•*]+$/g, '')
      .replace(/\*\*/g, '')
      .replace(/__/g, '')
      .trim();
    const cells = (s: string) => s.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).filter(Boolean);
    const lines = (info || '').split('\n');
    const out: string[] = [];
    let i = 0;
    while (i < lines.length) {
      const raw = lines[i];
      if (raw.includes('|') && i + 1 < lines.length && lines[i + 1].includes('-') && /^[|:\-\s]+$/.test(lines[i + 1].trim())) {
        const header = cells(raw).map(clean);
        i += 2;
        while (i < lines.length && lines[i].includes('|')) {
          const row = cells(lines[i]).map(clean);
          if (header.length && row.length === header.length) {
            out.push(header.map((h, j) => `${h}: ${row[j]}`).join('. ') + '.');
          } else if (row.length) {
            out.push(row.join(' — '));
          }
          i++;
        }
        continue;
      }
      const line0 = raw.trim();
      i++;
      if (!line0 || /^[|:\-\s]+$/.test(line0)) continue;
      let line = clean(line0);
      if (line.includes('|')) line = line.replace(/\s*\|\s*/g, ' — ').replace(/^[—\s]+|[—\s]+$/g, '').trim();
      if (!line) continue;
      if (line.length > 220) {
        line.split(/(?<=[.!?])\s+/).forEach(p => { if (p.trim().length > 15) out.push(p.trim()); });
      } else {
        out.push(line);
      }
    }
    return out;
  };

  const findKbAnswer = (text: string): { text: string; intent: string } | null => {
    const lower = text.toLowerCase();
    const msgWords = new Set(significantWords(text));
    for (const faq of knowledge.faqs ?? []) {
      if (!faq.q?.trim() || !faq.a?.trim()) continue;
      const qWords = significantWords(faq.q);
      if (qWords.length === 0) continue;
      const shared = qWords.filter(w => msgWords.has(w)).length;
      if (shared >= Math.min(2, qWords.length)) return { text: faq.a, intent: 'FAQ' };
    }
    if (/(hour|open|close|timing)/.test(lower) && knowledge.businessHours) {
      return { text: `Our business hours are ${knowledge.businessHours}. Is there anything else I can help you with?`, intent: 'Business Hours Inquiry' };
    }
    if (/(where|address|location|located|direction)/.test(lower) && knowledge.address) {
      return { text: `We're located at ${knowledge.address}.`, intent: 'General Inquiry' };
    }
    if (/(phone|number|contact)/.test(lower) && knowledge.phone) {
      return { text: `You can reach us at ${knowledge.phone}.`, intent: 'General Inquiry' };
    }
    if (lower.includes('email') && knowledge.email) {
      return { text: `Our email address is ${knowledge.email}.`, intent: 'General Inquiry' };
    }
    const passages = kbPassages([knowledge.companyInfo ?? '', ...(knowledge.documents ?? []).map(d => d.content)].join('\n'));
    if (passages.length > 0) {
      if ((lower.includes('about') && (lower.includes('company') || lower.includes('business')))
        || lower.includes('who are you') || lower.includes('your company') || lower.includes('your business')) {
        let overview = passages[0];
        if (passages.length > 1 && overview.length < 160) overview += ' ' + passages[1];
        return { text: overview, intent: 'General Inquiry' };
      }
      let best: string | null = null;
      let bestShared = 0;
      for (const p of passages) {
        const shared = significantWords(p).filter(w => msgWords.has(w)).length;
        if (shared > bestShared) { best = p; bestShared = shared; }
      }
      const needed = msgWords.size === 1 ? 1 : 2;
      if (best && bestShared >= needed && bestShared * 2 >= msgWords.size) return { text: best, intent: 'General Inquiry' };
    }
    return null;
  };

  const offlineAnswer = (text: string): { text: string; intent: string } => {
    const kb = findKbAnswer(text);
    if (kb) return kb;
    const lower = text.toLowerCase();
    if (/(appointment|book|schedule)/.test(lower)) return { text: `I'd be happy to help you book an appointment! Could you tell me your preferred date and time? We're open ${knowledge.businessHours}.`, intent: 'Appointment Booking' };
    if (/(support|technical|bug|error)/.test(lower)) return { text: "I understand you need technical support. Could you describe the problem you're experiencing?", intent: 'Technical Support' };
    if (/(manager|speak|human|person)/.test(lower)) return { text: behavior.transferPhrase || "I'd be happy to connect you with a manager. Would you like me to transfer you now?", intent: 'Transfer Request' };
    if (/(service|offer|what do you)/.test(lower)) return { text: `We offer ${knowledge.services}. Would you like more details about any particular service?`, intent: 'General Inquiry' };
    if (/(complaint|unhappy|problem)/.test(lower)) return { text: "I'm sorry to hear that. Could you tell me more about the issue? I'll make sure it gets the attention it deserves.", intent: 'Complaint' };
    return { text: "Thank you for that. Let me see how I can best help. Is there anything specific you'd like me to help with?", intent: 'General Inquiry' };
  };

  // ---- the conversation ----

  const msg = (sender: ChatMessage['sender'], text: string, extra: Partial<ChatMessage> = {}): ChatMessage =>
    ({ id: Date.now() + Math.random(), sender, text, at: new Date().toISOString(), ...extra });

  const startChat = async () => {
    if (chat?.status === 'active') await endChat();
    setOpening(true);
    backendCallIdRef.current = null;
    let opening = welcome;
    goodbyeRef.current = goodbye;
    if (await syncAgentSettings({ identity, behavior, knowledge })) {
      const started = await startAgentChat();
      if (started) {
        backendCallIdRef.current = started.callId;
        opening = started.greeting || opening;
        goodbyeRef.current = started.goodbye || goodbye;
      }
    }
    const online = !!backendCallIdRef.current;
    const c: Chat = {
      id: newChatId(),
      title: 'New chat',
      status: 'active',
      started_at: new Date().toISOString(),
      ended_at: null,
      duration: 0,
      agent_name: identity.agentName,
      company_name: identity.companyName,
      online,
      messages: [
        msg('system', online ? `Connected to ${identity.agentName}: answers come from your knowledge base and AI model.`
          : 'Backend not reachable (http://localhost:8000): using basic offline answers.'),
        msg('agent', opening),
      ],
    };
    setChat(c);
    persist(c);
    setOpening(false);
    setTimeout(() => inputRef.current?.focus(), 50);
  };

  const sendMessage = async (raw: string) => {
    const text = raw.trim();
    if (!text || !chat || chat.status !== 'active' || isTyping) return;
    setInput('');
    update((c) => ({
      ...c,
      title: c.title === 'New chat' ? titleFrom(text) : c.title,
      messages: [...c.messages, msg('caller', text)],
    }));
    setIsTyping(true);
    const t0 = performance.now();
    let answer: { text: string; intent: string };
    if (backendCallIdRef.current) {
      const r = await askAgent(backendCallIdRef.current, text);
      answer = r ? { text: r.message, intent: r.intent } : offlineAnswer(text);
    } else {
      await new Promise((r) => setTimeout(r, 600 + Math.random() * 500));
      answer = offlineAnswer(text);
    }
    const ms = Math.round(performance.now() - t0);
    update((c) => ({ ...c, messages: [...c.messages, msg('agent', answer.text, { intent: answer.intent, ms })] }));
    setIsTyping(false);
    inputRef.current?.focus();
  };

  const endChat = async () => {
    if (backendCallIdRef.current) {
      endAgentCall(backendCallIdRef.current);
      backendCallIdRef.current = null;
    }
    update((c) => ({
      ...c,
      status: 'ended',
      ended_at: new Date().toISOString(),
      duration: secondsOf(c),
      messages: [...c.messages, msg('agent', goodbyeRef.current || goodbye),
        msg('system', `Chat ended · ${formatDuration(secondsOf(c))}`)],
    }));
  };

  const openChat = async (id: string) => {
    if (chat?.id === id) return;
    if (chat?.status === 'active') await endChat();
    setOpening(true);
    try {
      const c = await chatApi.get(id);
      // A chat left open in an earlier visit can't be continued: its
      // agent session is gone.
      setChat(c.status === 'active' ? { ...c, status: 'ended' } : c);
    } catch (e: any) {
      setHistoryError(e.message);
    } finally {
      setOpening(false);
    }
  };

  const deleteChat = async (id: string) => {
    if (!window.confirm('Delete this chat from the history? This cannot be undone.')) return;
    try {
      await chatApi.remove(id);
      setSummaries((s) => s.filter((x) => x.id !== id));
      if (chat?.id === id) {
        if (backendCallIdRef.current) { endAgentCall(backendCallIdRef.current); backendCallIdRef.current = null; }
        setChat(null);
      }
    } catch (e: any) {
      setHistoryError(e.message);
    }
  };

  const clearHistory = async () => {
    if (!window.confirm(`Delete all ${summaries.length} chats from the history? This cannot be undone.`)) return;
    try {
      await chatApi.clear();
      setSummaries([]);
      if (chat && chat.status !== 'active') setChat(null);
    } catch (e: any) {
      setHistoryError(e.message);
    }
  };

  const exportChat = () => {
    if (!chat) return;
    const lines = [
      `${chat.title}`,
      `${new Date(chat.started_at).toLocaleString()} · ${chat.agent_name} (${chat.company_name}) · ${formatDuration(secondsOf(chat))}`,
      '',
      ...chat.messages.map((m) => m.sender === 'system' ? `--- ${m.text} ---`
        : `[${clock(m.at)}] ${m.sender === 'agent' ? chat.agent_name || 'Agent' : 'Caller'}: ${m.text}${m.intent ? `  (${m.intent})` : ''}`),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-${chat.started_at.slice(0, 16).replace(/[:T]/g, '-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ---- derived ----

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? summaries.filter((s) => `${s.title} ${s.last_message?.text || ''} ${s.intents.join(' ')}`.toLowerCase().includes(q)) : summaries;
    const groups: [string, ChatSummary[]][] = [];
    for (const s of list) {
      const g = dayGroup(s.started_at);
      const last = groups[groups.length - 1];
      if (last && last[0] === g) last[1].push(s); else groups.push([g, [s]]);
    }
    return groups;
  }, [summaries, search]);

  const stats = useMemo(() => {
    const msgs = chat?.messages || [];
    const answers = msgs.filter((m) => m.sender === 'agent' && m.ms);
    const intents: Record<string, number> = {};
    msgs.forEach((m) => { if (m.intent) intents[m.intent] = (intents[m.intent] || 0) + 1; });
    return {
      caller: msgs.filter((m) => m.sender === 'caller').length,
      agent: msgs.filter((m) => m.sender === 'agent').length,
      avgMs: answers.length ? Math.round(answers.reduce((a, m) => a + (m.ms || 0), 0) / answers.length) : 0,
      intents: Object.entries(intents).sort((a, b) => b[1] - a[1]),
    };
  }, [chat?.messages]);

  void tick; // re-render each second while a call is live
  const active = chat?.status === 'active';
  const initials = (identity.agentName || 'A').charAt(0).toUpperCase();

  // ---- UI ----

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-[280px_minmax(0,1fr)] ${chat && showInsights ? '2xl:grid-cols-[280px_minmax(0,1fr)_280px]' : ''} gap-4 lg:h-[calc(100vh-205px)]`}>

      {/* History */}
      <aside className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden max-h-[420px] lg:max-h-none">
        <div className="p-3 border-b border-gray-800 space-y-2.5">
          <button onClick={startChat} disabled={opening}
            className="w-full py-2.5 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
            <i className={`fa-solid ${opening ? 'fa-spinner fa-spin' : 'fa-plus'}`}></i>New chat
          </button>
          <div className="relative">
            <i className="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500"></i>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search chats"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-sm text-white focus:border-violet-500 outline-none" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {historyLoading && <p className="text-xs text-gray-500 text-center py-6"><i className="fa-solid fa-spinner fa-spin mr-1.5"></i>Loading history…</p>}
          {historyError && (
            <p className="text-xs text-amber-300 px-2 py-3">
              <i className="fa-solid fa-triangle-exclamation mr-1.5"></i>{historyError}
              <button onClick={loadHistory} className="underline ml-1.5">Retry</button>
            </p>
          )}
          {!historyLoading && !historyError && summaries.length === 0 && (
            <div className="text-center py-10 px-4">
              <i className="fa-regular fa-comments text-2xl text-gray-600"></i>
              <p className="text-sm text-gray-400 mt-2">No chats yet</p>
              <p className="text-xs text-gray-500 mt-1">Your conversations with the agent will be saved here.</p>
            </div>
          )}
          {grouped.map(([group, items]) => (
            <div key={group} className="mb-3">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 px-2 mb-1">{group}</p>
              {items.map((s) => {
                const selected = s.id === chat?.id;
                return (
                  <div key={s.id} onClick={() => openChat(s.id)}
                    className={`group relative rounded-lg px-2.5 py-2 cursor-pointer transition-all ${selected ? 'bg-violet-600/15 border border-violet-500/30' : 'border border-transparent hover:bg-gray-800/70'}`}>
                    <div className="flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.id === chat?.id && active ? 'bg-emerald-400 animate-pulse' : 'bg-gray-600'}`}></span>
                      <p className={`text-sm truncate flex-1 ${selected ? 'text-white font-medium' : 'text-gray-200'}`}>{s.title}</p>
                      <span className="text-[11px] text-gray-500 shrink-0 group-hover:hidden">{relative(s.started_at)}</span>
                      <button onClick={(e) => { e.stopPropagation(); deleteChat(s.id); }} title="Delete chat"
                        className="hidden group-hover:block text-gray-500 hover:text-red-400 text-xs px-1">
                        <i className="fa-solid fa-trash"></i>
                      </button>
                    </div>
                    {s.last_message && (
                      <p className="text-xs text-gray-500 truncate mt-0.5 pl-3.5">
                        {s.last_message.sender === 'caller' ? 'You: ' : ''}{s.last_message.text}
                      </p>
                    )}
                    <p className="text-[11px] text-gray-600 pl-3.5 mt-0.5">
                      {s.message_count} {s.message_count === 1 ? 'message' : 'messages'} · {formatDuration(s.duration)}
                      {!s.online && ' · offline'}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {summaries.length > 0 && (
          <div className="p-2 border-t border-gray-800 flex items-center justify-between">
            <span className="text-[11px] text-gray-500 px-1">{summaries.length} saved {summaries.length === 1 ? 'chat' : 'chats'}</span>
            <button onClick={clearHistory} className="text-[11px] text-gray-500 hover:text-red-400 px-2 py-1">Clear all</button>
          </div>
        )}
      </aside>

      {/* Chat */}
      <section className="bg-gray-900 rounded-xl border border-gray-800 flex flex-col overflow-hidden min-h-[560px]">
        {!chat ? (
          /* Welcome */
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-2xl mx-auto px-6 py-10 space-y-6">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-900/40">
                  <span className="text-2xl font-bold text-white">{initials}</span>
                </div>
                <h2 className="text-xl font-bold text-white mt-4">Chat with {identity.agentName}</h2>
                <p className="text-sm text-gray-400 mt-1">
                  Test how your AI receptionist from <span className="text-gray-200">{identity.companyName}</span> answers callers, by text.
                  Every chat is saved to your history.
                </p>
              </div>

              <div className="rounded-xl border border-gray-800 bg-gray-950/40 p-5">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Opening line</p>
                  {!editingGreeting && (
                    <button onClick={() => { setTempGreeting(welcome); setEditingGreeting(true); }}
                      className="text-xs text-violet-300 hover:text-violet-200"><i className="fa-solid fa-pen mr-1"></i>Edit</button>
                  )}
                </div>
                {editingGreeting ? (
                  <div className="space-y-2">
                    <textarea value={tempGreeting} onChange={(e) => setTempGreeting(e.target.value)} rows={3}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-violet-500 outline-none resize-none" />
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setEditingGreeting(false)} className="px-3 py-1.5 rounded-lg border border-gray-700 text-xs text-gray-300 hover:bg-gray-800">Cancel</button>
                      <button onClick={saveWelcome}
                        disabled={!tempGreeting.trim()} className="px-3 py-1.5 rounded-lg bg-violet-600 text-xs text-white hover:bg-violet-700 disabled:opacity-40">Save</button>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-gray-200 leading-relaxed">"{welcome}"</p>
                )}
                <p className="text-[11px] text-gray-500 mt-2">The same welcome your website visitors see (Chat › Widget setup).</p>
              </div>

              <button onClick={startChat} disabled={opening}
                className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white font-semibold flex items-center justify-center gap-2 shadow-lg disabled:opacity-60">
                <i className={`fa-solid ${opening ? 'fa-spinner fa-spin' : 'fa-comment-dots'}`}></i>Start a chat
              </button>

              <div>
                <p className="text-xs text-gray-500 mb-2 text-center">Or start with a question</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {quickPrompts.slice(0, 4).map((p) => (
                    <button key={p} onClick={async () => { await startChat(); setInput(p); }}
                      className="px-3 py-1.5 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:border-violet-500 hover:text-white">{p}</button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="px-4 py-3 border-b border-gray-800 flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center">
                  <span className="text-sm font-bold text-white">{(chat.agent_name || 'A').charAt(0).toUpperCase()}</span>
                </div>
                <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-gray-900 ${active ? 'bg-emerald-400' : 'bg-gray-500'}`}></span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white truncate">{chat.title === 'New chat' ? chat.agent_name : chat.title}</p>
                <p className="text-xs text-gray-400 truncate">
                  {active ? (isTyping ? <span className="text-violet-300">{chat.agent_name} is typing…</span> : <span className="text-emerald-300">Live</span>)
                    : `Ended · ${new Date(chat.started_at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`}
                  {' · '}{formatDuration(secondsOf(chat))}
                  {!chat.online && ' · offline answers'}
                </p>
              </div>
              <span className={`hidden sm:inline text-[11px] ${saveState === 'offline' ? 'text-amber-300' : 'text-gray-500'}`}
                title={saveState === 'offline' ? 'The backend is not running: this chat is not being saved' : 'Saved to history'}>
                <i className={`fa-solid ${saveState === 'saving' ? 'fa-spinner fa-spin' : saveState === 'offline' ? 'fa-cloud-arrow-up' : 'fa-check'} mr-1`}></i>
                {saveState === 'saving' ? 'Saving' : saveState === 'offline' ? 'Not saved' : 'Saved'}
              </span>
              <div className="flex items-center gap-1">
                {active ? (
                  <button onClick={endChat} className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300 text-xs hover:bg-red-500/20">
                    <i className="fa-solid fa-phone-slash mr-1.5"></i>End
                  </button>
                ) : (
                  <button onClick={startChat} className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs hover:bg-emerald-500/20">
                    <i className="fa-solid fa-plus mr-1.5"></i>New chat
                  </button>
                )}
                <button onClick={exportChat} title="Download transcript" className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800">
                  <i className="fa-solid fa-download text-sm"></i>
                </button>
                <button onClick={() => deleteChat(chat.id)} title="Delete chat" className="w-8 h-8 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-800">
                  <i className="fa-solid fa-trash text-sm"></i>
                </button>
                <button onClick={() => setShowInsights(!showInsights)} title={showInsights ? 'Hide insights' : 'Show insights'}
                  className={`hidden 2xl:block w-8 h-8 rounded-lg hover:bg-gray-800 ${showInsights ? 'text-violet-300' : 'text-gray-400 hover:text-white'}`}>
                  <i className="fa-solid fa-chart-simple text-sm"></i>
                </button>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4 bg-[radial-gradient(ellipse_at_top,rgba(124,58,237,0.06),transparent_60%)]">
              {chat.messages.map((m, i) => {
                const prev = chat.messages[i - 1];
                const grouped = prev && prev.sender === m.sender && m.sender !== 'system';
                if (m.sender === 'system') {
                  return (
                    <div key={m.id} className="flex justify-center">
                      <span className="px-3 py-1 rounded-full bg-gray-800/80 text-[11px] text-gray-400">
                        <i className="fa-solid fa-circle-info mr-1.5"></i>{m.text}
                      </span>
                    </div>
                  );
                }
                const agent = m.sender === 'agent';
                return (
                  <div key={m.id} className={`flex items-end gap-2 ${agent ? '' : 'flex-row-reverse'} ${grouped ? '-mt-2' : ''}`}>
                    <div className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center text-[11px] font-semibold ${grouped ? 'invisible' : ''} ${
                      agent ? 'bg-gradient-to-br from-violet-500 to-indigo-600 text-white' : 'bg-gray-700 text-gray-200'}`}>
                      {agent ? (chat.agent_name || 'A').charAt(0).toUpperCase() : <i className="fa-solid fa-user text-[10px]"></i>}
                    </div>
                    <div className={`max-w-[78%] flex flex-col ${agent ? 'items-start' : 'items-end'}`}>
                      <div className={`px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap break-words ${
                        agent ? 'bg-gray-800 border border-gray-700/70 text-gray-100 rounded-2xl rounded-bl-md'
                          : 'bg-gradient-to-br from-violet-600 to-indigo-600 text-white rounded-2xl rounded-br-md shadow-md shadow-violet-900/30'}`}>
                        {agent ? <FormattedMessage text={m.text} /> : m.text}
                      </div>
                      <div className={`flex items-center gap-1.5 mt-1 px-1 text-[11px] text-gray-500 ${agent ? '' : 'flex-row-reverse'}`}>
                        <span>{clock(m.at)}</span>
                        {m.intent && <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300">{m.intent}</span>}
                        {m.ms !== undefined && <span>· {(m.ms / 1000).toFixed(1)}s</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {isTyping && (
                <div className="flex items-end gap-2">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center text-[11px] font-semibold text-white">
                    {(chat.agent_name || 'A').charAt(0).toUpperCase()}
                  </div>
                  <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-gray-800 border border-gray-700/70 flex gap-1">
                    {[0, 150, 300].map((d) => <span key={d} className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: `${d}ms` }}></span>)}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Composer */}
            <div className="border-t border-gray-800 p-3">
              {active ? (
                <>
                  <div className="flex gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
                    {quickPrompts.map((p) => (
                      <button key={p} onClick={() => sendMessage(p)} disabled={isTyping}
                        className="shrink-0 px-3 py-1 rounded-full bg-gray-800 border border-gray-700 text-xs text-gray-300 hover:border-violet-500 hover:text-white disabled:opacity-40">{p}</button>
                    ))}
                  </div>
                  <div className="flex items-end gap-2 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 focus-within:border-violet-500">
                    <textarea ref={inputRef} value={input} rows={1} onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
                      placeholder="Type as the caller…  (Enter to send, Shift+Enter for a new line)"
                      className="flex-1 bg-transparent text-sm text-white placeholder-gray-500 outline-none resize-none max-h-32 py-1" />
                    <button onClick={() => sendMessage(input)} disabled={!input.trim() || isTyping}
                      className="w-9 h-9 shrink-0 rounded-lg bg-violet-600 hover:bg-violet-700 text-white disabled:opacity-40 flex items-center justify-center">
                      <i className="fa-solid fa-paper-plane text-sm"></i>
                    </button>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-between gap-3 px-1">
                  <p className="text-xs text-gray-500"><i className="fa-solid fa-lock mr-1.5"></i>This chat has ended and is read-only.</p>
                  <button onClick={startChat} className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-700 text-white text-xs">
                    <i className="fa-solid fa-plus mr-1.5"></i>Start a new chat
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </section>

      {/* Insights */}
      {chat && showInsights && (
        <aside className="hidden 2xl:flex flex-col gap-4 overflow-y-auto">
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">This chat</h3>
            <div className="grid grid-cols-2 gap-2">
              {[
                ['Caller messages', String(stats.caller), 'fa-user'],
                ['Agent replies', String(stats.agent), 'fa-robot'],
                ['Avg reply time', stats.avgMs ? `${(stats.avgMs / 1000).toFixed(1)}s` : '—', 'fa-stopwatch'],
                ['Duration', formatDuration(secondsOf(chat)), 'fa-clock'],
              ].map(([label, value, icon]) => (
                <div key={label} className="rounded-lg bg-gray-800/60 px-3 py-2.5">
                  <p className="text-[11px] text-gray-500"><i className={`fa-solid ${icon} mr-1`}></i>{label}</p>
                  <p className="text-lg font-semibold text-white mt-0.5">{value}</p>
                </div>
              ))}
            </div>
            <div className={`mt-3 text-xs rounded-lg px-3 py-2 ${chat.online ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}>
              <i className={`fa-solid ${chat.online ? 'fa-circle-check' : 'fa-plug-circle-xmark'} mr-1.5`}></i>
              {chat.online ? 'Answered by the AI agent (backend)' : 'Offline answers (backend not running)'}
            </div>
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-3">Detected intents</h3>
            {stats.intents.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">None yet. Ask the agent something.</p>
            ) : (
              <div className="space-y-2">
                {stats.intents.map(([name, count]) => (
                  <div key={name}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-gray-300">{name}</span>
                      <span className="text-gray-500">{count}</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-gray-800 overflow-hidden">
                      <div className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500"
                        style={{ width: `${Math.round((count / Math.max(1, stats.agent)) * 100)}%` }}></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 text-xs text-gray-400 space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-400">Agent</h3>
            <p><span className="text-gray-500">Name:</span> <span className="text-gray-200">{chat.agent_name}</span></p>
            <p><span className="text-gray-500">Company:</span> <span className="text-gray-200">{chat.company_name}</span></p>
            <p className="text-gray-500 pt-1">Want to hear it? Try a voice call in <span className="text-gray-300">Make a Call</span>.</p>
          </div>
        </aside>
      )}
    </div>
  );
}
