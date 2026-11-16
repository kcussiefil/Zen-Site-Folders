# Changelog

This file is a short index of published changes, not a second copy of the full release notes. See [GitHub Releases](https://github.com/kcussiefil/Zen-Site-Folders/releases) and [`releases/`](releases/) for exact version descriptions.

| Version | Summary |
| --- | --- |
| [v1.0.6](releases/v1.0.6.md) | Re-arm manual grouping after 150ms stationary centre hover even after native sorting; preserve progress through pointer jitter, give favicon pair an 8px gap and hide native close X only during preview. |
| [v1.0.5](releases/v1.0.5.md) | Latch native sorting after the far 70%/30% centre boundary; separate favicon pair by 2px, remove duplicate drag icon and turn only default manual folders white. |
| [v1.0.4](releases/v1.0.4.md) | Decouple New Group label and favicon pair from Zia-transformed native tab rows using two fixed, scroll-aware root overlays. |
| [v1.0.3](releases/v1.0.3.md) | Use centre-only hold with 150ms stability and Sine-adjustable 0.3–2.5s progress; preview source-first A/B on two original rows, sort only after crossing centre. |
| [v1.0.2](releases/v1.0.2.md) | Use Yab-style integrated 新群組 row with horizontal 500ms progress, and prevent wrong landing order by anchoring native group on hovered tab. |
| [v1.0.1](releases/v1.0.1.md) | Remove manual group colors; add Yab-style locked favicon-only ring progress and stable native-group landing without Zia reorder flicker. |
| [v1.0.0](releases/v1.0.0.md) | Make manual groups use full Site Folders/Zia visuals, native collapse and hover cards; add native color palette and easier center-drop targeting. |
| [v0.9.9](releases/v0.9.9.md) | Create native unpinned manual groups by dropping a tab on another tab or multi-select context menu; preserve automatic site groups. |
| [v0.9.8](releases/v0.9.8.md) | Restore Sine update detection by advancing updatedAt and add a release metadata regression check. No runtime changes. |
| [v0.9.7](releases/v0.9.7.md) | Correct collapsed-preview background-link placement and match the native Zia asleep-tab icon filter. |
| [v0.9.6](releases/v0.9.6.md) | Match group-header favicons to Zia asleep-tab icon brightness, with live load-state switching and no JS or layout changes. |
| [v0.9.5](releases/v0.9.5.md) | Preview cards dim unloaded tabs using Zia's setting, with live pending-state updates and no card rerender. |
| [v0.9.4](releases/v0.9.4.md) | Event-driven self-recovery when native background-drag guard disappears at runtime; no change to drag engine. |
| [v0.9.3](releases/v0.9.3.md) | Keep proven background drag always on (hidden kill switch); hand selected-tab colour UI and CSS to HG v0.4.5. |
| [v0.9.2](releases/v0.9.2.md) | Harden background drag against retargeted presses and overwritten native hooks; add diagnostics and coverage. |
| [v0.9.1](releases/v0.9.1.md) | Keep background-tab protection active during overlapping drop and press events. |
| [v0.9.0](releases/v0.9.0.md) | Drag background or unloaded tabs without activating them; preserve click, native/Zia ordering and split-view behavior. |
| [v0.8.9](releases/v0.8.9.md) | Add 3px gap between site group titles and member tabs with unchanged net height and animations. |
| [v0.8.8](releases/v0.8.8.md) | Match group-title hover to Zia's live tab hover color, including collapsed folders. |
| [v0.8.7](releases/v0.8.7.md) | Restore natural SVG proportions; optical sizing Undo 14px, Group 15px, Clear 14px with softer Clear ink. |
| [v0.8.6](releases/v0.8.6.md) | Normalize actual icon silhouettes with image-only scaleY/scaleX, preserving fixed buttons and native commands. |
| [v0.8.5](releases/v0.8.5.md) | Optically balance separator icons: Undo 15px, Group 16px, Clear 13px; keep all three 20px hit targets and fixed positions. |
| [v0.8.4](releases/v0.8.4.md) | Fix missing native Clear icon even when Zen protects active tabs; right-align Undo → Group → Clear with stationary fading and full-width separator wave. |
| [v0.8.3](releases/v0.8.3.md) | Reveal all three separator actions only on separator hover; use Zen's dart-down Clear icon; full-width line and adaptive sorting wave. |
| [v0.8.2](releases/v0.8.2.md) | Reject native split-view group admission at the drop boundary; preserve standalone split and ordinary-tab moves. |
| [v0.8.1](releases/v0.8.1.md) | Prevent repeated native expand animations on split-view group exit/re-entry; reduce drag layout clipping regressions. |
| [v0.8.0](releases/v0.8.0.md) | Correct version carry-over after v0.7.9; identical functional behavior to historical v0.7.10. |
| [v0.7.10](releases/v0.7.10.md) | Restore Zen's native split-folder expand/collapse geometry; prevent overlapped rows after dragging a split inside. |
| [v0.7.9](releases/v0.7.9.md) | Keep nested Zen split views visible and their titles intact in Site Folders; apply custom active-tab color to split containers. |
| [v0.7.8](releases/v0.7.8.md) | Suppress Zia decorative site-group hairline during drag, retaining drop highlights and all placement logic. |
| [v0.7.7](releases/v0.7.7.md) | Correct XUL context-menu opening mode for Site Folders group right-click pointer tracking; macOS manual validation pending. |
| [v0.7.6](releases/v0.7.6.md) | Zia 2.118 video-state hover-card compatibility and visible-only compositor handling. |
| [v0.7.5](releases/v0.7.5.md) | Better site-group title contrast in light Zen Spaces. |
| [v0.7.4](releases/v0.7.4.md) | Retired a separate experimental blur-gear mod; main Site Folders behavior unchanged. |
| [v0.7.3](releases/v0.7.3.md) | Fix hidden standalone tabs after background-group auto-dissolution; Zia glass styling alignment. |
| [v0.7.2](releases/v0.7.2.md) | Two-tab group threshold, standalone-tab rules, single-member cleanup and per-organize snapshots. |
| [v0.7.1](releases/v0.7.1.md) | Reliable tab opening-time tracking after Zen restores a session. |
| [v0.7.0](releases/v0.7.0.md) | Initial Zia live-preview styling integration. |

Earlier versions remain available in [`releases/`](releases/) and in the repository's [release history](https://github.com/kcussiefil/Zen-Site-Folders/releases). Historical notes are preserved as published; an old version's behavior must not be mistaken for the current version.

Documentation-only commits do not change the MOD version or published release tags.
