const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const script = fs.readFileSync(path.join(__dirname, '..', 'site-folders.uc.js'), 'utf8');
new vm.Script(script);
assert(script.includes('function ungroupInDisplayOrder('));
assert(script.includes('function rescueGroupInventory('));
assert(script.includes('if (inventory.ordinary.length)'),
  'unknown groups must block snapshot reset');
assert(!script.includes('reason: \'orphaned-created-groups\''),
  'never reset using only stale snapshot createdFolders IDs');

const injection = '  if (document.readyState === \'complete\') initialize();';
assert(script.includes(injection), 'test insertion anchor');
const source = script.replace(injection,
  '  window.__testZSF = { ungroupInDisplayOrder, rescueGroupInventory, rescueSiteGroups, readSnapshots };\n' + injection);

function harness({ owned = true, withFollowing = true, selected = false } = {}) {
  const notices = [];
  const slots = {};
  const snapshot = {
    version: 4, workspaceId: 'space1', capturedAt: 50,
    createdFolders: ['zsf-original-id'], // Zen restored with a different ID
    tabs: [{ id: 'tab-original-1', group: null, pinned: false }],
    elements: [{ type: 'tab', id: 'tab-original-1' }]
  };
  slots['zsf-before-sort-v1'] = JSON.stringify({ space1: snapshot });
  slots['zsf-owned-group-sites-v1'] = '{}';
  const session = {
    getCustomWindowValue: (_w, key) => slots[key] || '',
    setCustomWindowValue: (_w, key, value) => { slots[key] = value; },
    getCustomTabValue: () => '',
    setCustomTabValue() {},
  };
  const root = {
    querySelectorAll(selector) {
      if (selector === 'zen-workspace') return [];
      return [];
    }, getElementById: () => null,
  };
  const group = {
    localName: 'tab-group', id: 'restored-new-id', label: 'YouTube',
    isConnected: true, pinned: false, isZenFolder: false, tabs: [],
    attrs: new Map(owned ? [['data-zsf-site', 'youtube.com']] : []),
    getAttribute(key) { return this.attrs.get(key) ?? null; },
    hasAttribute(key) { return this.attrs.has(key); },
    setAttribute(key, value) { this.attrs.set(key, String(value)); },
    querySelectorAll(selector) {
      if (selector.includes('tab')) return this.tabs.filter(tab => tab.group === this);
      return [];
    },
  };
  const outside = tag => ({
    localName: tag, isConnected: true, pinned: false,
    hasAttribute: () => false, closest: () => null,
    getAttribute: () => 'space1',
  });
  const prefix = outside('tab');
  const suffix = outside('tab');
  const labels = ['New first', 'Middle', 'Old last'];
  const memberTabs = labels.map(label => ({
    localName: 'tab', label, group, isConnected: true,
    pinned: false, selected: selected && label === labels[0],
    hasAttribute: () => false,
    closest: () => null, getAttribute: () => 'space1',
  }));
  group.tabs = memberTabs.slice();
  const strip = [prefix, group, ...(withFollowing ? [suffix] : [])];
  const container = {
    get children() { return strip; },
    querySelectorAll(selector) {
      if (selector === 'tab')
        return strip.flatMap(el => el.localName === 'tab-group' ?
          el.tabs.filter(tab => tab.group === el) : el.localName === 'tab' ? [el] : []);
      if (selector.includes('tab-group')) return strip.filter(el => el.localName === 'tab-group');
      return [];
    },
  };
  group.parentElement = container;
  for (const item of strip) item.parentElement = container;
  const workspace = { tabsContainer: container };
  const moves = [];
  const browser = {
    get tabs() { return container.querySelectorAll('tab'); },
    tabContainer: container,
    ungroupTab(tab) {
      assert.equal(tab.group, group, 'ungroup only original member tabs');
      const index = group.tabs.indexOf(tab);
      assert(index >= 0);
      group.tabs.splice(index, 1);
      tab.group = null;
      tab.parentElement = container;
      // Simulate the observed Firefox behaviour: every ungroupTab is inserted
      // immediately after the group, which reverses A,B,C into C,B,A.
      strip.splice(strip.indexOf(group) + 1, 0, tab);
      if (!group.tabs.length) {
        strip.splice(strip.indexOf(group), 1);
        group.isConnected = false;
      }
    },
    moveTabBefore(tab, target) {
      assert(tab.isConnected && target.isConnected);
      strip.splice(strip.indexOf(tab), 1);
      strip.splice(strip.indexOf(target), 0, tab);
      moves.push({ tab, target });
    },
    moveTabAfter(tab, target) {
      strip.splice(strip.indexOf(tab), 1);
      strip.splice(strip.indexOf(target) + 1, 0, tab);
      moves.push({ tab, target });
    },
    removeTabGroup(g) { assert(!g.tabs.length, 'never close group with tabs'); },
  };
  const window = {
    SessionStore: session,
    gBrowser: browser,
    gZenWorkspaces: { activeWorkspace: 'space1', activeWorkspaceElement: workspace },
    alert(message) { notices.push(message); },
    addEventListener() {}, removeEventListener() {},
  };
  const Services = { prompt: { confirm() { return true; } } };
  vm.runInNewContext(source, {
    window, document: { readyState: 'loading', ...root },
    Services, ChromeUtils: { importESModule: () => ({ SessionStore: session }) },
    console, URL, setTimeout: () => 0, clearTimeout() {},
  });
  assert(window.__testZSF, 'test API must load');
  return { ...window.__testZSF, group, memberTabs, strip, browser, snapshot,
    slots, moves, notices, container, suffix, prefix };
}

