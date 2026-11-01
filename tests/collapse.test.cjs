const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);
assert(!/\.animate\s*\(|\bsetTimeout\s*\(|\brequestAnimationFrame\s*\(|\bTabGroupCollapse\b|\bTabGroupExpand\b|\bTabSelect\b/.test(
  src.replace(/\/\/[^\n]*/g,'').replace(/\/\*[\s\S]*?\*\//g,'')),
  'native Zen/Zia must own collapse and active-tab transitions; no competing JS');
assert(!/tab-group\[data-zsf-site\]\[collapsed\][^{]*\{/.test(css),
  'no site-specific collapsed CSS that swaps display/height on the last frame');
assert(!/data-zsf-collapse-settled[^]*?display:\s*none\s*!important/.test(
  css.replace(/\/\*[\s\S]*?\*\//g,'')),
  'previous delayed display:none must be gone');
assert(!/> \.tab-group-container > tab\[selected\] > \.tab-stack > \.tab-background\s*\{/.test(css),
  'Zia native selected-tab glass and glow must be preserved');
assert(!/\bmoveTab(?:Before|After|ToExistingGroup)\b|\bremoveTab\(|\bpinTab\(/.test(src),
  'native motion compatibility layer must never alter tabs');

// Model the exact upgrade state: an already-restored group may still carry
// the attributes set by the old v0.3.6 controller, even though Sine updated.
class Group {
  constructor(owned=true, collapsed=true) {
    this.isConnected=true;this.owned=owned;
    this.attrs=new Map([['data-zsf-animating','true'],
      ['data-zsf-collapse-settled','true'],
      ...(collapsed?[['collapsed','true']]:[])]);
    this.tabs=[{selected:true,group:this,isConnected:true}];
  }
  matches(selector) { return this.owned &&
    selector==='tab-group[data-zsf-site]:not([split-view-group])'; }
  removeAttribute(key){this.attrs.delete(key);}
  hasAttribute(key){return this.attrs.has(key);}
}
const own=new Group(), other=new Group(false), expanded=new Group(true,false);
const listeners={};
const window={
  gBrowser:{tabContainer:{querySelectorAll:selector=>[own,other,expanded].filter(g=>g.matches(selector))}},
  addEventListener(name,fn){listeners[name]=fn;}
};
const document={readyState:'complete'};
vm.runInNewContext(src,{window,document,console});
const api=window.__zsfCollapseV037;
assert.equal(api.version,'0.3.7');
for(const g of [own,expanded]){
  assert(!g.hasAttribute('data-zsf-animating'));
  assert(!g.hasAttribute('data-zsf-collapse-settled'));
}
assert(other.hasAttribute('data-zsf-collapse-settled'),
  'other Zia/native groups must remain untouched');
assert(own.hasAttribute('collapsed'),'native collapsed property must not change');
assert.equal(own.tabs[0].selected,true,'selected tab object preserved');
assert(!listeners.TabGroupCollapse&&!listeners.TabGroupExpand&&!listeners.TabSelect,
  'no competing animation or selection listeners');
console.log('PASS: Zen/Zia owns animation and selection, legacy flags cleaned, foreign groups isolated');
