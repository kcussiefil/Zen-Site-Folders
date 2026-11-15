/* v0.9.6: static regression for purely CSS-driven Zia header icon dimming.
   The dynamic :has() selector is intentionally the same as Zia's native folder
   asleep predicate, so no separate event listeners or state cache can drift. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
const manifest = require('../theme.json');
assert.equal(manifest.version, '0.9.6');
const begin = css.indexOf('/* Sync only Site Folders\' favicon');
const end = css.indexOf('#tabbrowser-tabs :is(tab-group, zen-folder)[data-zsf-site]:not([split-view-group]) > .tab-group-label-container > .tab-group-label', begin);
assert(begin >= 0 && end > begin, 'dedicated favicon-only compatibility block exists');
const block = css.slice(begin, end);
assert(block.includes('@media -moz-pref("zia.tabs.dim-asleep")'), 'Zia live preference gates the rule');
assert(block.includes(':root:not(#zia-none)'), 'Zia disable gate is respected');
assert(block.includes(':root[zia-light]:not(#zia-none)'), 'light Zen space is handled');
assert.equal((block.match(/:has\(\.tabbrowser-tab\[pending\]\):not\(:has\(\.tabbrowser-tab:not\(\[pending\]\)\)\)/g)||[]).length,2,
  'both themes match Zia all-pending group predicate');
assert.equal((block.match(/> \.tab-group-label-container > \.zsf-favicon/g)||[]).length,2,
  'only custom site-group icons are targeted');
assert(!/\.tab-group-label\s*\{|\.tab-group-container\s*\{|\b(?:height|margin|display|transform|animation)\s*:/.test(block),
  'never control group geometry, label, or animation');
const values = [...block.matchAll(/filter:\s*opacity\((0\.\d+)\)\s*!important/g)].map(x=>Number(x[1]));
assert.equal(values.length, 2, 'one opacity ratio per theme');
const [dark, light] = values;
assert(Math.abs(0.60 * dark - 0.55) < 1e-8, 'all-asleep dark favicon matches pending single-tab icon');
assert(Math.abs(0.80 * light - 0.75) < 1e-8, 'all-asleep light favicon matches pending single-tab icon');
function effective(pending, ziaEnabled, lightMode) {
  const allPending = pending.length > 0 && pending.every(Boolean);
  if (!ziaEnabled || !allPending) return 1;
  return (lightMode ? 0.80 : 0.60) * (lightMode ? light : dark);
}
for (const lightMode of [false, true]) {
  const expected = lightMode ? 0.75 : 0.55;
  assert(Math.abs(effective([true,true,true], true, lightMode)-expected)<1e-8);
  assert.equal(effective([true,false,true], true, lightMode),1, 'one loaded tab returns normal brightness');
  assert.equal(effective([false],true,lightMode),1, 'loaded single-member group stays bright');
  assert.equal(effective([true,true],false,lightMode),1, 'Zia toggle off cancels dimming');
  assert.equal(effective([],true,lightMode),1, 'empty group is not treated as asleep');
}
console.log('PASS: all-asleep header favicon ratios, preference gate, immediate :has() state, no geometry changes');
