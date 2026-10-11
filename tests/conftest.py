import re
from datetime import date, timedelta

import pytest

from turnirum import create_app

CREATOR_PASSWORD = "66666KZ@$"
VALID_CARD = "4400 4301 2345 6789"  # проходит проверку Луна


@pytest.fixture
def app(tmp_path):
    app = create_app({
        "TESTING": True,
        "DATABASE": str(tmp_path / "test.sqlite3"),
        "SECRET_KEY": "test",
        "CSRF_ENABLED": False,
    })
    yield app


@pytest.fixture
def client(app):
    return app.test_client()


def register(client, username, role="participant", password="secret123", full_name=None):
    return client.post("/register", data={
        "role": role,
        "username": username,
        "email": f"{username}@example.com",
        "full_name": full_name or username.title(),
        "password": password,
        "password2": password,
    })


def login(client, username, password="secret123"):
    return client.post("/login", data={"login": username, "password": password})


def logout(client):
    return client.post("/logout")


def tournament_form(**overrides):
    data = {
        "title": "Кубок Степи",
        "game": "Counter-Strike 2",
        "description": "Описание",
        "format": "online",
        "city": "",
        "start_date": (date.today() + timedelta(days=7)).isoformat(),
        "start_time": "19:00",
        "max_teams": "8",
        "team_size": "5",
        "is_paid": "0",
        "entry_fee": "",
        "card_number": "",
        "prize_percent": "60",
        "prize_note": "",
    }
    data.update(overrides)
    return data


def create_tournament(client, **overrides):
    response = client.post("/organizer/tournaments/new", data=tournament_form(**overrides))
    assert response.status_code == 302, response.data.decode()
    return int(re.search(r"id=(\d+)", response.headers["Location"]).group(1))
