const assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path');
const root=path.join(__dirname,'..'),css=fs.readFileSync(path.join(root,'userChrome.css'),'utf8');
const js=fs.readFileSync(path.join(root,'site-folders.uc.js'),'utf8');
const manifest=require(path.join(root,'theme.json'));
assert.equal(manifest.version,'0.8.6');
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
  return matches[matches.length-1][1];
};
const verifyIcon=(selector,size) => {
  const rule=ownIconRule(selector);
  for(const prop of ['width','min-width','max-width','height','min-height','max-height'])
    assert(rule.includes(prop+': '+size+'px !important;'),selector+' must keep '+prop+' at '+size+'px');
};
verifyIcon('zsf-sort-button',16);
verifyIcon('zen-workspace-close-unpinned-tabs-button',13);
const sharedStart=css.indexOf('toolbarbutton:is(.zsf-undo-button, .zsf-sort-button, .zen-workspace-close-unpinned-tabs-button) > .toolbarbutton-icon {');
assert(sharedStart>=0,'shared icon size base rule exists');
const shared=css.slice(sharedStart,css.indexOf('}',sharedStart));
assert(shared.includes('width: 15px !important;') &&
  shared.includes('height: 15px !important;'),'Undo remains 15px in shared base');
assert(css.includes('width: 20px !important;') &&
  css.includes('height: 20px !important;'),'clickable toolbarbuttons remain 20x20');
assert(css.includes('inset-inline-end: 59px !important;') &&
  css.includes('inset-inline-end: 32px !important;') &&
  css.includes('inset-inline-end: 5px !important;'),'original icon positions unchanged');
const optical = new Map([
  ['zsf-undo-button','scaleY(0.86)'],
  ['zsf-sort-button','scaleX(0.88)'],
  ['zen-workspace-close-unpinned-tabs-button','scaleX(1.22)']
]);
for(const [selector,scale] of optical) {
  const label='toolbarbutton.'+selector+' > .toolbarbutton-icon {';
  const blocks=css.split(label).slice(1).map(part=>part.slice(0,part.indexOf('}')));
  assert(blocks.some(block=>block.includes('transform: '+scale+' !important;')),
    selector+' must have the exact calibrated optical transform '+scale);
}
assert(css.includes('transform-origin: 50% 50% !important;') &&
  css.includes('transition: none !important;'),'glyphs transform about their center without animation');
console.log('PASS v0.8.6: measured optical glyph corrections, unchanged icon boxes, stationary click targets and native Clear');
