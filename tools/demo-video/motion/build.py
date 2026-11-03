"""Builds motion/scenes.html: the animated (non-screen) scenes of the demo video.
Every animation is plain CSS with explicit delays (seconds from the scene start), so frames can be rendered
deterministically by seeking document.getAnimations()."""
import json, pathlib

HERE = pathlib.Path(__file__).resolve().parent
import re
ICONS = dict(re.findall(r"^\s+(\w+): '(.*?)',$", (HERE.parents[2] / 'site' / 'js' / 'icons.js').read_text(), re.M))


def ic(name, size=24, cls=''):
    return (f'<svg class="ico {cls}" width="{size}" height="{size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
            f'stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{ICONS[name]}</svg>')


def fx(anim, d, dur=0.7, extra=''):
    """Inline animation for an element: one or more 'name' with a delay d (seconds)."""
    return f'style="animation: {anim} {dur}s var(--e) {d}s both{extra}"'


LOGO = ic('trophy', 64)
GEM = '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M12 2c.6 5.2 4.8 9.4 10 10-5.2.6-9.4 4.8-10 10-.6-5.2-4.8-9.4-10-10 5.2-.6 9.4-4.8 10-10z" fill="url(#gg)"/></svg>'
PP = '<span class="pp"><b>Pay</b><i>Pal</i></span>'

