"""Публичная часть: главная, каталог с фильтрами, страница турнира, участие."""
from flask import Blueprint, abort, current_app, flash, g, redirect, render_template, request, url_for

from .auth import roles_required
from .db import execute, query_all, query_one
from .finance import total_split
from .queries import (find_team_by_captain, get_tournament_or_404, list_tournaments, standings,
                      team_name_taken)
from .utils import split_members, to_int

bp = Blueprint("main", __name__)

SORTS = {
    "soon": ("Скоро старт", "t.start_at ASC"),
    "new": ("Новые", "t.created_at DESC, t.id DESC"),
    "popular": ("Популярные", "team_count DESC, t.start_at ASC"),
    "prize": ("Большой призовой", "(t.is_paid * t.entry_fee * t.max_teams * t.prize_percent) DESC, t.start_at ASC"),
    "fee_asc": ("Дешевле", "t.is_paid ASC, t.entry_fee ASC, t.start_at ASC"),
    "fee_desc": ("Дороже", "t.is_paid DESC, t.entry_fee DESC, t.start_at ASC"),
}


def _like(value):
    escaped = value.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


@bp.get("/")
def index():
    featured = list_tournaments("t.status = 'registration'", order="t.created_at DESC, t.id DESC", limit=6)
    if len(featured) < 3:
        featured = list_tournaments(order="t.created_at DESC, t.id DESC", limit=6)
    everything = list_tournaments()
    stats = {
        "tournaments": len(everything),
        "teams": query_one("SELECT COUNT(*) FROM teams")[0],
        "players": query_one("SELECT COUNT(*) FROM users WHERE role = 'participant'")[0],
        "prize": total_split(t["finance"]["collected"] for t in everything).prize,
    }
    by_priority = sorted(everything, key=lambda t: ({"active": 0, "finished": 1}.get(t["status"], 2), -t["team_count"]))
    showcase = next((t for t in by_priority if t["team_count"] >= 3), None)
    showcase_teams = standings(showcase["id"])[:5] if showcase else []
    return render_template("index.html", featured=featured, stats=stats,
                           showcase=showcase, showcase_teams=showcase_teams)


