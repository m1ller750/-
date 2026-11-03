"""Shared setup: serves the site with the demo mock and opens pages for a scene."""
import functools, http.server, os, pathlib, threading
ROOT = pathlib.Path(__file__).resolve().parents[2]  # the repository
HERE = pathlib.Path(__file__).resolve().parent
MOCK = (HERE / 'web' / 'demo-api.js').read_text()
ENGINE = (ROOT / 'supabase/functions/api/engine.js').read_text()
PAYPAL = (HERE / 'web' / 'fake-paypal-demo.js').read_text()
CHROME = os.environ.get('CHROME')  # optional path to a Chromium binary; Playwright's own by default

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(ROOT / 'site')))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}/'

CONTEXT = dict(viewport={'width': 1280, 'height': 720}, device_scale_factor=1.2, locale='en-US', timezone_id='Asia/Almaty')

def init_page(page, scene, as_user):
    page.add_init_script(f"window.__DEMO__ = {{ scene: '{scene}', as: '{as_user}' }};")
    page.route('**/js/api.js', lambda r: r.fulfill(body=MOCK, content_type='text/javascript'))
    page.route('**/js/engine.js', lambda r: r.fulfill(body=ENGINE, content_type='text/javascript'))
    page.route('https://www.paypal.com/sdk/js**', lambda r: r.fulfill(body=PAYPAL, content_type='text/javascript'))
