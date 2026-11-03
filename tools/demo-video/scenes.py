import asyncio, sys
from recorder import record

FILL = """() => { document.querySelectorAll('[data-tournament-form] .input, [data-tournament-form] .textarea, [data-tournament-form] .select, .split-inputs input')
  .forEach((el, i) => setTimeout(() => { el.classList.remove('demo-fill'); void el.offsetWidth; el.classList.add('demo-fill'); }, i * 60)); }"""

async def create(r):
    await r.until(0.35)
    await r.click('[data-ai-prompt]', 0.25, 0.45, ms=900)
    await r.until(r.at(1, 0.15))
    await r.type('Valorant 5v5 cup for 16 teams next Saturday at 7 PM, online, $20 entry, prizes for the top 3', cps=24)
    await r.click('[data-ai-draft]', ms=650)
    await r.chip('<i>✦</i><div>Gemini is drafting the tournament<small>Structured JSON answer, checked by the server</small></div>', '', 3300)
    await r.page.wait_for_function("document.querySelector('[name=title]').value.length > 0", timeout=8000)
    await r.js(FILL)
    await r.until(r.at(2, 0.25))
    await r.scroll_to('[data-tournament-form]', top=96, ms=1400)
    await r.until(r.at(2, 2.1))
    await r.scroll_to('select[name=bracket_format]', top=300, ms=1300)
    await r.point('select[name=bracket_format]', 0.35, 0.5, ms=700)
    await r.until(r.at(2, 4.3))
    await r.scroll_to('[data-prize-split]', top=200, ms=1300)
    await r.until(r.at(3, 0.1))
    await r.click('.fee-notice label.check', 0.04, 0.5, ms=700)
    await r.until(r.at(3, 1.1))
    await r.reveal('form[data-tournament-form] button[type=submit]', ms=750)
    await r.click('form[data-tournament-form] button[type=submit]', ms=650)

async def pay(r):
    await r.until(0.3)
    await r.click('input[name=name]', 0.3, 0.5, ms=700)
    await r.until(r.at(0, 0.1))
    await r.type('Tengri Force', cps=16)
    await r.click('textarea[name=members]', 0.6, 0.12, ms=500)
    await r.page.keyboard.press('End')
    await r.type('\nMirage\nKairat\nDias\nNova', cps=22)
    await r.click('input[name=prize_email]', 0.3, 0.5, ms=500)
    await r.type('tengri.force@paypal.dev', cps=26)
    await r.scroll_to('[data-paypal]', top=170, ms=1000)
    await r.until(r.at(1, -0.15))
    await r.click('[data-pp-card]', 0.5, 0.5, ms=700)
    await asyncio.sleep(0.35)
    await r.click('[data-pp-number]', 0.3, 0.5, ms=450)
    await r.type('4111111111111111', cps=20)
    await r.click('[data-pp-exp]', 0.3, 0.5, ms=400)
    await r.type('12/28', cps=14)
    await r.click('[data-pp-csc]', 0.3, 0.5, ms=400)
    await r.type('123', cps=12)
    await r.until(r.at(2, -0.2))
    await r.click('[data-pp-pay]', 0.5, 0.5, ms=600)
    await r.chip('<i>PP</i><div>Server → PayPal Orders v2: create order<small>$20.00, the price comes from the database</small></div>', 'pp', 5600)
    await asyncio.sleep(1.5)
    await r.chip('<i>✓</i><div>Capture → COMPLETED · $20.00 verified<small>Only now the team is admitted</small></div>', 'ok', 4200)
    await r.page.wait_for_function("location.hash === '#/t/7'", timeout=9000)
    await asyncio.sleep(0.6)
    await r.scroll_to('.my-team-box', top=260, ms=900)
    await r.until(r.at(3, -0.1))
    await r.js("() => document.querySelector('.my-team-box')?.classList.add('demo-glow')")
    await r.chip('<i>🔒</i><div>Card details stay with PayPal<small>TurniRUM keeps only the order and capture IDs</small></div>', 'ok', 0)

async def bracket(r):
    await r.until(0.25)
    await r.scroll_to('#bracket', top=86, ms=1300)
    await r.until(1.9)
    await r.click('[data-build]', 0.5, 0.5, ms=800)
    await r.chip('<i>✦</i><div>Gemini picks the format, seeds and schedule<small>A deterministic engine builds the bracket from the plan</small></div>', '', 4300)
    await r.page.wait_for_selector('.ai-note', timeout=8000)
    await asyncio.sleep(0.5)
    await r.scroll_to('#bracket', top=86, ms=900)
    await r.until(r.at(0, 6.9))
    await r.scroll_by(260, ms=1500)
    await r.until(r.at(1, 0.2))
    await r.chip('<i>🔔</i><div>8 captains notified<small>In the app and by email</small></div>', 'ok', 0)
    await r.point('.br-round:nth-child(3) .m-card', 0.5, 0.5, ms=1400)

