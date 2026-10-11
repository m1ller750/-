"""ТурниРУМ — онлайн-платформа для организации турниров и участия в них."""
import os
import secrets
from pathlib import Path

from flask import Flask, render_template

from . import auth, creator, db, filters, main, organizer, player
from .config import Config


def _load_secret_key(instance_path):
    key_file = Path(instance_path) / "secret_key"
    if key_file.exists():
        return key_file.read_text(encoding="utf-8").strip()
    key = secrets.token_hex(32)
    key_file.write_text(key, encoding="utf-8")
    return key


ERRORS = {
    400: ("Неверный запрос", "Похоже, форма устарела. Обновите страницу и попробуйте ещё раз."),
    403: ("Нет доступа", "Эта страница доступна только пользователям с другой ролью."),
    404: ("Страница не найдена", "Возможно, турнир удалён или ссылка набрана с ошибкой."),
    500: ("Что-то пошло не так", "Мы уже разбираемся. Попробуйте обновить страницу чуть позже."),
}


def create_app(test_config=None):
    # Для собранного .exe данные хранятся рядом с программой, а не во временной папке.
    instance_path = os.environ.get("TURNIRUM_INSTANCE")
    app = Flask(__name__, instance_relative_config=True, instance_path=instance_path)
    app.config.from_object(Config)
    if test_config:
        app.config.update(test_config)

    os.makedirs(app.instance_path, exist_ok=True)
    if not app.config.get("SECRET_KEY"):
        app.config["SECRET_KEY"] = _load_secret_key(app.instance_path)
    if not app.config.get("DATABASE"):
        app.config["DATABASE"] = os.path.join(app.instance_path, "turnirum.sqlite3")

    db.init_app(app)
    auth.init_app(app)
    filters.register(app)
    for blueprint in (auth.bp, main.bp, organizer.bp, player.bp, creator.bp):
        app.register_blueprint(blueprint)

    def handle_error(error):
        code = getattr(error, "code", 500) or 500
        title, text = ERRORS.get(code, ERRORS[500])
        return render_template("error.html", code=code, title=title, text=text), code

    for code in ERRORS:
        app.register_error_handler(code, handle_error)

    return app
