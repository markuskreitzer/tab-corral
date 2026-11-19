# Tab Corral

A small extension for Brave and other Chromium browsers that merges all windows into one, closes duplicate tabs, and groups tabs by site.

Tabs are moved, never recreated, so page state and history survive and a merge cannot create duplicates.

## Features

- **Merge all windows into this one.** Pinned tabs stay pinned and tab groups stay intact. Default shortcut: `Alt+Shift+M`.
- **Close duplicate tabs** across all windows. The active, pinned, playing, or grouped copy is kept over a plain one.
- **Group tabs by site.** Subdomains fold together (`gist.github.com` joins `github.com`). A site needs two or more tabs to get a group. Running it again adds new tabs to the existing group. Pinned tabs, tabs already in a group, and non-web pages are left alone.

Options in the popup:

- Close duplicates when merging (on by default)
- Group tabs by site when merging (off by default)
- Ignore the `#fragment` when comparing URLs (off by default)

Shortcuts for all three actions can be set at `brave://extensions/shortcuts` (or `chrome://extensions/shortcuts`).

## Install

1. Clone this repository, or download and unzip a release.
2. Open `brave://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder.

## Package

```sh
./package.sh
```

This writes `dist/tab-corral-<version>.zip`, using the version in `manifest.json`.

## Permissions

- `tabs`: read tab URLs to find duplicates and sites, and move tabs between windows
- `tabGroups`: keep groups intact when merging and create groups by site
- `storage`: remember the popup options

The extension makes no network requests and collects no data.

## License

GPL-3.0. See [LICENSE](LICENSE).