CSS = r"""
:root { --e: cubic-bezier(.2,.8,.2,1); --bg:#07080f; --text:#eef0ff; --muted:#a0a6cc; --dim:#6c7299;
  --violet:#8b5cf6; --indigo:#6366f1; --cyan:#22d3ee; --pink:#f472b6; --amber:#fbbf24; --green:#34d399; --red:#f87171;
  --grad: linear-gradient(135deg,#8b5cf6 0%,#6366f1 45%,#22d3ee 100%);
  --gtext: linear-gradient(100deg,#c4b5fd 0%,#818cf8 35%,#22d3ee 70%,#f0abfc 100%); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); color: var(--text);
  font-family: Manrope, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.scene { position: absolute; inset: 0; display: none; overflow: hidden; }
.scene.on { display: block; }
.bgfx { position: absolute; inset: 0; overflow: hidden; }
.bgfx i { position: absolute; border-radius: 50%; filter: blur(110px); opacity: .55; }
.bgfx .b1 { width: 900px; height: 900px; left: -260px; top: -380px; background: radial-gradient(circle,#6d28d9 0%,transparent 65%); animation: drift 22s ease-in-out infinite alternate; }
.bgfx .b2 { width: 820px; height: 820px; right: -300px; top: 120px; background: radial-gradient(circle,#0891b2 0%,transparent 65%); opacity: .42; animation: drift 26s ease-in-out -6s infinite alternate-reverse; }
.bgfx .b3 { width: 760px; height: 760px; left: 38%; bottom: -460px; background: radial-gradient(circle,#be185d 0%,transparent 65%); opacity: .3; animation: drift 30s ease-in-out -3s infinite alternate; }
.grid { position: absolute; inset: 0; background-image: linear-gradient(rgba(255,255,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.045) 1px, transparent 1px);
  background-size: 64px 64px; -webkit-mask-image: radial-gradient(ellipse at 50% 40%, #000 30%, transparent 75%); }
@keyframes drift { to { transform: translate(120px, 80px) scale(1.12); } }
@keyframes fadeUp { from { opacity: 0; transform: translateY(34px); } to { opacity: 1; transform: none; } }
@keyframes fadeDown { from { opacity: 0; transform: translateY(-26px); } to { opacity: 1; transform: none; } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes fadeOut { to { opacity: 0; } }
@keyframes pop { 0% { opacity: 0; transform: scale(.82); } 60% { opacity: 1; transform: scale(1.04); } 100% { opacity: 1; transform: scale(1); } }
@keyframes popRot { 0% { opacity: 0; transform: rotate(var(--r,0deg)) scale(.8); } 65% { opacity: 1; transform: rotate(var(--r,0deg)) scale(1.04); } 100% { opacity: 1; transform: rotate(var(--r,0deg)) scale(1); } }
@keyframes slideL { from { opacity: 0; transform: translateX(-60px); } to { opacity: 1; transform: none; } }
@keyframes slideR { from { opacity: 0; transform: translateX(60px); } to { opacity: 1; transform: none; } }
@keyframes word { from { opacity: 0; transform: translateY(28px); filter: blur(6px); } to { opacity: 1; transform: none; filter: blur(0); } }
@keyframes draw { from { stroke-dashoffset: var(--len, 600); } to { stroke-dashoffset: 0; } }
@keyframes flow { to { stroke-dashoffset: -60; } }
@keyframes jitter { 0%,100% { transform: rotate(var(--r,0deg)) translate(0,0); } 25% { transform: rotate(calc(var(--r,0deg) + .6deg)) translate(2px,-2px); } 50% { transform: rotate(calc(var(--r,0deg) - .5deg)) translate(-2px,1px); } 75% { transform: rotate(var(--r,0deg)) translate(1px,2px); } }
@keyframes shine { to { background-position: 200% center; } }
@keyframes glow { 0%,100% { box-shadow: 0 0 0 0 rgba(139,92,246,.0), 0 30px 80px -30px rgba(99,102,241,.9); } 50% { box-shadow: 0 0 0 12px rgba(139,92,246,.12), 0 30px 80px -30px rgba(99,102,241,.9); } }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes dim { to { opacity: .12; filter: blur(5px); transform: scale(.96); } }
@keyframes check { from { transform: scale(0); opacity: 0; } 70% { transform: scale(1.25); opacity: 1; } to { transform: scale(1); opacity: 1; } }
@keyframes strike { from { width: 0; } to { width: 100%; } }
@keyframes lift { to { transform: translateY(-250px) scale(.62); } }
@keyframes liftLogo { to { transform: translateY(-190px) scale(.78); } }
@keyframes light { to { background: rgba(52,211,153,.16); border-color: rgba(52,211,153,.55); } }
@keyframes busy { 0% { opacity: 0; transform: scale(.6); } 30% { opacity: 1; transform: scale(1.1); } 100% { opacity: 1; transform: scale(1); } }
@keyframes ticker { 0% { content: "Day 1"; } }
.ico { display: inline-block; vertical-align: middle; flex-shrink: 0; }
.eyebrow { position: absolute; display: inline-flex; align-items: center; gap: 10px; padding: 10px 18px; border-radius: 99px;
  font: 800 18px Manrope; letter-spacing: .16em; text-transform: uppercase; color: #c4b5fd; background: rgba(139,92,246,.12); border: 1px solid rgba(139,92,246,.35); }
.h1 { font-family: Unbounded, Manrope, sans-serif; font-weight: 700; letter-spacing: -.03em; line-height: 1.08; }
.gt { background: var(--gtext); background-size: 200% auto; -webkit-background-clip: text; background-clip: text; color: transparent; animation: shine 6s linear infinite; }
.card { position: absolute; border-radius: 26px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.1);
  box-shadow: 0 40px 90px -40px rgba(0,0,0,.9); backdrop-filter: blur(4px); }
.pp { font: italic 900 30px Verdana, Arial, sans-serif; letter-spacing: -1px; } .pp b { color: #003087; } .pp i { color: #009cde; }
.chip { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px; border-radius: 14px; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); font: 700 20px Manrope; color: var(--text); }
.mono { font-family: ui-monospace, 'DejaVu Sans Mono', monospace; font-weight: 600; }
.logo-mark { width: 150px; height: 150px; border-radius: 40px; display: grid; place-items: center; color: #fff; background: var(--grad);
  box-shadow: 0 30px 80px -30px rgba(99,102,241,.9); }

/* problem */
#problem .headline { position: absolute; left: 0; right: 0; top: 330px; text-align: center; font-size: 82px; transform-origin: 50% 0; }
#problem .headline span { display: inline-block; margin: 0 .12em; }
.sheet { left: 150px; top: 420px; width: 620px; padding: 22px; --r: -4deg; }
.sheet .t { display: flex; align-items: center; gap: 12px; font: 800 21px Manrope; color: #86efac; margin-bottom: 14px; }
.sheet table { width: 100%; border-collapse: collapse; font: 600 18px Manrope; color: #cfd3ef; }
.sheet td { border: 1px solid rgba(255,255,255,.12); padding: 8px 10px; }
.sheet td.bad { color: #fca5a5; background: rgba(248,113,113,.12); }
.sheet td.hl { background: rgba(251,191,36,.18); color: #fde68a; }
.chat { right: 150px; top: 380px; width: 610px; padding: 22px 22px 26px; --r: 3deg; }
.chat .t { display: flex; align-items: center; gap: 12px; font: 800 21px Manrope; margin-bottom: 16px; color: #93c5fd; }
.chat .t small { color: var(--dim); font-weight: 700; }
.bub { display: block; width: fit-content; max-width: 470px; padding: 13px 18px; border-radius: 20px 20px 20px 6px; margin: 10px 0; font: 700 21px Manrope; background: rgba(255,255,255,.09); }
.bub.me { margin-left: auto; border-radius: 20px 20px 6px 20px; background: rgba(59,130,246,.28); }
.bub b { display: block; font-size: 15px; color: var(--muted); margin-bottom: 3px; }
.sketch { left: 300px; top: 690px; width: 520px; height: 230px; padding: 18px; --r: 2deg; background: rgba(250,250,240,.92); border: 0; }
.sketch svg path { fill: none; stroke: #1f2937; stroke-width: 3; stroke-linecap: round; stroke-dasharray: 600; }
.sketch .n { position: absolute; font: italic 700 19px 'Comic Sans MS', 'Comic Neue', Manrope, cursive; color: #1f2937; }
.unpaid { left: 600px; top: 395px; --r: 8deg; padding: 12px 18px; border-radius: 14px; background: #dc2626; border: 0; font: 900 22px Manrope; color: #fff; }
.clockfight { position: absolute; left: 900px; top: 800px; display: flex; gap: 18px; }
.clockfight .chip { font-size: 24px; }
.prize { left: 560px; top: 455px; width: 800px; padding: 36px 40px; border-color: rgba(251,191,36,.35); background: linear-gradient(160deg, rgba(251,191,36,.12), rgba(244,114,182,.06)); }
.prize .row { display: flex; align-items: center; gap: 22px; }
.prize .ic { width: 84px; height: 84px; border-radius: 22px; display: grid; place-items: center; background: linear-gradient(135deg,#fde68a,#f59e0b 55%,#f97316); color: #451a03; }
.prize h3 { font: 700 34px Unbounded; margin-bottom: 6px; }
.prize p { font: 700 24px Manrope; color: var(--muted); }
.prize .status { margin-top: 26px; display: flex; align-items: center; gap: 14px; font: 800 26px Manrope; color: #fcd34d; }
.prize .days { position: relative; display: inline-block; width: 150px; height: 34px; overflow: hidden; vertical-align: middle; }
.prize .days span { position: absolute; left: 0; top: 0; opacity: 0; }

/* intro */
#intro .brand { position: absolute; left: 0; right: 0; top: 300px; display: flex; flex-direction: column; align-items: center; gap: 30px; transform-origin: 50% 0; }
#intro .brandrow { display: flex; align-items: center; gap: 36px; }
#intro .word { font: 800 150px Unbounded; letter-spacing: -.04em; }
#intro .tag { font: 700 40px Manrope; color: var(--muted); }
#intro .pills { position: absolute; left: 0; right: 0; top: 690px; display: flex; justify-content: center; gap: 30px; }
.pill { display: flex; align-items: center; gap: 16px; padding: 20px 30px; border-radius: 22px; font: 800 30px Manrope; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.14); }
.pill .k { width: 52px; height: 52px; border-radius: 15px; display: grid; place-items: center; background: var(--grad); color: #fff; }
.pill.paypal .k { background: #ffc439; color: #003087; }
#intro .three { position: absolute; left: 0; right: 0; top: 640px; display: flex; justify-content: center; gap: 36px; }
.tri { position: relative; width: 360px; padding: 34px 30px; border-radius: 26px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); text-align: center; }
.tri .ic { width: 86px; height: 86px; margin: 0 auto 18px; border-radius: 24px; display: grid; place-items: center; color: #fff; background: var(--grad); }
.tri b { font: 700 34px Unbounded; }
.tri .ok { position: absolute; top: -18px; right: -18px; width: 54px; height: 54px; border-radius: 50%; display: grid; place-items: center; background: #34d399; color: #052e1c; box-shadow: 0 10px 30px -8px rgba(52,211,153,.9); }

/* architecture */
#architecture .title { position: absolute; left: 150px; top: 104px; font-size: 64px; }
.node { position: absolute; padding: 26px 28px; border-radius: 24px; background: rgba(13,15,28,.88); border: 1px solid rgba(255,255,255,.12); box-shadow: 0 30px 70px -30px rgba(0,0,0,.95); }
.node h4 { display: flex; align-items: center; gap: 14px; font: 700 30px Unbounded; margin-bottom: 10px; }
.node p { font: 700 21px Manrope; color: var(--muted); line-height: 1.4; }
.node .k { width: 54px; height: 54px; border-radius: 16px; display: grid; place-items: center; color: #fff; background: var(--grad); flex-shrink: 0; }
.web { left: 120px; top: 380px; width: 360px; }
.supa { left: 600px; top: 230px; width: 680px; height: 560px; border-color: rgba(52,211,153,.45); background: rgba(6,40,30,.35); }
.supa > h4 .k { background: linear-gradient(135deg,#34d399,#059669); }
.inner { position: absolute; left: 34px; right: 34px; padding: 22px 24px; border-radius: 20px; background: rgba(7,8,15,.82); border: 1px solid rgba(255,255,255,.12); }
.inner b { display: flex; align-items: center; gap: 12px; font: 800 26px Manrope; }
.inner small { display: block; margin-top: 8px; font: 700 19px Manrope; color: var(--muted); }
.svc { left: 1420px; width: 400px; }
.svc .k.g { background: linear-gradient(135deg,#4285f4,#9b72cb 60%,#d96570); }
.svc .k.p { background: #ffc439; color: #003087; font: italic 900 24px Verdana; }
.svc .k.m { background: linear-gradient(135deg,#0b996e,#1fd896); }
.cron { position: absolute; left: 700px; top: 860px; display: flex; align-items: center; gap: 16px; padding: 16px 24px; border-radius: 18px; background: rgba(13,15,28,.92); border: 1px solid rgba(251,191,36,.45); font: 800 23px Manrope; }
.cron .clock { position: relative; width: 44px; height: 44px; border-radius: 50%; border: 3px solid #fbbf24; }
.cron .clock i { position: absolute; left: 19px; top: 6px; width: 3px; height: 17px; border-radius: 2px; background: #fbbf24; transform-origin: 50% 15px; animation: spin 2s linear infinite; }
svg.links { position: absolute; inset: 0; pointer-events: none; }
svg.links path { fill: none; stroke-width: 4; stroke-linecap: round; }
svg.links .base { stroke: rgba(167,139,250,.75); stroke-dasharray: var(--len); stroke-dashoffset: var(--len); }
svg.links .dots { stroke: #fff; stroke-dasharray: 2 28; opacity: .85; animation: flow 1.2s linear infinite; }

/* ai */
#ai .title { position: absolute; left: 0; right: 0; top: 120px; text-align: center; font-size: 66px; }
#ai .grid7 { position: absolute; left: 150px; right: 150px; top: 290px; display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; }
.aic { position: relative; padding: 28px 26px; border-radius: 24px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); }
.aic .k { width: 58px; height: 58px; border-radius: 17px; display: grid; place-items: center; color: #fff; background: var(--grad); margin-bottom: 18px; }
.aic b { display: block; font: 700 30px Unbounded; margin-bottom: 8px; }
.aic small { display: block; font: 700 20px Manrope; color: var(--muted); line-height: 1.35; }
.aic .n { position: absolute; top: 22px; right: 24px; font: 800 20px Manrope; color: var(--dim); }
.fallback { position: absolute; left: 150px; right: 150px; top: 760px; display: flex; align-items: center; gap: 26px; padding: 24px 30px; border-radius: 24px;
  background: rgba(52,211,153,.08); border: 1px solid rgba(52,211,153,.4); }
.fallback .k { width: 64px; height: 64px; border-radius: 18px; display: grid; place-items: center; background: linear-gradient(135deg,#34d399,#22d3ee); color: #052e1c; flex-shrink: 0; }
.fallback b { display: block; font: 800 28px Manrope; margin-bottom: 12px; }
.chain { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.chain .chip { font-size: 18px; padding: 8px 14px; }
.chain .arrow { color: var(--dim); font: 800 22px Manrope; }
.chain .busy { position: relative; }
.chain .busy::after { content: "busy"; position: absolute; top: -14px; right: -10px; padding: 2px 8px; border-radius: 99px; font: 800 13px Manrope; background: #dc2626; color: #fff; }

/* benefits */
#benefits .title { position: absolute; left: 0; right: 0; top: 120px; text-align: center; font-size: 66px; }
#benefits .cols { position: absolute; left: 150px; right: 150px; top: 290px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 34px; }
.ben { position: relative; padding: 36px 34px 38px; border-radius: 28px; background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.12); overflow: hidden; }
.ben::before { content: ""; position: absolute; width: 380px; height: 380px; border-radius: 50%; top: -190px; right: -140px; filter: blur(50px); opacity: .45; }
.ben.o::before { background: radial-gradient(circle,#8b5cf6,transparent 70%); } .ben.p::before { background: radial-gradient(circle,#06b6d4,transparent 70%); } .ben.c::before { background: radial-gradient(circle,#f59e0b,transparent 70%); }
.ben .k { position: relative; width: 84px; height: 84px; border-radius: 24px; display: grid; place-items: center; color: #fff; margin-bottom: 24px; }
.ben.o .k { background: var(--grad); } .ben.p .k { background: linear-gradient(135deg,#22d3ee,#34d399); color: #04212a; } .ben.c .k { background: linear-gradient(135deg,#fde68a,#f59e0b 55%,#f97316); color: #451a03; }
.ben h3 { position: relative; font: 700 38px Unbounded; margin-bottom: 26px; }
.ben li { position: relative; display: flex; align-items: center; gap: 14px; list-style: none; font: 700 24px Manrope; margin: 16px 0; color: #dfe2fb; }
.ben li .c { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; background: rgba(52,211,153,.18); color: #6ee7b7; flex-shrink: 0; }
.ben ul { padding: 0; }

/* outro */
#outro .brand { position: absolute; left: 0; right: 0; top: 280px; display: flex; flex-direction: column; align-items: center; gap: 34px; }
#outro .brandrow { display: flex; align-items: center; gap: 36px; }
#outro .word { font: 800 150px Unbounded; letter-spacing: -.04em; }
#outro .tag { font: 700 44px Manrope; color: #dfe2fb; }
#outro .links { display: flex; gap: 22px; margin-top: 18px; }
#outro .links .chip { font-size: 26px; padding: 16px 24px; border-radius: 18px; }
#outro .built { position: absolute; left: 0; right: 0; top: 830px; text-align: center; font: 700 24px Manrope; color: var(--dim); }
.fadeall { position: absolute; inset: 0; background: #000; opacity: 0; pointer-events: none; }
"""


