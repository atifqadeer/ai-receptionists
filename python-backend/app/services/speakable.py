"""
Text as it should be read aloud on a call.

Job data comes from recruiters' portals in short-hand: "£30,000+ (DOE)
(30-32k per annum)", "£12.50/hr", "£25k-£28k pa". Text-to-speech voices
read that badly (digit by digit, "k", "slash h r", "D O E"), so before
speaking, money, ranges and the usual abbreviations become words:
"thirty thousand pounds plus, depending on experience, thirty to
thirty-two thousand pounds a year". Only the spoken audio changes; the
transcript keeps the original text.

Phone numbers and other long digit strings are left alone.
"""

import re

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
         "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"]
_CURRENCY = {"£": ("pound", "pounds", "penny", "pence"), "$": ("dollar", "dollars", "cent", "cents"),
             "€": ("euro", "euros", "cent", "cents")}
# After an amount: how often. A full stop after "pa" / "p.h." is kept when
# it ends the sentence.
_DOT = r"(?:\.(?=\s+[a-z]))?"
_PER = [
    (r"\s?(?:/|per|a|an)\s?(?:annum|year|yr)\b|\s?p\.?\s?a\b" + _DOT, " a year"),
    (r"\s?(?:/|per|an)\s?(?:hour|hr|h)\b|\s?p\.?\s?h\b" + _DOT, " an hour"),
    (r"\s?(?:/|per|a)\s?day\b", " a day"),
    (r"\s?(?:/|per|a)\s?shift\b", " a shift"),
    (r"\s?(?:/|per|a)\s?(?:week|wk)\b|\s?p\.?\s?w\b" + _DOT, " a week"),
    (r"\s?(?:/|per|a)\s?(?:month|mth)\b|\s?p\.?\s?c\.?\s?m\b" + _DOT, " a month"),
]
_END = "\x00"          # marks where a spoken amount ends, for _per
_ABBREV = [
    (r"\(?\bD\.?O\.?E\b(?:\.(?=\s+[a-z]|\)))?\)?", ", depending on experience,"),
    (r"\bdependent on experience\b", "depending on experience"),
    (r"\bO\.?T\.?E\.?\b", "on target earnings"),
    (r"\bneg\.?\b|\bnegotiable\b", "negotiable"),
    (r"\bapprox\.?(?=\s)", "approximately"),
    (r"\bhrs\b", "hours"),
    (r"\bhr\b", "hour"),
    (r"\bmins\b", "minutes"),
    (r"\bwk\b", "week"),
    (r"\bmon-fri\b", "Monday to Friday"),
    (r"\bft\b", "full-time"),
    (r"\bpt\b", "part-time"),
    (r"\be\.g\.", "for example"),
    (r"\betc\.?", "and so on"),
]


