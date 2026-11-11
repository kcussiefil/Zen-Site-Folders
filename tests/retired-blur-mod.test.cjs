const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const base=path.join(__dirname,'..');
const main=JSON.parse(fs.readFileSync(path.join(base,'theme.json'),'utf8'));
const dir=path.join(base,'sine-mods/zen-blur-compat-test');
const legacy=JSON.parse(fs.readFileSync(path.join(dir,'theme.json'),'utf8'));
const css=fs.readFileSync(path.join(dir,'chrome.css'),'utf8');
assert.match(main.version,/^\d+\.\d+\.\d+$/,'main release must use semver');
assert(main.version.localeCompare('0.7.4',undefined,{numeric:true})>=0,
  'retired blur experiment must remain disabled in all releases since v0.7.4');
assert.equal(main.preferences,'preferences.json','only the background-drag settings UI may remain');
const prefs=JSON.parse(fs.readFileSync(path.join(base,'preferences.json'),'utf8'));
assert(prefs.length===1 && prefs[0].property==='zen.sitefolders.background_drag.enabled' &&
  !JSON.stringify(prefs).includes('blur'),'old blur controls must remain retired');
assert.equal(legacy.version,'0.2.1');
assert.equal(legacy.id,'0a960432-0bb0-44a9-8f73-dc9b50d31e08','legacy Sine ID must remain updateable');
assert(!Object.hasOwn(legacy,'preferences'),'test Sine manifest must not expose gear');
assert(!fs.existsSync(path.join(dir,'preferences.json')),'obsolete experimental settings must be deleted');
assert.equal(css.replace(/\/\*[\s\S]*?\*\//g,'').trim(),'','retired test CSS must have zero live rules');
console.log('PASS: legacy blur experiment retired; optional background-drag toggle isolated');
