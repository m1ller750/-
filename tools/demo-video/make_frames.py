"""Window chrome around the screen recordings: background + browser window with a transparent content hole."""
import asyncio, os, json, pathlib
from PIL import Image, ImageDraw
from playwright.async_api import async_playwright
HERE = pathlib.Path(__file__).resolve().parent
CHROME = os.environ.get('CHROME')
X, Y, W, BAR, H, R = 192, 40, 1536, 46, 864, 20
LABELS = {
  'create': ('Create a tournament', 'Organizer', '#8b5cf6'), 'pay': ('Valorant Night Cup · Team registration', 'Player', '#22d3ee'),
  'bracket': ('My tournaments · Valorant Night Cup', 'Organizer', '#8b5cf6'), 'reschedule': ('Bracket', 'Player', '#22d3ee'),
  'teammates': ('Find a team', 'Player', '#22d3ee'), 'results': ('My tournaments · Valorant Night Cup', 'Organizer', '#8b5cf6'),
}
css = open(HERE / 'motion' / 'build.py').read().split('CSS = r"""')[1].split('"""')[0]
def page(title, role, color):
    return f"""<!doctype html><html><head><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Unbounded:wght@700&display=block">
<style>{css}
.win {{ position:absolute; left:{X}px; top:{Y}px; width:{W}px; height:{BAR + H}px; border-radius:{R}px; background:#000;
  box-shadow: 0 50px 120px -30px rgba(0,0,0,.95), 0 0 0 1px rgba(255,255,255,.14), 0 0 90px -20px rgba(139,92,246,.45); }}
.bar {{ position:absolute; left:0; right:0; top:0; height:{BAR}px; border-radius:{R}px {R}px 0 0; background:linear-gradient(#171a2b,#11131f); border-bottom:1px solid rgba(255,255,255,.08);
  display:flex; align-items:center; padding:0 18px; gap:9px; }}
.dot {{ width:13px; height:13px; border-radius:50%; }}
.addr {{ position:absolute; left:50%; transform:translateX(-50%); display:flex; align-items:center; gap:10px; padding:7px 18px; border-radius:11px; background:rgba(255,255,255,.06); border:1px solid rgba(255,255,255,.08); font:700 16px Manrope; color:#c9cdeb; }}
.addr b {{ font:700 15px Unbounded; color:#fff; }} .addr b span {{ background:var(--grad); -webkit-background-clip:text; color:transparent; }}
.role {{ position:absolute; right:18px; display:flex; align-items:center; gap:8px; padding:6px 14px; border-radius:99px; font:800 13px Manrope; letter-spacing:.12em; text-transform:uppercase; color:{color}; border:1px solid {color}88; background:{color}1f; }}
.role i {{ width:8px; height:8px; border-radius:50%; background:{color}; box-shadow:0 0 10px {color}; }}
</style></head><body><div class="scene on">
<div class="bgfx"><i class="b1" style="animation:none"></i><i class="b2" style="animation:none"></i><i class="b3" style="animation:none"></i></div><div class="grid"></div>
<div class="win"><div class="bar"><span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
<div class="addr"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6ee7b7" stroke-width="2.4" stroke-linecap="round"><rect width="18" height="11" x="3" y="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><b>Turni<span>RUM</span></b> · {title}</div>
<div class="role"><i></i>{role} view</div></div></div></div></body></html>"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        pg = await b.new_page(viewport={'width': 1920, 'height': 1080})
        for sid, (title, role, color) in LABELS.items():
            await pg.set_content(page(title, role, color)); await pg.evaluate('document.fonts.ready'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=str(HERE / 'comp' / f'chrome_{sid}.png'))
        await b.close()
    # transparent content hole with rounded bottom corners (4x supersampled mask)
    S = 4; mask = Image.new('L', (1920 * S, 1080 * S), 255); d = ImageDraw.Draw(mask)
    top = Y + BAR
    d.rounded_rectangle([X * S, top * S, (X + W) * S - 1, (top + H) * S - 1], radius=R * S, fill=0)
    d.rectangle([X * S, top * S, (X + W) * S - 1, (top + R) * S], fill=0)
    mask = mask.resize((1920, 1080), Image.LANCZOS)
    for sid in LABELS:
        im = Image.open(HERE / 'comp' / f'chrome_{sid}.png').convert('RGBA'); im.putalpha(mask)
        im.save(HERE / 'comp' / f'frame_{sid}.png')
    print('frames ok')
asyncio.run(main())