async def reschedule(r):
    await r.until(0.25)
    await r.point('[data-reschedule]', 0.5, 0.5, ms=1100)
    await r.until(r.at(1, 0.3))
    await r.click('[data-reschedule]', ms=300)
    await r.chip('<i>✦</i><div>Both captains asked<small>The AI looks for a free slot with no clashes</small></div>', '', 3000)
    await r.until(r.at(2, -0.2))
    await r.click('.bell', ms=700)
    await asyncio.sleep(0.9)
    await r.chip('<i>✉</i><div>Email reminders<small>24 hours and 1 hour before, via Brevo</small></div>', 'ok', 0)
    await r.point('.note', 0.4, 0.5, ms=900)

async def teammates(r):
    await r.until(0.25)
    await r.click('[data-ai-mates]', ms=700)
    await r.chip('<i>✦</i><div>Gemini reads your tournament history<small>Games, level, role and who is looking for a team</small></div>', '', 3400)
    await r.page.wait_for_selector('.mate-card', timeout=8000)
    await asyncio.sleep(0.35)
    await r.reveal('[data-ai-mates]', ms=1000, y=92)
    await r.point('.mate-card .mate-reason', 0.5, 0.5, ms=900)
    await asyncio.sleep(1.4)
    await r.point('.mate-card:nth-child(2) .mate-reason', 0.5, 0.5, ms=900)

FINAL = ".m-card:has(.m-head span:text-is('Final'))"

async def results_prep(r):
    await r.page.evaluate("""() => { const el = [...document.querySelectorAll('.m-card')].find((c) => c.querySelector('.m-head span')?.textContent.trim() === 'Final');
      scrollTo(0, scrollY + el.getBoundingClientRect().top - 330); }""")
    b = await r.page.locator(FINAL).first.bounding_box()
    r.x, r.y = b['x'] + b['width'] * 0.5, b['y'] + b['height'] + 120
    await r.page.mouse.move(r.x, r.y)

async def results(r):
    await r.until(0.15)
    await r.click(f'{FINAL} [data-score=a]', 0.5, 0.5, ms=650)
    await r.type('13', cps=9)
    await r.click(f'{FINAL} [data-score=b]', 0.5, 0.5, ms=380)
    await r.type('10', cps=9)
    await r.click(f'{FINAL} [data-report]', ms=450)
    await r.page.wait_for_function("document.querySelector('.m-card.m-finished .is-win')", timeout=6000)
    await r.until(r.at(1, -0.35))
    await r.js("() => window.demoScroll(0, 900)")
    await asyncio.sleep(0.25)
    await r.click("[data-status=finished]", ms=650)
    await asyncio.sleep(1.05)
    await r.click('[data-confirm-ok]', ms=650)
    await r.chip('<i>PP</i><div>PayPal Payouts: 3 prizes<small>1st $48.00 · 2nd $28.80 · 3rd $19.20</small></div>', 'pp', 5200)
    await r.page.wait_for_selector('#prizes', timeout=9000)
    await r.until(r.at(2, 0.1))
    await r.reveal('#prizes', ms=1000, y=96)
    await r.until(r.at(2, 3.4))
    await r.chip('<i>%</i><div>10% → platform wallet · $16.00<small>The organizer keeps $48.00 to withdraw</small></div>', 'ok', 0)
    await r.click(".nav-link[href='#/wallet']", ms=750)
    await asyncio.sleep(1.2)
    await r.point('form[data-withdraw] button[type=submit]', 0.5, 0.5, ms=900)

SCENES = {
    'create': (create, 'u-org', '/organizer/new'),
    'pay': (pay, 'u-p1', '/t/7/join'),
    'bracket': (bracket, 'u-org', '/organizer?id=7'),
    'reschedule': (reschedule, 'u-p1', '/bracket'),
    'teammates': (teammates, 'u-p5', '/team-finder'),
    'results': (results, 'u-org', '/organizer?id=7', results_prep),
}

if __name__ == '__main__':
    for sid in sys.argv[1:] or SCENES:
        fn, who, path, *prep = SCENES[sid]
        asyncio.run(record(sid, fn, who, path, f'rec/{sid}', prep[0] if prep else None))
