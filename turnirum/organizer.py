"""Кабинет организатора: создание турниров, таблицы команд, бизнес-модель."""
from datetime import date, datetime

from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, url_for

from .auth import require_role
from .db import execute, get_db
from .finance import total_split
from .queries import get_tournament, list_tournaments, standings, team_name_taken
from .utils import (GAME_NAMES, card_brand, digits_only, format_card, game_style, luhn_valid, split_members,
                    to_int)

bp = Blueprint("organizer", __name__, url_prefix="/organizer")

STAT_FIELDS = ("wins", "draws", "losses", "score_for", "score_against", "points")


@bp.before_request
def only_organizers():
    return require_role("organizer")


def owned_tournament_or_404(tid):
    t = get_tournament(tid)
    if t is None or t["organizer_id"] != g.user["id"]:
        abort(404)
    return t


# ------------------------------------------------------------ форма --------

def empty_form():
    return {
        "title": "", "game": "", "description": "", "format": "online", "city": "",
        "start_date": "", "start_time": "18:00", "max_teams": "16", "team_size": "5",
        "is_paid": "0", "entry_fee": "", "card_number": "", "prize_percent": "60", "prize_note": "",
    }


def form_from_tournament(t):
    start = datetime.fromisoformat(t["start_at"])
    return {
        "title": t["title"], "game": t["game"], "description": t["description"],
        "format": t["format"], "city": t["city"],
        "start_date": start.strftime("%Y-%m-%d"), "start_time": start.strftime("%H:%M"),
        "max_teams": str(t["max_teams"]), "team_size": str(t["team_size"]),
        "is_paid": "1" if t["is_paid"] else "0",
        "entry_fee": str(t["entry_fee"] or ""), "card_number": format_card(t["card_number"] or ""),
        "prize_percent": str(t["prize_percent"]), "prize_note": t["prize_note"],
    }


def parse_tournament_form(raw, min_teams=2, is_new=True):
    """Проверяет форму турнира. Возвращает (значения для формы, данные для БД, ошибки)."""
    form = {key: (raw.get(key) or "").strip() for key in empty_form()}
    form["is_paid"] = "1" if form["is_paid"] == "1" else "0"
    form["format"] = form["format"] if form["format"] in {"online", "offline"} else "online"
    errors = {}
    max_prize = 100 - current_app.config["PLATFORM_FEE_PERCENT"]

    if not 3 <= len(form["title"]) <= 80:
        errors["title"] = "Название: от 3 до 80 символов."
    if not 1 <= len(form["game"]) <= 40:
        errors["game"] = "Укажите игру или дисциплину."
    if len(form["description"]) > 2000:
        errors["description"] = "Описание слишком длинное (до 2000 символов)."
    if form["format"] == "offline" and not form["city"]:
        errors["city"] = "Для офлайн-турнира укажите город или площадку."

    start_at = None
    try:
        start_at = datetime.strptime(f"{form['start_date']} {form['start_time'] or '18:00'}", "%Y-%m-%d %H:%M")
        if is_new and start_at.date() < date.today():
            errors["start_date"] = "Дата старта не может быть в прошлом."
    except ValueError:
        errors["start_date"] = "Укажите дату и время старта."

    max_teams = to_int(form["max_teams"], lo=2, hi=256)
    if max_teams is None:
        errors["max_teams"] = "От 2 до 256 команд."
    elif max_teams < min_teams:
        errors["max_teams"] = f"Уже зарегистрировано {min_teams} команд — лимит не может быть меньше."
    team_size = to_int(form["team_size"], lo=1, hi=12)
    if team_size is None:
        errors["team_size"] = "От 1 до 12 игроков."

    is_paid = form["is_paid"] == "1"
    entry_fee, card, prize_percent = 0, None, 60
    if is_paid:
        entry_fee = to_int(form["entry_fee"], lo=100, hi=10_000_000)
        if entry_fee is None:
            errors["entry_fee"] = "Взнос — целое число от 100 до 10 000 000."
        card = digits_only(form["card_number"])
        if not luhn_valid(card):
            errors["card_number"] = "Проверьте номер карты — он введён с ошибкой."
        prize_percent = to_int(form["prize_percent"], lo=0, hi=max_prize)
        if prize_percent is None:
            errors["prize_percent"] = f"Доля призового фонда — от 0 до {max_prize} %."
    if len(form["prize_note"]) > 200:
        errors["prize_note"] = "До 200 символов."

    data = {
        "title": form["title"], "game": form["game"], "description": form["description"],
        "format": form["format"], "city": form["city"] if form["format"] == "offline" else "",
        "start_at": start_at.strftime("%Y-%m-%d %H:%M") if start_at else None,
        "max_teams": max_teams, "team_size": team_size, "is_paid": int(is_paid),
        "entry_fee": entry_fee or 0, "card_number": card if is_paid else None,
        "prize_percent": prize_percent if prize_percent is not None else 60,
        "prize_note": form["prize_note"],
    }
    return form, data, errors