@bp.get("/tournaments")
def catalog():
    args = request.args
    f = {
        "q": args.get("q", "").strip()[:80],
        "game": args.get("game", "").strip(),
        "price": args.get("price", "all"),
        "status": args.get("status", "all"),
        "fmt": args.get("fmt", "all"),
        "max_fee": to_int(args.get("max_fee"), None, lo=0),
        "available": args.get("available") == "1",
        "joined": args.get("joined") == "1",
        "sort": args.get("sort", "soon"),
    }
    if f["sort"] not in SORTS:
        f["sort"] = "soon"

    where, params = [], []
    if f["q"]:
        where.append("(casefold(t.title) LIKE ? ESCAPE '\\' OR casefold(t.game) LIKE ? ESCAPE '\\'"
                     " OR casefold(t.description) LIKE ? ESCAPE '\\' OR casefold(t.city) LIKE ? ESCAPE '\\'"
                     " OR casefold(u.full_name) LIKE ? ESCAPE '\\')")
        params += [_like(f["q"])] * 5
    if f["game"]:
        where.append("casefold(t.game) = ?")
        params.append(f["game"].casefold())
    if f["price"] == "free":
        where.append("t.is_paid = 0")
    elif f["price"] == "paid":
        where.append("t.is_paid = 1")
    if f["status"] in {"registration", "active", "finished"}:
        where.append("t.status = ?")
        params.append(f["status"])
    if f["fmt"] in {"online", "offline"}:
        where.append("t.format = ?")
        params.append(f["fmt"])
    if f["max_fee"] is not None and f["price"] != "free":
        where.append("(t.is_paid = 0 OR t.entry_fee <= ?)")
        params.append(f["max_fee"])
    if f["available"]:
        where.append("t.status = 'registration' AND "
                     "(SELECT COUNT(*) FROM teams tm WHERE tm.tournament_id = t.id) < t.max_teams")
    if f["joined"] and g.user and g.user["role"] == "participant":
        where.append("EXISTS (SELECT 1 FROM teams tm WHERE tm.tournament_id = t.id AND tm.captain_id = ?)")
        params.append(g.user["id"])

    tournaments = list_tournaments(" AND ".join(where), params, order=SORTS[f["sort"]][1])
    games = query_all("SELECT game, COUNT(*) AS n FROM tournaments GROUP BY casefold(game) ORDER BY n DESC, game")
    fee_ceiling = query_one("SELECT COALESCE(MAX(entry_fee), 0) FROM tournaments WHERE is_paid = 1")[0]
    fee_ceiling = max(1000, -(-fee_ceiling // 500) * 500)

    joined_ids = set()
    if g.user and g.user["role"] == "participant":
        joined_ids = {r[0] for r in query_all("SELECT tournament_id FROM teams WHERE captain_id = ?",
                                              (g.user["id"],))}
    active_filters = sum([bool(f["q"]), bool(f["game"]), f["price"] != "all", f["status"] != "all",
                          f["fmt"] != "all", f["max_fee"] is not None, f["available"], f["joined"]])
    return render_template("tournaments/catalog.html", tournaments=tournaments, f=f, games=games,
                           sorts=SORTS, fee_ceiling=fee_ceiling, joined_ids=joined_ids,
                           active_filters=active_filters)


@bp.get("/tournaments/<int:tid>")
def detail(tid):
    t = get_tournament_or_404(tid)
    teams = standings(tid)
    my_team = None
    if g.user and g.user["role"] == "participant":
        my_team = next((tm for tm in teams if tm["captain_id"] == g.user["id"]), None)
    is_owner = bool(g.user and g.user["id"] == t["organizer_id"])
    return render_template("tournaments/detail.html", t=t, teams=teams, my_team=my_team, is_owner=is_owner)


def _join_blocker(t):
    if t["status"] != "registration":
        return "Регистрация на этот турнир закрыта."
    if t["slots_left"] <= 0:
        return "Все места на турнире уже заняты."
    if find_team_by_captain(t["id"], g.user["id"]):
        return "Вы уже зарегистрировали команду на этот турнир."
    return None


@bp.route("/tournaments/<int:tid>/join", methods=["GET", "POST"])
@roles_required("participant")
def join(tid):
    t = get_tournament_or_404(tid)
    blocker = _join_blocker(t)
    if blocker:
        flash(blocker, "warning")
        return redirect(url_for("main.detail", tid=tid))

    form = {"name": "", "members": g.user["full_name"], "payment_note": ""}
    errors = {}
    if request.method == "POST":
        form = {
            "name": request.form.get("name", "").strip(),
            "members": request.form.get("members", "").strip(),
            "payment_note": request.form.get("payment_note", "").strip()[:120],
        }
        members = split_members(form["members"])
        if not 2 <= len(form["name"]) <= 40:
            errors["name"] = "Название команды: от 2 до 40 символов."
        elif team_name_taken(tid, form["name"]):
            errors["name"] = "Команда с таким названием уже участвует."
        if not members:
            errors["members"] = "Укажите хотя бы одного игрока."
        elif len(members) > t["team_size"]:
            errors["members"] = f"В команде может быть не больше {t['team_size']} игроков."
        if t["is_paid"]:
            if request.form.get("paid_confirm") != "1":
                errors["paid_confirm"] = "Подтвердите, что перевели взнос на карту организатора."
            if len(form["payment_note"]) < 2:
                errors["payment_note"] = "Укажите имя отправителя или последние 4 цифры вашей карты."

        if not errors:
            execute(
                "INSERT INTO teams (tournament_id, captain_id, name, members, payment_note) VALUES (?, ?, ?, ?, ?)",
                (tid, g.user["id"], form["name"], "\n".join(members), form["payment_note"]),
            )
            if t["is_paid"]:
                flash("Команда зарегистрирована! Организатор подтвердит оплату в ближайшее время.", "success")
            else:
                flash("Команда зарегистрирована! Удачи на турнире.", "success")
            return redirect(url_for("main.detail", tid=tid))

    return render_template("tournaments/join.html", t=t, form=form, errors=errors)


@bp.post("/tournaments/<int:tid>/leave")
@roles_required("participant")
def leave(tid):
    t = get_tournament_or_404(tid)
    team = find_team_by_captain(tid, g.user["id"])
    if team is None:
        abort(404)
    if t["status"] != "registration":
        flash("Турнир уже начался — сняться с него нельзя.", "warning")
    elif team["is_paid"]:
        flash("Взнос уже подтверждён. Для возврата свяжитесь с организатором.", "warning")
    else:
        execute("DELETE FROM teams WHERE id = ?", (team["id"],))
        flash(f"Команда «{team['name']}» снята с турнира.", "info")
    return redirect(url_for("main.detail", tid=tid))


@bp.app_context_processor
def inject_globals():
    return {
        "PLATFORM_FEE": current_app.config["PLATFORM_FEE_PERCENT"],
        "CURRENCY": current_app.config["CURRENCY"],
    }
