"""Browser test for the TurniRUM web app against an in-memory mock of api.js.

Usage: python site-tests/run_ui_tests.py [screenshot_dir]
Serves ./site locally, swaps js/api.js for site-tests/mock-api.js and the PayPal SDK for a fake button,
then walks through every role. Exits non-zero on failures or browser errors.
"""
import functools
import http.server
import pathlib
import sys
import threading

from playwright.sync_api import expect, sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
MOCK = (ROOT / "site-tests" / "mock-api.js").read_text(encoding="utf-8")
FAKE_PAYPAL = (ROOT / "site-tests" / "fake-paypal.js").read_text(encoding="utf-8")
SHOTS = pathlib.Path(sys.argv[1]) if len(sys.argv) > 1 else None
CHROMIUM = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(SITE))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, f"http://127.0.0.1:{server.server_address[1]}/"


class Session:
    def __init__(self, browser, base, width=1440, height=1000, name="desktop"):
        self.context = browser.new_context(viewport={"width": width, "height": height})
        self.page = self.context.new_page()
        self.base = base
        self.name = name
        self.errors = []
        self.page.on("pageerror", lambda e: self.errors.append(f"pageerror: {e}"))
        self.page.on("console", lambda m: self.errors.append(f"console.{m.type}: {m.text}") if m.type == "error" else None)
        self.page.route("**/js/api.js", lambda route: route.fulfill(body=MOCK, content_type="text/javascript"))
        self.page.route("https://www.paypal.com/sdk/js**", lambda route: route.fulfill(body=FAKE_PAYPAL, content_type="text/javascript"))

    def go(self, hash_path):
        self.page.goto(self.base + "#" + hash_path)
        self.settle()

    def settle(self):
        self.page.wait_for_load_state("networkidle")
        self.page.wait_for_function("() => !document.querySelector('#app .page-loader')")
        self.page.wait_for_timeout(250)

    def shot(self, name):
        if not SHOTS:
            return
        self.page.add_style_tag(content="*{transition:none!important;animation:none!important}"
                                        ".js .reveal{opacity:1!important;transform:none!important}"
                                        ".topbar{position:absolute!important;width:100%}.toasts{display:none!important}")
        self.page.evaluate("window.scrollTo(0, 0)")
        self.page.wait_for_timeout(150)
        self.page.screenshot(path=str(SHOTS / f"{self.name}_{name}.png"), full_page=True)

    def login(self, email, password="demo1234"):
        self.go("/login")
        self.page.fill("input[name=email]", email)
        self.page.fill("input[name=password]", password)
        self.page.click("form[data-login] button[type=submit]")
        self.settle()

    def logout(self):
        self.page.click("[data-logout]")
        self.settle()


