"""Build the static site and a source-only, reproducible extension archive."""
from pathlib import Path
import shutil
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "dist"
OUT.mkdir(exist_ok=True)
for name in ["index.html", "styles.css", "app.js", "vault.js", "bookmark-store.js",
             "sync-setup.html", "sw.js", "manifest.webmanifest", ".nojekyll"]:
    shutil.copy2(ROOT / name, OUT / name)
shutil.copytree(ROOT / "assets", OUT / "assets", dirs_exist_ok=True)
(OUT / "downloads").mkdir(exist_ok=True)
with ZipFile(OUT / "downloads/nova-bookmark-sync.zip", "w", ZIP_DEFLATED) as archive:
    for name in ["manifest.json", "shared.js", "background.js", "content.js",
                 "popup.html", "popup.css", "popup.js", "README.md"]:
        entry = ZipInfo(f"nova-bookmark-sync/{name}", (2026, 10, 21, 0, 0, 0))
        entry.compress_type = ZIP_DEFLATED
        entry.external_attr = 0o644 << 16
        archive.writestr(entry, (ROOT / "extension" / name).read_bytes())
print("Built dist/ and dist/downloads/nova-bookmark-sync.zip")
