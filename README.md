# Right to Reply

**Our guarantee:** Right to Reply is free to use, will always remain free to use, and will never include advertising.

Right to Reply displays approved plain-text responses alongside keyword mentions when the participating party is named in the same article. It matches names and keywords locally. The extension downloads the complete approved response bundles for every enrolled party on a daily background schedule, independent of browsing. Every match and reply lookup is local. No accounts, telemetry, advertising, browsing-history collection or keyword-specific network requests.

## Privacy by design

All readers receive the same public datasets. The extension does not transmit page URLs, article text, keyword matches, popup activity or political preferences. It stores complete public response bundles and settings locally, never a history of viewed replies. No external images, fonts or scripts are loaded into replies. GitHub or the configured CDN can see ordinary dataset requests and IP addresses; explicit external links are opened without a referrer, but the destination has its own privacy practices. Daily refresh runs while the browser permits background execution; installation, startup when due, and an explicit settings refresh are the only other triggers. No browsing action triggers a download. All future contributions must preserve these properties.

## Install in debug mode

**No local build required:** download your browser's ZIP from the [latest automated browser release](https://github.com/mikemayne/right-to-reply/releases/latest) and extract it into a folder. Chrome and Edge can load that folder directly; Firefox uses its `manifest.json`. Safari packages are unsigned; follow the Safari instructions below. Each release identifies its source commit and includes SHA-256 checksums. The Browser packages workflow rebuilds after extension or packaging changes on `main`, and can also be run manually from Actions.

### Build from source (optional)

Download or clone this repository. From its root run `python tools/package.py` (Python 3.10+). Use the unpacked directory for your browser.

| Browser | Debug installation |
| --- | --- |
| Chrome | Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, then select `dist/chrome`. |
| Edge | Open `edge://extensions`, enable **Developer mode**, choose **Load unpacked**, then select `dist/edge`. |
| Firefox | Open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `dist/firefox/manifest.json`. Repeat after restarting Firefox. |
| Safari on macOS | Enable the developer features in Safari settings. Where offered, use **Add Temporary Extension** in developer settings and select `dist/safari`. Alternatively, use Xcode as described below. |
| Safari on iOS | On a Mac with Xcode, build the Safari app wrapper as described below, choose the iOS target, set the development signing team, and run on a simulator or device. Enable the extension in Safari settings. |