def main():
    server, base = serve()
    failures = []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=CHROMIUM)
        s = Session(browser, base)
        page = s.page

        def check(label, condition):
            print(("PASS " if condition else "FAIL ") + label)
            if not condition:
                failures.append(label)

        # Guest pages
        s.go("/")
        check("home renders hero", page.locator(".hero-title").is_visible())
        check("home shows featured cards", page.locator(".t-card").count() >= 3)
        s.shot("home")
        s.go("/tournaments")
        total = page.locator(".t-card").count()
        page.click("label[for=price-paid]")
        page.wait_for_timeout(200)
        paid = page.locator(".t-card").count()
        check(f"price filter narrows results ({total} → {paid})", 0 < paid < total)
        page.fill("input[name=q]", "chess")
        page.wait_for_timeout(500)
        check("search finds Chess Blitz", page.locator(".t-card").count() == 1 and "Chess" in page.locator(".t-card").inner_text())
        check("filters are stored in the URL", "q=chess" in page.url and "price=paid" in page.url)
        page.click("[data-reset]")
        page.wait_for_timeout(200)
        check("reset restores all cards", page.locator(".t-card").count() == total)
        s.shot("catalog")
        s.go("/t/1")
        check("tournament page shows standings", page.locator(".standings tbody tr").count() == 4)
        check("guest sees sign-in button", page.locator("text=Sign in to join").is_visible())
        s.shot("detail")
        s.go("/organizer")
        check("protected page redirects to login", "#/login" in page.url)

        # Player pays with PayPal
        s.login("player1@demo.dev")
        check("player lands on catalog", "#/tournaments" in page.url)
        s.go("/t/1/join")
        check("join page shows PayPal amount", "$25" in page.locator(".paypal-amount").inner_text())
        page.wait_for_selector(".fake-paypal-button")
        page.fill("input[name=name]", "")
        page.click(".fake-paypal-button")
        page.wait_for_timeout(200)
        check("PayPal blocked until team name is valid", page.locator("[data-field=name].has-error").count() == 1)
        check("join page asks for a prize PayPal email", page.locator("input[name=prize_email]").count() == 1)
        page.fill("input[name=name]", "Golden Eagles")
        page.fill("textarea[name=members]", "Alex\nMira\nTom")
        page.fill("input[name=prize_email]", "eagles@paypal.dev")
        s.shot("join")
        page.click(".fake-paypal-button")
        page.wait_for_url("**#/t/1")
        s.settle()
        check("paid team shows in my-team box", "Paid with PayPal" in page.locator(".my-team-box").inner_text())
        check("standings highlight my team", page.locator("tr.is-mine").count() == 1)
        check("no leave button after payment", page.locator("[data-leave]").count() == 0)
        s.go("/player?id=1")
        check("my tables shows place KPI", page.locator(".kpi-label", has_text="Place").count() == 1)
        s.shot("player_tables")
        s.logout()

        # New player registers and joins a free tournament, then leaves
        s.go("/register?role=participant")
        page.fill("input[name=username]", "x")
        page.click("form[data-register] button[type=submit]")
        check("register validates username", page.locator("[data-field=username].has-error").count() == 1)
        page.fill("input[name=username]", "newbie")
        page.fill("input[name=full_name]", "New Player")
        page.fill("input[name=email]", "newbie@demo.dev")
        page.fill("input[name=password]", "secret1")
        page.fill("input[name=password2]", "secret1")
        s.shot("register")
        page.click("form[data-register] button[type=submit]")
        s.settle()
        check("new player is signed in", page.locator(".user-chip", has_text="New Player").is_visible())
        s.go("/t/3/join")
        page.fill("input[name=name]", "Fresh Five")
        page.click("form[data-join] button[type=submit]")
        page.wait_for_url("**#/t/3")
        s.settle()
        check("free registration works", "Fresh Five" in page.locator(".my-team-box").inner_text())
        page.click("[data-leave]")
        page.click("[data-confirm-ok]")
        page.wait_for_selector(".toast-text:has-text('has left the tournament')", state="attached")
        s.settle()
        check("leave removes the team", page.locator(".my-team-box").count() == 0)
        s.logout()

        # Organizer creates a paid tournament and edits standings
        s.login("arena@demo.dev")
        check("organizer lands on my tournaments", "#/organizer" in page.url)
        s.go("/organizer/new")
        page.fill("input[name=title]", "Autumn Clash")
        page.click("[data-fill-game='Valorant']")
        page.fill("input[name=start_date]", "2030-05-20")
        page.click("label[for=paid-1]")
        page.fill("input[name=entry_fee]", "20")
        page.fill("input[name=max_teams]", "10")
        page.click("form[data-tournament-form] button[type=submit]")
        page.wait_for_timeout(200)
        check("the 10% platform fee must be acknowledged", page.locator("[data-field=fee_ack].has-error").count() == 1)
        page.click("[data-places='2']")
        check("prize places preset", page.locator("[data-split-inputs] input").count() == 2)
        page.locator("[data-split-inputs] input").first.fill("60")
        page.check("input[name=fee_ack]")
        page.click("form[data-tournament-form] button[type=submit]")
        page.wait_for_timeout(200)
        check("prize places must add up to 100%", page.locator("[data-field=prize_split].has-error").count() == 1)
        page.locator("[data-split-inputs] input").first.fill("70")
        page.wait_for_timeout(100)
        check("live split preview", page.locator("[data-out=total]").first.inner_text() == "$200")
        check("prize places preview", page.locator("[data-preview-places] li").count() == 2)
        s.shot("org_form")
        page.click("form[data-tournament-form] button[type=submit]")
        s.settle()
        check("new tournament opens in manage view", page.locator(".manage-head h2").inner_text() == "Autumn Clash")
        page.fill("form[data-add-team] input[name=name]", "Manual Team")
        page.click("form[data-add-team] button[type=submit]")
        s.settle()
        check("manual team added", page.locator("[data-row]").count() == 1)
        s.go("/organizer?id=1")
        row = page.locator("[data-row]").last
        row.locator("[data-stat=wins]").fill("4")
        row.locator("[data-stat=draws]").fill("1")
        check("auto points in the browser", row.locator("[data-stat=points]").input_value() == "13")
        page.locator("[data-save]").first.click()
        s.settle()
        check("saved standings re-rank teams", page.locator("[data-row]").first.locator("[data-stat=points]").input_value() == "13")
        check("PayPal payments list visible", page.locator(".card-title", has_text="PayPal payments").count() == 1)
        s.shot("org_manage")
        page.click("button[data-status=active]")
        s.settle()
        check("status switched to live", page.locator(".seg-btn.is-on", has_text="Live").count() == 1)
        refundable = page.locator("[data-refund]").count()
        page.locator("[data-refund]").first.click()
        page.click("[data-confirm-ok]")
        page.wait_for_selector(".toast-text:has-text('was refunded')", state="attached")
        s.settle()
        check("refund removes the PayPal team", page.locator("[data-refund]").count() == refundable - 1)

        # Finishing a paid tournament pays the prizes and fills the wallets
        s.go("/organizer?id=2")
        page.click("button[data-status=finished]")
        page.wait_for_selector("#confirm-modal[open]")
        check("finish dialog lists the prizes", "1st place: $36.75" in page.locator("[data-confirm-text]").inner_text())
        page.click("[data-confirm-ok]")
        page.wait_for_selector(".toast-text:has-text('prizes were sent')", state="attached")
        s.settle()
        check("prize payouts are listed", page.locator("#prizes tbody tr").count() == 2)
        check("prize payout status is refreshed", page.locator("#prizes .pay-completed").count() == 2)
        check("standings are final after finishing", page.locator("[data-save]").count() == 0 and page.locator("[data-status]").count() == 0)
        s.shot("org_finished")
        s.go("/wallet")
        check("organizer wallet holds the income", page.locator(".wallet-balance b").inner_text() == "$15")
        page.fill("form[data-withdraw] input[name=amount]", "5")
        page.fill("form[data-withdraw] input[name=email]", "arena@paypal.dev")
        page.click("form[data-withdraw] button[type=submit]")
        page.wait_for_selector(".toast-text:has-text('on its way')", state="attached")
        s.settle()
        check("withdrawal lowers the balance", page.locator(".wallet-balance b").inner_text() == "$10")
        check("withdrawal is listed", page.get_by_role("cell", name="arena@paypal.dev", exact=True).count() == 1)
        s.shot("org_wallet")
        s.go("/organizer/business")
        check("business page KPIs", page.locator(".kpi").count() == 5)
        s.shot("org_business")
        s.go("/creator")
        check("organizer cannot open creator panel", page.locator(".error-code").inner_text() == "403")
        s.logout()

        # The winning captain sees the prize
        s.login("player2@demo.dev")
        s.go("/player?id=2")
        check("winner sees the prize payout", "1st place: $36.75" in page.locator(".notice-prize").inner_text())
        s.logout()

        # Platform creator
        s.login("boss@demo.dev", "66666KZ@$")
        check("creator lands on dashboard", "#/creator" in page.url and page.locator(".creator-profit").is_visible())
        s.shot("creator")
        s.go("/creator/tournaments")
        before = page.locator("[data-delete]").count()
        page.locator("[data-delete]").first.click()
        page.click("[data-confirm-ok]")
        page.wait_for_selector(".toast-text:has-text('was deleted')", state="attached")
        s.settle()
        check("creator deletes a tournament", page.locator("[data-delete]").count() == before - 1)
        s.go("/creator/payments")
        check("payments ledger lists PayPal payments", page.locator(".pay-completed").count() >= 2)
        check("payouts ledger lists prizes and withdrawals", page.locator("td", has_text="arena@paypal.dev").count() == 1
              and page.locator("td", has_text="snow.leopards@paypal.example.com").count() == 1)
        s.shot("creator_payments")
        s.go("/wallet")
        check("platform wallet holds the 10% fee", page.locator(".wallet-balance b").inner_text() == "$7.50")
        s.go("/creator/users")
        check("users list with emails", page.locator("td", has_text="newbie@demo.dev").count() == 1)
        s.go("/nope")
        check("404 page", page.locator(".error-code").inner_text() == "404")

        errors = list(s.errors)
        s.context.close()

        # Mobile layout
        m = Session(browser, base, 390, 844, "mobile")
        for path, name in [("/", "home"), ("/tournaments", "catalog"), ("/t/1", "detail")]:
            m.go(path)
            width = m.page.evaluate("document.documentElement.scrollWidth")
            check(f"mobile {name} has no horizontal scroll ({width}px)", width <= 390)
            m.shot(name)
        m.page.click("[data-nav-toggle]")
        check("mobile menu opens", m.page.locator("[data-nav].is-open").is_visible())
        errors += m.errors
        m.context.close()
        browser.close()

    server.shutdown()
    unexpected = [e for e in errors if "fonts.g" not in e]
    for e in unexpected:
        print("BROWSER ERROR", e)
    if failures or unexpected:
        print(f"\n{len(failures)} failed checks, {len(unexpected)} browser errors")
        sys.exit(1)
    print("\nAll UI checks passed")


if __name__ == "__main__":
    main()