async function main() {
  {
    const h = harness();
    const result = h.ungroupInDisplayOrder(h.group, h.memberTabs);
    assert.equal(result.moved, 3);
    assert.equal(result.errors, 0);
    assert.equal(result.ordered, true);
    assert.deepEqual(h.strip.slice(1, 4), h.memberTabs,
      'manual ungroup must keep original top-to-bottom order, not reverse');
    assert(h.memberTabs.every(t => t.isConnected && !t.pinned && t.group == null));
    assert(h.moves.length > 0, 'actual order recovery uses native moveTabBefore API');
  }
  {
    const h = harness({ withFollowing: false });
    const result = h.ungroupInDisplayOrder(h.group, h.memberTabs);
    assert.equal(result.errors, 0, 'last group with no next anchor must also preserve order');
    assert.deepEqual(h.strip.slice(1, 4), h.memberTabs);
  }
  {
    const h = harness();
    const inv = h.rescueGroupInventory(
      { id: 'space1', node: { tabsContainer: h.container } },
      h.snapshot);
    assert.equal(inv.owned.length, 1,
      'a restored owned site group with a new ID is still trusted by private site marker');
    await h.rescueSiteGroups();
    assert.deepEqual(h.strip.slice(1, 4), h.memberTabs,
      'safe rescue must retain the same visual order as the folder');
    assert(!h.group.isConnected, 'successfully rescued site group must be gone');
    const stored = JSON.parse(h.slots['zsf-before-sort-v1']);
    assert(stored.space1, 'recovery arrow and snapshot must still exist after ungroup');
    assert(stored.space1.rescueCompleted === true,
      'snapshot must mark rescue completed without being deleted');
    await h.rescueSiteGroups();
    assert(!JSON.parse(h.slots['zsf-before-sort-v1']).space1,
      'only a second confirmed action after no groups remain may clear the snapshot');
    const backup = JSON.parse(h.slots['zsf-archived-snapshots-v1']);
    assert.equal(backup.space1.length, 1, 'archive must be durably saved before reset');
  }
  {
    const h = harness({ owned: false });
    await h.rescueSiteGroups();
    assert(h.group.isConnected, 'unknown native group must not be touched');
    assert(JSON.parse(h.slots['zsf-before-sort-v1']).space1,
      'unknown group must block reset and preserve the only recovery entry');
  }
  console.log('PASS: native ungroup preserves A-B-C, rescue stale group ID, two-stage safe reset, generic-group fail-close');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
