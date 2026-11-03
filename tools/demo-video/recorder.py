"""Records one screen scene of the demo video: drives the real site (demo mock backend) on the narration timeline
and captures every repaint with the Chrome screencast."""
import asyncio, base64, json, math, pathlib, shutil, subprocess, sys, time
from playwright.async_api import async_playwright
from demo_env import serve, MOCK, ENGINE, PAYPAL, CHROME, CONTEXT

HERE = pathlib.Path(__file__).resolve().parent
TL = json.load(open(HERE / 'timeline.json'))
SC = {s['id']: s for s in TL['scenes']}
OVERLAY_JS = (HERE / 'web' / 'overlay.js').read_text()
BG = (HERE / 'web' / 'demo-bg.png').read_bytes()


class Run:
    def __init__(self, page, sid, frames_dir):
        self.page, self.s, self.dir = page, SC[sid], frames_dir
        self.t0 = None; self.wall0 = None; self.x, self.y = 900, 600; self.frames = []

    # --- timeline ---
    def at(self, k, offset=0.0):
        return self.s['sentences'][k]['start'] + offset

    async def until(self, t):
        delay = self.t0 + t - time.monotonic()
        if delay > 0:
            await asyncio.sleep(delay)

    def now(self):
        return time.monotonic() - self.t0

    # --- pointer ---
    async def move(self, x, y, ms=650):
        """Moves the cursor along an eased path in real time: the duration holds even when the browser is busy."""
        x0, y0 = self.x, self.y; start = time.monotonic(); dur = ms / 1000
        while True:
            p = min(1.0, (time.monotonic() - start) / dur); e = 1 - (1 - p) ** 3
            await self.page.mouse.move(x0 + (x - x0) * e, y0 + (y - y0) * e)
            if p >= 1: break
            await asyncio.sleep(0.012)
        self.x, self.y = x, y

    async def box(self, selector):
        el = self.page.locator(selector).first
        await el.scroll_into_view_if_needed()
        return await el.bounding_box()

    async def point(self, selector, fx=0.5, fy=0.5, ms=650):
        b = await self.page.locator(selector).first.bounding_box()
        await self.move(b['x'] + b['width'] * fx, b['y'] + b['height'] * fy, ms)

    async def click(self, selector, fx=0.5, fy=0.5, ms=650):
        await self.point(selector, fx, fy, ms)
        await asyncio.sleep(0.08)
        await self.page.mouse.down(); await asyncio.sleep(0.07); await self.page.mouse.up()

    async def type(self, text, cps=20):
        await self.page.keyboard.type(text, delay=1000 / cps)

    async def scroll_to(self, selector, top=90, ms=900):
        y = await self.page.evaluate("([s, top]) => { const el = document.querySelector(s); return el.getBoundingClientRect().top + scrollY - top; }", [selector, top])
        await self.page.evaluate("([y, ms]) => window.demoScroll(y, ms)", [y, ms])

    async def reveal(self, selector, ms=800, y=420):
        await self.page.evaluate("([s, ms, y]) => window.demoReveal(s, ms, y)", [selector, ms, y])

    async def scroll_by(self, dy, ms=900):
        await self.page.evaluate("([dy, ms]) => window.demoScroll(scrollY + dy, ms)", [dy, ms])

    async def chip(self, html, cls='', ttl=0):
        await self.page.evaluate("([h, c, t]) => { window.demoChip(h, c, t); }", [html, cls, ttl])

    async def js(self, code, arg=None):
        return await self.page.evaluate(code, arg)


async def record(sid, scene_fn, as_user, path, out_dir, prep=None):
    out_dir = pathlib.Path(out_dir); shutil.rmtree(out_dir, ignore_errors=True); (out_dir / 'frames').mkdir(parents=True)
    srv, base = serve()
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=['--force-color-profile=srgb', '--hide-scrollbars'])
        ctx = await browser.new_context(**CONTEXT)
        page = await ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        await page.add_init_script(f"window.__DEMO__ = {{ scene: '{sid}', as: '{as_user}' }};")
        await page.add_init_script(OVERLAY_JS)
        await page.route('**/js/api.js', lambda r: r.fulfill(body=MOCK, content_type='text/javascript'))
        await page.route('**/js/engine.js', lambda r: r.fulfill(body=ENGINE, content_type='text/javascript'))
        await page.route('https://www.paypal.com/sdk/js**', lambda r: r.fulfill(body=PAYPAL, content_type='text/javascript'))
        await page.route('**/demo-bg.png', lambda r: r.fulfill(body=BG, content_type='image/png'))
        await page.goto(base + '#' + path)
        await page.wait_for_load_state('networkidle')
        await page.wait_for_timeout(1500)
        run = Run(page, sid, out_dir / 'frames')
        await page.mouse.move(run.x, run.y)
        if prep:
            await prep(run)
            await page.wait_for_timeout(400)

        cdp = await ctx.new_cdp_session(page)
        frames = []
        async def on_frame(params):
            ts = params['metadata']['timestamp']
            name = f"f{len(frames):05d}.jpg"
            (out_dir / 'frames' / name).write_bytes(base64.b64decode(params['data']))
            frames.append((ts, name))
            try:
                await cdp.send('Page.screencastFrameAck', {'sessionId': params['sessionId']})
            except Exception:
                pass
        cdp.on('Page.screencastFrame', lambda params: asyncio.ensure_future(on_frame(params)))
        await cdp.send('Page.startScreencast', {'format': 'jpeg', 'quality': 92, 'maxWidth': 1536, 'maxHeight': 864, 'everyNthFrame': 1})
        await asyncio.sleep(0.6)
        run.t0 = time.monotonic(); run.wall0 = time.time()
        await scene_fn(run)
        await run.until(run.s['duration'] + 0.3)
        await cdp.send('Page.stopScreencast')
        await asyncio.sleep(0.3)
        await browser.close()
    srv.shutdown()
    json.dump({'wall0': run.wall0, 'duration': run.s['duration'], 'frames': frames, 'errors': errors}, open(out_dir / 'frames.json', 'w'))
    print(sid, 'frames', len(frames), 'errors', errors[:3])
    build_clip(out_dir)


def build_clip(out_dir):
    meta = json.load(open(out_dir / 'frames.json'))
    wall0, dur, frames = meta['wall0'], meta['duration'], sorted(meta['frames'])
    first = max([f for f in frames if f[0] <= wall0] or [frames[0]])
    seq = [first] + [f for f in frames if wall0 < f[0] < wall0 + dur]
    lines = []
    for i, (ts, name) in enumerate(seq):
        start = 0.0 if i == 0 else ts - wall0
        end = (seq[i + 1][0] - wall0) if i + 1 < len(seq) else dur
        lines += [f"file 'frames/{name}'", f"duration {max(0.001, end - start):.4f}"]
    lines.append(f"file 'frames/{seq[-1][1]}'")
    (out_dir / 'list.txt').write_text('\n'.join(lines) + '\n')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
                    '-vf', 'fps=30,scale=1536:864:flags=lanczos,format=yuv420p', '-t', f'{dur:.3f}',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', 'clip.mp4'], cwd=out_dir, check=True)
    gaps = [b[0] - a[0] for a, b in zip(seq, seq[1:])]
    print(out_dir.name, 'clip', round(dur, 2), 's,', len(seq), 'frames, longest gap', round(max(gaps or [0]), 3), 's')