def bg():
    return '<div class="bgfx"><i class="b1"></i><i class="b2"></i><i class="b3"></i></div><div class="grid"></div>'


def words(text, start, step, cls_from=None):
    out, t = [], start
    for i, w in enumerate(text.split()):
        cls = ' class="gt"' if cls_from is not None and i >= cls_from else ''
        out.append(f'<span{cls} {fx("word", round(t, 2), 0.6)}>{w}</span>')
        t += step
    return ' '.join(out)


def problem():
    bubbles = [("who plays at 8??", False, 7.6, 'Dias'), ("bracket link is broken again", False, 8.5, 'Asel'),
               ("did anyone get my $20 transfer?", True, 10.0, None), ("can we move our match to tmrw?", False, 11.0, 'Kairat'),
               ("NO. 9 PM is final", True, 11.8, None)]
    bub = ''.join(f'<span class="bub{" me" if me else ""}" {fx("pop", d, 0.45)}>{f"<b>{who}</b>" if who else ""}{txt}</span>'
                  for txt, me, d, who in bubbles)
    rows = [['Team', 'Paid?', 'Match', 'Time'], ['Steppe Wolves', 'yes?', 'vs Nomad', '8 PM'], ['Astana Lions', 'NO', 'vs Aurora', '8?? 9?'],
            ['Qyran Five', 'pending', 'TBD', '—'], ['Silk Road', 'NO', '???', '9 PM']]
    cell = lambda v: f'<td class="{"bad" if v in ("NO", "???", "8?? 9?") else "hl" if v in ("pending", "yes?") else ""}">{v}</td>'
    table = ''.join('<tr>' + ''.join(cell(v) for v in r) + '</tr>' for r in rows)
    return f"""
    <section class="scene" id="problem">{bg()}
      <span class="eyebrow" style="left:50%; top:220px; transform:translateX(-50%); animation: fadeIn .8s var(--e) .3s both, fadeOut .5s ease 4.3s forwards">{ic('alert', 20)} The problem</span>
      <div class="h1 headline" style="animation: lift .8s var(--e) 4.35s both">{words("Running a tournament shouldn't be", 1.05, 0.2)}<br>{words("harder than", 2.2, 0.2)} {words("winning one.", 2.65, 0.25, 0)}</div>
      <div class="chaos" style="animation: dim .7s ease 12.6s forwards">
        <div class="card sheet" {fx("popRot", 6.2, 0.55, ", jitter 3s ease-in-out 7s infinite")}>
          <div class="t">{ic('table', 26)} bracket_v7_FINAL(2).xlsx</div><table>{table}</table></div>
        <div class="card unpaid" {fx("popRot", 10.0, 0.45)}>5 teams unpaid?</div>
        <div class="card chat" {fx("popRot", 7.25, 0.55, ", jitter 3.4s ease-in-out 8s infinite")}>
          <div class="t">{ic('users', 26)} Tournament chat <small>· 214 members</small></div>{bub}</div>
        <div class="card sketch" {fx("popRot", 8.45, 0.55)}>
          <svg width="484" height="194"><path style="--len:600; animation: draw 1.2s ease 8.7s both" d="M20 30 h90 v40 h-90 M20 110 h90 v-40 M110 70 h70 M20 150 h90 v20 M180 70 v55 h90 M270 125 h80"/></svg>
          <span class="n" style="left:30px; top:10px">Wolves</span><span class="n" style="left:30px; top:120px">Lions??</span><span class="n" style="left:300px; top:95px">final</span></div>
        <div class="clockfight" style="animation: fadeUp .5s var(--e) 11.5s both"><span class="chip">{ic('clock', 26)} 8 PM?</span><span class="chip" style="border-color:#f87171;color:#fecaca">{ic('clock', 26)} 9 PM!!</span></div>
      </div>
      <div class="card prize" {fx("pop", 12.95, 0.6)}>
        <div class="row"><div class="ic">{ic('trophy', 44)}</div><div><h3>1st place prize · $480</h3><p>Winners: Aurora · paid by bank transfer</p></div></div>
        <div class="status">{ic('hourglass', 30)} Status: pending… <span class="days">
          <span style="animation: fadeIn .01s linear 13.4s both, fadeOut .01s linear 14.0s forwards">day 3</span>
          <span style="animation: fadeIn .01s linear 14.0s both, fadeOut .01s linear 14.6s forwards">day 9</span>
          <span style="animation: fadeIn .01s linear 14.6s both, fadeOut .01s linear 15.2s forwards">day 16</span>
          <span style="animation: fadeIn .01s linear 15.2s both">day 23</span></span></div>
      </div>
    </section>"""


