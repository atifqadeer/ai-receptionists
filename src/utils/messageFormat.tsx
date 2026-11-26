// Chat bubbles for the AI agent: show lists as bullet points.
//
// The knowledge base answers in one spoken-style sentence so the same text
// works on phone calls ("Main Responsibilities: Prepare ingredients, Cook
// meals, ... and more."). In a chat that reads as a wall of text, so here a
// sentence like that becomes a heading with bullets. Lines that already start
// with "-", "•", "*" or "1." are shown as bullets too. Everything else is left
// as it was. The website widget does the same (python-backend/app/widget/chatbot.js).

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'list'; heading: string; items: string[]; more: boolean; ordered: boolean };

const BULLET = /^\s*(?:[-•*▪●]|(\d+)[.)])\s+(.*)$/;
const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

// "Label: a, b, c and d." -> heading + items (null when it is not a list).
function inlineList(sentence: string): Block | null {
  const m = /^([^:]{2,60}):\s+(.+?)\.?$/.exec(sentence.trim());
  if (!m || words(m[1]) > 6) return null;
  const parts = m[2].split(/,\s+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  let more = false;
  let last = parts.pop() as string;
  if (/\s+and more$/i.test(last)) { more = true; last = last.replace(/\s+and more$/i, ''); parts.push(last); }
  else {
    const i = last.lastIndexOf(' and ');
    if (i > 0) parts.push(last.slice(0, i), last.slice(i + 5)); else parts.push(last);
  }
  const items = parts.map((x) => x.replace(/^(?:and|or)\s+/i, '').replace(/[.;]$/, '').trim()).filter(Boolean);
  if (items.length < 3 || items.some((x) => words(x) > 14)) return null;
  return { kind: 'list', heading: m[1].trim(), items: items.map((x) => x.charAt(0).toUpperCase() + x.slice(1)), more, ordered: false };
}

// Sentences, keeping the full stop; does not split "e.g. this" or "3.5".
function sentences(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if ((ch === '.' || ch === '!' || ch === '?') && /\s/.test(text[i + 1] || '') && /[A-Z"'(]/.test(text.slice(i + 1).trimStart()[0] || '')
      && !/\b(?:e\.g|i\.e|etc|Mr|Mrs|Ms|Dr|St|No)$/i.test(text.slice(start, i))) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  if (text.slice(start).trim()) out.push(text.slice(start).trim());
  return out;
}

export function parseMessage(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    // Inside a paragraph, turn "Label: a, b, c" sentences into lists.
    let prose: string[] = [];
    for (const s of sentences(para.join(' '))) {
      const list = inlineList(s);
      if (list) {
        if (prose.length) blocks.push({ kind: 'p', text: prose.join(' ') });
        prose = [];
        blocks.push(list);
      } else prose.push(s);
    }
    if (prose.length) blocks.push({ kind: 'p', text: prose.join(' ') });
    para = [];
  };

  for (const line of (text || '').split(/\r?\n/)) {
    const b = BULLET.exec(line);
    if (b) {
      let cur = blocks[blocks.length - 1];
      if (!para.length && cur && cur.kind === 'list' && !cur.more) {
        cur.items.push(b[2].trim());
        continue;
      }
      // The line before a bullet list ending in ":" is its heading.
      let heading = '';
      if (para.length && /:\s*$/.test(para[para.length - 1])) heading = (para.pop() as string).replace(/:\s*$/, '');
      flush();
      cur = { kind: 'list', heading, items: [b[2].trim()], more: false, ordered: !!b[1] };
      blocks.push(cur);
    } else if (line.trim()) {
      para.push(line.trim());
    } else {
      flush();
    }
  }
  flush();
  return blocks;
}

/** Message text with lists shown as bullets (for AI agent bubbles). */
export function FormattedMessage({ text, bulletClass = 'bg-violet-400' }: { text: string; bulletClass?: string }) {
  const blocks = parseMessage(text);
  if (blocks.length === 1 && blocks[0].kind === 'p') return <>{text}</>;
  return (
    <div className="space-y-2 whitespace-normal">
      {blocks.map((b, i) => b.kind === 'p' ? <p key={i}>{b.text}</p> : (
        <div key={i}>
          {b.heading && <p className="font-semibold mb-1">{b.heading}</p>}
          <ul className="space-y-1">
            {b.items.map((it, j) => (
              <li key={j} className="flex gap-2">
                {b.ordered
                  ? <span className="shrink-0 min-w-[1rem] opacity-70">{j + 1}.</span>
                  : <span className={`shrink-0 w-1.5 h-1.5 rounded-full mt-[0.55em] ${bulletClass}`}></span>}
                <span>{it}</span>
              </li>
            ))}
          </ul>
          {b.more && <p className="text-xs opacity-70 mt-1">…and more</p>}
        </div>
      ))}
    </div>
  );
}
