"""Spoken numbers in a caller's words written as digits.

Speech-to-text on calls gives numbers as words ("three oh eight", "four
ten", "fifty thousand"), especially Vosk and Whisper on this PC, and
Deepgram's numerals option gives a digit string as "3 0 8". Transcripts and
the agent read better with "308", "410" and "50000", so every final caller
transcript goes through `digits()` before it is stored, shown or answered.

Kept conservative:
- a single digit word on its own stays a word ("one moment", "no one",
  "I have two questions"); two or more number words in a row become digits
  ("three oh eight" -> "308", "double five" -> "55");
- "oh" / "o" counts as zero only after another number word ("oh, okay"
  stays as it is);
- cardinals of ten and above become digits ("twenty five" -> "25",
  "two hundred and fifty" -> "250");
- ordinals ("twenty eighth") and words inside other words are left alone.

This is the opposite direction of speakable.py (text for the voice to say),
which is not affected.
"""
import re

_DIGIT = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
          "six": 6, "seven": 7, "eight": 8, "nine": 9}
_TEEN = {"ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
         "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19}
_TENS = {"twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
         "seventy": 70, "eighty": 80, "ninety": 90}
_SCALE = {"thousand": 1000, "million": 1000000}
_MULT = {"double": 2, "triple": 3}
_ORDINAL = {"first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth"}

_LEAD = re.compile(r"^[(\"'\[]+")
_TRAIL = re.compile(r"[.,!?;:)\"'\]]+$")


def _kind(core: str):
    """(kind, value) of one word, or None when it isn't a number word."""
    if core in _DIGIT:
        return "digit", _DIGIT[core]
    if core in ("oh", "o"):
        return "oh", 0
    if core in _TEEN:
        return "teen", _TEEN[core]
    if core in _TENS:
        return "tens", _TENS[core]
    if core == "hundred":
        return "hundred", 100
    if core in _SCALE:
        return "scale", _SCALE[core]
    if core in _MULT:
        return "mult", _MULT[core]
    if core == "and":
        return "and", 0
    if re.fullmatch(r"\d{1,4}", core):
        return "num", core
    return None


def _words(token: str):
    """The number words of a token ("twenty-five" -> two), or None."""
    core = token.lower()
    if "-" in core and re.search(r"\d", core):
        return None                     # "410-555-22" is already written as digits
    parts = core.split("-") if "-" in core else [core]
    kinds = [_kind(p) for p in parts]
    if any(k is None for k in kinds) or (len(kinds) > 1 and any(k[0] in ("and", "mult", "oh") for k in kinds)):
        return None
    return kinds


def _chunks(words: list) -> list:
    """Digit strings of a run of number words."""
    out, cur = [], None          # cur: {"total", "now", "last", "words"}

    def flush():
        nonlocal cur
        if cur is not None:
            out.append(str(cur["total"] + cur["now"]))
            cur = None

    i = 0
    while i < len(words):
        kind, v = words[i]
        last = cur["last"] if cur else None
        if kind == "mult":
            flush()
            out.append(str(words[i + 1][1]) * v)   # the run only has "double" before a digit
            i += 2
            continue
        if kind == "num":
            flush()
            out.append(v)
        elif kind in ("digit", "oh"):
            if last in ("tens", "hundred", "scale", "and") and kind == "digit":
                cur["now"] += v
                cur["last"] = "unit"
            else:
                flush()
                cur = {"total": 0, "now": v, "last": "single"}
        elif kind in ("teen", "tens"):
            if last in ("hundred", "scale", "and"):
                cur["now"] += v
            else:
                flush()
                cur = {"total": 0, "now": v, "last": kind}
            cur["last"] = "unit" if kind == "teen" else "tens"
        elif kind == "hundred":
            cur["now"] = (cur["now"] or 1) * 100
            cur["last"] = "hundred"
        elif kind == "scale":
            cur["total"] += (cur["now"] or 1) * v
            cur["now"] = 0
            cur["last"] = "scale"
        elif kind == "and":
            cur["last"] = "and"
        i += 1
    flush()
    return out


def _can_follow(prev: tuple, kind: str, nxt) -> bool:
    """May a word of `kind` continue a run whose last word was `prev`?"""
    if kind == "oh":
        return prev[0] in ("digit", "oh", "teen", "tens", "num")
    if kind in ("hundred", "scale"):
        return prev[0] in ("digit", "teen", "tens", "hundred") and not (kind == "hundred" and prev[0] == "hundred")
    if kind == "and":
        return prev[0] in ("hundred", "scale") and nxt is not None and nxt[0] in ("digit", "teen", "tens")
    return True


def digits(text: str) -> str:
    """`text` with spoken numbers written as digits (see the module notes)."""
    if not text:
        return text
    tokens = text.split()
    out: list = []
    i = 0
    while i < len(tokens):
        run, words, j = [], [], i
        while j < len(tokens):
            tok = tokens[j]
            lead = _LEAD.match(tok)
            trail = _TRAIL.search(tok)
            core = tok[lead.end() if lead else 0: trail.start() if trail else len(tok)]
            if lead and run:
                break
            kinds = _words(core) if core else None
            if not kinds:
                break
            nxt_tok = tokens[j + 1] if j + 1 < len(tokens) else ""
            nxt_core = _TRAIL.sub("", _LEAD.sub("", nxt_tok)).lower()
            nxt = _kind(nxt_core) if nxt_core else None
            first = kinds[0]
            if not run and first[0] in ("oh", "hundred", "scale", "and"):
                break                                    # a run can't start with these
            if run and not _can_follow(words[-1], first[0], nxt):
                break
            if first[0] == "mult" and (nxt is None or nxt[0] not in ("digit", "oh") or (trail and trail.group())):
                break                                    # "double" only before a digit
            run.append(tok)
            words.extend(kinds)
            j += 1
            if trail:
                # A comma between single digits ("three, oh, eight") keeps the run going.
                if not (trail.group() == "," and first[0] in ("digit", "oh", "num")
                        and nxt is not None and nxt[0] in ("digit", "oh", "num", "mult")):
                    break
        if not run:
            out.append(tokens[i])
            i += 1
            continue
        after = _TRAIL.sub("", _LEAD.sub("", tokens[j])).lower() if j < len(tokens) else ""
        if after in _ORDINAL and words and words[-1][0] == "tens" and len(_words(_TRAIL.sub("", run[-1])) or []) == 1:
            words.pop()                                   # "twenty eighth": an ordinal, left as words
            j -= 1
            run.pop()
        while words and words[-1][0] in ("and", "mult"):   # never end on "and"
            words.pop()
            j -= 1
            run.pop()
        if not run:
            out.append(tokens[i])
            i += 1
            continue
        chunks = _chunks(words)
        lone_word = len(words) == 1 and words[0][0] in ("digit", "num")
        if lone_word or (len(chunks) == 1 and words[0][0] == "num"):
            out.extend(run)                               # one digit word, or already digits
        else:
            lead = _LEAD.match(run[0])
            trail = _TRAIL.search(run[-1])
            tail = trail.group().lstrip(",") if trail else ""
            out.append((lead.group() if lead else "") + "".join(chunks) + tail)
        i = j
    joined = " ".join(out)
    return re.sub(r"\b\d(?:-\d){2,}\b", lambda m: m.group().replace("-", ""), joined)  # "3-0-8" -> "308"
