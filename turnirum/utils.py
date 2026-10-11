"""Вспомогательные функции: банковские карты, игры, даты, склонения."""
import hashlib
import re
from datetime import date, datetime

# ---------------------------------------------------------------- карты ----


def digits_only(value):
    return re.sub(r"\D", "", value or "")


def luhn_valid(number):
    """Проверка номера карты по алгоритму Луна (ловит опечатки при вводе)."""
    if not number.isdigit() or not 13 <= len(number) <= 19:
        return False
    total = 0
    for i, ch in enumerate(reversed(number)):
        d = int(ch)
        if i % 2 == 1:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def luhn_check_digit(partial):
    """Контрольная цифра, которую нужно дописать к partial, чтобы номер стал валидным."""
    for digit in "0123456789":
        if luhn_valid(partial + digit):
            return digit
    raise ValueError(partial)


def card_brand(number):
    number = number or ""
    if number[:4] in {"2200", "2201", "2202", "2203", "2204"}:
        return "МИР"
    if number.startswith("4"):
        return "VISA"
    if number[:2] in {"51", "52", "53", "54", "55"} or "2221" <= number[:4] <= "2720":
        return "Mastercard"
    if number.startswith("62"):
        return "UnionPay"
    if number[:2] in {"34", "37"}:
        return "AMEX"
    return "CARD"


def format_card(number):
    number = number or ""
    return " ".join(number[i:i + 4] for i in range(0, len(number), 4))


def mask_card(number):
    return f"•••• {number[-4:]}" if number else ""


# ---------------------------------------------------------------- игры -----

# Название, короткая подпись для обложки и два цвета градиента.
GAMES = [
    ("Counter-Strike 2", "CS2", "#f59e0b", "#ef4444"),
    ("Dota 2", "DOTA", "#ef4444", "#7c3aed"),
    ("Valorant", "VAL", "#fb7185", "#9333ea"),
    ("League of Legends", "LoL", "#06b6d4", "#3b82f6"),
    ("PUBG Mobile", "PUBG", "#f59e0b", "#65a30d"),
    ("Mobile Legends", "MLBB", "#3b82f6", "#8b5cf6"),
    ("Standoff 2", "SO2", "#f97316", "#eab308"),
    ("EA FC", "FC", "#22c55e", "#0891b2"),
    ("Fortnite", "FN", "#a855f7", "#ec4899"),
    ("Clash Royale", "CR", "#0ea5e9", "#facc15"),
    ("Шахматы", "ШАХ", "#64748b", "#a78bfa"),
    ("Мини-футбол", "ФУТ", "#16a34a", "#22d3ee"),
]
_GAME_INDEX = {name.casefold(): (abbr, c1, c2) for name, abbr, c1, c2 in GAMES}
GAME_NAMES = [name for name, *_ in GAMES]


def hue_of(text):
    return int(hashlib.md5((text or "").encode("utf-8")).hexdigest()[:6], 16) % 360


def game_style(name):
    known = _GAME_INDEX.get((name or "").casefold())
    if known:
        abbr, c1, c2 = known
        return {"abbr": abbr, "c1": c1, "c2": c2}
    h = hue_of(name)
    words = [w for w in re.split(r"[\s\-_:]+", name or "") if w]
    abbr = "".join(w[0] for w in words[:3]).upper() or "?"
    return {"abbr": abbr, "c1": f"hsl({h} 85% 60%)", "c2": f"hsl({(h + 50) % 360} 80% 45%)"}


def initials(text):
    words = [w for w in re.split(r"\s+", (text or "").strip()) if w]
    if not words:
        return "?"
    if len(words) == 1:
        return words[0][:2].upper()
    return (words[0][0] + words[1][0]).upper()


# ---------------------------------------------------------------- даты -----

MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля",
          "августа", "сентября", "октября", "ноября", "декабря"]
MONTHS_SHORT = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"]
WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]


def parse_dt(value):
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def ru_date(value, with_time=False, short=False):
    dt = parse_dt(value)
    if not dt:
        return ""
    month = (MONTHS_SHORT if short else MONTHS)[dt.month - 1]
    text = f"{dt.day} {month}"
    if dt.year != date.today().year:
        text += f" {dt.year}"
    if with_time:
        text += f", {dt:%H:%M}"
    return text


def days_until(value):
    dt = parse_dt(value)
    if not dt:
        return None
    return (dt.date() - date.today()).days


def plural(n, one, few, many):
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def to_int(value, default=None, lo=None, hi=None):
    """Безопасно превратить строку из формы в число в заданных границах."""
    try:
        n = int(str(value).strip().replace(" ", "").replace(" ", ""))
    except (TypeError, ValueError):
        return default
    if lo is not None and n < lo:
        return default
    if hi is not None and n > hi:
        return default
    return n


def split_members(text, limit=None):
    parts = [p.strip() for p in re.split(r"[\n,;]+", text or "")]
    members = [p[:40] for p in parts if p]
    return members[:limit] if limit else members
