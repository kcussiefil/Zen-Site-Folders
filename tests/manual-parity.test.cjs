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
assert(css.includes("#tabbrowser-tabs :is(tab-group, zen-folder)[data-zsf-site] {\n  --tab-group-color: transparent !important;"),
  'automatic site color remains transparently neutral');
assert(css.includes('border-inline-start: 3px solid var(--tab-group-color, currentColor)'),
  'manual color appears as a subtle native-theme accent, not solid group background');
assert(css.includes('tab-group[data-zsf-manual][data-zsf-color-custom]'),
  'only explicitly chosen manual group colors receive accent');
assert(css.includes('tab-group:is([data-zsf-site], [data-zsf-manual])[collapsed]'),
  'manual group uses same collapsed-row CSS as site folders');
assert(css.includes('opacity(0.3025)')&&css.includes('opacity(0.5625)'),
  'native Zia asleep icon composition is unchanged');
assert(manual.includes('const HOVER_MS = 95'), 'hover must respond promptly');
assert(manual.includes('rect.height * .10'), 'center target must span 80% of tab row');
assert(manual.includes("color: 'gray'"), 'use native Firefox gray, not invalid grey');
assert(!manual.includes("color: 'grey'"));
assert(manual.includes('function setColor(group, color)')&&manual.includes('saveRegistry'),
  'user selected color must be persisted with stable native group ID');
assert(!/\.pinTab\(|\.unpinTab\(|\.removeTab\(/.test(manual),
  'group creation must never pin/unpin/remove existing tabs');
console.log('PASS: manual group styling, collapse, hover, drag, native color and safety parity');