def intro():
    return f"""
    <section class="scene" id="intro">{bg()}
      <div class="brand" style="animation: liftLogo .8s var(--e) 7.35s both">
        <div class="brandrow">
          <div class="logo-mark" style="animation: pop .8s var(--e) .25s both, glow 3s ease-in-out 1.2s infinite">{LOGO}</div>
          <div class="word" style="animation: slideR .8s var(--e) .75s both">Turni<span class="gt">RUM</span></div>
        </div>
        <div class="tag" style="animation: fadeUp .7s var(--e) 1.5s both">Tournaments that run themselves</div>
        <div class="chip" style="animation: fadeUp .6s var(--e) 2.3s both">{ic('code', 20)} Open source · MIT license</div>
      </div>
      <div class="pills" style="animation: fadeOut .4s ease 7.3s forwards">
        <div class="pill" {fx("pop", 4.0, 0.6)}><span class="k">{GEM.replace('url(#gg)', '#fff')}</span> AI does the organizing</div>
        <div class="pill paypal" {fx("pop", 5.4, 0.6)}><span class="k" style="font:italic 900 22px Verdana">P</span> PayPal handles the money</div>
      </div>
      <div class="three">
        <div class="tri" {fx("fadeUp", 8.45, 0.6)}><div class="ic">{ic('swords', 46)}</div><b>Bracket</b><span class="ok" {fx("check", 10.35, 0.45)}>{ic('check', 30)}</span></div>
        <div class="tri" {fx("fadeUp", 9.1, 0.6)}><div class="ic">{ic('calendar', 46)}</div><b>Schedule</b><span class="ok" {fx("check", 10.55, 0.45)}>{ic('check', 30)}</span></div>
        <div class="tri" {fx("fadeUp", 9.8, 0.6)}><div class="ic">{ic('trophy', 46)}</div><b>Prizes</b><span class="ok" {fx("check", 10.75, 0.45)}>{ic('check', 30)}</span></div>
      </div>
    </section>"""


