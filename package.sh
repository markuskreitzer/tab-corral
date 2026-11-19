#!/usr/bin/env bash
# Build dist/tab-corral-<version>.zip from the extension files.
set -euo pipefail
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json)
out="dist/tab-corral-${version}.zip"
mkdir -p dist
rm -f "$out"
zip -q -r "$out" manifest.json background.js core.js popup.html popup.css popup.js icons
echo "$out"
