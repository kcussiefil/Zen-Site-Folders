const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-background-drag.uc.js'), 'utf8');
new vm.Script(src);
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'theme.json'), 'utf8'));
const prefs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'preferences.json'), 'utf8'));
assert.equal(manifest.preferences, 'preferences.json');
assert.deepEqual(prefs.map(p => p.property), ['zen.sitefolders.background_drag.enabled']);
assert(!src.includes('preventDefault(') && !src.includes('stopPropagation('),
  'Do not intercept native/Zia drag or click events');
assert(!/moveTab(?:To|Before|After)|addTabToGroup|ungroupTab/.test(src),
  'Background drag must not change placement or group ownership');

function make(options = {}) {
  const events = new Map(), timers = new Map();
  let nextTimer = 0, current, selectedItem, enabled = options.enabled !== false;
  const selections = [];
  const tab = (name, extra = {}) => ({
    localName: 'tab', name, isConnected: true, multiselected: false,
    hasAttribute(name) { return name === 'pending' && !!this.pending ||
      name === 'discarded' && !!this.discarded; },
    contains(node) { return node === this; },
    closest(selector) {
      if (selector.startsWith('tab, ')) return this;
      if (selector.startsWith('tab-group[') && extra.split) return {};
      return null;
    }
  });
  const original = tab('original'), background = tab('background', options);
  const other = tab('other');
  for (const t of [original, background, other]) {
    t.linkedBrowser = {owner:t.name}; t.linkedPanel = 'tab-panel';
  }
  const tabs = [original, background, other];
  current = original;
  selectedItem = original;
  const strip = {
    contains: node => tabs.includes(node),
    tabDragAndDrop: { startTabDrag(event, source) {
      strip.selectedItem = source;
      const thumbnail = window.PageThumbs.captureToCanvas(source.linkedBrowser);
      return { selected: browser.selectedTab, elements: browser.selectedElements,
        selectedTabs: browser.selectedTabs, thumbnail };
    }}
  };
  Object.defineProperty(strip, 'selectedItem', {
    configurable: true, get: () => selectedItem, set: tab => { selectedItem = tab; browser.selectedTab = tab; }
  });
  const browser = {
    tabContainer: strip, isTab: node => tabs.includes(node),
    get selectedTab() { return current; },
    set selectedTab(tab) {
      if (tab === current) return;
      selections.push(tab.name);
      current = tab;
      tab.pending = false;
    },
    get selectedElements() { return [current]; },
    get selectedTabs() { return [current]; },
    getTabForBrowser(sourceBrowser) {
      return tabs.find(tab => tab.linkedBrowser === sourceBrowser);
    },
    setSelectedTab(tab) { this.selectedTab = tab; }
  };
  const thumbCaptures = [];
  const PageThumbs = { captureToCanvas(sourceBrowser) {
    thumbCaptures.push(sourceBrowser); return Promise.resolve('capture');
  }};
  const window = {
    PageThumbs,
    gBrowser: browser,
    addEventListener(type, handler) {
      if (!events.has(type)) events.set(type, []);
      events.get(type).push(handler);
    },
    removeEventListener(type, handler) {
      events.set(type, (events.get(type) || []).filter(h => h !== handler));
    },
    setTimeout(fn) { const id = ++nextTimer; timers.set(id, fn); return id; },
    clearTimeout(id) { timers.delete(id); }
  };
  const Services = { prefs: { getBoolPref: () => enabled } };
  vm.runInNewContext(src, {window, Services, console}, {filename: 'site-folders-background-drag.uc.js'});
  function fire(type, target = background, extra = {}) {
    const event = {type, target, button: 0, buttons: 1, clientX: 0, clientY: 0, ...extra};
    (events.get(type) || []).slice().forEach(h => h(event));
  }
  function flush() {
    for (const [id, fn] of [...timers.entries()]) { timers.delete(id); fn(); }
  }
  function finish(type, source, target = original) {
    fire(type, target, {dataTransfer: {mozGetDataAt: () => source}});
  }
  return {browser, strip, window, thumbCaptures, original, background, other, selections, fire, finish, flush,
    enable: value => {enabled = value;}};
}
{
  const t = make();
  t.fire('mousedown'); t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original, 'mousedown must not wake background tab');
  t.fire('mouseup');
  assert.equal(t.browser.selectedTab, t.original, 'release alone must not activate the tab');
  t.fire('click');
  assert.equal(t.browser.selectedTab, t.background, 'ordinary click selects tab normally');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.background.pending = true;
  t.fire('mousedown');
  t.browser.selectedTab = t.background;
  t.browser.setSelectedTab(t.background);
  t.strip.selectedItem = t.background;
  assert.equal(t.browser.selectedTab, t.original);
  const payload = t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  assert.equal(t.thumbCaptures.length, 0, 'do not capture a pending tab during native drag');
  assert.equal(payload.selected, t.original);
  assert.equal(payload.elements[0], t.background, 'native drag must carry source tab');
  t.fire('mousemove', t.background, {clientY: 20});
  t.fire('mouseup');
  t.finish('drop', t.background);
  assert.equal(t.browser.selectedTab, t.original, 'native/Zia drop cannot wake source');
  assert.equal(t.background.pending, true);
  t.flush();
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'native setter restored after release');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.background.pending = t.other.pending = true;
  t.fire('mousedown', t.background);
  t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  t.finish('drop', t.background);

  t.fire('mousedown', t.other);
  // The first tab's landing callback can run after the next press has armed.
  t.browser.selectedTab = t.background;
  t.strip.selectedItem = t.other;
  const payload = t.strip.tabDragAndDrop.startTabDrag({}, t.other);
  t.finish('dragend', t.background);
  t.flush(); // Expiring the first landing must leave the second drag armed.
  t.strip.selectedItem = t.other;
  assert.equal(payload.elements[0], t.other);
  assert.deepEqual(t.selections, [], 'neither native selection attempt may wake a tab');
  assert.equal(t.background.pending, true);
  assert.equal(t.other.pending, true);

  t.finish('drop', t.other);
  t.finish('dragend', t.other);
  t.fire('mousedown', t.other);
  t.fire('mouseup', t.other);
  t.fire('click', t.other);
  assert.deepEqual(t.selections, ['other'], 'a new click can activate the just-dropped tab');
  assert.equal(t.other.pending, false);
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.fire('mousedown');
  t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  t.finish('drop', t.background, {}); // Content-area drop belongs to Split View.
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'a page drop can select its new split pane');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.background.pending = true;
  t.fire('mousedown');
  // Browser/drag service can emit a zero-buttons mousemove while still
  // physically holding the left button. Never allow it to wake the tab.
  t.fire('mousemove', t.background, {buttons: 0, clientY: 2});
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original,
    'zero-buttons intermediate mousemove must not disarm selection protection');
  t.fire('mousemove', t.background, {buttons: 1, clientY: 20});
  t.fire('deactivate');
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original,
    'transient deactivation during a held drag must not awaken the tab');
  t.finish('dragend', t.background);
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original,
    'premature dragend before physical mouseup must remain protected');
  t.fire('mouseup', t.background, {buttons: 0});
  t.flush();
  assert.equal(t.background.pending, true);
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.fire('mousedown');
  t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  assert.equal(t.thumbCaptures.length, 1, 'loaded backgrounds retain native drag preview');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make({split: true});
  t.fire('mousedown'); t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'split view keeps native handling');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make({enabled: false});
  t.fire('mousedown'); t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'off switch restores native click');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.fire('mousedown', t.background, {metaKey: true});
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'modified clicks unchanged');
  t.window.__zsfBackgroundDragV090.destroy();
}
{
  const t = make();
  t.fire('mousedown');
  t.window.__zsfBackgroundDragV090.destroy();
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.background, 'all native descriptors restored');
}
// Regression: an overlay can retarget the event outside the native strip,
// while the composed path still contains the real background tab. v0.9.1
// returned before resolving this path and activated the unloaded tab.
{
  const t = make();
  t.background.pending = true;
  const overlay = {closest() {return null;}, matches() {return false;}};
  t.fire('mousedown', overlay, {
    composedPath: () => [overlay, t.background, t.strip]
  });
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original,
    'retargeted mousedown must guard the native tab before selection');
  const payload = t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  assert.equal(payload.elements[0], t.background,
    'retargeted press must still drag the correct background tab');
  t.fire('mouseup', t.background);
  t.finish('drop', t.background);
  assert.equal(t.background.pending, true);
  t.window.__zsfBackgroundDragV090.destroy();
}
// Regression: a trusted pointerdown can locate the real tab before XUL
// retargets mousedown to another surface. A second press event must NOT
// clear the gesture and wake the discarded background tab.
{
  const t = make();
  t.background.pending = true;
  const overlay = {closest() {return null;}, matches() {return false;}};
  t.fire('pointerdown', t.background);
  t.fire('mousedown', overlay);
  t.browser.selectedTab = t.background;
  assert.equal(t.browser.selectedTab, t.original,
    'retargeted mousedown must not clear pointerdown protection');
  t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  t.fire('mouseup', t.background);
  t.finish('drop', t.background);
  assert.equal(t.background.pending, true);
  t.window.__zsfBackgroundDragV090.destroy();
}
// Regression: native startTabDrag can arrive without a captured mousedown.
// Recover the real drag source instead of passing through Zen's selecting path.
{
  const t = make();
  t.background.pending = true;
  const payload = t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  assert.equal(payload.elements[0], t.background);
  assert.equal(t.browser.selectedTab, t.original);
  assert.equal(t.background.pending, true);
  t.finish('dragend', t.background);
  t.window.__zsfBackgroundDragV090.destroy();
}
// Regression: after the first drag, a different MOD may replace the accessor.
// The second physical mousedown must reinstall a guard before native selection.
{
  const t = make();
  t.background.pending = t.other.pending = true;
  t.fire('mousedown', t.background);
  t.strip.tabDragAndDrop.startTabDrag({}, t.background);
  t.fire('mouseup', t.background);
  t.finish('drop', t.background);
  t.flush();
  const descriptor = Object.getOwnPropertyDescriptor(t.browser, 'selectedTab');
  Object.defineProperty(t.browser, 'selectedTab', {
    configurable: true,
    get() {return descriptor.get.call(this);},
    set(tab) {return descriptor.set.call(this, tab);}
  });
  t.fire('mousedown', t.other);
  t.browser.selectedTab = t.other;
  assert.equal(t.browser.selectedTab, t.original,
    'second press must repair overwritten native selection guard');
  assert.equal(t.other.pending, true);
  t.strip.tabDragAndDrop.startTabDrag({}, t.other);
  t.fire('mouseup', t.other);
  t.finish('drop', t.other);
  t.window.__zsfBackgroundDragV090.destroy();
}
// Ten distinct consecutive drags, including a retargeted overlay on every
// alternate pass. None may select or wake the source; clicks remain separate.
{
  const t = make();
  t.background.pending = t.other.pending = true;
  const overlay = {closest() {return null;}, matches() {return false;}};
  for (let i=0; i<10; i++) {
    const source = i % 2 ? t.other : t.background;
    if (i % 2) {
      t.fire('mousedown', overlay, {
        composedPath: () => [overlay, source, t.strip]
      });
    } else {
      t.fire('mousedown', source);
    }
    t.browser.selectedTab = source;
    t.strip.tabDragAndDrop.startTabDrag({}, source);
    t.fire('mousemove', source, {clientY: 20, buttons: 1});
    assert.equal(t.browser.selectedTab, t.original);
    t.fire('mouseup', source);
    t.finish('drop', source);
    t.flush();
  }
  assert.deepEqual(t.selections, [], 'ten consecutive drags must never select');
  assert.equal(t.background.pending, true);
  assert.equal(t.other.pending, true);
  t.window.__zsfBackgroundDragV090.destroy();
}

console.log('PASS: background tab drag, click selection, pending preservation, native payload, split, pref, modifiers, retargeted hit paths, repeated drags, rehook, teardown');