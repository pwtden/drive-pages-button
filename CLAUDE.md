# drive-pages-button

A Manifest V3 Chrome extension: buttons, configured by the organisation's Chrome policy, that open its own web pages for the Google Drive file or folder in front of the person. Plain JavaScript, no build step; Bun for tests, moon for tasks, proto for pins. User-facing description: [README.md](README.md).

## Quick reference

| Task | Command |
| --- | --- |
| Lint and unit tests | `moon run extension:check` |
| Real Chrome (popup and options page) | `moon run extension:chrome-check` |
| Package for the Chrome Web Store | `moon run extension:package` |

## Where things live

| What | Where |
| --- | --- |
| Which buttons for which address, and what makes a button unusable | `extension/buttons.js` (pure), tested by `extension/buttons.test.js` |
| The popup and the options page | `extension/popup.*`, `extension/options.*` |
| The policy's schema (what an administrator can set) | `extension/managed_schema.json`; the unit tests keep it equal to what `readConfig` reads |
| Decisions | [docs/adr/](docs/adr/) |

## Rules

- **Nothing about any one organisation in the code:** every address and label comes from configuration. An organisation's own configuration lives in that organisation's repository, never here.
- **Two permissions only:** `activeTab` and `storage`. A change that needs more is a decision (an ADR), because every organisation's administrator has to accept it.
- **Only https addresses**, and an id is URL-encoded before it reaches one.
- **Released as a single unit** with semantic-release when the repository goes public (version 2.0.0, the successor of a single-organisation 1.x).
