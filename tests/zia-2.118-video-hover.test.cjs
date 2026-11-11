/* Zia 2.118 video / group-hover CSS compatibility checks; Node.js 22, no packages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'userChrome.css'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'theme.json'), 'utf8'));
const hover = fs.readFileSync(path.join(root, 'site-folders-hover.uc.js'), 'utf8');
const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');

assert.equal(manifest.version, '0.9.0', 'release under test must be v0.8.9');
assert(!Object.hasOwn(manifest, 'preferences'), 'no retired separate blur settings or gear');
assert(hover.includes('getComputedStyle(source)'), 'inherit Zia actual native preview paint');
assert(hover.includes("Services.prefs.addObserver('zia.'"), 'react to Zia pref changes');
assert(hover.includes('data-zsf-preview-sidebar-hold'), 'sidebar stays open over independent card');

const normal = clean.match(/:root:not\(\[zia-video\]\) #zsf-folder-hover-card\s*\{([^}]*)\}/);
assert(normal, 'normal video-free or Blur over video-enabled glass card style');
assert.match(normal[1], /var\(--zia-tab-card-bg\) 76%, transparent/, 'normal glass is 76%');
assert.match(normal[1], /backdrop-filter:\s*blur\(24px\) saturate\(1\.6\)/, 'normal glass blurs');

const protectedVideo = clean.match(/:root\[zia-video\] #zsf-folder-hover-card\s*\{([^}]*)\}/);
assert(protectedVideo, 'video-protected card still has translucent styling');
assert.match(protectedVideo[1], /var\(--zia-tab-card-bg\) 88%, transparent/, 'protected video is 88% translucent');
assert.match(protectedVideo[1], /backdrop-filter:\s*none/, 'protected video does not blur');
assert(!/background-color:\s*var\(--zia-tab-card-bg, rgb\(38, 38, 42\)\)/.test(protectedVideo[1]),
  'video-protected card must not revert to completely solid background');

const compositor = clean.match(
  /:root:not\(\[zia-video\]\):has\(> #zsf-folder-hover-card:not\(\[hidden\]\)\) #tabbrowser-tabpanels \.browserSidebarContainer\s*\{([^}]*)\}/
);
assert(compositor, 'independent preview must follow Zia root-level video gate');
assert.match(compositor[1], /will-change:\s*transform\s*!important/, 'glass paint compositor');
assert.match(compositor[1], /backface-visibility:\s*hidden\s*!important/, 'glass layer compatibility');
assert(!/:has\(#tabbrowser-tabpanels[^{}]*browser\[zia-video\]/.test(clean),
  'inner browser zia-video must not override Zia Blur over video preference');
assert(!/:root:has\(> #zsf-folder-hover-card:not\(\[hidden\]\)\):not\(/.test(clean),
  'obsolete negative video selector removed');
assert(css.includes('@media -moz-pref("zia.cards.blur")'),
  'no forced glass when Zia card blur is disabled');
console.log('PASS: Zia 2.118 video-gated translucent group preview and controlled blur compositor');
