const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
const release = require('../theme.json');
assert.equal(release.version, '0.7.10');
assert(css.includes('--zia-folder-swatch: transparent !important'), 'preserve original tint-free group design');
assert(css.includes(':root[zia-light]:not(#zia-none):not(#zia-none-2) #tabbrowser-tabs'), 'use Zia light theme state');
const lightRule = css.match(/:root\[zia-light\]:not\(#zia-none\):not\(#zia-none-2\) #tabbrowser-tabs\s+:is\(tab-group, zen-folder\)\[data-zsf-site\]:not\(\[split-view-group\]\)\s+> \.tab-group-label-container > \.tab-group-label\s*\{([^}]+)\}/);
assert(lightRule, 'light mode must target only ZSF group label and not global tabs');
assert(lightRule[1].includes('color: var(--zia-sidebar-ink, rgb(28, 28, 32)) !important;'),
  'Zia native sidebar ink is the actual color source');
assert(!/background|opacity|filter|visibility/.test(lightRule[1]),
  'do not touch group appearance or animation');
assert(css.includes('color: inherit !important;'), 'preserve original non-light styling');
console.log('PASS: Zia light-space dark group labels, with dark-mode and no-tint behavior retained');