For an Xcode wrapper, run `xcrun safari-web-extension-packager "$PWD/dist/safari"` on a Mac. Older Xcode versions call this command `safari-web-extension-converter`. Set a development bundle identifier and signing team in the generated project. In Safari, grant the extension access to the demo or other site you want to test. See [Apple’s packaging instructions](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari) and [running instructions](https://developer.apple.com/documentation/safariservices/running-your-safari-web-extension).

To exercise the extension, run `python -m http.server 8000` from the repository root and open `http://localhost:8000/demo/`. The page mentions the fictional party and keyword. The extension shows the response once its repository is listed in the source directory and its response is merged into that repository’s `main` branch. Use **Refresh approved responses** in the popup to check immediately. The package contains no reply data.

## Optional owner disclaimer

The extension owner's `data/disclaimer.json` can contain an optional plain-text message and/or an HTTPS link. The disclaimer appears immediately below the independent extension header, before any party statements. Set the file to `{}` to display nothing.

```json
{
  "message": "Your notice or legal disclaimer.",
  "link": "https://example.org/notice",
  "linkText": "Further information"
}
```

All fields are optional; `linkText` requires `link`. Without link text, the URL itself is shown. The extension downloads and validates this JSON from the central repository’s `main` branch during the daily background refresh. Edit the file and merge to `main`; no rebuild or store update is required. Party repositories cannot set it. Invalid or unavailable disclaimer data uses the existing last-valid snapshot fallback (up to 24 hours), rather than silently dropping a legal notice. No HTML, additional permissions or party-supplied links are introduced. The link opens a new tab only when selected, without a referrer. As with source updates, delivery depends on the browser being active, network availability and HTTP caching.

## Public submissions

Every party receives the same invitation and rules at the same time. Participation is opt-in. An authorised party representative proposes additions, edits and removals in a public pull request. The PR records evidence, links, discussion and review decisions. The distributed data contains the reviewed wording only. Parties have no direct publishing access.

Each participating party has a dedicated public GitHub repository controlled by the project owner. The party’s authorised representative proposes changes through public PRs to that repository; only the owner approves and merges them into `main`. Its root contains two JSON files. `identifiers.json` is an array such as `["Example Party", "Alex Example"]`. Include the party name, approved senior members and any approved aliases. A mention anywhere in the same article qualifies that party for keyword matching. `party.json` supplies the party's `id`, `name` and hex `color`.

Put one Markdown file per response in `responses/`. The filename without `.md` is the keyword, including spaces. For example, `responses/example keyword.md` matches the phrase **example keyword**. Renaming the file changes the keyword. To withdraw a response, delete its file. There is no manual keyword list to maintain.

Write two plain-text paragraphs, each on one line, separated by a blank line. The first is the short response (up to 128 characters), the second the extended description (up to 255). For example:

```text
Your one-line response to the keyword goes here.

Your extended description goes here.
```

The browser displays both paragraphs as plain text. Put evidence links in the PR discussion.

To enrol or remove a party, submit a public PR changing `data/sources.json`. Each entry contains only `repository` (owner/repo). The browser downloads `party.json` and `identifiers.json` from each listed repository’s `main` branch, plus the complete `responses.json` from its owner-managed `keyword-index` branch. The publishing workflow generates this bundle from approved Markdown files when changes merge into main. Contributors never edit generated bundles. The existing keyword index remains available for older versions. Use the test party repository as the template for future parties.

Reviewers verify authority and wording, then record the decision in the public PR. Merging approved changes automatically republishes the bundle; new and removed replies take effect on the next successful refresh. No second approval or central directory edit is required. The extension downloads every enrolled party regardless of reader behaviour. Malformed or unavailable parties are excluded independently. A failed central refresh retains only a still-valid snapshot, for up to 24 hours from its last successful check; expired replies are unavailable until a refresh succeeds. The complete validated local snapshot is bounded to 8 MiB; oversized snapshots fail safely. Feed edits do not require a new extension build. For urgent withdrawals use the existing publication and CDN purge process; installed clients receive changes on their next successful refresh.

## Delivery and CDN

GitHub raw files are the default origin. The browser respects HTTP caching and backs off an affected repository on HTTP 429 or 503 (honouring Retry-After up to one hour). No GitHub REST API is called by readers. To build against a CDN, configure a trusted HTTPS pull zone whose origin is `https://raw.githubusercontent.com` and preserves the path, then run `python tools/package.py --base-url https://YOUR-CDN-HOST`. The package restricts network permissions and CSP to the chosen origin. Use a short cache TTL (for example five minutes) for directory, metadata, index and response files; purge withdrawn files and indexes if immediate removal is necessary. No CDN account is required for development and no CDN is provisioned by this repository.

## Website library

The same build generates `dist/website/right-to-reply.mjs`. Host this module from your site and call `createScanner(approvedData)({ headline, blocks })`. It returns participating parties and matches for the headline and each supplied block. Match offsets are UTF-16 indices. Render responses and descriptions as text. Use neutral styling for all matches and short responses; reveal the party name and description only when the reader expands the short response.

Run `node tools/validate.cjs` and `node --test tests/feed.test.cjs` to validate the data and exercise the matcher and refresh logic. Run `python tools/package.py`, install Playwright and its Chromium browser, then run `node tests/browser.mjs` for a deterministic extension integration test. Set `RIGHT_TO_REPLY_LIVE=1` to exercise the real test repository instead.

Identifiers accept joined, spaced and hyphenated spellings, but the complete approved name or alias must match. List shorter names, alternate spellings and reversed name order explicitly in `identifiers.json` if desired. Separate first names and surnames scattered through an article do not qualify a party. A response keyword must still match.

Each semantic article (including individual social-media posts where identifiable) is scanned independently. Navigation, hidden content and unrelated articles do not supply the party mention. On pages without semantic article markup the extension uses the main content area, or the body as a fallback. Dynamic changes rescan affected article roots instead of resetting the whole page.

All parties use the same neutral dotted underline, following the site's text colour for contrast against its background. Short responses use the popup's foreground colour and are shuffled for each match. Readers choose a statement on its merits; selecting it reveals the party name and extended description. Forced-colour mode uses the reader's system underline colour. Existing party colour metadata is retained for compatibility but does not style the underline or short response.
