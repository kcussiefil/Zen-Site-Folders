const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..'),css=fs.readFileSync(path.join(root,'userChrome.css'),'utf8');
const js=fs.readFileSync(path.join(root,'site-folders.uc.js'),'utf8');
const manifest=require(path.join(root,'theme.json'));
assert.equal(manifest.version,'0.9.4');
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
  css.includes('toolbarbutton.zen-workspace-close-unpinned-tabs-button > .toolbarbutton-icon {\n  display: flex !important'),
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
const ownIconRule=(selector) => {
  const rx = new RegExp('toolbarbutton\\.'+selector+' > \\.toolbarbutton-icon \\{([^}]+)\\}', 'g');
  const matches=[...css.matchAll(rx)];
  assert(matches.length>=1,'expected a distinct icon-size rule for '+selector);
  // The last rule may apply a transform, not dimensions. Select the
  // dimensions declaration instead of assuming every matching block is one.
  return matches.map(m=>m[1]).reverse().find(rule=>rule.includes('width: '));
};
const verifyIcon=(selector,size) => {
  const rule=ownIconRule(selector);
  for(const prop of ['width','min-width','max-width','height','min-height','max-height'])
    assert(rule.includes(prop+': '+size+'px !important;'),selector+' must keep '+prop+' at '+size+'px');
};
verifyIcon('zsf-sort-button',15);
verifyIcon('zen-workspace-close-unpinned-tabs-button',14);
verifyIcon('zsf-undo-button',14);
const sharedStart=css.indexOf('toolbarbutton:is(.zsf-undo-button, .zsf-sort-button, .zen-workspace-close-unpinned-tabs-button) > .toolbarbutton-icon {');
assert(sharedStart>=0,'shared icon size base rule exists');
const shared=css.slice(sharedStart,css.indexOf('}',sharedStart));
assert(shared.includes('width: 15px !important;') &&
  shared.includes('height: 15px !important;'),'shared base 15px remains overridden by individual icon rules');
assert(css.includes('width: 20px !important;') &&
  css.includes('height: 20px !important;'),'clickable toolbarbuttons remain 20x20');
assert(css.includes('inset-inline-end: 59px !important;') &&
  css.includes('inset-inline-end: 32px !important;') &&
  css.includes('inset-inline-end: 5px !important;'),'original icon positions unchanged');
const separatorCss=css.slice(0,css.indexOf('/* Notice rendering uses Zen'));
assert(!['scaleX(', 'scaleY(', 'scale('].some(pattern=>separatorCss.includes(pattern)),
  'separator glyphs must not be distorted with nonuniform or uniform transforms');
const sharedIconSelector='toolbarbutton:is(.zsf-undo-button, .zsf-sort-button, .zen-workspace-close-unpinned-tabs-button) > .toolbarbutton-icon {';
assert(css.split(sharedIconSelector).some(block=>block.includes('transform: none !important;')),
  'explicitly cancel transforms without modifying 20px toolbarbuttons');
assert(css.includes('opacity: .88 !important;'),
  'the solid-fill native Clear should have a slightly softer ink weight');
console.log('PASS v0.8.9: undistorted 14/15/14 optical balance, 20px targets, Clear tone, wave and alignment');
