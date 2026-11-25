"""
Knowledge search - answers caller questions from the Company Knowledge
text and the uploaded .md/.txt documents when no AI model is available.

Documents are read by their structure, not line by line: each heading
starts a section, bullet lists are kept together under their heading or
"label:" line, and "Q: ... / A: ..." pairs become question/answer entries.
A question is matched against section headings, document titles, list
items and FAQ questions (rare words count more than common ones), and
the answer is the matching section, list, sentence or FAQ answer — never
a bare heading or the FAQ question itself.
"""

import math
import re
from difflib import SequenceMatcher
from dataclasses import dataclass, field
from typing import Optional

STOPWORDS = {
    "what", "when", "where", "which", "your", "yours", "about", "there",
    "their", "this", "that", "with", "have", "does", "did", "will",
    "would", "could", "should", "please", "thanks", "thank",
    # Short filler words: 3-letter words are kept as key words (app, fee,
    # web, ceo, nmc, cqc), so the common ones are listed here.
    "the", "and", "you", "are", "how", "can", "for", "our", "any", "get",
    "has", "its", "was", "who", "why", "may", "not", "all", "one", "out",
    "use", "way", "but", "tell", "know", "want", "like", "need", "much",
    "many", "some", "also", "just", "from", "into", "they", "them", "then",
    "than", "were", "been", "being", "here", "hello", "okay", "work",
    "doe", "being", "more", "most", "such", "other", "each", "only",
}

# Words that ask about money all map to one key word, so "how much does
# a website cost" matches "a website starts at $2,500".
PRICE_WORDS = {
    "cost", "costs", "price", "prices", "pricing", "priced", "charge",
    "charges", "fee", "fees", "rate", "rates", "expensive", "cheap",
    "budget", "quote", "pay", "salary", "salaries", "wage", "wages",
    "paid", "earn", "earning", "earnings", "income",
}

# Two-letter words that carry meaning (CV, UK, HR); every other
# two-letter word is filler.
_SHORT_KEY_WORDS = {"cv", "uk", "hr"}

# Words for a job opening all map to "job": "which roles do you have"
# matches "Main Recruitment Categories" and "positions ... recruit for".
JOB_WORDS = {
    "job", "jobs", "role", "roles", "position", "positions", "vacancy",
    "vacancies", "opening", "openings", "category", "categories",
}

# Question words that only ask for the list of jobs ("what jobs are
# available", "which positions do you recruit for").
_LIST_WORDS = {
    "job", "available", "current", "currently", "kind", "type", "list",
    "offer", "recruit", "hire", "hiring", "open", "vacant", "provide",
    "give", "find",
}

_OVERVIEW_WORDS = {"company", "business", "agency", "organisation", "organization", "firm", "yourself", "introduction", "overview"}


def _stem(w: str) -> str:
    if w in PRICE_WORDS:
        return "price"
    if w in JOB_WORDS:
        return "job"
    if len(w) > 4 and w.endswith("ies"):
        return w[:-3] + "y"
    if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
        return w[:-1]
    return w


def key_words(text: str) -> set:
    """The key words of a text: lower-case, filler words dropped, simple
    plurals and money/job synonyms folded together."""
    words = set()
    if "$" in text or "£" in text:
        words.add("price")
    for w in re.findall(r"[a-z0-9]+", (text or "").lower()):
        if (len(w) < 3 and w not in _SHORT_KEY_WORDS) or w in STOPWORDS:
            continue
        w = _stem(w)
        if w not in STOPWORDS:
            words.add(w)
    return words


@dataclass
class Unit:
    """One searchable piece of a document."""
    kind: str                     # "section", "qa" or "line"
    doc: str                      # document title
    heading: str = ""             # section heading, list label, or FAQ question
    items: list = field(default_factory=list)   # str sentences / list items, or nested Unit lists
    answer: str = ""              # FAQ answer (kind == "qa")
    parent: Optional["Unit"] = None
    is_list: bool = False         # items are bullet points
    order: int = 0
    instruction: bool = False     # written for the AI agent, never read to a caller


