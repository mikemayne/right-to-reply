# Chrome Web Store submission

Dashboard: https://chrome.google.com/webstore/devconsole

## Files
- Upload ZIP (do not extract): https://github.com/mikemayne/right-to-reply/releases/latest
- Use `right-to-reply-chrome.zip`. Check that the release commit includes the intended extension code.
- Open the successful Responses workflow run for this PR (or later source revision), download its `chrome-store-assets` artifact, and extract it. It includes the original 128px icon, three 1280x800 screenshots captured in Chromium with the actual extension running against a fictional fixture, and a 440x280 promotional tile.
- Privacy policy URL (verify it is publicly accessible after merging the test-site privacy PR): https://mikemayne.github.io/right-to-reply-test/privacy.html
- Website and support information: https://mikemayne.github.io/right-to-reply-test/ and its FAQ.

## Store listing
Name: Right to Reply

Category: News & Weather (or the closest available news category).
Language: English (UK if offered).
Price: Free. No ads. No paid features.

Short description:
Read publicly reviewed responses from participating parties alongside relevant phrases in online articles.

Detailed description:

Right to Reply makes it easier to read participating UK political parties' own positions alongside the news you are reading.

When an article mentions a participating party and a relevant keyword, the extension adds a neutral dotted underline. Select it to read a short response, then expand the response to reveal the party's name and its fuller explanation. You decide what to make of it. The extension is independent of the publication and does not endorse a party.

Participation is opt-in. All eligible UK political parties are offered the same terms. Replies are reviewed under public rules. The current demonstration uses fictional data; real party replies appear only when parties choose to participate and their content is approved.

Privacy by design: the extension reads visible website text locally to identify relevant phrases. It downloads the same complete approved response datasets for every reader, independently of what they read. Article text, browsing history, page URLs, keyword matches and reply activity are not sent to the project or political parties. Site preferences remain on your device. GitHub receives ordinary network connection metadata for background dataset downloads. No account, advertising, analytics or tracking. You can turn matching off globally or for individual sites.

Free to use, forever, without advertising.

## Privacy practices answers
Single purpose: Display publicly reviewed party responses when a participating party and a relevant keyword occur in the same online article, using local matching and locally cached public response datasets.

Permissions:
- storage: Save the complete public response dataset, refresh timestamps and user-configured global and per-site settings locally.
- alarms: Schedule daily background updates independently of reading activity.
- activeTab: Read the current tab URL when the user opens the toolbar popup, only to identify its hostname and apply or change the per-site preference. No persistent tabs permission or browser-history permission.
- HTTP/HTTPS website content script access: Read visible page text locally, match relevant party names and phrases, and add the neutral interactive underline and reply panel. No article content or browsing history is transmitted.
- https://raw.githubusercontent.com/*: Download the complete public source directory, party metadata, reply bundles and optional owner disclaimer over HTTPS on installation, due startup, scheduled refresh or explicit refresh. No credentials, referrers or page-specific requests.
- Remote code: No. Only validated JSON/plain-text data is downloaded; all executable JavaScript is packaged with the extension.

Data handling: disclose website content (visible text, processed locally) and the current website hostname / explicitly configured site preferences (local only, relevant to the web history category). No browsing history log, no transmission of these categories, and no collection of identities, authentication details, financial or health data, personal communications, location or user activity telemetry. GitHub receives ordinary network metadata (including IP address) as the hosting provider. Review the dashboard's actual checkbox definitions before certifying: do not claim that website content is never accessed, or that local data is transmitted. Certify Limited Use only after confirming the declarations are accurate.

Reviewer instructions:
Open https://mikemayne.github.io/right-to-reply-test/test.html after installing. Enable site access and use the toolbar's Refresh approved responses button. The publicly configured example party and demo keyword should be underlined. Open the reply, then expand it to reveal attribution. No account or test login is required. If the live demo source is removed before launch, update these reviewer instructions accordingly.

## Final checks for the owner
- Merge the privacy policy PR and verify its public URL loads.
- Confirm the Responses workflow passed on the intended code and inspect actual screenshots.
- Manually load the exact release ZIP in Chrome and test on the test site, the global and per-site switches, and refresh. The automated test is not a substitute for this final smoke test.
- Confirm whether to leave the clearly fictional demo party enabled for review; do not imply real parties have enrolled.
- In the dashboard complete developer identity/contact information and any required trader status or regional declarations. Choose distribution and visibility. Confirm data declarations yourself.
- Upload and submit only when satisfied.

Google guidance: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy and https://developer.chrome.com/docs/webstore/images.
