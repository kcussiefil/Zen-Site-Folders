const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(process.env.ZSF_COLLAPSE_SOURCE || path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const listeners = new Map(), calls = [];
const element = extra => {
  const attrs = new Map(), styles = new Map();
  return Object.assign({ isConnected: true, pinned: false,
    style: { setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k), getPropertyValue: k => styles.get(k) || '' },
    setAttribute: (k,v) => attrs.set(k,String(v)), removeAttribute: k => attrs.delete(k),
    hasAttribute: k => attrs.has(k), getAttribute: k => attrs.get(k) || null,
    getAnimations: () => [] }, extra);
};
const a = element({ selected: false }), b = element({ selected: false });
const tab = element({ selected: true });
const group = element({ tabs: [a,b], collapsed: true, isZenFolder: false,
  matches: () => true, closest: () => null, groupContainer: { hidden: true } });
let spacerCancelled=false;
group.groupStartElement=element({getAnimations:()=>[{effect:{getKeyframes:()=>[{marginTop:'-695px'},{marginTop:'0px'}]},cancel(){spacerCancelled=true;}}]});
group.groupStartElement.style.setProperty('margin-top','-695px');
a.group = b.group = group;
const clean = rows => rows.forEach(t => ['height','min-height','opacity'].forEach(k => t.style.removeProperty(k)));
const proto = {
  get activeGroups() { return this.hasAttribute('has-active') ? [this] : []; },
  get childActiveGroups() { return []; },
  get activeTabs() { return this._activeTabs; },
  set activeTabs(rows) { this._activeTabs = rows; rows.forEach(t => t.setAttribute('folder-active','true')); }
};
const win = {
  addEventListener(type, fn, capture) { listeners.set(type, {fn,capture}); },
  customElements: { get: () => ({prototype: proto}) },
  gBrowser: { selectedTab: tab, tabContainer: {
    querySelectorAll: selector => selector === 'zen-workspace' ? [] : [group],
    _invalidateCachedVisibleTabs() {} } },
  gZenFolders: {
    styleCleanup: clean,
    animateExpand() { calls.push('expand'); },
    animateCollapse() { calls.push('collapse'); },
    animateSelect(g) {
      assert.equal(g, group, 'native routine receives the actual group, not a clone');
      if (!g.isZenFolder) return false;
      assert.equal(g.pinned,false);
      calls.push('select');
      assert.equal(g.groupStartElement.style.getPropertyValue('margin-top'),'0px','landing must not share a 695px spacer animation');
      assert(spacerCancelled,'old spacer animation must release its computed offset before measuring');
      g.groupContainer.hidden = false;
      for (const t of g.tabs) {
        if (t.selected) clean([t]);
        else { t.style.setProperty('height','0px'); t.style.setProperty('opacity','0'); }
      }
      return Promise.resolve();
    }
  }
};
vm.runInNewContext(source, { window: win, document: { readyState: 'loading' },
  MutationObserver: class { observe() {} }, queueMicrotask, console });
const api = win.__zsfCollapseV037;
api.start(); calls.length = 0;
tab.style.setProperty('height','0px');tab.style.setProperty('opacity','0');
group.tabs.push(tab);tab.group = group;
assert.equal(listeners.get('TabGrouped')?.capture, true, 'handoff precedes native bubble listener');
listeners.get('TabGrouped').fn({target:group,detail:tab});
assert.equal(group.isZenFolder,false,'folder capability restored synchronously');
assert.equal(Object.getOwnPropertyDescriptor(group,'isZenFolder').value,false);
assert.equal(group.collapsed,true);
assert.equal(group.pinned,false);
assert(group.hasAttribute('has-active'),'native on_TabGrouped must not auto-expand a closed group');
assert.equal(group.groupContainer.hidden,false,'landing measurement sees visible selected row immediately');
assert.equal(tab.style.getPropertyValue('height'),'');
assert.equal(a.style.getPropertyValue('height'),'0px','hidden siblings have no intervening layout gap');
assert.deepEqual(calls,['select'],'one native selection animation, no second collapse');
api.sync(group);
assert.deepEqual(calls,['select'],'queued mutation observer must not restart animation');

// Departure capture must precede native animateUnload's folder-active check.
tab.group = null;group.tabs.pop();
tab.style.setProperty('height','0px');tab.style.setProperty('opacity','0');
listeners.get('TabUngrouped').fn({target:group,detail:tab});
assert(!tab.hasAttribute('folder-active'));
assert.equal(tab.style.getPropertyValue('height'),'');
assert.equal(tab.style.getPropertyValue('opacity'),'');
assert(!group.activeTabs.includes(tab));
assert.equal(group.groupContainer.hidden,true,'departed last active row closes its now-empty visual container synchronously');
assert.deepEqual(calls,['select'],'departure must not add a second collapse animation to the source group');
const count = calls.length;
const nativeGroup = {...group,isZenFolder:true};tab.group = nativeGroup;
listeners.get('TabGrouped').fn({target:nativeGroup,detail:tab});
listeners.get('TabUngrouped').fn({target:nativeGroup,detail:tab});
assert.equal(calls.length,count,'native folders retain their own event handling');
console.log('PASS: synchronous membership layout, single native animation, departure visibility, native-folder isolation');
