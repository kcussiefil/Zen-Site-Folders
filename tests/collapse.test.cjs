// Safety checks supplement tests/browser/regressions.js, which executes Zen's
// actual custom elements, animation routines and computed layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
new vm.Script(src);
assert(!/\.animate\s*\(|\bpinTab\(|\bremoveTab\(|\bmoveTab/.test(src), 'bridge must use native motion and preserve tabs');
assert(!/isZenFolder\s*=|pinned\s*=/.test(src), 'ordinary group type and pin status must remain intact');
console.log('PASS: motion bridge safety; native layout behavior covered by browser suite');

// Mocked native bridge: a selection switch in a collapsed group must NOT
// trigger an overlapping expand/collapse pair (v0.4.1 regression).
const calls = [];
const cleaned = [];
const first = { selected: true, multiselected: false, getAttribute: () => null };
const second = { selected: false, multiselected: false, getAttribute: () => null };
const group = {
  isConnected: true, isZenFolder: false, pinned: false, collapsed: false,
  tabs: [first, second], groupContainer: { hidden: false },
  matches: () => true
};
const folderPrototype = {
  get activeGroups() { return []; },
  get childActiveGroups() { return []; },
  get activeTabs() { return this._activeTabs; },
  set activeTabs(value) { this._activeTabs = value; }
};
const win = {
  addEventListener() {},
  customElements: { get: () => ({ prototype: folderPrototype }) },
  gBrowser: { tabContainer: { _invalidateCachedVisibleTabs() {} } },
  gZenFolders: {
    animateExpand(g) { assert.equal(g, group); calls.push('expand'); return Promise.resolve(); },
    animateCollapse(g) { assert.equal(g, group); calls.push('collapse'); return Promise.resolve(); },
    styleCleanup(tabs) { cleaned.push(...tabs); }
  }
};
vm.runInNewContext(src, {
  window: win, document: { readyState: 'loading' }, console, queueMicrotask
});
const bridge = win.__zsfCollapseV037;
assert(bridge && bridge.version === '0.4.2');
bridge.sync(group);
assert.deepEqual(calls, ['expand'], 'initial expanded state uses only expansion');
group.collapsed = true;
bridge.sync(group);
assert.deepEqual(calls, ['expand', 'collapse'], 'closing once uses only collapse');
first.selected = false;
second.selected = true;
bridge.sync(group);
assert.deepEqual(calls, ['expand', 'collapse', 'collapse'], 'selection change never expands while closed');
assert.deepEqual(cleaned, [second], 'only newly selected hidden tab gets native style cleanup');
console.log('PASS: single-path audio/selection motion and native row cleanup');
