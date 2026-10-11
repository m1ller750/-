"""Общие запросы к турнирам и командам."""
from flask import abort, current_app

from .db import query_all, query_one
from .finance import tournament_finance
from .utils import game_style, hue_of, initials, split_members

TOURNAMENT_SELECT = """
SELECT t.*,
       u.full_name AS organizer_name,
       u.username  AS organizer_username,
       (SELECT COUNT(*) FROM teams tm WHERE tm.tournament_id = t.id) AS team_count,
       (SELECT COUNT(*) FROM teams tm WHERE tm.tournament_id = t.id AND tm.is_paid = 1) AS paid_count
FROM tournaments t
JOIN users u ON u.id = t.organizer_id
"""

STANDINGS_ORDER = ("points DESC, (score_for - score_against) DESC, score_for DESC, "
                   "wins DESC, casefold(name) ASC")

STATUS_LABELS = {
    "registration": "Регистрация",
    "active": "Идёт",
    "finished": "Завершён",
}


def enrich(row):
    """Строка турнира из БД → словарь с вычисляемыми полями для шаблонов."""
    t = dict(row)
    platform_percent = current_app.config["PLATFORM_FEE_PERCENT"]
    t["finance"] = tournament_finance(t, platform_percent)
    t["style"] = game_style(t["game"])
    t["slots_left"] = max(0, t["max_teams"] - t["team_count"])
    t["fill_percent"] = min(100, round(t["team_count"] * 100 / t["max_teams"])) if t["max_teams"] else 0
    t["status_label"] = STATUS_LABELS.get(t["status"], t["status"])
    t["is_open"] = t["status"] == "registration" and t["slots_left"] > 0
    return t


def list_tournaments(where="", args=(), order="t.start_at ASC", limit=None):
    sql = TOURNAMENT_SELECT
    if where:
        sql += f" WHERE {where}"
    sql += f" ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [enrich(r) for r in query_all(sql, args)]


def get_tournament(tournament_id):
    row = query_one(TOURNAMENT_SELECT + " WHERE t.id = ?", (tournament_id,))
    return enrich(row) if row else None


def get_tournament_or_404(tournament_id):
    t = get_tournament(tournament_id)
    if t is None:
        abort(404)
    return t


def standings(tournament_id):
    rows = query_all(
        f"""SELECT tm.*, u.full_name AS captain_name
            FROM teams tm LEFT JOIN users u ON u.id = tm.captain_id
            WHERE tm.tournament_id = ? ORDER BY {STANDINGS_ORDER}""",
        (tournament_id,),
    )
    result = []
    for place, row in enumerate(rows, start=1):
        team = dict(row)
        team["place"] = place
        team["played"] = team["wins"] + team["draws"] + team["losses"]
        team["diff"] = team["score_for"] - team["score_against"]
        team["member_list"] = split_members(team["members"])
        team["hue"] = hue_of(team["name"])
        team["initials"] = initials(team["name"])
        result.append(team)
    return result


def find_team_by_captain(tournament_id, user_id):
    return query_one(
        "SELECT * FROM teams WHERE tournament_id = ? AND captain_id = ?",
        (tournament_id, user_id),
    )


def team_name_taken(tournament_id, name, exclude_id=None):
    row = query_one(
        "SELECT id FROM teams WHERE tournament_id = ? AND casefold(name) = ? AND id != ?",
        (tournament_id, name.casefold(), exclude_id or 0),
    )
    return row is not None
