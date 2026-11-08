const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..'),css=fs.readFileSync(path.join(root,'userChrome.css'),'utf8');
const js=fs.readFileSync(path.join(root,'site-folders.uc.js'),'utf8');
const manifest=require(path.join(root,'theme.json'));
assert.equal(manifest.version,'0.8.4');
assert(css.includes('.pinned-tabs-container-separator:has(> .zsf-sort-button):hover > toolbarseparator'),
  'only the separator row should shrink the line');
assert(css.includes('position: absolute !important') &&
  css.includes('inset-inline-end: 59px') &&
  css.includes('inset-inline-end: 32px') &&
  css.includes('inset-inline-end: 5px'),
  'all three right-aligned icons have fixed positions in Undo/Group/Clear order');
assert(css.includes('transition: opacity .14s ease, visibility') &&
  !css.includes('transition:\n    width'),
  'fade icons without width/position transitions');
assert(css.includes('zen-icons/dart-down.svg') &&
  css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button > .toolbarbutton-icon {\n  display: -moz-box !important'),
  'override Zen icon hiding for protected selected tabs without replacing the native action');
assert(!css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button:not([can-close="true"])'),
  'Clear must be available even without Zen can-close because other tabs may remain closable');
assert(!css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button {\n  display: flex !important;'),
  'preserve Zen preference that can hide native Clear');
assert(css.includes('toolbarbutton.zsf-undo-button[hidden] {\n  display: none !important'),
  'Undo with no snapshot must stay hidden');
assert(js.includes('undoButton.hidden = !Boolean(snapshot)'),
  'no saved snapshot must hide Undo from layout and pointer handling');
assert(js.includes('lineRect.width') && !js.includes('rect.width > 6'),
  'wave must follow true native separator geometry without invisible overlay controls');
assert(css.includes('.pinned-tabs-container-separator.zsf-is-sorting .zsf-wave'));
console.log('PASS v0.8.4: stationary right actions, Clear remains available, Undo conditional, line and wave');
