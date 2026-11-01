const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);
assert(css.includes('[data-zsf-collapse-settled]'), 'settled group CSS missing');
assert(css.includes(':has(> .tab-group-container > tab[selected])'), 'active tab must remain visible');
assert(css.includes('> .tab-group-container > tab:not([selected])'), 'non-selected tabs hidden after settling');
assert(!/\.tab-group-container:not\(\[hidden\]\)\s*\{\s*display:\s*flex\s*!important/.test(css),
  'unconditional forced display:flex breaks Zen native collapse');
assert(!/moveTabBefore|moveTabToExistingGroup|pinTab\(|unpinTab\(|removeTab\(/.test(src),
  'collapse controller must never move, pin or close tabs');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
class Group {
  constructor(collapsed = false) {
    this.isConnected = true;
    this.nodeType = 1;
    this.isZenFolder = false;
    this.pinned = false;
    this.attrs = new Map(collapsed ? [['collapsed', 'true']] : []);
  }
  matches(s) { return s === 'tab-group[data-zsf-site]:not([split-view-group])'; }
  hasAttribute(key) { return this.attrs.has(key); }
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); }
  querySelectorAll() { return []; }
}
async function main() {
  const existing = new Group(true);
  const dynamic = new Group(false);
  const unrelated = new Group(false);
  unrelated.matches = () => false;
  const events = {};
  let observer;
  const groupsInTabContainer = [existing];
  const window = {
    gBrowser: { tabContainer: { querySelectorAll: () => groupsInTabContainer } },
    addEventListener(name, fn) { events[name] = fn; },
    removeEventListener(name) { delete events[name]; },
    matchMedia() { return { matches: false }; },
  };
  const document = { readyState: 'complete' };
  class MutationObserver {
    constructor(fn) { this.fn = fn; observer = this; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  vm.runInNewContext(src, { window, document, MutationObserver, console,
    setTimeout, clearTimeout });
  const api = window.__zsfCollapseV032;
  assert.equal(api.version, '0.3.2');
  assert(existing.hasAttribute('data-zsf-collapse-settled'),
    'restored collapsed groups must settle immediately');
  assert(!dynamic.hasAttribute('data-zsf-collapse-settled'));
  // Simulate real DOM insertion: a dynamic group stays reachable through
  // gBrowser.tabContainer.querySelectorAll during unload cleanup.
  groupsInTabContainer.push(dynamic);
  observer.fn([{ type: 'childList', addedNodes: [dynamic] }]);

  dynamic.setAttribute('collapsed', 'true');
  events.TabGroupCollapse({ target: dynamic });
  assert(!dynamic.hasAttribute('data-zsf-collapse-settled'),
    'do not hide children while native Zia spring is running');
  await delay(500);
  assert(dynamic.hasAttribute('data-zsf-collapse-settled'),
    'group must reliably hide non-active tabs after the 420ms spring');

  dynamic.removeAttribute('collapsed');
  events.TabGroupExpand({ target: dynamic });
  assert(!dynamic.hasAttribute('data-zsf-collapse-settled'),
    'expanding must restore children without waiting');
  dynamic.setAttribute('collapsed', 'true');
  events.TabGroupCollapse({ target: dynamic });
  await delay(30);
  dynamic.removeAttribute('collapsed');
  events.TabGroupExpand({ target: dynamic });
  await delay(500);
  assert(!dynamic.hasAttribute('data-zsf-collapse-settled'),
    'rapid collapse then expand must cancel stale hide timers');

  observer.fn([{ type: 'childList', addedNodes: [unrelated] }]);
  assert(!unrelated.hasAttribute('data-zsf-collapse-settled'),
    'unrelated user/Zia groups must be ignored');

  dynamic.setAttribute('collapsed', 'true');
  observer.fn([{ type: 'attributes', target: dynamic, attributeName: 'collapsed' }]);
  await delay(500);
  assert(dynamic.hasAttribute('data-zsf-collapse-settled'),
    'attribute-driven collapse must work even without native event');

  api.destroy();
  assert(observer.disconnected, 'observer cleanup');
  assert(!existing.hasAttribute('data-zsf-collapse-settled'), 'cleanup existing');
  assert(!dynamic.hasAttribute('data-zsf-collapse-settled'), 'cleanup dynamic');
  assert(!events.TabGroupCollapse && !events.TabGroupExpand, 'listener cleanup');
  console.log('PASS: initial state, Zia spring delay, reliable collapse, rapid toggle, own-group scope, mutation fallback, cleanup');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
