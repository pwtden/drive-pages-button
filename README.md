# Drive Pages Button

A Chrome toolbar button that opens **your organisation's own web pages** for the Google Drive file or folder in front of you. On a Drive folder it can offer "Upload files to this folder"; on a Doc, Sheet or Slides, "Edit this file"; anywhere, "All our pages". The organisation decides the buttons. The extension only builds the links.

- **No secrets and no calls:** it holds no password, token or document content, and calls no service. The pages it opens do their own sign-in and their own checks.
- **Two permissions:**
  - `activeTab` reads the address of the tab in front, and only when the button is clicked;
  - `storage` reads the configuration.
- **Configured by the organisation:** an administrator sets the buttons by Chrome policy (managed storage), so every managed browser gets the same buttons and nobody can change them. Without a policy, a person can set their own on the options page.

## Configuration

A JSON object: an optional `title` and `note`, and a `buttons` list (at most 20). Each button has:

| Field   | Meaning                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------- |
| `label` | What the button says (at most 60 characters)                                                                |
| `when`  | `"folder"` (a Drive folder is open), `"file"` (a Doc, Sheet, Slides, Drawing or Drive file) or `"always"` |
| `url`   | An `https` address; it may contain `{folderId}` when `"folder"`, or `{fileId}` when `"file"`                |

A button that breaks a rule is left out, and the options page says which one and why. A full example is in [`examples/example-config.json`](examples/example-config.json).

### By Chrome policy (Google Admin console)

1. Force-install the extension by its Chrome Web Store id (Devices › Chrome › Apps & extensions › Users & browsers).
2. In the extension's **Policy for extensions** box, paste the configuration with each setting wrapped in `{"Value": …}`, which is the Admin console's format:

```json
{
  "title": { "Value": "Example Co: files" },
  "buttons": { "Value": [{ "label": "All our pages", "when": "always", "url": "https://pages.example.com/" }] }
}
```

Optionally, block every permission the extension does not have today (`blocked_permissions` in the ExtensionSettings policy). A future version that asked for more would then be refused rather than granted.

## Develop

```bash
proto use                          # bun and moon, as pinned in .prototools
bun install
moon run extension:check           # Biome lint and the unit tests
moon run extension:chrome-check    # the popup and options page in real headless Chrome
moon run extension:package         # dist/drive-pages-button-<version>.zip and its SHA-256
```

## Licence

MIT, see [LICENSE](LICENSE). The icon is Microsoft's Fluent Emoji "card index dividers", under MIT ([extension/icons/LICENSE-fluent-emoji.txt](extension/icons/LICENSE-fluent-emoji.txt)).
