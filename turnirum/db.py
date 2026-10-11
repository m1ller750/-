"""Работа с SQLite: подключение на запрос, схема и CLI-команды."""
import sqlite3
from pathlib import Path

import click
from flask import current_app, g

SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def _casefold(value):
    # Встроенные lower()/LIKE в SQLite не понимают кириллицу, поэтому регистр
    # для поиска приводим средствами Python.
    return value.casefold() if isinstance(value, str) else value


def get_db():
    if "db" not in g:
        conn = sqlite3.connect(current_app.config["DATABASE"])
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        conn.create_function("casefold", 1, _casefold, deterministic=True)
        g.db = conn
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def query_all(sql, args=()):
    return get_db().execute(sql, args).fetchall()


def query_one(sql, args=()):
    return get_db().execute(sql, args).fetchone()


def execute(sql, args=()):
    conn = get_db()
    cur = conn.execute(sql, args)
    conn.commit()
    return cur.lastrowid


def init_db():
    get_db().executescript(SCHEMA_PATH.read_text(encoding="utf-8"))


@click.command("init-db")
def init_db_command():
    """Создать таблицы базы данных."""
    init_db()
    click.echo("База данных готова.")


@click.command("seed")
def seed_command():
    """Заполнить базу демонстрационными турнирами и пользователями."""
    from .seed import seed_demo

    if seed_demo():
        click.echo("Демо-данные добавлены. Пароль всех демо-аккаунтов: demo1234")
        click.echo("  организаторы: arena_kz, cyber_league")
        click.echo("  участники:    player1 … player6")
    else:
        click.echo("Демо-данные уже были добавлены ранее.")


def init_app(app):
    app.teardown_appcontext(close_db)
    app.cli.add_command(init_db_command)
    app.cli.add_command(seed_command)
    with app.app_context():
        init_db()
