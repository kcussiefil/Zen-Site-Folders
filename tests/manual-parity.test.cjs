const assert = require('node:assert/strict');
const fs = require('node:fs');
const read = name => fs.readFileSync(name, 'utf8');
const collapse=read('site-folders-collapse.uc.js');
const hover=read('site-folders-hover.uc.js');
const drag=read('site-folders-drag.uc.js');
const top=read('site-folders-top-drop.uc.js');
const css=read('userChrome.css');
const manual=read('site-folders-manual.uc.js');
const both='tab-group:is([data-zsf-site], [data-zsf-manual]):not([split-view-group])';
for (const [name,script] of [['collapse',collapse],['hover',hover],['drag',drag],['top-drop',top]]) {
  assert(script.includes(both),name+' must include manual groups without claiming site ownership');
  assert(!script.includes("const GROUP = 'tab-group[data-zsf-site]") &&
    !script.includes("const SELECTOR = 'tab-group[data-zsf-site]"),
    name+' must not silently exclude manually created groups');
}
const fullCSS=(css.match(/tab-group:is\(\[data-zsf-site\], \[data-zsf-manual\]\)/g)||[]).length;
assert(fullCSS >= 22,'manual group must inherit full transparent Site Folders geometry and styles');
assert(!css.includes('border-inline-start: 3px solid var(--tab-group-color') &&
  !css.includes('[data-zsf-color-custom]'),
  'manual-group color accents removed');
assert(css.includes('#tabbrowser-tabs :is(tab-group, zen-folder):is([data-zsf-site], [data-zsf-manual]) {\n  --tab-group-color: transparent !important;'),
  'manual and site groups both force neutral transparent native color');
assert(css.includes('tab-group:is([data-zsf-site], [data-zsf-manual])[collapsed]'),
  'manual group uses same collapsed-row CSS as site folders');
assert(css.includes('opacity(0.3025)')&&css.includes('opacity(0.5625)'),
  'native Zia asleep icon composition is unchanged');
assert(manual.includes('const HOVER_MS = 250') &&
  manual.includes('const STATIONARY_PX = 3') &&
  manual.includes('DEFAULT_HOLD_SECONDS = 1.2') &&
  manual.includes("getStringPref(HOLD_PREF,raw)"),
  '250ms stationary centre dwell precedes adjustable 1.2s hold');
assert(css.includes('zsf-manual-horizontal-fill') &&
  css.includes('scaleX(0)') && css.includes('scaleX(1)'),
  'horizontal progress must visibly fill with GPU transform rather than hidden important width');
assert(css.includes('data-zsf-manual-pair') &&
  css.includes('visibility: hidden !important'),
  'two original rows are masked by their own icon-only preview without reparenting');
assert(!css.includes('zsf-manual-ring-fill') &&
  !css.includes('zsf-manual-merge-progress'),'old circular ring removed');
assert(manual.includes('function watchRearm(event)') &&
  manual.includes('Math.hypot(x-pending.x,y-pending.y)<=STATIONARY_PX') &&
  manual.includes('current.sorting=false') &&
  manual.includes('watchRearm(event)'),
  'only a stationary 250ms centre dwell permits a manual preview');
assert(!manual.includes('event.stopPropagation()') &&
  manual.includes("lastDrop='native-sort'") &&
  manual.includes('clearDrag();return;'),
  'never intercept native dragover or incomplete native drop');
assert(!css.includes('[data-zsf-manual-guard]') &&
  !manual.includes("setAttribute('data-zsf-manual-guard'"),
  'native neighbour-avoidance is never suppressed by the manual group mod');
assert(manual.includes('const lower=upper===source ? tab : source'),
  'always build both source and target favicon previews after Zia reorders tabs');
assert(manual.includes("color: 'gray'"), 'use native Firefox gray, not invalid grey');
assert(!manual.includes("color: 'grey'"));
assert(!manual.includes('function setColor(') && !manual.includes('GROUP_COLORS'), 'no color feature');
assert(!manual.includes("icon: info.icon, color:"), 'color is not persisted for new groups');
assert(manual.includes("delete info.color") && manual.includes("group.color = 'gray'"),
  'pre-v1.0.1 color selections migrate safely to neutral');
assert(css.includes('#zsf-manual-merge-choice') &&
  css.includes('#zsf-manual-pair') && !css.includes('#zsf-manual-merge-preview'),
  'two original row positions display title and overlapping favicons');
assert(manual.includes('document.documentElement.appendChild(choice)') &&
  manual.includes('document.documentElement.appendChild(pair)') &&
  !manual.includes('stack.appendChild(choice)') &&
  !manual.includes('bottomStack.appendChild(pair)'),
  'both previews must be root portals, never descendants of Zia-transformed tabs');
assert(css.includes(':root > :is(#zsf-manual-merge-choice, #zsf-manual-pair)') &&
  css.includes('position: fixed !important') &&
  manual.includes('setPortalBounds(choice,drag.previewSlots.upper)') &&
  manual.includes('setPortalBounds(pair,drag.previewSlots.lower)'),
  'upper and lower rows use independent fixed viewport positions from pre-drag snapshots');
assert(css.includes(':root > #zsf-manual-pair') &&
  !css.includes('transform: none !important;\n  translate: none !important;'),
  'root previews do not impose a transform freeze on native Zen/Zia tab rows');
assert(manual.includes('insertBefore: before') &&
  manual.includes('const anchor=sourceTop<=targetTop ? source : target'),
  'native group title anchors to original upper row for both directions');
assert(manual.includes('[dragSource, ...validated.filter(tab => tab !== dragSource)]'),
  'native membership is dragged-first independent of transient Zen/Zia sorting');
assert(!/_dontAnimateTabMove\s*=/.test(manual),
  'manual grouping must NEVER mutate Zen global drag animation flag');
assert(manual.includes("data-zsf-manual-committing"),
  'drop suppresses intermediate landing transition only for two grouped tabs');
assert(!/event\.dataTransfer\.setDragImage\s*\(/.test(manual),
  'never overwrite native/Zia-managed drag picture');
assert(manual.includes("source.setAttribute('data-zsf-manual-source','true')") &&
  manual.includes("drag?.source?.removeAttribute?.('data-zsf-manual-source')") &&
  css.includes('.tabbrowser-tab[data-zsf-manual-source]'),
  'hide moving native source only while manual group preview is visible');
assert(css.includes('gap: 8px !important') &&
  css.includes('margin-inline-start: 0 !important'),
  'manual group site favicons are separated by an actual 8px gap');
assert(manual.includes("document.documentElement.setAttribute('data-zsf-manual-preview-active','true')") &&
  manual.includes("document.documentElement.removeAttribute('data-zsf-manual-preview-active')") &&
  css.includes(':root[data-zsf-manual-preview-active] :is(.tab-close-button, .tab-reset-button)') &&
  css.includes('visibility: hidden !important'),
  'native tab close/reset X is suppressed only for the active group preview');
assert(css.includes('brightness(0) invert(1)') &&
  css.includes('.zsf-favicon[src="chrome://browser/skin/zen-icons/folder.svg"]') &&
  css.includes('zsf-manual-merge-icon'),
  'only default folder images turn white, not unrelated favicon images');
assert(!/\.pinTab\(|\.unpinTab\(|\.removeTab\(/.test(manual),
  'group creation must never pin/unpin/remove existing tabs');
console.log('PASS: manual group styling, collapse, hover, drag, neutral group color and native safety parity');