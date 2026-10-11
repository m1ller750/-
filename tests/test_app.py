from conftest import (CREATOR_PASSWORD, VALID_CARD, create_tournament, login, logout, register,
                      tournament_form)

from turnirum.db import query_one
from turnirum.finance import split_revenue
from turnirum.utils import luhn_valid


def user_role(app, username):
    with app.app_context():
        return query_one("SELECT role FROM users WHERE username = ?", (username,))["role"]


def make_paid_tournament(client, **overrides):
    register(client, "org", role="organizer")
    params = dict(is_paid="1", entry_fee="5000", card_number=VALID_CARD, prize_percent="60", max_teams="4")
    params.update(overrides)
    return create_tournament(client, **params)


def join(client, tid, name, paid=True):
    data = {"name": name, "members": "Капитан\nИгрок 2"}
    if paid:
        data.update(paid_confirm="1", payment_note="Карта •• 1234")
    return client.post(f"/tournaments/{tid}/join", data=data)


# ------------------------------------------------------------ финансы ----

def test_split_gives_platform_ten_percent_and_sums_exactly():
    s = split_revenue(80_000, prize_percent=60)
    assert (s.prize, s.organizer, s.platform) == (48_000, 24_000, 8_000)
    odd = split_revenue(12_345, prize_percent=55)
    assert odd.platform == 1_235
    assert odd.prize + odd.organizer + odd.platform == 12_345


def test_prize_share_cannot_eat_platform_fee():
    s = split_revenue(10_000, prize_percent=100)
    assert s.platform == 1_000 and s.prize == 9_000 and s.organizer == 0


def test_luhn():
    assert luhn_valid(VALID_CARD.replace(" ", ""))
    assert not luhn_valid("4400430123456788")


# ------------------------------------------------------------ роли -------

def test_register_roles(app, client):
    assert register(client, "maker", role="organizer").headers["Location"] == "/organizer/tournaments"
    logout(client)
    assert register(client, "gamer", role="participant").headers["Location"] == "/tournaments"
    assert user_role(app, "maker") == "organizer"
    assert user_role(app, "gamer") == "participant"


def test_creator_password_on_registration(app, client):
    response = register(client, "boss", role="participant", password=CREATOR_PASSWORD)
    assert response.headers["Location"] == "/creator/"
    assert user_role(app, "boss") == "creator"
    assert client.get("/creator/").status_code == 200


def test_creator_password_on_login_promotes_user(app, client):
    register(client, "boss", role="organizer", password=CREATOR_PASSWORD)
    with app.app_context():
        from turnirum.db import execute
        execute("UPDATE users SET role = 'organizer' WHERE username = 'boss'")
    logout(client)
    response = login(client, "boss", CREATOR_PASSWORD)
    assert response.headers["Location"] == "/creator/"
    assert user_role(app, "boss") == "creator"


def test_wrong_password_rejected(client):
    register(client, "gamer")
    logout(client)
    response = login(client, "gamer", "nope-nope")
    assert response.status_code == 200
    assert "Неверный логин или пароль" in response.data.decode()


def test_role_pages_are_protected(client):
    assert client.get("/organizer/tournaments").status_code == 302  # гость → вход
    register(client, "gamer")
    assert client.get("/organizer/tournaments").status_code == 403
    assert client.get("/creator/").status_code == 403
    assert client.get("/player/tables").status_code == 200


# ------------------------------------------------------------ турниры ----

def test_paid_tournament_requires_valid_card(client):
    register(client, "org", role="organizer")
    form = tournament_form(is_paid="1", entry_fee="5000", card_number="4400 4301 2345 6788")
    response = client.post("/organizer/tournaments/new", data=form)
    assert response.status_code == 200
    assert "Проверьте номер карты" in response.data.decode()

    tid = create_tournament(client, is_paid="1", entry_fee="5000", card_number=VALID_CARD)
    page = client.get(f"/organizer/tournaments?id={tid}").data.decode()
    assert "Кубок Степи" in page and "6789" in page


def test_free_tournament_has_no_card(app, client):
    register(client, "org", role="organizer")
    tid = create_tournament(client, card_number=VALID_CARD)
    with app.app_context():
        row = query_one("SELECT is_paid, card_number FROM tournaments WHERE id = ?", (tid,))
    assert row["is_paid"] == 0 and row["card_number"] is None


def test_catalog_filters(client):
    register(client, "org", role="organizer")
    create_tournament(client, title="Платный кубок", is_paid="1", entry_fee="3000", card_number=VALID_CARD)
    create_tournament(client, title="Бесплатная лига", game="Dota 2")
    logout(client)

    paid = client.get("/tournaments?price=paid").data.decode()
    assert "Платный кубок" in paid and "Бесплатная лига" not in paid
    free = client.get("/tournaments?price=free").data.decode()
    assert "Бесплатная лига" in free and "Платный кубок" not in free
    by_game = client.get("/tournaments?game=Dota 2").data.decode()
    assert "Бесплатная лига" in by_game and "Платный кубок" not in by_game
    search = client.get("/tournaments?q=ЛИГА").data.decode()  # поиск без учёта регистра кириллицы
    assert "Бесплатная лига" in search and "Платный кубок" not in search
    cheap = client.get("/tournaments?max_fee=2000").data.decode()
    assert "Платный кубок" not in cheap and "Бесплатная лига" in cheap


