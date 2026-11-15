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
assert(manual.includes('const HOVER_MS = 120') && manual.includes('const HOLD_MS = 420'),
  'the same two-phase reveal and hold as Yab produces a real progress decision');
assert(manual.includes('drag.slots.get(tab)') && manual.includes('drag.slots.get(drag.hover)'),
  'merge targets use fixed unshifted slots and stick while held');
assert(manual.includes("color: 'gray'"), 'use native Firefox gray, not invalid grey');
assert(!manual.includes("color: 'grey'"));
assert(!manual.includes('function setColor(') && !manual.includes('GROUP_COLORS'), 'no color feature');
assert(!manual.includes("icon: info.icon, color:"), 'color is not persisted for new groups');
assert(manual.includes("delete info.color") && manual.includes("group.color = 'gray'"),
  'pre-v1.0.1 color selections migrate safely to neutral');
assert(css.includes('#zsf-manual-merge-progress') &&
  !css.includes('#zsf-manual-merge-preview'), 'only favicon and ring progress remain');
assert(manual.includes("data-zsf-manual-committing"),
  'drop suppresses intermediate landing transition only for two grouped tabs');
assert(!/\.pinTab\(|\.unpinTab\(|\.removeTab\(/.test(manual),
  'group creation must never pin/unpin/remove existing tabs');
console.log('PASS: manual group styling, collapse, hover, drag, neutral group color and native safety parity');