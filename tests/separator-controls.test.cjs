const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const base=path.join(__dirname,'..');
const css=fs.readFileSync(path.join(base,'userChrome.css'),'utf8');
const js=fs.readFileSync(path.join(base,'site-folders.uc.js'),'utf8');
const manifest=require(path.join(base,'theme.json'));
assert.equal(manifest.version,'0.8.3');
assert(css.includes(':has(> .zsf-sort-button):is(:hover, :focus-within)'),
  'reveal must be triggered by separator hover/focus, never generic sidebar hover');
assert(css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button'));
assert(css.includes("zen-icons/dart-down.svg"),
  'Clear must reuse the Zen-native icon');
assert(css.includes('> .toolbarbutton-text {\n  display: none !important;'),
  'native Clear word must be hidden');
assert(!css.includes('zen-has-implicit-hover'),
  'no sidebar-wide hover trigger');
const collapsed=css.slice(css.indexOf('/* Three controls share ONE hover trigger:'),
  css.indexOf('/* Keep keyboard focus usable'));
assert(collapsed.includes('width: 0 !important') &&
  collapsed.includes('flex: 0 0 0px !important') &&
  collapsed.includes('margin: 0 !important') &&
  collapsed.includes('pointer-events: none !important'),
  'hidden actions must release actual layout width, not merely fade');
assert(css.includes('toolbarbutton.zsf-undo-button[hidden]') &&
  css.includes('display: none !important'),
  'undo with no valid snapshot must stay hidden');
assert(css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button:not([can-close="true"])'),
  'Clear unavailable in Zen must not reserve an empty slot');
assert(!css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button {\n  display: flex !important;'),
  'never override Zen user preference disabling Clear');
assert(js.includes('rect.width > 6') &&
  js.includes("svg.style.setProperty('--zsf-wave-width'"),
  'wave must track physical separator line without zero-width buttons');
assert(css.includes('.pinned-tabs-container-separator.zsf-is-sorting .zsf-wave') &&
  css.includes('.pinned-tabs-container-separator.zsf-is-sorting > toolbarseparator'),
  'retain original active sorting wave');
console.log('PASS: 3 separator-local hover icons, Zen clear preference, zero-width hidden space, wave');
