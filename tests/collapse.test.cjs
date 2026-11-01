const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
new vm.Script(src);

assert(!src.includes('SETTLE_MS') && !src.includes('setTimeout('),
  'no fixed 470ms wait before instantly hiding content');
assert(src.includes('box.animate(frames'), 'actual container height must animate');
assert(src.includes('nativeGeometryAnimations'), 'native Zia animation must take priority');
assert(css.includes('[data-zsf-animating]'), 'layout stays visible while an animation runs');
assert(css.includes('[data-zsf-collapse-settled]'), 'final closed state must be protected');
assert(!/> \.tab-group-container > tab\[selected\] > \.tab-stack > \.tab-background\s*\{/.test(css),
  'own CSS must NOT replace Zia native selected background, glow and shine in collapsed state');
assert(!/min-height: var\(--zia-tab-height, 34px\) !important;\s*pointer-events: auto !important;/.test(css),
  'selected row must keep its natural height across expanded and collapsed states');
assert(!/moveTabBefore|moveTabToExistingGroup|pinTab\(|unpinTab\(|removeTab\(/.test(src),
  'collapse must never change any live tab');

const rafQueue = [];
const frames = async () => {
  const queue = rafQueue.splice(0);
  for (const fn of queue) fn();
  await Promise.resolve();
};
const tick = async () => {
  // Promise.allSettled(native.finished) crosses several microtask turns
  // before its cleanup callback enqueues requestAnimationFrame.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  await frames();
  for (let i = 0; i < 3; i++) await Promise.resolve();
};

class FakeAnimation {
  constructor(box, keyframes, native = false) {
    this.box = box;
    this.keyframes = keyframes;
    this.native = native;
    this.playState = 'running';
    this.effect = { getKeyframes: () => keyframes };
    this.finished = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  finish() {
    this.playState = 'finished';
    if (!this.native) {
      const last = this.keyframes.at(-1);
      if (Number.isFinite(parseFloat(last.height))) this.box.height = parseFloat(last.height);
    }
    this.resolve();
  }
  cancel() {
    if (this.playState !== 'running') return;
    this.playState = 'idle';
    this.reject(new Error('cancelled'));
  }
}
class Group {
  constructor(collapsed = false, height = 300) {
    this.nodeType = 1;
    this.isConnected = true;
    this.isZenFolder = false;
    this.pinned = false;
    this.attrs = new Map(collapsed ? [['collapsed', 'true']] : []);
    this.box = {
      height,
      scrollHeight: 300,
      animations: [],
      created: [],
      getBoundingClientRect() { return { height: this.height }; },
      getAnimations() { return this.animations; },
      querySelector: () => null,
      animate(keyframes, options) {
        const animation = new FakeAnimation(this, keyframes);
        this.created.push({ animation, keyframes, options });
        return animation;
      },
    };
    this.groupContainer = this.box;
    this.groupStartElement = null;
    this.tabs = [];
  }
  matches(selector) { return selector === 'tab-group[data-zsf-site]:not([split-view-group])'; }
  hasAttribute(key) { return this.attrs.has(key); }
  setAttribute(key, value) { this.attrs.set(key, String(value)); }
  removeAttribute(key) { this.attrs.delete(key); }
  querySelectorAll() { return []; }
}
async function main() {
  const existing = new Group(true, 0);
  const group = new Group(false, 300);
  const other = new Group(false);
  other.matches = () => false;
  const groups = [existing, group, other];
  const listeners = {};
  let observer = null;
  let reducedMotion = false;
  let selectedWithSpacing = null;
  const window = {
    gBrowser: { tabContainer: { querySelectorAll: () => groups } },
    matchMedia: () => ({ matches: reducedMotion }),
    getComputedStyle: node => {
      if (selectedWithSpacing && node === selectedWithSpacing)
        return { marginTop: '4px', marginBottom: '3px' };
      if (selectedWithSpacing && node === group.box)
        return { paddingTop: '2px', paddingBottom: '3px' };
      return { paddingTop: '0px', paddingBottom: '0px',
        marginTop: '0px', marginBottom: '0px' };
    },
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener(type) { delete listeners[type]; },
  };
  const document = { readyState: 'complete' };
  class MutationObserver {
    constructor(fn) { observer = this; this.fn = fn; }
    observe() {}
    disconnect() { this.disconnected = true; }
  }
  vm.runInNewContext(src, {
    window, document, MutationObserver, console,
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
    setTimeout() { throw new Error('fixed timer must not be used'); },
    clearTimeout() {},
  });
  const api = window.__zsfCollapseV034;
  assert.equal(api.version, '0.3.4');
  assert(existing.hasAttribute('data-zsf-collapse-settled'),
    'restored collapsed group must be settled immediately');

  // Explicit click: measure BEFORE native Zen toggles, animate measured
  // height continuously. No timed content snap after 470ms.
  api.prepare(group);
  assert(group.hasAttribute('data-zsf-animating'));
  group.setAttribute('collapsed', 'true');
  listeners.TabGroupCollapse({ target: group, type: 'TabGroupCollapse' });
  await frames();
  assert.equal(group.box.created.length, 1, 'fallback must be a real WAAPI animation');
  let call = group.box.created.at(-1);
  assert.equal(call.keyframes[0].height, '300px');
  assert.equal(call.keyframes.at(-1).height, '0px');
  assert.equal(call.options.duration, 420);
  assert(!group.hasAttribute('data-zsf-collapse-settled'),
    'no early snap while its height is in motion');
  call.animation.finish();
  await tick();
  assert(group.hasAttribute('data-zsf-collapse-settled'),
    'hide nonselected tabs only after actual animation.finished');
  assert(!group.hasAttribute('data-zsf-animating'));

  // Expand from 0px to actual scrollHeight; no fixed delay.
  api.prepare(group);
  group.removeAttribute('collapsed');
  listeners.TabGroupExpand({ target: group, type: 'TabGroupExpand' });
  await frames();
  call = group.box.created.at(-1);
  assert.equal(call.keyframes[0].height, '0px');
  assert.equal(call.keyframes.at(-1).height, '300px');
  call.animation.finish();
  await tick();
  assert(!group.hasAttribute('data-zsf-collapse-settled'));
  assert(!group.hasAttribute('data-zsf-animating'));

  // Rapid reversal begins from currently visible animated height.
  group.box.height = 300;
  api.prepare(group);
  group.setAttribute('collapsed', 'true');
  listeners.TabGroupCollapse({ target: group, type: 'TabGroupCollapse' });
  await frames();
  const interrupted = group.box.created.at(-1);
  group.box.height = 110;
  api.prepare(group); // cancels only our old animation, never a native one
  group.removeAttribute('collapsed');
  listeners.TabGroupExpand({ target: group, type: 'TabGroupExpand' });
  await frames();
  const reversing = group.box.created.at(-1);
  assert.equal(interrupted.animation.playState, 'idle');
  assert.equal(reversing.keyframes[0].height, '110px');
  assert.equal(reversing.keyframes.at(-1).height, '300px');
  reversing.animation.finish();
  await tick();
  assert(!group.hasAttribute('data-zsf-collapse-settled'),
    'obsolete collapse promise must never hide the newly expanded group');

  // Collapsed group containing the actual selected tab ends at its real
  // height, while nonselected siblings are hidden only at completion.
  const selected = {
    isConnected: true, group, selected: true, hasAttribute: name => name === 'selected',
    getBoundingClientRect: () => ({ height: 34 }),
  };
  group.tabs = [selected, { isConnected: true, group, selected: false, hasAttribute: () => false }];
  selectedWithSpacing = selected;
  group.box.height = 300;
  api.prepare(group);
  group.setAttribute('collapsed', 'true');
  listeners.TabGroupCollapse({ target: group, type: 'TabGroupCollapse' });
  await frames();
  call = group.box.created.at(-1);
  assert.equal(call.keyframes.at(-1).height, '46px',
    'collapse target must include selected tab height, margins and container padding');
  call.animation.finish();
  await tick();
  assert(group.hasAttribute('data-zsf-collapse-settled'));
  assert(selected.isConnected && selected.group === group);
  selectedWithSpacing = null;

  // Native Zia geometry animation exists: do NOT start a second spring.
  group.tabs = [];
  group.removeAttribute('collapsed');
  group.box.height = 300;
  const native = new FakeAnimation(group.box, [{ height: '300px' }, { height: '0px' }], true);
  group.box.animations = [native];
  const count = group.box.created.length;
  api.prepare(group);
  group.setAttribute('collapsed', 'true');
  listeners.TabGroupCollapse({ target: group, type: 'TabGroupCollapse' });
  await frames();
  assert.equal(group.box.created.length, count, 'native Zia spring owns the transition');
  assert(!group.hasAttribute('data-zsf-collapse-settled'));
  native.finish();
  await tick();
  assert(group.hasAttribute('data-zsf-collapse-settled'));
  group.box.animations = [];

  // Reduced motion snaps immediately without waiting, in an accessible way.
  reducedMotion = true;
  api.prepare(group);
  group.removeAttribute('collapsed');
  listeners.TabGroupExpand({ target: group, type: 'TabGroupExpand' });
  await frames();
  assert(!group.hasAttribute('data-zsf-animating'));
  assert(!group.hasAttribute('data-zsf-collapse-settled'));

  assert.equal(api.nativeGeometryAnimations(other, other.box).length, 0);
  assert(!other.hasAttribute('data-zsf-animating'));
  api.destroy();
  assert(observer.disconnected, 'cleanup observer');
  assert(!listeners.TabGroupCollapse && !listeners.TabGroupExpand, 'remove handlers');
  assert(!existing.hasAttribute('data-zsf-collapse-settled'), 'cleanup initial groups');
  assert(!group.hasAttribute('data-zsf-collapse-settled'), 'cleanup active group');
  console.log('PASS: WAAPI height spring, selected tab, real animation completion, native Zia preference, reverse, reduced motion, cleanup');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
