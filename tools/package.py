"""Generate unpacked extensions and ZIPs for all supported browser families."""
import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
EXTENSION = ROOT / "extension"
ASSETS = ("article-reply.js", "content.css", "content.js", "demo-data.js",
          "feed.js", "settings.html", "settings.js", "sync.js")


def package(name, files):
    folder = DIST / name
    folder.mkdir(parents=True, exist_ok=True)
    with ZipFile(DIST / f"right-to-reply-{name}.zip", "w", ZIP_DEFLATED) as archive:
        for filename, data in files.items():
            (folder / filename).write_text(data, encoding="utf-8", newline="\n")
            archive.writestr(filename, data)


def main():
    assets = {name: (EXTENSION / name).read_text(encoding="utf-8") for name in ASSETS}
    for target in ("chrome", "edge", "firefox", "safari"):
        manifest = {
            "manifest_version": 3,
            "name": "Right to Reply",
            "version": "0.1.0",
            "description": "Read publicly reviewed responses from participating parties.",
            "permissions": ["storage", "activeTab"],
            "host_permissions": [
                "https://github.com/*",
                "https://release-assets.githubusercontent.com/*",
                "https://objects.githubusercontent.com/*",
            ],
            "background": {"service_worker": "sync.js"},
            "action": {"default_popup": "settings.html"},
            "content_scripts": [{
                "matches": ["http://*/*", "https://*/*"],
                "js": ["article-reply.js", "feed.js", "demo-data.js", "content.js"],
                "css": ["content.css"],
                "run_at": "document_idle",
            }],
        }
        if target == "firefox":
            manifest["background"] = {"scripts": ["feed.js", "sync.js"]}
            manifest["browser_specific_settings"] = {
                "gecko": {"id": "right-to-reply@mikemayne", "data_collection_permissions": {"required": ["none"]}}
            }
        package(target, {"manifest.json": json.dumps(manifest, indent=2) + "\n", **assets})

    core = "\n\n".join(assets[name].rsplit("\nif (typeof module", 1)[0]
                      for name in ("article-reply.js", "feed.js"))
    website = (ROOT / "tools" / "website.mjs").read_text(encoding="utf-8")
    package("website", {"right-to-reply.mjs": core + "\n\n" + website})


if __name__ == "__main__":
    main()