def _clean(line: str) -> str:
    line = re.sub(r"^#+\s*", "", line.strip())
    line = re.sub(r"^\s*>\s?", "", line)
    line = re.sub(r"^([-*•]|\d+[.)])\s+", "", line)
    line = line.replace("**", "").replace("__", "").strip()
    # snake_case field names ("full_name") read as words.
    if "_" in line and " " not in line:
        line = line.replace("_", " ")
    return line.strip()


# Text written as instructions for the agent ("The AI Agent must not
# guarantee employment", "You are the AI Recruitment Assistant") guides
# the AI model; it is not an answer to read out to a caller.
_INSTRUCTION = re.compile(r"\b(ai agent|ai assistant|the assistant|recruitment assistant|you are the|agent must|must never|must not)\b", re.I)
_INSTRUCTION_DOC = re.compile(r"\b(ai agent|agent rules|behaviou?r|instructions?|prompt|data collection)\b", re.I)


def _doc_title(text: str, name: str) -> str:
    for line in (text or "").splitlines():
        if re.match(r"^#\s+", line):
            title = _clean(line)
            # "Job Category: Nurse" -> "Nurse"
            if ":" in title:
                title = title.split(":", 1)[1].strip() or title
            return title
    return re.sub(r"[_\-]+", " ", re.sub(r"\.\w+$", "", name or "")).strip()


