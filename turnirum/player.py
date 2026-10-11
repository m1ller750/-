"""Кабинет участника: турнирные таблицы."""
from flask import Blueprint, g, render_template, request

from .auth import require_role
from .queries import list_tournaments, standings
from .utils import to_int

bp = Blueprint("player", __name__, url_prefix="/player")


@bp.before_request
def only_participants():
    return require_role("participant")


@bp.get("/tables")
def tables():
    mine = list_tournaments(
        "EXISTS (SELECT 1 FROM teams tm WHERE tm.tournament_id = t.id AND tm.captain_id = ?)",
        (g.user["id"],),
        order="CASE t.status WHEN 'active' THEN 0 WHEN 'registration' THEN 1 ELSE 2 END, t.start_at ASC",
    )
    mine_ids = {t["id"] for t in mine}
    others = [t for t in list_tournaments(order="t.start_at DESC") if t["id"] not in mine_ids]

    wanted = to_int(request.args.get("id"))
    everything = mine + others
    selected = next((t for t in everything if t["id"] == wanted), None) or (everything[0] if everything else None)
    teams = standings(selected["id"]) if selected else []
    my_team = next((tm for tm in teams if tm["captain_id"] == g.user["id"]), None)
    return render_template("player/tables.html", mine=mine, others=others, t=selected,
                           teams=teams, my_team=my_team)
