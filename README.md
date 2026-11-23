# Right to Reply

Right to Reply displays approved plain-text responses alongside keyword mentions when the participating party is named in the same article. It matches names and keywords locally. The extension's network request downloads the approved response JSON and includes no article text or page URL.

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

To exercise the extension, run `python -m http.server 8000` from the repository root and open `http://localhost:8000/demo/`. Open the extension popup on that tab and check **Enable fictional localhost demo**. Activate the underline beneath **example keyword** to see the response. The linked example has a separate response control and its original link remains usable. The demo works only on loopback sites. On ordinary sites the initial approved feed is empty. Use **Refresh approved responses** to check for new data immediately.

## Public submissions

Every party receives the same invitation and rules at the same time. Participation is opt-in. An authorised party representative proposes additions, edits and removals in a public pull request. The PR records evidence, links, discussion and review decisions. The distributed data contains the reviewed wording only. Parties have no direct publishing access.

Edit `data/responses.json` in a pull request. The version-1 format has a `parties` array, with `id`, `name`, `color` (six-digit hex), and `responses` per party. Each response has a `keyword`, a single-line `response` of up to 160 characters, and a `description` of up to 255 characters. Published content is plain text. The validator rejects unexpected fields, markup and URL forms. Put evidence links in the PR. Eligibility comes from the submitted party name.

Reviewers verify authority and wording, then record the decision in the public PR. Merging the reviewed feed to protected `main` starts its validation and data-only release. The extension reads only the `responses.json` asset from the latest release of this repository. It retains the last valid response set if an update fails. Feed edits do not require a new extension build.

## Website library

The same build generates `dist/website/right-to-reply.mjs`. Host this module from your site and call `createScanner(approvedData)({ headline, blocks })`. It returns participating parties and matches for the headline and each supplied block. Match offsets are UTF-16 indices. Render response and description as text.

Run `node tools/validate.cjs` and `node --test tests/feed.test.cjs` to validate the data and exercise the matcher and refresh logic.
