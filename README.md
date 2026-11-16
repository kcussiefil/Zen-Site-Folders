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

- **Background-tab dragging:** move unselected or discarded tabs without selecting them first; normal clicks still activate them. Toggle in Sine preferences (enabled by default). Split-view tabs keep Zen's native behavior.

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
| Current mod version | **v1.0.7** (see `theme.json`) |
| Installation metadata | [`theme.json`](theme.json) |
| Version changes | [`CHANGELOG.md`](CHANGELOG.md) and [Releases](https://github.com/kcussiefil/Zen-Site-Folders/releases) |
| Detailed historical release notes | [`releases/`](releases/) |
| macOS acceptance checklist | [`docs/macOS-acceptance.md`](docs/macOS-acceptance.md) |
| Release-writing convention | [`docs/RELEASE_POLICY.md`](docs/RELEASE_POLICY.md) |

**Updating documentation does not create a new mod version.** Feature changes must be validated separately before updating `theme.json` and publishing a release.

Selected-tab colour, its native context-menu command and the non-modal picker are now owned independently by [HDR Guard](https://github.com/kcussiefil/Zen-Compact-Transparent-HDR-Guard) v0.4.5. Background dragging is built in by default without a Sine checkbox; advanced rollback is `zen.sitefolders.background_drag.enabled=false` in `about:config`.

**v1.0.7** prioritizes native Zen/Zia sorting above manual grouping: **no `dragover` is intercepted**, and releasing before the editable group-fill completes **never intercepts the native `drop`**. A manual preview appears only after an actual **250ms stationary dwell within 3px** of a target tab's centre, then displays the usual configurable 1.2-second horizontal fill. Deliberate movement immediately cancels the preview and restores native sorting. Both favicon icons always render even when Zia has reordered the two tabs beyond adjacent rows; no more conditional second-row disappearance. Root-fixed preview, 8px icon separation, white default folder and dragged-first group ordering remain. macOS real-input acceptance is still required.

**v1.0.6** fixes the v1.0.5 regression that made manual grouping nearly impossible after crossing a sort boundary. Native Zen/Zia sorting retains control while the pointer moves, but a **stationary 150ms centre hover** can now re-arm grouping **within the same drag**. The active group preview tolerates small pointer jitter before returning to sorting; the 1.2s default progress hold remains editable in Sine. The two site favicons now have a **real 8px gap**, not the earlier 2px overlap. While the group preview is visible, native tab close/reset X controls are hidden and restored immediately on cancel or drop. The root-fixed two-row preview and dragged-tab-first ordering remain. Physical macOS acceptance still required.

**v1.0.5** restores fluid native sorting when dragging a standalone tab across another: after crossing the target's far central edge (70% downward, 30% upward, plus a 2px guard), the **remainder of this drag belongs to Zen/Zia sorting** and later rows cannot recapture it for a new group preview. Adjacent favicons in the lower preview overlap by only 2px rather than 7px. The dragged source row is hidden only while a group preview is visible; the mod no longer overrides Zia's native drag image, avoiding a duplicate cursor-following website icon where Zia manages dragging. Only the default manual-folder icon becomes white, including its preview and group header, while site/custom icons retain their colors. Stability (150ms) and the editable hold (default 1.2s) are unchanged. Hardware verification still required.

**v1.0.4** fixes the two-row manual New Group preview appearing on the same row when Zia moves the dragged tab. The **新群組** title/progress and the overlapping source/target favicons now render as two independent, viewport-fixed root overlays, at the original upper and lower tab coordinates. Zia's tab transforms cannot move either preview. Normal sidebar scrolling moves both previews together using the actual scroll offset; exit/drop removes them. The existing source-first native group order, 150ms stability gate and editable 1.2-second default hold are unchanged. Real macOS trackpad confirmation remains necessary.

**v1.0.3** changes manual tab-to-tab grouping to a centre-band gesture: Zen/Zia does not avoid neighbouring tabs while approaching the target's first edge; crossing the far edge (past the 30–70% central band) restores native reordering. A 150ms stable overlap precedes a **1.2-second default hold**, with the duration editable as a decimal number in the mod's Sine gear settings (0.3–2.5 seconds, 0.1-second steps). Adjacent A→B and B→A merges display **新群組** in the original upper row and the two overlapping site favicons in the lower row; the upward gesture animates that pair downward without changing native tab order. Completed groups always place the **dragged tab first**, then the hovered tab, while the group title stays at the original upper slot. Hardware acceptance remains necessary.

**v1.0.2** matches Yab's published two-stage tab-drop choice: after 180ms, the target tab row temporarily becomes **新群組**, with its site favicon and a 500ms left-to-right progress fill; after the fill, its icon becomes a folder and releasing creates the native group. Unlike the v1.0.1 ring, this is drawn **inside the existing tab row**, not as a floating translucent card. Native creation anchors to the hovered target and preserves **target first, dragged tab second**, even if Zia reorders the drag preview. The native global drag animation state is never modified; no late reordering of the created group. In supported Gecko drag sessions, the native drag image is the favicon; the native image remains as a fallback.

**v1.0.1** removes the entire manual-group color feature (including already saved colors) so manually created groups match normal Site Folders. Dragging onto a tab uses a target-locked, favicon-only circular progress indicator: reveal after 120 ms, fill for 420 ms, then release to create a native ordinary group. The target remains stable even when Zia shifts surrounding tabs. The old translucent preview card is gone; the final group is created with stale Zia landing transforms cleared before the first frame. This is based on the two-stage target/hold logic in Yab's open-source `ColumnDrag.swift` / `TabDropChoice.swift`, adapted for Gecko.

**v1.0.0** unifies manually created groups with the complete Site Folders/Zia layout, collapse motion, hover preview and group-drag behavior. Dragging uses an 80% row-center target with a 95ms preview delay; only tab edges keep native reorder. Right-click a manual group to choose one of nine native Firefox group colors (subtle accent, not a solid background); original automatic site groups remain untouched. Manual group identity and chosen color survive restart.

**v0.9.9** adds native, unpinned manual groups: drag a standalone tab onto the center of another standalone tab and hold briefly, then drop to group; alternatively Command-select several plain tabs and choose **建立普通群組** from the tab context menu. Same-site groups use the site's name and favicon; mixed groups default to 新群組 with a folder icon. Right-click a manual group to rename, change its icon or ungroup. Automatic site organizing leaves these groups intact. Disable drag creation via `zen.sitefolders.manual_group_drag.enabled=false` in `about:config` (context-menu creation remains available).

**v0.9.8** fixes Sine update detection by advancing the manifest's `updatedAt` field; no browser behavior changes.

**v0.9.7** corrects related background tab placement after selecting a collapsed Site Folder from its hover card, and uses Zia's exact asleep-icon opacity instead of a parent-filter ratio.

**v0.9.6** matches Site Folders' group-header favicon brightness to Zia's unloaded-tab icons. A group dims only when all of its tabs are unloaded; any loaded tab restores the normal brightness. This follows Zia's live setting with no script, new observers, or layout changes.

**v0.9.4** adds event-driven recovery when the independent background-drag guard disappears after visiting Zen Settings or Sine reloads. It only checks on tab selection, browser focus, or a genuine tab pointer press; the drag engine itself remains exactly v0.9.2. Runtime diagnostics: `window.__zsfBackgroundDragRecoveryV094?.debug()` in the Browser Console.
