"""Renders the motion scenes frame by frame (30 fps) by seeking every CSS animation, then encodes them."""
import asyncio, os, functools, http.server, json, pathlib, shutil, subprocess, sys, threading
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME')
TL = {s['id']: s for s in json.load(open(HERE / 'timeline.json'))['scenes']}
FPS = 30

class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

async def render(ids, preview_times=None):
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Q, directory=str(HERE / 'motion')))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}/scenes.html'
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME, args=['--force-color-profile=srgb'])
        page = await b.new_page(viewport={'width': 1920, 'height': 1080})
        for sid in ids:
            await page.goto(f'{base}?scene={sid}')
            await page.evaluate('document.fonts.ready')
            await page.wait_for_timeout(600)
            n = await page.evaluate("() => { window.__a = document.getAnimations(); window.__a.forEach((a) => a.pause()); return window.__a.length; }")
            dur = TL[sid]['duration']
            if preview_times:
                for t in preview_times[sid]:
                    await page.evaluate("(ms) => window.__a.forEach((a) => { a.currentTime = ms; })", t * 1000)
                    await page.screenshot(path=str(HERE / f'mprev_{sid}_{t}.png'))
                print(sid, n, 'animations; previews', preview_times[sid]); continue
            out = HERE / 'mframes' / sid; shutil.rmtree(out, ignore_errors=True); out.mkdir(parents=True)
            total = int(round(dur * FPS))
            for i in range(total):
                await page.evaluate("(ms) => window.__a.forEach((a) => { a.currentTime = ms; })", i * 1000 / FPS)
                await page.screenshot(path=str(out / f'f{i:05d}.jpg'), type='jpeg', quality=94)
            subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-framerate', str(FPS), '-i', str(out / 'f%05d.jpg'),
                            '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', str(HERE / 'mclips' / f'{sid}.mp4')], check=True)
            print(sid, n, 'animations,', total, 'frames →', f'mclips/{sid}.mp4', flush=True)
        await b.close()
    srv.shutdown()

if __name__ == '__main__':
    (HERE / 'mclips').mkdir(exist_ok=True)
    if sys.argv[1] == 'preview':
        times = {'problem': [2.4, 5.0, 9.0, 12.2, 14.6], 'intro': [1.6, 6.3, 11.5], 'architecture': [3.4, 8.8, 17.6],
                 'ai': [3.5, 8.9, 13.5], 'benefits': [2.2, 11.9], 'outro': [2.0, 5.5]}
        asyncio.run(render(list(times), times))
    else:
        asyncio.run(render(sys.argv[1:]))
