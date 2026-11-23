# Changelog

All notable changes are recorded here, newest first, in the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) style; versions follow [Semantic Versioning](https://semver.org/).

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