def parse_document(text: str, name: str = "") -> tuple:
    """Split one document into searchable units. Returns (title, units)."""
    title = _doc_title(text, name)
    instruction_doc = bool(_INSTRUCTION_DOC.search(title) or _INSTRUCTION_DOC.search(name or ""))
    units: list = []
    lines = (text or "").splitlines()

    root = Unit(kind="section", doc=title, heading="")
    units.append(root)
    stack = [(0, root)]          # (heading level, section)
    label: Optional[Unit] = None  # "Industry Sectors:" list label
    pending_q: Optional[str] = None
    pending_q_unit: Optional[Unit] = None

    def section() -> Unit:
        return stack[-1][1]

    def add_line(text_: str, owner: Unit, is_item: bool) -> None:
        owner.items.append(text_)
        if is_item:
            owner.is_list = True
        if len(text_) > 3:
            units.append(Unit(kind="line", doc=title, heading=text_, parent=owner))

    i = 0
    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()
        i += 1
        if not stripped or re.fullmatch(r"[|:\-\s=*_]+", stripped):
            continue

        # Headings start a new section, nested under shallower headings.
        m = re.match(r"^(#+)\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            label = None
            if level == 1:
                continue  # the document title
            while len(stack) > 1 and stack[-1][0] >= level:
                stack.pop()
            parent = section()
            sec = Unit(kind="section", doc=title, heading=_clean(m.group(2)), parent=parent)
            parent.items.append(sec)   # parent sections list their sub-sections
            units.append(sec)
            stack.append((level, sec))
            continue

        # FAQ pairs: "Q: question" followed by "A: answer".
        qm = re.match(r"^(?:q|question)\s*[:.)-]\s*(.+)$", stripped, re.I)
        if qm:
            pending_q = _clean(qm.group(1))
            pending_q_unit = section()
            continue
        am = re.match(r"^(?:a|answer)\s*[:.)-]\s*(.+)$", stripped, re.I)
        if am and pending_q:
            units.append(Unit(kind="qa", doc=title, heading=pending_q,
                              answer=_clean(am.group(1)), parent=pending_q_unit))
            pending_q = None
            continue

        # Markdown table: each row becomes "Header: value. Header: value."
        if "|" in stripped and i < len(lines) and re.fullmatch(r"[|:\-\s]+", lines[i].strip() or "x"):
            header = [_clean(c) for c in stripped.strip("|").split("|")]
            i += 1
            while i < len(lines) and "|" in lines[i]:
                row = [_clean(c) for c in lines[i].strip().strip("|").split("|")]
                if len(row) == len(header):
                    add_line(". ".join(f"{h}: {c}" for h, c in zip(header, row)) + ".", section(), True)
                else:
                    add_line(" — ".join(c for c in row if c), section(), True)
                i += 1
            continue

        is_item = bool(re.match(r"^([-*•]|\d+[.)])\s+", stripped))
        line = _clean(stripped)
        if not line:
            continue

        # "Industry Sectors:" / "The candidate provides:" introduces a list.
        if not is_item and line.endswith(":") and len(line) < 120:
            label = Unit(kind="section", doc=title, heading=line.rstrip(":").strip(), parent=section())
            section().items.append(label)
            units.append(label)
            continue

        if is_item and label is not None:
            add_line(line, label, True)
            continue
        if not is_item:
            label = None

        if not is_item and len(line) > 220:
            for part in re.split(r"(?<=[.!?])\s+", line):
                if len(part.strip()) > 15:
                    add_line(part.strip(), section(), False)
        else:
            add_line(line, section(), is_item)

    for n, u in enumerate(units):
        u.order = n
        own = u.answer if u.kind == "qa" else " ".join(x for x in [u.heading] + u.items if isinstance(x, str))
        in_notes = u.parent is not None and u.parent.heading.lower().startswith("important note")
        u.instruction = instruction_doc or in_notes or bool(_INSTRUCTION.search(own))
    return title, units


def _text_of(item) -> str:
    return item if isinstance(item, str) else _format_section(item, 0)


def _join_list(items: list) -> str:
    items = [s.rstrip(".;, ") for s in items if s.strip()]
    if len(items) > 8:
        return ", ".join(items[:8]) + " and more"
    if len(items) > 1:
        return ", ".join(items[:-1]) + " and " + items[-1]
    return items[0] if items else ""


def _format_section(sec: Unit, depth: int = 0) -> str:
    """Speakable text of a section: prose as sentences, bullet lists as
    "Heading: a, b and c.", sub-sections by their headings."""
    strings = [s for s in sec.items if isinstance(s, str)]
    subs = [s for s in sec.items if isinstance(s, Unit)]
    parts = []
    if sec.is_list and strings:
        short = sum(len(s) for s in strings) / len(strings) < 60
        if short:
            parts.append(f"{sec.heading}: {_join_list(strings)}." if sec.heading else _join_list(strings) + ".")
        else:
            parts.append(" ".join(s if s.endswith((".", "!", "?")) else s + "." for s in strings[:5]))
    elif strings:
        parts.append(" ".join(s if s.endswith((".", "!", "?", ":")) else s + "." for s in strings))
    if subs:
        if depth == 0:
            # Sub-sections: list labels are read out; headings are named.
            for sub in subs:
                if sub.items and all(isinstance(x, str) for x in sub.items) and sub.is_list:
                    parts.append(_format_section(sub, depth + 1))
            headed = [s.heading for s in subs if not (s.is_list and all(isinstance(x, str) for x in s.items))]
            if headed:
                parts.append(f"{sec.heading}: {_join_list(headed)}." if sec.heading and not strings else _join_list(headed) + ".")
    text = " ".join(p for p in parts if p).strip()
    return _trim(text)


def _trim(text: str, limit: int = 600) -> str:
    if len(text) <= limit:
        return text
    cut = text[:limit]
    end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
    return cut[: end + 1] if end > 200 else cut.rstrip() + "..."


class KnowledgeBase:
    """Searchable knowledge built from the agent's knowledge sources."""

    def __init__(self, sources: list, company_name: str = ""):
        # sources: list of (name, text); the Company Knowledge text first.
        self.company_name = company_name or ""
        self.docs = []      # (name, title, units)
        self.units = []
        for name, text in sources:
            title, units = parse_document(text, name)
            self.docs.append((name, title, units))
            self.units.extend(units)
        n = max(1, len(self.units))
        df: dict = {}
        self._fields = {}
        for u in self.units:
            f = self._unit_fields(u)
            self._fields[id(u)] = f
            for w in set().union(*f.values()):
                df[w] = df.get(w, 0) + 1
        self.idf = {w: math.log(1 + n / c) for w, c in df.items()}
        self.titles = [t for _, t, _ in self.docs if t]

    @staticmethod
    def _unit_fields(u: Unit) -> dict:
        title = key_words(u.doc)
        if u.kind == "qa":
            return {"head": key_words(u.heading), "title": title, "body": key_words(u.answer)}
        if u.kind == "line":
            return {"head": key_words(u.heading), "title": title,
                    "body": key_words(u.parent.heading if u.parent else "")}
        body = " ".join(_text_of(x) if isinstance(x, str) else x.heading for x in u.items)
        return {"head": key_words(u.heading), "title": title, "body": key_words(body)}

    # ---- answers ----

    def overview(self) -> Optional[str]:
        """The company introduction: the first prose of the company
        document (or of the Company Knowledge text)."""
        name_words = key_words(self.company_name)

        def rank(doc):
            name, title, _ = doc
            words = key_words(name + " " + title)
            return (("company" in words or "about" in name.lower() or "overview" in words) * 2
                    + bool(words & name_words))
        ordered = sorted(self.docs, key=rank, reverse=True) if self.docs else []
        for _, _, units in ordered:
            prose = []
            for u in units:
                if u.kind != "section" or u.is_list:
                    continue
                for s in u.items:
                    if isinstance(s, str) and len(s) > 40 and not re.match(r"^[\w\s]{1,30}:\s", s):
                        prose.append(s)
                if len(prose) >= 2:
                    break
            if prose:
                return _trim(" ".join(prose[:2]), 400)
        return None

    def _job_list(self) -> Optional[str]:
        """Answer to "which jobs do you have": the FAQ answer or section
        that names the most of the documents' titles (the role names)."""
        titles = [t for t in self.titles if 2 < len(t) < 40]
        if len(titles) < 2:
            return None
        best, best_key = None, (1, 0)
        for u in self.units:
            text = u.answer if u.kind == "qa" else (_format_section(u) if u.kind == "section" else "")
            if not text:
                continue
            low = text.lower()
            hits = sum(1 for t in titles if t.lower() in low)
            key = (hits, 1 if u.kind == "qa" else 0)
            if key > best_key:
                best, best_key = text, key
        return best if best_key[0] >= 2 else None

    # ---- roles (one document per job role) ----

    def roles(self) -> list:
        """Titles of the documents that describe a job role: a short title
        and sections such as Job Description / Responsibilities."""
        out = []
        for _, title, units in self.docs:
            if not title or len(title.split()) > 3:
                continue
            if any(u.kind == "section" and not u.instruction and
                   re.search(r"job description|responsibilit|requirement", u.heading, re.I) for u in units):
                out.append(title)
        return out

    def find_role(self, text: str) -> Optional[str]:
        """The role named in the text ("I'm a sous chef" -> "Sous Chef");
        the longest title wins, so "Sous Chef" beats "Chef"."""
        low = " " + re.sub(r"[^a-z0-9 ]", " ", (text or "").lower()) + " "
        for title in sorted(self.roles(), key=len, reverse=True):
            if re.search(r"\b" + re.escape(title.lower()) + r"(s|es)?\b", low):
                return title
        return None

    def role_intro(self, title: str) -> Optional[str]:
        intro = self._doc_intro(title)
        if intro is None:
            return None
        strings = [x for x in intro.items if isinstance(x, str)]
        return strings[0] if strings else None

    def screening_questions(self, title: str) -> list:
        """The role's screening questions, asked one at a time."""
        for _, t, units in self.docs:
            if t != title:
                continue
            for u in units:
                if u.kind == "section" and re.search(r"screening question", u.heading, re.I):
                    return [x for x in u.items if isinstance(x, str) and x.strip()]
        return []

    def next_after(self, ref: Optional[tuple]) -> Optional[tuple]:
        """("tell me more") The section after the one last answered, as
        (text, ref)."""
        if not ref:
            return None
        for u in self.units:
            if u.kind == "section" and (u.doc, u.heading) == ref:
                nxt = self._next_section(u)
                while nxt is not None and not _format_section(nxt):
                    nxt = self._next_section(nxt)
                if nxt is not None:
                    return _format_section(nxt), (nxt.doc, nxt.heading)
                return None
        return None

    def search(self, question: str, topic: Optional[str] = None) -> Optional[str]:
        return self.search_detail(question, topic)[0]

    def faq_answer(self, question: str, min_similarity: float = 0.75) -> Optional[str]:
        """The answer of the documents' FAQ (Q:/A: pair) whose question is
        the one asked: the same key words and close wording. None when no
        FAQ question matches that closely."""
        q = key_words(question)
        if not q:
            return None
        said = " ".join(re.findall(r"[a-z0-9]+", question.lower()))
        best, best_ratio = None, 0.0
        for u in self.units:
            if u.kind != "qa" or not u.answer or self._fields[id(u)]["head"] != q:
                continue
            asked = " ".join(re.findall(r"[a-z0-9]+", u.heading.lower()))
            ratio = SequenceMatcher(None, said, asked).ratio()
            if ratio > best_ratio:
                best, best_ratio = u, ratio
        return best.answer if best is not None and best_ratio >= min_similarity else None

    def search_detail(self, question: str, topic: Optional[str] = None) -> tuple:
        """(answer, ref) for a question; ref names the section answered
        from, for "tell me more". topic: the role being discussed, used
        when the question names none ("what are the requirements")."""
        text, unit = self._search(question, topic)
        if unit is None:
            return text, None
        sec = unit.parent if unit.kind in ("line", "qa") else unit
        return text, ((sec.doc, sec.heading) if sec is not None and sec.heading else None)

    def _search(self, question: str, topic: Optional[str] = None) -> tuple:
        if not self.units:
            return None, None
        q = key_words(question)
        lower = question.lower()
        name_words = key_words(self.company_name)

        # "Tell me about your company", "who are you", "what does
        # Kingsbury Personnel do": the company introduction.
        if (q and q <= (name_words | _OVERVIEW_WORDS)) or "who are you" in lower or \
                ("about" in lower and q & {"company", "business", "agency"}):
            text = self.overview()
            if text:
                return text, None

        # "Which jobs / roles / positions do you have?": the role list.
        if "job" in q and q <= _LIST_WORDS | name_words:
            text = self._job_list()
            if text:
                return text, None

        q = q - {"company", "business"} - name_words
        if not q:
            return None, None
        # Follow-up questions ("what are the requirements") are about the
        # role being discussed, unless they name another document.
        q_asked = q
        if topic and not any(q & key_words(t) for t in self.titles):
            q = q | key_words(topic)

        best, best_key, best_matched = None, (0.0, 0.0), set()
        for u in self.units:
            # The untitled top of a document is searched through its lines:
            # for a plain-text knowledge box it is the whole text.
            if u.instruction or (u.kind == "section" and not u.heading):
                continue
            f = self._fields[id(u)]
            matched = q & (f["head"] | f["title"] | f["body"])
            if not (matched & q_asked) or not (q & (f["head"] | f["body"]) or q & f["title"] == q):
                continue
            idf = self.idf
            if u.kind == "line":
                w_head, w_title, w_body = 2.5, 1.5, 1.0
            else:
                w_head, w_title, w_body = 3.0, 1.5, 1.0
            score = sum(idf.get(w, 1.0) * (w_head * (w in f["head"]) + w_title * (w in f["title"]) + w_body * (w in f["body"]))
                        for w in q)
            # A document whose title only partly matches ("Sous Chef" for a
            # question about a "Chef") ranks below the exact one.
            if q & f["title"]:
                score -= 0.8 * sum(idf.get(w, 1.0) for w in f["title"] - q)
            # Covering every word of the question beats matching some of
            # them strongly: "responsibilities of a sous chef" wants the
            # Sous Chef "Main Responsibilities" section, not a line that
            # only names the Sous Chef.
            # A money question wants the line that states a price.
            if "price" in matched & q_asked:
                score += idf.get("price", 1.0) * w_head
            score *= (len(matched & q_asked) / len(q_asked)) ** 2
            # An FAQ whose question is the one asked wins: "how can I apply
            # for a job" is the FAQ "How can I apply for a job?", not "Can I
            # apply for more than one position?" (which shares its words).
            if u.kind == "qa" and f["head"]:
                overlap = len(q_asked & f["head"]) / len(q_asked | f["head"])
                if overlap > 0.66:
                    score *= 1 + 2 * overlap
                if q_asked == f["head"]:
                    # Same key words ("more than one" are filler words):
                    # the closer wording wins.
                    said = " ".join(re.findall(r"[a-z0-9]+", lower))
                    asked = " ".join(re.findall(r"[a-z0-9]+", u.heading.lower()))
                    score += 100 * (1 + SequenceMatcher(None, said, asked).ratio())
            # Ties go to the more focused text: "how do I start a project"
            # picks "To start a project, email ..." over a longer line that
            # merely mentions both words.
            focus = len(matched) / max(1, sum(1 for w in f["head"] | f["body"] if not w.isdigit()))
            key = (round(score, 6), focus)
            if key > best_key:
                best, best_key, best_matched = u, key, matched

        if best is None:
            return None, None
        # Enough of the question must be covered: half its key words, and
        # two of them once it has three or more.
        best_matched = best_matched & q_asked
        needed = 1 if len(q_asked) <= 2 else 2
        if len(best_matched) < needed or len(best_matched) * 2 < len(q_asked):
            return None, None
        # A question that only names a document ("tell me about the nurse
        # role", "what does a solicitor do") gets that document's
        # description, not a metadata line such as "Job Title: Nurse".
        title_words = self._fields[id(best)]["title"]
        if best_matched <= title_words | {"job", "description", "title"}:
            intro = self._doc_intro(best.doc)
            if intro is not None:
                return self._answer(intro), intro
        return self._answer(best), best

    def _doc_intro(self, doc_title: str) -> Optional[Unit]:
        """The first prose section of a document (its description)."""
        for _, title, units in self.docs:
            if title != doc_title:
                continue
            for u in units:
                if u.kind == "section" and u.heading and not u.is_list and not u.instruction:
                    if any(isinstance(x, str) and len(x) > 40 for x in u.items):
                        return u
        return None

    def _answer(self, u: Unit) -> Optional[str]:
        text = self._answer_text(u)
        if text and len(text) < 150 and u.kind != "qa":
            sec = u.parent if u.kind == "line" else u
            nxt = self._next_section(sec)
            if nxt is not None:
                more = _format_section(nxt)
                if more:
                    text = _trim(text + " " + more)
        return text

    def _next_section(self, sec: Optional[Unit]) -> Optional[Unit]:
        if sec is None or sec.parent is None or not sec.heading:
            return None
        siblings = [x for x in sec.parent.items if isinstance(x, Unit)]
        if sec in siblings:
            i = siblings.index(sec)
            if i + 1 < len(siblings) and not siblings[i + 1].instruction:
                return siblings[i + 1]
        return None

    def _answer_text(self, u: Unit) -> Optional[str]:
        if u.kind == "qa":
            return u.answer
        if u.kind == "line":
            parent = u.parent
            if parent is not None:
                strings = [s for s in parent.items if isinstance(s, str)]
                if parent.is_list and strings and sum(len(s) for s in strings) / len(strings) < 60:
                    return _format_section(parent)       # short list: read the list
                if not parent.is_list and parent.heading and 0 < sum(len(s) for s in strings) <= 450:
                    return _format_section(parent)       # short prose section: read it all
            text = u.heading
            return text if text.endswith((".", "!", "?")) else text + "."
        text = _format_section(u)
        return text or None
