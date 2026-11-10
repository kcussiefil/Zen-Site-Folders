# Zen Site Folders

**Organize related Zen tabs into compact, native tab groups without pinning them.**

[繁體中文](README.zh-TW.md) · [Latest release](https://github.com/kcussiefil/Zen-Site-Folders/releases/latest) · [Changelog](CHANGELOG.md)

Zen Site Folders is a [Sine](https://github.com/CosmoCreeper/Sine) mod for Zen Browser. It groups eligible ordinary tabs by website in the regular tab area and supplies a Zia-style hover preview. Organizing is manual; existing Zen folders, pinned tabs and other protected tab types are kept outside the organizer.

## Features

- **One-click organization:** group matching sites in the ordinary tab area. A new group needs at least two eligible tabs; a single tab may join an existing matching group.
- **Compact previews:** a separate group hover card with tab information, opening-time display when reliable, and Zia-compatible appearance and sound indicators.
- **Native-feeling interaction:** expand/collapse animation, visual drag-and-drop feedback and automatic scrolling near the edge.
- **Preserve your tabs:** sorting and undo use local snapshots and the browser's tab-group APIs; the mod does not intentionally close or reload tabs while organizing.
- **Sensible standalone tabs:** remaining independent web tabs are ordered on an explicit Organize action, with a fallback for unknown opening times.
- **Automatic single-member cleanup:** closing a tab may dissolve a Site Folders-owned group when exactly one member remains; manually dragging a tab out does not trigger this behavior.

## Requirements and installation

1. Install Zen Browser, [Sine](https://github.com/CosmoCreeper/Sine) and [Zia](https://github.com/z1n-k/zia). The current preview integration targets **Zia 2.118**.
2. In Zen / Sine, allow JavaScript mods from external repositories as required by your Sine setup.
3. Install this repository using `kcussiefil/Zen-Site-Folders`.
4. Restart Zen to load the mod scripts.
5. Use the organizer button at the left of the tab-section divider. Its adjacent restore/undo control is available when a suitable snapshot exists.

Back up your Zen profile before first using an organizer that moves existing tabs. If another grouping mod manages the same ordinary groups, check for conflicts before enabling both.

## Compatibility and limitations

- The mod operates on **ordinary tab groups**, not Zen's pinned native folders. It does not automatically convert groups into pinned folders.
- Site Folders' hover preview follows **Zia 2.118** video-state styling. With Zia's *Blur over video* disabled, a video-page card can be translucent **without actual blur**; this is intentional to avoid forcing additional video composition.
- If *Blur over video* is enabled, the preview may use blur while visible. Zia warns that video blur can dull colors or impair HDR rendering; test the result on your own display.
- Genuine opening times are retained when available. Restored legacy tabs without trustworthy timestamps show an unknown time rather than an invented one.
- Browser/profile state, other mods and operating-system graphics composition can affect the final result. Automated tests do not replace hardware testing.

## Project information

| Item | Location |
| --- | --- |
| Current mod version | **v0.8.8** (see `theme.json`) |
| Installation metadata | [`theme.json`](theme.json) |
| Version changes | [`CHANGELOG.md`](CHANGELOG.md) and [Releases](https://github.com/kcussiefil/Zen-Site-Folders/releases) |
| Detailed historical release notes | [`releases/`](releases/) |
| macOS acceptance checklist | [`docs/macOS-acceptance.md`](docs/macOS-acceptance.md) |
| Release-writing convention | [`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md) |

**Updating documentation does not create a new mod version.** Feature changes must be validated separately before updating `theme.json` and publishing a release.
