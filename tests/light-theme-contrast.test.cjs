const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '..', 'userChrome.css'), 'utf8');
const release = require('../theme.json');
assert.equal(release.version, '0.9.0');
assert(css.includes('--zia-folder-swatch: transparent !important'), 'preserve original tint-free group design');
assert(css.includes(':root[zia-light]:not(#zia-none):not(#zia-none-2) #tabbrowser-tabs'), 'use Zia light theme state');
const lightRule = css.match(/:root\[zia-light\]:not\(#zia-none\):not\(#zia-none-2\) #tabbrowser-tabs\s+:is\(tab-group, zen-folder\)\[data-zsf-site\]:not\(\[split-view-group\]\)\s+> \.tab-group-label-container > \.tab-group-label\s*\{([^}]+)\}/);
assert(lightRule, 'light mode must target only ZSF group label and not global tabs');
assert(lightRule[1].includes('color: var(--zia-sidebar-ink, rgb(28, 28, 32)) !important;'),
  'Zia native sidebar ink is the actual color source');
assert(!/background|opacity|filter|visibility/.test(lightRule[1]),
  'do not touch group appearance or animation');
assert(css.includes('color: inherit !important;'), 'preserve original non-light styling');
// Match the same live Zia hover token used by ordinary tabs, including
// light Spaces; never let the collapsed-only rule conceal the hover fill.
const hoverRule = css.match(/:root\[zen-sidebar-expanded="true"\] #tabbrowser-tabs tab-group\[data-zsf-site\]:not\(\[split-view-group\]\) > \.tab-group-label-container:hover\s*\{([^}]+)\}/);
assert(hoverRule, 'site-group label hover must be scoped to owned ordinary groups');
assert(hoverRule[1].includes('background-color: var(--zia-tab-hover-bg, color-mix(in srgb, currentColor 8%, transparent)) !important;'),
  'hover must follow the live Zia tab theme token, not a hard-coded light/dark shade');
const collapsedRule = css.match(/tab-group\[data-zsf-site\]\[collapsed\]:not\(\[split-view-group\]\)\s*> \.tab-group-label-container\s*\{([^}]+)\}/);
assert(collapsedRule && !/background(?:-color)?\s*:/.test(collapsedRule[1]),
  'collapsed group label must not override hover background with transparent');
assert(css.includes('> .tab-group-label-container {\n  background: transparent !important;'),
  'site-group headers remain transparent at rest');
assert(css.includes('tab-group[data-zsf-site]:not([split-view-group])::after') &&
  css.includes('tab-group[data-zsf-site]:not([split-view-group], [zia-drop-slot])::before'),
  'site-group perimeter removal and drag drop-slot guards remain unchanged');
console.log('PASS: themed group hover across collapsed/expanded states, light label and drag/drop guards');
