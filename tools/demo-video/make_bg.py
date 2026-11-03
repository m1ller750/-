import asyncio
from playwright.async_api import async_playwright
from demo_env import serve, MOCK, ENGINE, CHROME
async def main():
    srv, base = serve()
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME)
        ctx = await b.new_context(viewport={'width': 1280, 'height': 720}, device_scale_factor=1.2)
        page = await ctx.new_page()
        await page.add_init_script("window.__DEMO__={scene:'create',as:'u-org'}")
        await page.route('**/js/api.js', lambda r: r.fulfill(body=MOCK, content_type='text/javascript'))
        await page.route('**/js/engine.js', lambda r: r.fulfill(body=ENGINE, content_type='text/javascript'))
        await page.goto(base + '#/guide'); await page.wait_for_timeout(1200)
        await page.add_style_tag(content='.blob{animation:none!important}.topbar,main,footer,.toasts{visibility:hidden!important}')
        await page.wait_for_timeout(300)
        await page.screenshot(path='web/demo-bg.png')
        await b.close()
    srv.shutdown()
asyncio.run(main())
