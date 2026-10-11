"""Панель создателя платформы: прибыль, управление турнирами, пользователи."""
from collections import defaultdict

from flask import Blueprint, flash, redirect, render_template, request, url_for

from .auth import require_role
from .db import execute, query_all, query_one
from .finance import total_split
from .queries import get_tournament_or_404, list_tournaments
from .utils import plural

bp = Blueprint("creator", __name__, url_prefix="/creator")


@bp.before_request
def only_creator():
    return require_role("creator")


@bp.get("/")
def dashboard():
    tournaments = list_tournaments(order="t.created_at DESC, t.id DESC")
    paid = [t for t in tournaments if t["is_paid"]]
    collected = total_split(t["finance"]["collected"] for t in paid)
    expected = total_split(t["finance"]["expected"] for t in paid)
    potential = total_split(t["finance"]["potential"] for t in paid)

    by_game = defaultdict(lambda: {"platform": 0, "gmv": 0, "count": 0})
    by_organizer = defaultdict(lambda: {"platform": 0, "gmv": 0, "count": 0, "name": ""})
    for t in tournaments:
        money = t["finance"]["collected"]
        game = by_game[t["game"]]
        game["platform"] += money.platform
        game["gmv"] += money.total
        game["count"] += 1
        org = by_organizer[t["organizer_id"]]
        org["name"] = t["organizer_name"]
        org["platform"] += money.platform
        org["gmv"] += money.total
        org["count"] += 1

    games = sorted(by_game.items(), key=lambda kv: (-kv[1]["gmv"], -kv[1]["count"]))[:8]
    games_top = max([data["gmv"] for _, data in games] + [1])
    organizers = sorted(by_organizer.values(), key=lambda o: (-o["platform"], -o["count"]))[:6]
    top_paid = sorted(paid, key=lambda t: -t["finance"]["collected"].platform)[:8]

    roles = {r["role"]: r["n"] for r in query_all("SELECT role, COUNT(*) AS n FROM users GROUP BY role")}
    counts = {
        "organizers": roles.get("organizer", 0),
        "participants": roles.get("participant", 0),
        "tournaments": len(tournaments),
        "paid": len(paid),
        "free": len(tournaments) - len(paid),
        "teams": query_one("SELECT COUNT(*) FROM teams")[0],
        "active": sum(1 for t in tournaments if t["status"] == "active"),
    }
    return render_template("creator/dashboard.html", collected=collected, expected=expected, potential=potential,
                           games=games, games_top=games_top, organizers=organizers, top_paid=top_paid,
                           counts=counts)


@bp.get("/tournaments")
def tournaments():
    q = request.args.get("q", "").strip()[:80]
    where, params = "", ()
    if q:
        like = "%" + q.casefold().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        where = ("casefold(t.title) LIKE ? ESCAPE '\\' OR casefold(t.game) LIKE ? ESCAPE '\\'"
                 " OR casefold(u.full_name) LIKE ? ESCAPE '\\'")
        params = (like, like, like)
    items = list_tournaments(where, params, order="t.created_at DESC, t.id DESC")
    return render_template("creator/tournaments.html", tournaments=items, q=q)


@bp.post("/tournaments/<int:tid>/delete")
def delete_tournament(tid):
    t = get_tournament_or_404(tid)
    execute("DELETE FROM tournaments WHERE id = ?", (tid,))
    teams = t["team_count"]
    if teams:
        flash(f"Турнир «{t['title']}» удалён вместе с {teams} {plural(teams, 'командой', 'командами', 'командами')}.",
              "success")
    else:
        flash(f"Турнир «{t['title']}» удалён.", "success")
    if request.form.get("back") == "dashboard":
        return redirect(url_for("creator.dashboard"))
    return redirect(url_for("creator.tournaments", q=request.form.get("q") or None))


@bp.get("/users")
def users():
    rows = query_all(
        """SELECT u.*,
                  (SELECT COUNT(*) FROM tournaments t WHERE t.organizer_id = u.id) AS tournaments_count,
                  (SELECT COUNT(*) FROM teams tm WHERE tm.captain_id = u.id) AS teams_count
           FROM users u ORDER BY u.created_at DESC, u.id DESC""")
    return render_template("creator/users.html", users=rows)
