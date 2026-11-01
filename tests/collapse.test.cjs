// Safety checks supplement tests/browser/regressions.js, which executes Zen's
// actual custom elements, animation routines and computed layout.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'site-folders-collapse.uc.js'), 'utf8');
new vm.Script(src);
assert(!/\.animate\s*\(|\bpinTab\(|\bremoveTab\(|\bmoveTab/.test(src), 'bridge must use native motion and preserve tabs');
assert(!/isZenFolder\s*=|pinned\s*=/.test(src), 'ordinary group type and pin status must remain intact');
console.log('PASS: motion bridge safety; native layout behavior covered by browser suite');