def _render_form(form, errors, t=None):
    return render_template("organizer/form.html", form=form, errors=errors, t=t, games=GAME_NAMES,
                           game_styles={name: game_style(name) for name in GAME_NAMES},
                           max_prize=100 - current_app.config["PLATFORM_FEE_PERCENT"],
                           today=date.today().isoformat())


@bp.route("/tournaments/new", methods=["GET", "POST"])
def create():
    if request.method == "POST":
        form, data, errors = parse_tournament_form(request.form)
        if not errors:
            tid = execute(
                """INSERT INTO tournaments (organizer_id, title, game, description, format, city, start_at,
                       max_teams, team_size, is_paid, entry_fee, card_number, prize_percent, prize_note)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (g.user["id"], data["title"], data["game"], data["description"], data["format"], data["city"],
                 data["start_at"], data["max_teams"], data["team_size"], data["is_paid"], data["entry_fee"],
                 data["card_number"], data["prize_percent"], data["prize_note"]),
            )
            flash(f"Турнир «{data['title']}» создан и открыт для регистрации!", "success")
            return redirect(url_for("organizer.manage", id=tid))
        flash("Проверьте поля формы — некоторые заполнены неверно.", "error")
        return _render_form(form, errors)
    return _render_form(empty_form(), {})


@bp.route("/tournaments/<int:tid>/edit", methods=["GET", "POST"])
def edit(tid):
    t = owned_tournament_or_404(tid)
    if request.method == "POST":
        form, data, errors = parse_tournament_form(request.form, min_teams=max(2, t["team_count"]), is_new=False)
        if not errors:
            execute(
                """UPDATE tournaments SET title = ?, game = ?, description = ?, format = ?, city = ?, start_at = ?,
                       max_teams = ?, team_size = ?, is_paid = ?, entry_fee = ?, card_number = ?,
                       prize_percent = ?, prize_note = ?
                   WHERE id = ? AND organizer_id = ?""",
                (data["title"], data["game"], data["description"], data["format"], data["city"], data["start_at"],
                 data["max_teams"], data["team_size"], data["is_paid"], data["entry_fee"], data["card_number"],
                 data["prize_percent"], data["prize_note"], tid, g.user["id"]),
            )
            flash("Изменения сохранены.", "success")
            return redirect(url_for("organizer.manage", id=tid))
        flash("Проверьте поля формы — некоторые заполнены неверно.", "error")
        return _render_form(form, errors, t)
    return _render_form(form_from_tournament(t), {}, t)


# ------------------------------------------------------------ мои турниры --

@bp.get("/tournaments")
def manage():
    tournaments = list_tournaments("t.organizer_id = ?", (g.user["id"],),
                                   order="CASE t.status WHEN 'active' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END,"
                                         " t.start_at ASC")
    selected = None
    wanted = to_int(request.args.get("id"))
    if tournaments:
        selected = next((t for t in tournaments if t["id"] == wanted), tournaments[0])
    teams = standings(selected["id"]) if selected else []
    brand = card_brand(selected["card_number"]) if selected and selected["card_number"] else None
    return render_template("organizer/manage.html", tournaments=tournaments, t=selected, teams=teams, brand=brand)


@bp.post("/tournaments/<int:tid>/table")
def save_table(tid):
    t = owned_tournament_or_404(tid)
    auto_points = request.form.get("auto_points") == "1"
    teams = standings(tid)
    seen_names, updates, problems = set(), [], []

    for team in teams:
        prefix = f"t{team['id']}_"
        name = request.form.get(prefix + "name", team["name"]).strip()[:40]
        if len(name) < 2:
            problems.append(f"У команды «{team['name']}» слишком короткое название.")
            name = team["name"]
        if name.casefold() in seen_names:
            problems.append(f"Название «{name}» повторяется — оставлено прежнее.")
            name = team["name"]
        seen_names.add(name.casefold())

        values = {}
        for field in STAT_FIELDS:
            value = to_int(request.form.get(prefix + field), None, lo=0, hi=99999)
            values[field] = team[field] if value is None else value
        if auto_points:
            values["points"] = values["wins"] * 3 + values["draws"]
        members = request.form.get(prefix + "members")
        members = "\n".join(split_members(members, t["team_size"])) if members is not None else team["members"]
        is_paid = int(request.form.get(prefix + "is_paid") == "1") if t["is_paid"] else team["is_paid"]
        updates.append((name, members, *[values[f] for f in STAT_FIELDS], is_paid, team["id"], tid))

    if updates:
        conn = get_db()
        # Временные имена снимают конфликт UNIQUE, если команды поменялись названиями.
        ids = [team["id"] for team in teams]
        conn.execute(f"UPDATE teams SET name = '~' || id || '~' || name WHERE id IN ({','.join('?' * len(ids))})",
                     ids)
        conn.executemany(
            """UPDATE teams SET name = ?, members = ?, wins = ?, draws = ?, losses = ?, score_for = ?,
                   score_against = ?, points = ?, is_paid = ? WHERE id = ? AND tournament_id = ?""",
            updates,
        )
        conn.commit()
    for problem in problems:
        flash(problem, "warning")
    flash("Турнирная таблица сохранена.", "success")
    return redirect(url_for("organizer.manage", id=tid) + "#table")


@bp.post("/tournaments/<int:tid>/teams")
def add_team(tid):
    t = owned_tournament_or_404(tid)
    name = request.form.get("name", "").strip()
    members = split_members(request.form.get("members", ""), t["team_size"])
    if t["team_count"] >= t["max_teams"]:
        flash("Достигнут лимит команд. Увеличьте его в настройках турнира.", "warning")
    elif not 2 <= len(name) <= 40:
        flash("Название команды: от 2 до 40 символов.", "error")
    elif team_name_taken(tid, name):
        flash("Команда с таким названием уже есть.", "error")
    else:
        is_paid = int(bool(t["is_paid"]) and request.form.get("is_paid") == "1")
        execute("INSERT INTO teams (tournament_id, name, members, is_paid) VALUES (?, ?, ?, ?)",
                (tid, name, "\n".join(members), is_paid))
        flash(f"Команда «{name}» добавлена.", "success")
    return redirect(url_for("organizer.manage", id=tid) + "#table")


@bp.post("/tournaments/<int:tid>/teams/<int:team_id>/delete")
def delete_team(tid, team_id):
    owned_tournament_or_404(tid)
    execute("DELETE FROM teams WHERE id = ? AND tournament_id = ?", (team_id, tid))
    flash("Команда удалена из турнира.", "info")
    return redirect(url_for("organizer.manage", id=tid) + "#table")


@bp.post("/tournaments/<int:tid>/status")
def set_status(tid):
    owned_tournament_or_404(tid)
    status = request.form.get("status")
    if status not in {"registration", "active", "finished"}:
        abort(400)
    execute("UPDATE tournaments SET status = ? WHERE id = ? AND organizer_id = ?", (status, tid, g.user["id"]))
    labels = {"registration": "Регистрация открыта.", "active": "Турнир запущен!", "finished": "Турнир завершён."}
    flash(labels[status], "success")
    return redirect(url_for("organizer.manage", id=tid))


# ------------------------------------------------------------ бизнес-модель -

@bp.get("/business")
def business():
    tournaments = list_tournaments("t.organizer_id = ?", (g.user["id"],), order="t.start_at DESC")
    paid = [t for t in tournaments if t["is_paid"]]
    collected = total_split(t["finance"]["collected"] for t in paid)
    potential = total_split(t["finance"]["potential"] for t in paid)
    pending = sum(t["finance"]["pending_amount"] for t in paid)
    pending_teams = sum(t["finance"]["pending_teams"] for t in paid)
    avg_prize = round(sum(t["prize_percent"] for t in paid) / len(paid)) if paid else 60
    return render_template("organizer/business.html", tournaments=tournaments, paid=paid, collected=collected,
                           potential=potential, pending=pending, pending_teams=pending_teams,
                           avg_prize=avg_prize, max_prize=100 - current_app.config["PLATFORM_FEE_PERCENT"])
