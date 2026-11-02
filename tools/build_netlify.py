"""Builds release/netlify/index.html: the whole web app in one file (CSS, supabase-js and the app bundle inline).

Usage: python tools/build_netlify.py
Needs Node.js; esbuild is run with npx unless ESBUILD points to an esbuild binary.
The file can be dropped on https://app.netlify.com/drop or deployed with the Netlify API as is.
"""
import base64
import os
import pathlib
import shlex
import subprocess
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"
OUT = ROOT / "release" / "netlify" / "index.html"


def bundle() -> str:
    esbuild = shlex.split(os.environ.get("ESBUILD", "npx --yes esbuild@0.24.0"))
    with tempfile.TemporaryDirectory() as tmp:
        target = pathlib.Path(tmp) / "app.js"
        subprocess.run([*esbuild, str(SITE / "js" / "main.js"), "--bundle", "--format=iife", "--minify",
                        "--target=es2020", f"--outfile={target}"], check=True, cwd=ROOT)
        return target.read_text(encoding="utf-8")


def main() -> None:
    page = (SITE / "index.html").read_text(encoding="utf-8")
    css = (SITE / "css" / "style.css").read_text(encoding="utf-8")
    supabase = (SITE / "vendor" / "supabase-2.117.3.js").read_text(encoding="utf-8")
    app = bundle()
    favicon = base64.b64encode((SITE / "img" / "favicon.svg").read_bytes()).decode()
    safe = lambda js: js.replace("</script", "<\\/script")  # noqa: E731

    page = page.replace('<link rel="icon" href="img/favicon.svg" type="image/svg+xml">',
                        f'<link rel="icon" href="data:image/svg+xml;base64,{favicon}" type="image/svg+xml">')
    page = page.replace('<link rel="stylesheet" href="css/style.css">', f"<style>\n{css}\n</style>")
    page = page.replace('  <script src="vendor/supabase-2.117.3.js" defer></script>\n'
                        '  <script type="module" src="js/main.js"></script>\n', "")
    assert "vendor/" not in page and "js/main.js" not in page, "index.html changed: update the build script"
    page = page.replace("</body>", f"<script>\n{safe(supabase)}\n</script>\n<script>\n{safe(app)}\n</script>\n</body>")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(page, encoding="utf-8")
    print(f"{OUT.relative_to(ROOT)}: {len(page.encode()) // 1024} KB")


if __name__ == "__main__":
    main()
