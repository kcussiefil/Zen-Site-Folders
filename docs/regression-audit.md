# v0.3.7 regression audit and v0.3.8 repair

Base: `5a3fe4a3d8d6cb33b69127238159feefefa30fad` (main, v0.3.7).
The user explicitly requested publication on 2026-11-01. The verified repair is prepared as v0.3.8 after versioned CI passes; physical macOS acceptance remains unverified.

## Source evidence

The installed Mac was inspected read-only: Zen 1.24b, build 20261029123729, source stamp `f75390aa2b797ddc3524ff9ed52ceb32a839f9fa`; Zia 2.114.1. The native modules were read from the application's omni.ja, without modifying the application or the user's profile. CI uses the official Zen 1.24b binaries and Zia commit `4bbd6c57338970765b18eb54de162267ae115dfa`.

- Zen `tabbrowser/tabgroup.mjs`: the label click sets `group.collapsed`; the setter emits `TabGroupCollapse`/`TabGroupExpand`. The ordinary group's animation-complete event waits for width transitions, not the folder's vertical animation.
- Zen `zen-components/ZenFolders.mjs`: `on_TabGroupCollapse`, `on_TabGroupExpand`, and selection entrypoints reject ordinary groups through the `isZenFolder` guard. The public `animateCollapse`/`animateExpand` routines perform the vertical animation and share a registry that cancels replaced item animations.
- Zia's `springFolderAnimation` decorates `Element.prototype.animate`, including ordinary groups, but does not create the missing native call. Its drop handlers run in window capture, can place tabs immediately or queue placement, and keep `zia-settling` during landing.
- Zen `Tabbrowser.sys.mjs`: `ungroupTab` moves each tab immediately after its group, reversing repeated A/B/C detaches. The current API mutates synchronously, but it also emits native move events and queues group MutationObservers/removal. The wrapper has no completion promise for the group's DOM removal.
- A real tab mousedown selects the tab and `_adjustFocusAfterTabSwitch` focuses its content browser. That emits blur even though the user is still working in the same window. v0.3.7's capturing `blur -> reset` discards the pending drag source. The old unit fixture had no native focus transfer.

Upstream references: [Zen source](https://github.com/zen-browser/desktop/tree/f75390aa2b797ddc3524ff9ed52ceb32a839f9fa), [Zen 1.24b binaries](https://github.com/zen-browser/desktop/releases/tag/1.24b), [Zia 2.114.1](https://github.com/z1n-k/zia/tree/4bbd6c57338970765b18eb54de162267ae115dfa).

## Conflicting controls across earlier versions

| Revision | Competing control / missing assumption |
| --- | --- |
| v0.3.1–v0.3.2 | A 470ms timer set a settled flag; CSS subsequently hid the container. This created a second completion controller alongside the Zia spring. |
| v0.3.3–v0.3.6 | A separate 420ms height animation, native-animation detection, selected-row height calculations, and settled CSS could disagree about geometry and final visibility. |
| v0.3.7 collapse | Removed those controls and CSS, but also removed the only vertical-animation caller for ordinary groups. A true collapsed group still occupied 119px in the initial native probe. |
| v0.3.7 dragging | A guessed 38ms post-drop correction used already-translated row rectangles. Capturing blur erased some sources; native transient ungroup/collapse made correction bail out. Mouseup could also schedule a correction without an accepted native drop. |
| v0.3.6–v0.3.7 ungroup | Immediate verification ignored an outstanding drop transaction and asynchronous group removal. A standalone synchronous ungroup **does pass** the native baseline; the pending-drop and deferred-detach cases fail. Do not misreport the standalone case as reproduced. |

## Final behavior

Only owned, ordinary, unpinned site groups receive the adapter. It borrows three native animation-state accessors, keeps the real group type, and invokes Zen's native animation methods. Zia continues to decorate that same animation path. Selection/reversal uses the native replacement registry. No independent height animation, delayed hide flag, global prototype patch, or custom collapsed CSS was added.

Drag targets use plain copies of pre-drag DOMRect geometry, adjusted for scrolling. OS window deactivation, Escape, a new pointer gesture or an actual workspace change cancels stale work; moving focus to a content browser does not. The queued transaction also checks the live workspace ID, because ordinary Space switching may omit the UI-update event. A drop is committed at most once after native motion/landing becomes idle, rather than after 38ms. The polling interval is 16ms; a 4-second timeout **aborts** correction, it does not force a late move. Multi-selection, split views, pinned tabs and cross-folder destinations are excluded. An accepted same-folder drop may return that exact original tab if native placement transiently ungrouped it; it never pulls a tab back out of another group.

Explicit organize, undo, menu ungroup and safe split wait for accepted drop work before capturing order. Ungroup snapshots the actual DOM after that barrier, awaits detach/move API completion, preserves sibling anchors, verifies the original objects in contiguous order, and waits for native empty-group removal before rescue progress is marked complete. Archive readback and active snapshot retention are preserved. Restore uses the real collapsed setter so native events fire.

## Tests and their limits

The original six Node suites remain supplementary checks. `tests/browser/run.py` starts a dedicated disposable Zen profile and connects only to that process's private Marionette port. It loads the actual five scripts, CSS and optional complete Zia resources. It never attaches to an existing browser or copies user session data.

Ten native cases cover computed collapse height, rapid reversals, selected-row transfer, pre-drag translated geometry, late real native moves, consecutive sorting, group-to-first placement, native transient ungroup, stale-gesture cancellation, drop/ungroup sequencing, deferred detach completion, the actual XUL menu command, safe splitting with a foreign group, SessionStore archive/arrow protection, and undo. Assertions compare actual tab/linked-browser identities and DOM order. Destructive and tab-creation APIs are trapped after fixture setup. The deferred API case delays a call to the real native API; it does not substitute a model of tabs.

Mouse/drag input in this suite is synthetic chrome input; layout, custom elements, tab objects, move APIs, events, animations and SessionStore are real. Headless macOS/Linux results do not certify physical trackpad behavior, GPU rendering, native animation feel, or a user's production session. Those remain required manual acceptance.

Both unchanged baseline and candidate are run in CI. The baseline check requires the collapse, folder-drag and drop/ungroup regressions to fail; the candidate must pass every case. Reports include browser version, script hashes, Zia hashes and individual outcomes. See `docs/macOS-acceptance.md` for the remaining physical acceptance checks.
