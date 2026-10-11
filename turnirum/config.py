"""Настройки приложения. Любое значение можно переопределить переменной окружения."""
import os
from datetime import timedelta


class Config:
    # Если ключ не задан, он будет сгенерирован и сохранён в instance/secret_key.
    SECRET_KEY = os.environ.get("TURNIRUM_SECRET_KEY")
    # По умолчанию база лежит в instance/turnirum.sqlite3.
    DATABASE = os.environ.get("TURNIRUM_DATABASE")

    # Пользователь, который регистрируется или входит с этим паролем,
    # получает роль «Создатель платформы».
    CREATOR_PASSWORD = os.environ.get("TURNIRUM_CREATOR_PASSWORD", "66666KZ@$")

    # Доля от общей выручки каждого платного турнира, которая идёт создателю платформы.
    PLATFORM_FEE_PERCENT = 10
    CURRENCY = os.environ.get("TURNIRUM_CURRENCY", "₸")

    CSRF_ENABLED = True
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    PERMANENT_SESSION_LIFETIME = timedelta(days=14)
