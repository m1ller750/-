"""Запуск ТурниРУМ одним файлом: поднимает сервер и открывает браузер."""
import os
import sys
import threading
import webbrowser

if getattr(sys, "frozen", False):
    base = os.path.dirname(sys.executable)
else:
    base = os.path.dirname(os.path.abspath(__file__))
os.environ.setdefault("TURNIRUM_INSTANCE", os.path.join(base, "turnirum_data"))

from turnirum import create_app  # noqa: E402
from turnirum.db import query_one  # noqa: E402
from turnirum.seed import seed_demo  # noqa: E402

PORT = int(os.environ.get("PORT", "5000"))
URL = f"http://127.0.0.1:{PORT}"

app = create_app()
with app.app_context():
    if query_one("SELECT COUNT(*) FROM users")[0] == 0:
        seed_demo()

print("ТурниРУМ запущен:", URL)
print("Не закрывайте это окно, пока пользуетесь сайтом.")
threading.Timer(1.5, lambda: webbrowser.open(URL)).start()
app.run(host="127.0.0.1", port=PORT, debug=False, threaded=True)