def words(n: int) -> str:
    """0 <= n < 10^12, in words ("thirty-two thousand five hundred")."""
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + ("-" + _ONES[n % 10] if n % 10 else "")
    if n < 1000:
        rest = n % 100
        return _ONES[n // 100] + " hundred" + (" and " + words(rest) if rest else "")
    for size, name in ((10 ** 9, "billion"), (10 ** 6, "million"), (1000, "thousand")):
        if n >= size:
            rest = n % size
            tail = ""
            if rest:
                tail = (" and " if rest < 100 else " ") + words(rest)
            return words(n // size) + " " + name + tail
    return str(n)


def _amount(num: str, mult: str) -> tuple:
    """("thirty thousand", whole, pence) for "30" + "k"; pence None when no decimals."""
    num = num.replace(",", "")
    whole_s, _, dec = num.partition(".")
    whole = int(whole_s or 0)
    m = (mult or "").lower()
    factor = {"k": 1000, "m": 10 ** 6, "mil": 10 ** 6, "million": 10 ** 6, "thousand": 1000, "bn": 10 ** 9}.get(m, 1)
    if factor > 1:
        value = float(num) * factor
        return words(int(round(value))), int(round(value)), None
    pence = int((dec + "0")[:2]) if dec else None
    return words(whole), whole, pence


_NUM = r"(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?"
_MULT = r"(k|K|m|M|mil|million|thousand|bn)?\b"
_MONEY = re.compile(
    r"(?P<cur>[£$€])\s?(?P<a>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?P<am>k|K|m|M|mil|million|thousand|bn)?(?![\w])"
    r"(?:\s?(?:-|–|—|to)\s?(?:[£$€])?\s?(?P<b>\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)\s?(?P<bm>k|K|m|M|mil|million|thousand|bn)?(?![\w]))?"
    r"(?P<plus>\s?\+)?")
# "30-32k", "25k - 28k" with no currency sign
_K_RANGE = re.compile(r"\b(\d+(?:\.\d)?)\s?(k|K)?\s?(?:-|–|—|to)\s?(\d+(?:\.\d)?)\s?(k|K)\b(?P<plus>\s?\+)?")
_K_ONE = re.compile(r"\b(\d+(?:\.\d)?)(k|K)\b(?P<plus>\s?\+)?")


def _say_money(cur: str, a: str, am: str, b: str, bm: str, plus: bool) -> str:
    one, many, cent, cents = _CURRENCY[cur]
    if b and not am and bm:
        am = bm                               # "£30-32k": both are thousands
    a_words, a_whole, a_pence = _amount(a, am)
    if b:
        b_words, b_whole, b_pence = _amount(b, bm or am)
        if a_pence is None and b_pence is None:
            out = f"{a_words} to {b_words} {many if b_whole != 1 else one}"
        else:
            out = f"{_with_pence(a_words, a_whole, a_pence, one, many, cent, cents)} to " \
                  f"{_with_pence(b_words, b_whole, b_pence, one, many, cent, cents)}"
    else:
        out = _with_pence(a_words, a_whole, a_pence, one, many, cent, cents)
    return out + (" plus" if plus else "")


def _with_pence(w: str, whole: int, pence, one: str, many: str, cent: str, cents: str) -> str:
    if pence:
        if one == "pound":
            return f"{w} {one if whole == 1 else many} {words(pence)}"   # "twelve pounds fifty"
        return f"{w} {one if whole == 1 else many} and {words(pence)} {cent if pence == 1 else cents}"
    return f"{w} {one if whole == 1 else many}"


def _per(text: str) -> str:
    """"…pounds/hr" -> "…pounds an hour" (only straight after an amount)."""
    for pat, rep in _PER:
        text = re.sub(_END + r"(?:" + pat + r")", rep, text, flags=re.I)
    return text.replace(_END, "")


def for_speech(text: str) -> str:
    """`text` as it should be spoken."""
    if not text or not re.search(r"[£$€\d]|\b(DOE|OTE|hrs?|pa|ph)\b", text, re.I):
        return text
    t = text
    # Amounts without a sign ("30-32k") are in the text's own currency.
    cur = next((c for c in _CURRENCY if c in t), "")
    unit = " " + _CURRENCY[cur][1] if cur else ""
    t = _MONEY.sub(lambda m: _say_money(m["cur"], m["a"], m["am"] or "", m["b"] or "", m["bm"] or "",
                                        bool(m["plus"])) + _END, t)
    t = _K_RANGE.sub(lambda m: f"{_amount(m[1], m[2] or m[4])[0]} to {_amount(m[3], m[4])[0]}{unit}"
                     + (" plus" if m["plus"] else "") + _END, t)
    t = _K_ONE.sub(lambda m: _amount(m[1], m[2])[0] + unit + (" plus" if m["plus"] else "") + _END, t)
    t = _per(t)
    t = re.sub(r"(?i)\bper annum\b|\bp\.a\.(?=\s|$)", "a year", t)
    t = re.sub(r"(?i)\bper hour\b", "an hour", t)
    for pat, rep in _ABBREV:
        t = re.sub(pat, rep, t, flags=re.I)
    # "(depending on experience) (thirty to …)" -> commas, so it reads as one sentence
    t = re.sub(r"\s*\(\s*([^()]{1,80}?)\s*\)\s*", r", \1, ", t)
    t = re.sub(r"\s+,", ",", t)
    t = re.sub(r",\s*([.!?])", r"\1", t)
    t = re.sub(r",\s*$", ".", t)
    t = re.sub(r"\s*,(\s*,)+", ",", t)
    # Plain numbers with thousands separators: "38,000 applicants"
    t = re.sub(r"(?<![\d.])(\d{1,3}(?:,\d{3})+)(?![\d,])", lambda m: words(int(m[1].replace(",", ""))), t)
    # Number ranges like "9-5" or "3-4 days" read "to"
    t = re.sub(r"(?<![\d:])(\d{1,2})\s?[-–]\s?(\d{1,2})(?![\d:])", r"\1 to \2", t)
    return re.sub(r"\s{2,}", " ", t).strip()
