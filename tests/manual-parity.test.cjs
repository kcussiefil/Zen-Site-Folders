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
assert(manual.includes("menuItem.setAttribute('label', '建立群組')"),
  'selected-tab context menu must display 建立群組');
assert(!manual.includes('建立普通群組') &&
  !manual.includes('dragstart') && !manual.includes('dragover') &&
  !manual.includes("'drop',") && !manual.includes("'dragend',"),
  'no drag-to-group controller or event listeners remain');
assert(!manual.includes('manual_group_drag') &&
  !manual.includes('HOVER_MS') && !manual.includes('holdMs()'),
  'the discontinued hold preference and timer are removed');
assert(!css.includes('#zsf-manual-merge-choice') &&
  !css.includes('#zsf-manual-pair') &&
  !css.includes('data-zsf-manual-preview-active'),
  'the old draggable grouping overlay and source-hiding styles are removed');
assert(manual.includes('selectedForMenu()') &&
  manual.includes('if (tabs) createFromTabs(tabs)'),
  'only valid multiselection launches manual group creation');
assert(manual.includes("insertBefore: before") &&
  manual.includes("color: 'gray'"),
  'manual groups preserve native insertion order and neutral color');
assert(!manual.includes("dragSource") &&
  !manual.includes("_dontAnimateTabMove =") &&
  !manual.includes(".pinTab(") &&
  !manual.includes(".unpinTab(") &&
  !manual.includes(".removeTab("),
  'no drag-only reparenting, global animation mutation, or tab removal');
assert(manual.includes("delete info.color") &&
  manual.includes("group.color = 'gray'"),
  'existing stored manual groups still restore neutral color');
assert(css.includes('.zsf-favicon[src="chrome://browser/skin/zen-icons/folder.svg"]') &&
  css.includes('brightness(0) invert(1)'),
  'default manual folder icon remains white');
const manifest=require('../theme.json');
assert(!manifest.preferences && !fs.existsSync('preferences.json'),
  'manual group gear and its preferences.json are both gone');
console.log('PASS: native group appearance, menu-only creation, drag isolation, existing group restore, no Sine gear');
