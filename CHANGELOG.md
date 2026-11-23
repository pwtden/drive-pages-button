# Changelog

All notable changes are recorded here, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style; versions follow [Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- `scripts/web-store.js`: publish a version to the Chrome Web Store through its API (v2) as a service account with no key, whose token gcloud mints by impersonation. `status` shows the published version and the one in review (`--published <version>` exits 0 only once that version is live). `release` checks the zip's SHA-256 and manifest version, does nothing when that version is already submitted or published, uploads, waits for the store to process it and submits it for review. `submit` submits the last upload. The publisher, the item, the service account and the gcloud login come from flags or `CWS_*` environment variables, never from the repository. It changes nothing in the extension itself.

## 2.1.0 - 2026-11-23

Version 2.1.0 is about fewer clicks. An organisation whose pages finish their job by themselves (grant access, make the document, upload the files) and then send the person back to the file or folder can now open those pages in the tab the person is on, so they stay in one tab. The popup can be opened from the keyboard, and its buttons pressed with a key. Nothing new is asked of the browser: the permissions are still `activeTab` and `storage`.

### Added

- A button may say `"tab": "same"`: its page opens in the tab the person is on (`chrome.tabs.update` on the active tab), instead of a new tab, the default. Any other value leaves the button out with a reason, like every other rule.
- A keyboard shortcut, Alt+Shift+D, suggested for opening the popup (`_execute_action`); people can change it in Chrome.
- In the popup the first button has the focus, so Enter presses it, and the digits 1 to 9 press the button of that number, which each button now shows.
- The policy schema and the options page know `tab`; the unit tests keep the schema equal to what `readConfig` reads (22 tests), and the real-Chrome check covers the focus, the numbers, a digit key and a same-tab button (21 checks).

- `scripts/preview-popup.js`: render the real popup with your own configuration on an address you name, print each button with the address it opens and any setting it could not use, and save a picture of the popup at the size Chrome gives it.

### Changed

- The real-Chrome plumbing (serving the extension's files, starting headless Chrome, the stand-ins for the Chrome APIs) moved into `scripts/cdp.js`, shared by the check and the preview. The check itself is unchanged and still passes all 17 checks.

## 2.0.0 - 2026-11-22

Drive Pages Button began as one organisation's toolbar button, with that organisation's page addresses written into its code (the 1.x line, never published). Version 2.0.0 is the first public release, and it carries nothing about any one organisation. The buttons, their labels and the addresses they open come from the organisation's Chrome policy, or from the person's own options page when no policy sets them. One package can therefore serve any organisation that keeps its pages in its own place and wants them one click from the Google Drive folder or file in front of its people. It was submitted to the Chrome Web Store on 2026-11-22.

### Added

- Buttons configured by Chrome policy (`chrome.storage.managed`, schema in `extension/managed_schema.json`). Each button has a label, when it shows (on a Drive folder, on a file, or always) and an https address that may carry `{folderId}` or `{fileId}`.
- An options page for people without a policy. It is read-only and names any unusable setting when a policy is present, and it saves a person's own configuration only when every button in it is usable.
- A unit-tested rule for which buttons are usable: https only, a placeholder only where its id exists, and limits of 60-character titles and labels, a 200-character note and 20 buttons. A button that breaks a rule is left out and named, never half-used.
- A real-Chrome check of the popup and the options page, `scripts/verify-in-real-chrome.js`, with 17 checks.
- Store images rendered from the real popup (`scripts/store-images.js`), a privacy policy (`PRIVACY.md`) and the MIT licence.

### Changed

- Permissions are `activeTab` and `storage`. The latter is new, and reads the policy; neither shows a warning to users.
- A new neutral icon, "card index dividers" from Microsoft's Fluent Emoji (MIT).

### Security

- The extension calls no service, holds no secret and collects no data. It reads the tab's address only when its button is clicked. An organisation can block every other permission for it with `blocked_permissions`, so a later version that asked for more would be refused.