def test_participant_joins_paid_tournament(app, client):
    tid = make_paid_tournament(client)
    logout(client)
    register(client, "gamer")

    no_confirm = client.post(f"/tournaments/{tid}/join", data={"name": "Wolves", "members": "A"})
    assert "Подтвердите, что перевели взнос" in no_confirm.data.decode()

    assert join(client, tid, "Wolves").status_code == 302
    again = client.get(f"/tournaments/{tid}/join")
    assert again.status_code == 302  # вторая команда от того же капитана не нужна
    with app.app_context():
        team = query_one("SELECT * FROM teams WHERE tournament_id = ?", (tid,))
    assert team["name"] == "Wolves" and team["is_paid"] == 0

    tables = client.get(f"/player/tables?id={tid}").data.decode()
    assert "Ваша команда" in tables


def test_team_limit_enforced(client):
    tid = make_paid_tournament(client, max_teams="2")
    logout(client)
    for i in range(3):
        register(client, f"gamer{i}")
        join(client, tid, f"Team {i}")
        logout(client)
    register(client, "late")
    response = client.get(f"/tournaments/{tid}/join")
    assert response.status_code == 302


def test_organizer_edits_table_and_confirms_payment(app, client):
    tid = make_paid_tournament(client)
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Alpha", "members": "a, b"})
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Beta", "members": "c", "is_paid": "1"})
    with app.app_context():
        alpha = query_one("SELECT id FROM teams WHERE name = 'Alpha'")["id"]
        beta = query_one("SELECT id FROM teams WHERE name = 'Beta'")["id"]

    response = client.post(f"/organizer/tournaments/{tid}/table", data={
        "auto_points": "1",
        f"t{alpha}_name": "Alpha Prime", f"t{alpha}_wins": "3", f"t{alpha}_draws": "1",
        f"t{alpha}_losses": "0", f"t{alpha}_score_for": "9", f"t{alpha}_score_against": "2",
        f"t{alpha}_points": "0", f"t{alpha}_is_paid": "1",
        f"t{beta}_name": "Beta", f"t{beta}_wins": "1", f"t{beta}_draws": "0", f"t{beta}_losses": "3",
        f"t{beta}_score_for": "2", f"t{beta}_score_against": "9", f"t{beta}_points": "0",
    })
    assert response.status_code == 302
    with app.app_context():
        alpha_row = query_one("SELECT * FROM teams WHERE id = ?", (alpha,))
        beta_row = query_one("SELECT * FROM teams WHERE id = ?", (beta,))
    assert alpha_row["name"] == "Alpha Prime" and alpha_row["points"] == 10 and alpha_row["is_paid"] == 1
    assert beta_row["points"] == 3 and beta_row["is_paid"] == 0  # снятая галочка = не оплачено

    page = client.get(f"/tournaments/{tid}").data.decode()
    table = page[page.index('class="standings"'):]
    assert table.index("Alpha Prime") < table.index("Beta")


def test_swapping_team_names_does_not_break_unique_constraint(app, client):
    tid = make_paid_tournament(client)
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "One"})
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Two"})
    with app.app_context():
        one = query_one("SELECT id FROM teams WHERE name = 'One'")["id"]
        two = query_one("SELECT id FROM teams WHERE name = 'Two'")["id"]
    client.post(f"/organizer/tournaments/{tid}/table", data={f"t{one}_name": "Two", f"t{two}_name": "One"})
    with app.app_context():
        assert query_one("SELECT name FROM teams WHERE id = ?", (one,))["name"] == "Two"
        assert query_one("SELECT name FROM teams WHERE id = ?", (two,))["name"] == "One"


def test_organizer_cannot_touch_foreign_tournament(client):
    tid = make_paid_tournament(client)
    logout(client)
    register(client, "other", role="organizer")
    assert client.get(f"/organizer/tournaments/{tid}/edit").status_code == 404
    assert client.post(f"/organizer/tournaments/{tid}/status", data={"status": "finished"}).status_code == 404


def test_business_model_numbers(app, client):
    tid = make_paid_tournament(client, prize_percent="70")
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Paid A", "is_paid": "1"})
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Paid B", "is_paid": "1"})
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Pending"})
    page = client.get("/organizer/business").data.decode()
    # 2 оплаты × 5000 = 10 000: призы 7 000, организатору 2 000, платформе 1 000.
    assert "10 000" in page and "7 000" in page and "2 000" in page and "1 000" in page
    logout(client)

    register(client, "boss", password=CREATOR_PASSWORD)
    creator_page = client.get("/creator/").data.decode()
    assert "Прибыль ТурниРУМ" in creator_page and "1 000" in creator_page


def test_only_creator_deletes_tournaments(app, client):
    tid = make_paid_tournament(client)
    client.post(f"/organizer/tournaments/{tid}/teams", data={"name": "Alpha"})
    assert client.post(f"/creator/tournaments/{tid}/delete").status_code == 403
    logout(client)

    register(client, "boss", password=CREATOR_PASSWORD)
    assert client.post(f"/creator/tournaments/{tid}/delete").status_code == 302
    assert client.get(f"/tournaments/{tid}").status_code == 404
    with app.app_context():
        assert query_one("SELECT COUNT(*) FROM teams")[0] == 0


def test_csrf_blocks_forged_posts(tmp_path):
    from turnirum import create_app

    app = create_app({"TESTING": True, "DATABASE": str(tmp_path / "csrf.sqlite3"), "SECRET_KEY": "x"})
    client = app.test_client()
    response = client.post("/register", data={"username": "x"})
    assert response.status_code == 400
