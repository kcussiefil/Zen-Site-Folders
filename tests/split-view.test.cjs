// Nested Zen split tabs are NOT ordinary direct members of a site group.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(source);
const calls = [], cleared = [];
const attrs = new Set();
const tab = (label, selected, owner) => ({
  localName: 'tab', isConnected: true, label, selected, multiselected: false,
  group: owner, hasAttribute: () => false,
  style: { getPropertyValue: () => '', setProperty: () => { throw Error('split tab style overwritten'); } },
  getAnimations: () => []
});
const split = { hasAttribute: k => k === 'split-view-group' };
const nested = tab('Split web page title', true, split);
const plain = tab('Other member', false, null);
let containsSplit = true;
const group = {
  isConnected: true, isZenFolder: false, pinned: false, collapsed: true,
  tabs: [plain], groupContainer: { hidden: true }, matches: () => true,
  querySelectorAll: s => s === 'tab-group[split-view-group]' ? (containsSplit ? [split] : [])
    : s === 'tab.tabbrowser-tab' ? [nested, plain] : [],
  removeAttribute: k => attrs.delete(k), hasAttribute: k => attrs.has(k)
};
plain.group = group;
nested.closest = s => s.startsWith('tab-group[data-zsf-site]') ? group : split;
const proto = { get activeGroups() { return []; }, get childActiveGroups() { return []; },
  get activeTabs() { return this._activeTabs; }, set activeTabs(x) { this._activeTabs = x; } };
const win = {
  customElements: { get: () => ({ prototype: proto }) },
  gBrowser: { selectedTab: nested, tabContainer: { _invalidateCachedVisibleTabs() { calls.push('invalidate'); } } },
  gZenFolders: { animateExpand() { calls.push('expand'); }, animateCollapse() { calls.push('collapse'); },
    styleCleanup(rows) { cleared.push(...rows); } },
  addEventListener() {}
};
vm.runInNewContext(source, {window: win, document: {readyState:'loading'}, console, queueMicrotask});
const api = win.__zsfCollapseV037;
api.sync(group);
assert.equal(group.groupContainer.hidden, false, 'selected nested split remains visible even when absent from group.tabs');
assert(!calls.includes('collapse') && !calls.includes('expand'), 'nested split bypasses incompatible ordinary-folder animation');
assert.equal(nested.label, 'Split web page title', 'native split tab title remains unchanged');
group.collapsed = false; api.sync(group);
assert.equal(group.groupContainer.hidden, false, 'expanded site folder shows its split and ordinary children');
nested.selected = false; win.gBrowser.selectedTab = null; group.collapsed = true; api.sync(group);
assert.equal(group.groupContainer.hidden, true, 'closed group with no selected descendant stays hidden');
nested.selected = true; win.gBrowser.selectedTab = nested; api.sync(group);
assert.equal(group.groupContainer.hidden, false, 'selected split pane unhides the closed host');
assert.equal(cleared.length, 0, 'healthy split members are never restyled');
containsSplit = false; group.collapsed = false; api.sync(group);
assert(calls.includes('expand'), 'ordinary native folder motion resumes after removing split');
assert(/#tabbrowser-tabs tab-group\[split-view-group\]\s*\{\s*--zia-active-tab-bg:\s*var\(--zsf-selected-tab-fill/.test(css),
  'split wrapper receives the same selected-tab color variable');
assert(/group\.querySelector\?\.\('tab-group\[split-view-group\]'\)/.test(
  fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8')),
  'single-member dissolution must guard nested split groups');
console.log('PASS: nested split preservation, title, selected-visibility and active color CSS; normal group resume');
