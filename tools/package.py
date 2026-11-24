"""Generate unpacked extensions and ZIPs for all supported browser families."""
import argparse
import json
import re
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EXTENSION = ROOT / "extension"
ASSETS = ("article-reply.js", "content.css", "content.js",
          "feed.js", "settings.html", "settings.js", "sync.js", "sources.js")
ICON_SIZES = (16, 32, 48, 128)


def package(name, files):
    folder = DIST / name
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "demo-data.js").unlink(missing_ok=True)
    (folder / "disclaimer.js").unlink(missing_ok=True)
    with ZipFile(DIST / f"right-to-reply-{name}.zip", "w", ZIP_DEFLATED) as archive:
        for filename, data in files.items():
            if isinstance(data, bytes):
                (folder / filename).write_bytes(data)
            else:
                (folder / filename).write_text(data, encoding="utf-8", newline="\n")
            archive.writestr(filename, data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="https://raw.githubusercontent.com",
                        help="HTTPS origin serving the raw GitHub path layout")
    args = parser.parse_args()
    origin = args.base_url.rstrip("/")
    if not re.fullmatch(r"https://[a-zA-Z0-9.-]+", origin):
        parser.error("--base-url must be a plain HTTPS origin without a path or credentials")
    assets = {name: (EXTENSION / name).read_text(encoding="utf-8") for name in ASSETS}
    assets["sources.js"] = assets["sources.js"].replace(
        "'https://raw.githubusercontent.com/'", json.dumps(origin + "/"), 1)
    icons = {str(size): f"icon-{size}.png" for size in ICON_SIZES}
    icon_files = {name: (EXTENSION / name).read_bytes() for name in icons.values()}
    for target in ("chrome", "edge", "firefox", "safari"):
        manifest = {
            "manifest_version": 3,
            "name": "Right to Reply",
            "version": "0.2.0",
            "description": "Read publicly reviewed responses from participating parties.",
            "permissions": ["storage", "activeTab", "alarms"],
            "host_permissions": [
                origin + "/*",
            ],
            "content_security_policy": {"extension_pages": (
                "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "connect-src " + origin +
                "; object-src 'none'; base-uri 'none'; frame-src 'none'"
            )},
            "background": {"service_worker": "sync.js"},
            "icons": icons,
            "action": {"default_popup": "settings.html", "default_icon": icons},
            "content_scripts": [{
                "matches": ["http://*/*", "https://*/*"],
                "js": ["article-reply.js", "feed.js", "content.js"],
                "css": ["content.css"],
                "run_at": "document_idle",
            }],
        }
        if target in ("firefox", "safari"):
            manifest["background"] = {"scripts": ["feed.js", "sources.js", "sync.js"]}
        if target == "firefox":
            manifest["browser_specific_settings"] = {
                "gecko": {"id": "right-to-reply@mikemayne", "data_collection_permissions": {"required": ["none"]}}
            }
        package(target, {"manifest.json": json.dumps(manifest, indent=2) + "\n", **assets, **icon_files})

    core = "\n\n".join(assets[name].rsplit("\nif (typeof module", 1)[0]
                      for name in ("article-reply.js", "feed.js"))
    website = (ROOT / "tools" / "website.mjs").read_text(encoding="utf-8")
    package("website", {"right-to-reply.mjs": core + "\n\n" + website})


if __name__ == "__main__":
    main()