def architecture():
    # connector paths: web→supa, edge→gemini/paypal/brevo, cron→edge
    links = [
        ('M480 500 C 540 500, 560 500, 600 500', 2.9, 160),
        ('M1246 670 C 1330 670, 1330 330, 1420 330', 9.4, 520),
        ('M1246 700 C 1340 700, 1340 560, 1420 560', 11.5, 330),
        ('M1246 730 C 1340 730, 1340 770, 1420 770', 13.9, 230),
        ('M940 860 L 940 792', 15.3, 70),
    ]
    paths = ''.join(f'<path class="base" style="--len:{ln}; animation: draw .9s ease {d}s both" d="{p}"/>'
                    f'<path class="dots" style="animation: fadeIn .3s ease {d + 0.8}s both, flow 1.2s linear {d + 0.8}s infinite" d="{p}"/>'
                    for p, d, ln in links)
    return f"""
    <section class="scene" id="architecture">{bg()}
      <span class="eyebrow" style="left:150px; top:44px; animation: fadeIn .6s var(--e) .3s both">{ic('code', 20)} Under the hood</span>
      <div class="h1 title" style="animation: fadeUp .7s var(--e) .55s both">How it <span class="gt">works</span></div>
      <svg class="links" width="1920" height="1080">{paths}</svg>
      <div class="node web" {fx("slideL", 1.85, 0.7)}><h4><span class="k">{ic('globe', 28)}</span>Web app</h4>
        <p>HTML · CSS · JavaScript<br>for organizers, players<br>and the platform creator</p></div>
      <div class="node supa" {fx("pop", 2.75, 0.7)}><h4><span class="k">{ic('zap', 28)}</span>Supabase</h4>
        <div class="inner" style="top:110px; animation: fadeUp .6s var(--e) 3.15s both"><b>{ic('user', 26)} Auth</b><small>Email + password accounts and sessions</small></div>
        <div class="inner" style="top:250px; animation: fadeUp .6s var(--e) 3.8s both"><b>{ic('table', 26)} Postgres + Row Level Security</b><small>Every table guarded by policies · RPC functions</small></div>
        <div class="inner" style="top:410px; border-color: rgba(139,92,246,.55); animation: fadeUp .6s var(--e) 6.4s both"><b>{ic('code', 26)} Edge Function · Deno</b><small>Payments · payouts · refunds · brackets · AI · notifications</small></div>
      </div>
      <div class="node svc" style="top:250px; animation: slideR .7s var(--e) 9.6s both"><h4><span class="k g">{GEM.replace('url(#gg)', '#fff')}</span>Google Gemini</h4><p>Plans brackets, schedules,<br>drafts and suggestions</p></div>
      <div class="node svc" style="top:480px; animation: slideR .7s var(--e) 11.7s both"><h4><span class="k p">P</span>PayPal</h4><p>Orders · Payouts · Refunds</p></div>
      <div class="node svc" style="top:680px; animation: slideR .7s var(--e) 14.1s both"><h4><span class="k m">{ic('mail', 28)}</span>Brevo</h4><p>Reminder emails</p></div>
      <div class="cron" style="animation: fadeUp .6s var(--e) 15.45s both"><span class="clock"><i></i></span> pg_cron · every 10 minutes → reminders</div>
    </section>"""


