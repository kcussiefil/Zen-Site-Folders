/* v0.9.7: apply the same per-icon filter as native Zia asleep tabs.
   No parent-composite opacity ratio or geometry modification is allowed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
const manifest = require('../theme.json');
assert.equal(manifest.version, '1.0.7');
const begin = css.indexOf('/* v0.9.7: Zia filters BOTH nested');
const end = css.indexOf('#tabbrowser-tabs :is(tab-group, zen-folder):is([data-zsf-site], [data-zsf-manual]):not([split-view-group]) > .tab-group-label-container > .tab-group-label', begin);
assert(begin >= 0 && end > begin, 'dedicated site-group favicon paint rules exist');
const block = css.slice(begin, end);
assert(block.includes('@media -moz-pref("zia.tabs.dim-asleep")'), 'follow live Zia preference');
assert(block.includes(':root:not(#zia-none)'), 'respect Zia disabled state');
assert(block.includes(':root[zia-light]:not(#zia-none)'), 'respect Zia light space');
assert.equal((block.match(/:has\(\.tabbrowser-tab\[pending\]\):not\(:has\(\.tabbrowser-tab:not\(\[pending\]\)\)\)/g)||[]).length,5,
  'the same all-pending predicate must guard each native-style filter');
assert(block.includes('> .tab-group-label-container {\n    filter: none !important;'),
  'avoid double-dimming of the whole group header');
const values = [...block.matchAll(/filter: opacity\((0\.\d+)\) !important/g)].map(m=>Number(m[1]));
assert.deepEqual(values,[0.3025,0.6,0.5625,0.8],
  'native double-layer icon filters and native group title strengths');
assert.equal((block.match(/> \.tab-group-label-container > \.zsf-favicon \{/g)||[]).length,2,
  'only site-group favicon receives icon fade');
assert(!block.includes('0.9166666667') && !block.includes('0.9375'),
  'v0.9.6 ratio compensation must not return');
assert(!/\b(?:height|display|margin|padding|transform|animation|scroll)\s*:/.test(block),
  'no group geometry, background scroll or animation changes');
function brightness(pending, ziaOn, light) {
  return ziaOn && pending.length > 0 && pending.every(Boolean) ?
    (light ? 0.75 * 0.75 : 0.55 * 0.55) : 1;
}
for (const light of [false,true]) {
  assert(Math.abs(brightness([true,true],true,light) -
    (light ? 0.5625 : 0.3025)) < 1e-10, 'stack and image filters compound');
  assert.equal(brightness([true,false,true],true,light),1);
  assert.equal(brightness([true,true],false,light),1);
  assert.equal(brightness([],true,light),1);
}
console.log('PASS: compounded Zia icon-stack + favicon dimming for site groups in light/dark modes');
