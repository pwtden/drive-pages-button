# 2026-11-22: The buttons come from Chrome policy, and the extension carries nothing about any one organisation

**Status:** accepted

## Context

The extension began as a single practice's toolbar button: version 1.x lived in that practice's own repository, with its pages' address and labels written into the code. Its author decided (2026-11-22) to publish it under the author's own Chrome Web Store developer account, under the MIT licence, so that it can serve more than one organisation.

Published that way, a hard-coded address would tie the extension to one organisation, and would put that organisation's internal address in public code.

## Decision

- **Configuration by policy.** The buttons are read from `chrome.storage.managed`, which an administrator sets for every managed browser through Chrome policy (in the Google Admin console: Policy for extensions). The schema is `extension/managed_schema.json`. Each button has a label, when it shows (on a folder, on a file, or always) and an https address that may carry the open folder's or file's id.
- **A person's own configuration** on the options page (`chrome.storage.sync`) is used only when no policy sets one, so an organisation's buttons cannot be overridden.
- **A button that breaks a rule is left out and named**, never half-used: only https; `{folderId}` only on folder buttons; `{fileId}` only on file buttons; no other placeholder.
- **Permissions:** `activeTab` and `storage`. The `storage` permission is new compared with 1.x and is needed to read managed storage; it shows no warning to users.

## Consequences

- One package serves every organisation; each keeps its configuration in its own repository and Admin console.
- An organisation can lock the extension to these permissions with `blocked_permissions`, so an update that asked for more would be refused.
- Configuration mistakes show on the options page instead of failing silently.