def ai():
    items = [('Drafting', 'A whole tournament from one sentence', 'sparkles', 3.25), ('Formats', 'Single, double, round robin or groups', 'swords', 4.05),
             ('Seeding', 'The strongest teams meet later', 'trend', 4.95), ('Scheduling', 'Times, breaks, parallel matches', 'calendar', 5.85),
             ('Rescheduling', 'A free slot when both captains ask', 'clock', 6.9), ('Reminders', 'Friendly emails 24 h and 1 h before', 'mail', 8.1),
             ('Teammates', 'Players who fit, with a reason', 'users', 8.55)]
    cards = ''.join(f'<div class="aic" {fx("pop", d, 0.5)}><span class="n">0{i + 1}</span><div class="k">{ic(icn, 30)}</div><b>{n}</b><small>{t}</small></div>'
                    for i, (n, t, icn, d) in enumerate(items))
    chain = ['gemini-3.6-flash', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-3.5-flash', 'plain rules']
    chips = ''
    for i, c in enumerate(chain):
        d = 10.0 + i * 0.45
        cls = ' busy' if i == 0 else ''
        style = f'animation: fadeUp .4s var(--e) {d}s both' + (', light .4s ease 11.5s forwards' if i == 1 else '')
        chips += f'<span class="chip mono{cls}" style="{style}">{c}</span>' + (f'<span class="arrow" style="animation: fadeIn .3s ease {d + .2}s both">→</span>' if i < len(chain) - 1 else '')
    return f"""
    <section class="scene" id="ai">{bg()}
      <span class="eyebrow" style="left:50%; top:44px; transform:translateX(-50%); animation: fadeIn .6s var(--e) .3s both">{ic('bot', 20)} Where the AI works</span>
      <div class="h1 title" style="animation: fadeUp .7s var(--e) .6s both">Gemini in <span class="gt">seven places</span></div>
      <div class="grid7">{cards}</div>
      <div class="fallback" {fx("fadeUp", 9.1, 0.7)}><div class="k">{ic('shield', 34)}</div>
        <div><b>Model busy? The next one answers, or plain rules take over.</b><div class="chain">{chips}</div></div></div>
    </section>"""


def benefits():
    col = lambda cls, icn, title, items, d: (
        f'<div class="ben {cls}" {fx("fadeUp", d, 0.7)}><div class="k">{ic(icn, 44)}</div><h3>{title}</h3><ul>' +
        ''.join(f'<li style="animation: slideL .5s var(--e) {round(d + 0.45 + i * 0.4, 2)}s both"><span class="c">{ic("check", 20)}</span>{t}</li>' for i, t in enumerate(items)) +
        '</ul></div>')
    return f"""
    <section class="scene" id="benefits">{bg()}
      <span class="eyebrow" style="left:50%; top:44px; transform:translateX(-50%); animation: fadeIn .6s var(--e) .25s both">{ic('star', 20)} Who benefits</span>
      <div class="h1 title" style="animation: fadeUp .7s var(--e) .45s both">Everyone in the <span class="gt">tournament</span></div>
      <div class="cols">
        {col('o', 'trophy', 'Organizers', ['Hours saved on every event', 'Entry fees verified for you', 'Income in the wallet, fairly split'], 0.7)}
        {col('p', 'swords', 'Players', ['Clear brackets, live standings', 'Fair schedules and rescheduling', 'Prizes paid automatically'], 3.6)}
        {col('c', 'users', 'Clubs & communities', ['Paid events, no spreadsheets', 'Every payment in one ledger', 'Full transparency, flat 10% fee'], 7.7)}
      </div>
    </section>"""


def outro():
    return f"""
    <section class="scene" id="outro">{bg()}
      <div class="brand">
        <div class="brandrow">
          <div class="logo-mark" style="animation: pop .8s var(--e) .2s both, glow 3s ease-in-out 1s infinite">{LOGO}</div>
          <div class="word" style="animation: slideR .8s var(--e) .45s both">Turni<span class="gt">RUM</span></div>
        </div>
        <div class="tag" style="animation: fadeUp .7s var(--e) 1.4s both">Tournaments that run themselves.</div>
        <div class="links">
          <span class="chip" style="animation: pop .6s var(--e) 3.2s both">{ic('code', 26)} Open source · MIT</span>
          <span class="chip" style="animation: pop .6s var(--e) 3.55s both"><svg width="26" height="26" viewBox="0 0 24 24" fill="#fff"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.9 2.9 1.3 3.6 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.4 4.6 18.4 5 18.4 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/></svg> GitHub · m1ller750</span>
          <span class="chip" style="animation: pop .6s var(--e) 3.9s both">{ic('shield', 26)} PayPal sandbox demo</span>
        </div>
      </div>
      <div class="built" style="animation: fadeIn .8s ease 4.4s both">Built with Google Gemini · PayPal · Supabase · Brevo</div>
      <div class="fadeall" style="animation: fadeIn .7s ease 6.9s forwards"></div>
    </section>"""


HTML = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Unbounded:wght@500;600;700;800&display=block">
<style>{CSS}</style></head><body>
<svg width="0" height="0" style="position:absolute"><defs><linearGradient id="gg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4285f4"/><stop offset=".6" stop-color="#9b72cb"/><stop offset="1" stop-color="#d96570"/></linearGradient></defs></svg>
{problem()}{intro()}{architecture()}{ai()}{benefits()}{outro()}
<script>
  const id = new URLSearchParams(location.search).get('scene') || 'problem';
  document.getElementById(id).classList.add('on');
</script></body></html>"""

(HERE / 'scenes.html').write_text(HTML)
print('motion/scenes.html', len(HTML))
