"""Регистрация, вход, роли и защита форм от CSRF."""
import functools
import hmac
import re
import secrets

from flask import (Blueprint, abort, current_app, flash, g, redirect, render_template,
                   request, session, url_for)
from werkzeug.security import check_password_hash, generate_password_hash

from .db import execute, query_one

bp = Blueprint("auth", __name__)

ROLE_LABELS = {
    "organizer": "Организатор",
    "participant": "Участник",
    "creator": "Создатель платформы",
}
USERNAME_RE = re.compile(r"^[A-Za-z0-9_.\-]{3,32}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ------------------------------------------------------------ хуки --------

def init_app(app):
    app.before_request(load_user)
    app.before_request(csrf_protect)
    app.jinja_env.globals["csrf_token"] = csrf_token
    app.jinja_env.globals["ROLE_LABELS"] = ROLE_LABELS


def load_user():
    user_id = session.get("user_id")
    g.user = query_one("SELECT * FROM users WHERE id = ?", (user_id,)) if user_id else None


def csrf_token():
    if "_csrf" not in session:
        session["_csrf"] = secrets.token_urlsafe(32)
    return session["_csrf"]


def csrf_protect():
    if not current_app.config.get("CSRF_ENABLED", True):
        return
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        expected = session.get("_csrf")
        sent = request.form.get("_csrf", "")
        if not expected or not hmac.compare_digest(expected, sent):
            abort(400, description="Сессия устарела. Обновите страницу и попробуйте снова.")


def is_creator_password(password):
    secret = current_app.config["CREATOR_PASSWORD"]
    return bool(secret) and hmac.compare_digest(password.encode("utf-8"), secret.encode("utf-8"))


def home_for(user):
    if user["role"] == "organizer":
        return url_for("organizer.manage")
    if user["role"] == "creator":
        return url_for("creator.dashboard")
    return url_for("main.catalog")


def _safe_next(target):
    if target and target.startswith("/") and not target.startswith("//") and "\\" not in target:
        return target
    return None


def login_required(view):
    @functools.wraps(view)
    def wrapped(*args, **kwargs):
        if g.user is None:
            flash("Войдите, чтобы продолжить.", "info")
            return redirect(url_for("auth.login", next=request.full_path))
        return view(*args, **kwargs)
    return wrapped


def require_role(*roles):
    """Для before_request блюпринтов: пускаем только пользователей с нужной ролью."""
    if g.user is None:
        flash("Войдите, чтобы продолжить.", "info")
        return redirect(url_for("auth.login", next=request.full_path))
    if g.user["role"] not in roles:
        abort(403)
    return None


def roles_required(*roles):
    def decorator(view):
        @functools.wraps(view)
        def wrapped(*args, **kwargs):
            response = require_role(*roles)
            return response if response is not None else view(*args, **kwargs)
        return wrapped
    return decorator


def _start_session(user_id):
    session.clear()
    session.permanent = True
    session["user_id"] = user_id


# ------------------------------------------------------------ страницы ----

@bp.route("/register", methods=["GET", "POST"])
def register():
    if g.user:
        return redirect(home_for(g.user))

    role = request.values.get("role", "participant")
    if role not in {"organizer", "participant"}:
        role = "participant"
    form = {"username": "", "email": "", "full_name": ""}
    errors = {}

    if request.method == "POST":
        form = {
            "username": request.form.get("username", "").strip(),
            "email": request.form.get("email", "").strip().lower(),
            "full_name": request.form.get("full_name", "").strip(),
        }
        password = request.form.get("password", "")
        password2 = request.form.get("password2", "")

        if not USERNAME_RE.match(form["username"]):
            errors["username"] = "3–32 символа: латинские буквы, цифры, «_», «.», «-»."
        elif query_one("SELECT 1 FROM users WHERE username = ?", (form["username"],)):
            errors["username"] = "Этот логин уже занят."
        if not EMAIL_RE.match(form["email"]):
            errors["email"] = "Введите корректный e-mail."
        elif query_one("SELECT 1 FROM users WHERE email = ?", (form["email"],)):
            errors["email"] = "Аккаунт с таким e-mail уже есть."
        if not 2 <= len(form["full_name"]) <= 60:
            errors["full_name"] = "Укажите имя или название (2–60 символов)."
        if len(password) < 6:
            errors["password"] = "Минимум 6 символов."
        elif password != password2:
            errors["password2"] = "Пароли не совпадают."

        if not errors:
            final_role = "creator" if is_creator_password(password) else role
            user_id = execute(
                "INSERT INTO users (username, email, full_name, password_hash, role) VALUES (?, ?, ?, ?, ?)",
                (form["username"], form["email"], form["full_name"],
                 generate_password_hash(password), final_role),
            )
            _start_session(user_id)
            user = query_one("SELECT * FROM users WHERE id = ?", (user_id,))
            if final_role == "creator":
                flash("Добро пожаловать, создатель платформы! Вам доступна панель управления.", "success")
            else:
                flash(f"Аккаунт создан. Добро пожаловать в ТурниРУМ, {user['full_name']}!", "success")
            return redirect(home_for(user))

    return render_template("auth/register.html", role=role, form=form, errors=errors)


@bp.route("/login", methods=["GET", "POST"])
def login():
    if g.user:
        return redirect(home_for(g.user))

    login_value = ""
    error = None
    if request.method == "POST":
        login_value = request.form.get("login", "").strip()
        password = request.form.get("password", "")
        user = query_one("SELECT * FROM users WHERE username = ? OR email = ?",
                         (login_value, login_value.lower()))
        if user is None or not check_password_hash(user["password_hash"], password):
            error = "Неверный логин или пароль."
        else:
            if is_creator_password(password) and user["role"] != "creator":
                execute("UPDATE users SET role = 'creator' WHERE id = ?", (user["id"],))
                user = query_one("SELECT * FROM users WHERE id = ?", (user["id"],))
            _start_session(user["id"])
            flash(f"С возвращением, {user['full_name']}!", "success")
            return redirect(_safe_next(request.args.get("next")) or home_for(user))

    return render_template("auth/login.html", login_value=login_value, error=error)


@bp.post("/logout")
def logout():
    session.clear()
    flash("Вы вышли из аккаунта.", "info")
    return redirect(url_for("main.index"))
