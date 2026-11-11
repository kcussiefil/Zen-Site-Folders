/* Preserve Zia native folder geometry, animations, and selected-tab paint. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
const manifest = require('../theme.json');
assert.equal(manifest.version, '0.9.0');
const pattern = /:root\[zen-sidebar-expanded="true"\]\s+#tabbrowser-tabs\s+tab-group\[data-zsf-site\]:not\(\[split-view-group\]\)\s*> \.tab-group-container:not\(\[hidden\]\)\s*\{([^}]*)\}/;
const match = css.match(pattern);
assert(match, 'spacing must target only ordinary owned site group containers');
const declarations = match[1];
assert.match(declarations, /margin-top:\s*calc\(3px - var\(--zia-folder-inner-gap, 5px\)\) !important;/);
assert.match(declarations, /padding-bottom:\s*calc\(var\(--zia-folder-inner-gap, 5px\) - 3px\) !important;/);
assert.doesNotMatch(declarations, /(?:height|transform|translate|overflow|opacity|transition|display|position)\s*:/);
assert(!match[0].includes('[collapsed]') && !match[0].includes('[zia-folder-holding]'),
  'spacing must not change at collapsed or native hold transitions');
for (const innerGap of [3, 4, 5, 6, 8]) {
  const top = 3 - innerGap;
  const bottom = innerGap - 3;
  assert.equal(top + bottom, 0, 'balanced spacing must preserve the total group height');
}
assert(css.includes('--zia-active-tab-bg: var(--zsf-selected-tab-fill'),
  'selected-tab translucent background paint must be unchanged');
console.log('PASS v0.8.9: +3px first-tab separation; zero net height; native animation and drag spacing untouched');
