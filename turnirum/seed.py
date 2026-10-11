"""Демонстрационные данные: `flask --app turnirum seed`."""
import random
from datetime import date, timedelta

from werkzeug.security import generate_password_hash

from .db import get_db, query_one
from .utils import luhn_check_digit

DEMO_PASSWORD = "demo1234"

ORGANIZERS = [
    ("arena_kz", "arena@turnirum.example", "Arena KZ Esports"),
    ("cyber_league", "league@turnirum.example", "Cyber League"),
]
PLAYERS = [
    ("player1", "Алихан Нурланов"), ("player2", "Дана Ермекова"), ("player3", "Тимур Сатпаев"),
    ("player4", "Мария Ким"), ("player5", "Арман Жумабаев"), ("player6", "Елена Смирнова"),
]
TEAM_NAMES = [
    "Steppe Wolves", "Nomad Five", "Astana Lions", "Qazaq Eagles", "Tengri Force", "Altyn Squad",
    "Snow Leopards", "Barys Gaming", "Kok Bori", "Silk Road", "Aral Storm", "Tulpar Esports",
    "Alatau Peaks", "Baiterek", "Shymkent Heat", "Irtysh Wave",
]
NICKS = ["s1mple_kz", "Nomad", "Bars", "Kairat", "Zhan", "Aiko", "Shadow", "Ruslan", "Ace", "Dias",
         "Mirage", "Sultan", "Kaz", "Viper", "Asel", "Ermek", "Nova", "Bolat", "Rin", "Timka"]

# (организатор, название, игра, формат, город, дней до старта, команд макс, состав,
#  взнос или 0, % в призы, статус, сколько команд, описание, приз для бесплатных)
TOURNAMENTS = [
    (0, "Кубок Степи 2026", "Counter-Strike 2", "online", "", 9, 16, 5, 5000, 60, "registration", 11,
     "Главный онлайн-турнир осени по CS2. Групповой этап Bo1, плей-офф Bo3, финал Bo5 с кастерами.", ""),
    (0, "Dota 2 Night Cup", "Dota 2", "online", "", -3, 8, 5, 3000, 70, "active", 8,
     "Ночная лига для полуночников: матчи стартуют в 22:00 по Астане. Формат — круговая система.", ""),
    (1, "Valorant Spike Rush", "Valorant", "online", "", 5, 12, 5, 0, 60, "registration", 7,
     "Бесплатный турнир для новых команд. Отличный шанс сыграть первый официальный матч.",
     "Игровые девайсы от партнёров и мерч ТурниРУМ"),
    (0, "Шахматный блиц Алматы", "Шахматы", "offline", "Алматы, Dostyk Plaza", 14, 32, 1, 2000, 50,
     "registration", 18, "Блиц 3+2 по швейцарской системе в 9 туров. Приносите хорошее настроение!", ""),
    (1, "EA FC Weekend League", "EA FC", "online", "", -20, 10, 1, 0, 60, "finished", 10,
     "Турнир выходного дня по EA FC. Один на один, Bo2 с суммой голов.", "Подписки EA Play победителям"),
    (1, "Mobile Legends Clash", "Mobile Legends", "online", "", 3, 10, 5, 2500, 65, "registration", 6,
     "Clash для мобильных команд. Драфт-пик, Bo3 начиная с полуфиналов.", ""),
    (0, "PUBG Mobile Squad Rush", "PUBG Mobile", "online", "", -1, 16, 4, 1500, 55, "active", 14,
     "Шесть карт за вечер, очки за места и фраги. Лучшие сквады — в финал.", ""),
    (1, "Standoff 2 Open", "Standoff 2", "offline", "Астана, Esports Arena", 21, 8, 5, 4000, 60,
     "registration", 3, "Офлайн-турнир на большой сцене со стримом и комментаторами.", ""),
]


def _card(rng, prefix):
    partial = prefix + "".join(rng.choice("0123456789") for _ in range(15 - len(prefix)))
    return partial + luhn_check_digit(partial)


def seed_demo():
    if query_one("SELECT 1 FROM users WHERE username = ?", (ORGANIZERS[0][0],)):
        return False
    rng = random.Random(2026)
    conn = get_db()
    password_hash = generate_password_hash(DEMO_PASSWORD)

    organizer_ids = []
    for username, email, name in ORGANIZERS:
        cur = conn.execute("INSERT INTO users (username, email, full_name, password_hash, role) "
                           "VALUES (?, ?, ?, ?, 'organizer')", (username, email, name, password_hash))
        organizer_ids.append(cur.lastrowid)
    player_ids = []
    for username, name in PLAYERS:
        cur = conn.execute("INSERT INTO users (username, email, full_name, password_hash, role) "
                           "VALUES (?, ?, ?, ?, 'participant')",
                           (username, f"{username}@turnirum.example", name, password_hash))
        player_ids.append(cur.lastrowid)

    cards = [_card(rng, "440043"), _card(rng, "220070")]
    for (org, title, game, fmt, city, days, max_teams, size, fee, prize, status, n_teams,
         description, prize_note) in TOURNAMENTS:
        start = date.today() + timedelta(days=days)
        cur = conn.execute(
            """INSERT INTO tournaments (organizer_id, title, game, description, format, city, start_at, max_teams,
                   team_size, is_paid, entry_fee, card_number, prize_percent, prize_note, status)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (organizer_ids[org], title, game, description, fmt, city, f"{start:%Y-%m-%d} 19:00", max_teams, size,
             int(fee > 0), fee, cards[org] if fee else None, prize, prize_note, status),
        )
        tid = cur.lastrowid
        names = rng.sample(TEAM_NAMES, min(n_teams, len(TEAM_NAMES)))
        if size == 1:
            names = rng.sample(NICKS, n_teams)
        captains = rng.sample(player_ids, min(len(player_ids), max(0, len(names) // 3)))
        for i, name in enumerate(names):
            played = 0 if status == "registration" else rng.randint(3, 7)
            wins = rng.randint(0, played)
            draws = rng.randint(0, played - wins) if game in {"EA FC", "Шахматы"} else 0
            losses = played - wins - draws
            score_for = wins * rng.randint(2, 4) + draws + rng.randint(0, 6) if played else 0
            score_against = losses * rng.randint(2, 4) + draws + rng.randint(0, 6) if played else 0
            members = name if size == 1 else "\n".join(rng.sample(NICKS, size))
            paid = int(fee > 0 and (status != "registration" or rng.random() < 0.75))
            conn.execute(
                """INSERT INTO teams (tournament_id, captain_id, name, members, wins, draws, losses, score_for,
                       score_against, points, is_paid, payment_note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (tid, captains[i] if i < len(captains) else None, name, members, wins, draws, losses,
                 score_for, score_against, wins * 3 + draws, paid, "Перевод с карты •• " + str(rng.randint(1000, 9999))
                 if fee else ""),
            )
    conn.commit()
    return True
