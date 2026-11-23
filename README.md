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
| `tab`   | `"new"` (the default) opens the page in a new tab; `"same"` opens it in the tab the person is on (since 2.1) |

A button that breaks a rule is left out, and the options page says which one and why.

**Keyboard (since 2.1):** Alt+Shift+D opens the popup (Chrome's suggested shortcut; people can change it at `chrome://extensions/shortcuts`). The first button has the focus, so Enter presses it, and the digits 1 to 9 press the button of that number, which each button shows.

`"tab": "same"` suits a page that finishes by itself and then sends the person back to the file or folder: they stay in one tab. **Set it only once every Chrome has 2.1**: Chrome checks a policy against the installed version's schema, and 2.0's schema has no `tab`. A full example is in [`examples/example-config.json`](examples/example-config.json).

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

### See it before you roll it out

`scripts/preview-popup.js` renders the real popup with your configuration (the plain form, as in `examples/example-config.json`) on an address you name. It prints each button with the address it opens, names any setting it could not use, and saves a picture of the popup at the size Chrome gives it:

```bash
bun scripts/preview-popup.js --config your-config.json --tab "https://drive.google.com/drive/folders/<a folder id>" --out popup.png
```

Try a Drive folder, a Google Doc and any other page. `--own` previews the configuration as a person's own options-page setting instead of the policy. The exit code is 0 when the popup shows buttons and uses every setting, 1 when it does not, and 2 when it could not look.

## Develop

```bash
proto use                          # bun and moon, as pinned in .prototools
bun install
moon run extension:check           # Biome lint and the unit tests
moon run extension:chrome-check    # the popup and options page in real headless Chrome
bun scripts/preview-popup.js --config <file> --tab <address>   # your configuration's popup, as a picture
moon run extension:package         # dist/drive-pages-button-<version>.zip and its SHA-256
```

## Licence

MIT, see [LICENSE](LICENSE). The icon is Microsoft's Fluent Emoji "card index dividers", under MIT ([extension/icons/LICENSE-fluent-emoji.txt](extension/icons/LICENSE-fluent-emoji.txt)).
