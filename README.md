# Right to Reply

Right to Reply displays approved plain-text responses alongside keyword mentions when the participating party is named in the same article. It matches names and keywords locally. The extension downloads only the approved source directory and party metadata from each repository’s `main` branch, then fetches individual response files when a reader opens a popup. Requests contain no article text or page URL, but the requested keyword filename is visible to GitHub.

## Install in debug mode

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

To enrol or remove a party, submit a public PR changing `data/sources.json`. Each entry contains only `repository` (owner/repo). The browser downloads `party.json` and `identifiers.json` from each listed repository’s `main` branch. It fetches individual keyword Markdown files only when a reader opens a matching popup. An owner-managed GitHub Action in each party repository generates `keywords.json` on the separate `keyword-index` branch whenever approved changes merge into `main`. The browser downloads that index; the response filenames are its only source. Contributors never edit the index. The index is limited to 256 KiB, not a fixed number of keywords. Use the test party repository as the template for future parties. Party representatives submit changes only to their own repository.

Reviewers verify authority and wording, then record the decision in the public PR. Merging a response PR into the party repository’s `main` publishes the response file; the automatic index job updates the keyword list. New and removed keywords take effect on the next successful extension metadata refresh. No second approval or central directory edit is required. Contributors must not have direct publishing access or permission to change the owner-managed index workflow. The central directory is used only to enrol or remove repositories. Metadata normally refreshes every 15 minutes. Unavailable or malformed party metadata is excluded independently; other parties remain available, and partial refreshes are retried on subsequent eligible refreshes. If the central directory itself cannot be read, the last valid metadata is retained for up to 24 hours. Successful replies are cached in background memory for up to five minutes and invalidated on metadata refresh; missing or malformed response files display an unavailable message instead of stale content. Removal from the directory or keyword list takes effect on the next successful metadata refresh. Feed edits do not require a new extension build.

## Delivery and CDN

GitHub raw files are the default origin. The browser respects HTTP caching and backs off an affected repository on HTTP 429 or 503 (honouring Retry-After up to one hour). No GitHub REST API is called by readers. To build against a CDN, configure a trusted HTTPS pull zone whose origin is `https://raw.githubusercontent.com` and preserves the path, then run `python tools/package.py --base-url https://YOUR-CDN-HOST`. The package restricts network permissions and CSP to the chosen origin. Use a short cache TTL (for example five minutes) for directory, metadata, index and response files; purge withdrawn files and indexes if immediate removal is necessary. No CDN account is required for development and no CDN is provisioned by this repository.

## Website library

The same build generates `dist/website/right-to-reply.mjs`. Host this module from your site and call `createScanner(approvedData)({ headline, blocks })`. It returns participating parties and matches for the headline and each supplied block. Match offsets are UTF-16 indices. Render response and description as text.

Run `node tools/validate.cjs` and `node --test tests/feed.test.cjs` to validate the data and exercise the matcher and refresh logic. Run `python tools/package.py`, install Playwright and its Chromium browser, then run `node tests/browser.mjs` for a deterministic extension integration test. Set `RIGHT_TO_REPLY_LIVE=1` to exercise the real test repository instead.

Identifiers accept joined, spaced and hyphenated spellings, but the complete approved name or alias must match. List shorter names, alternate spellings and reversed name order explicitly in `identifiers.json` if desired. Separate first names and surnames scattered through an article do not qualify a party. A response keyword must still match.

Each semantic article (including individual social-media posts where identifiable) is scanned independently. Navigation, hidden content and unrelated articles do not supply the party mention. On pages without semantic article markup the extension uses the main content area, or the body as a fallback. Dynamic changes rescan affected article roots instead of resetting the whole page.

Each party chooses one six-digit hex underline colour in its party.json. Shared matches get equal-width colour segments, one per participating party. Segment order and popup order are shuffled separately for each match. Forced-colour mode uses the reader's system underline colour.
