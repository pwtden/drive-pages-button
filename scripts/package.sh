#!/usr/bin/env bash
# Package the extension for the Chrome Web Store: a zip of exactly the files the manifest needs, and its SHA-256.
# Usage: bash scripts/package.sh            → dist/drive-pages-button-<version>.zip
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/extension"
version=$(bun -e 'console.log(JSON.parse(await Bun.file("manifest.json").text()).version)')
out="../dist/drive-pages-button-${version}.zip"
files=(manifest.json managed_schema.json popup.html popup.js options.html options.js buttons.js
  icons/icon-16.png icons/icon-32.png icons/icon-48.png icons/icon-128.png icons/LICENSE-fluent-emoji.txt)
for f in "${files[@]}"; do [[ -f "$f" ]] || { echo "✗ missing $f" >&2; exit 1; }; done
mkdir -p ../dist
rm -f "$out"
zip -q -X "$out" "${files[@]}"
echo "$(cd ../dist && pwd)/$(basename "$out")"
shasum -a 256 "$out" | cut -d' ' -f1
