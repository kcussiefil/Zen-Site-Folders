// Sine identifies mod updates by comparing updatedAt timestamps, not
// semantic versions. Check the previous tagged release (not a hard-coded
// timestamp) so every future version bump must advance this field.
// GitHub Actions fetches complete Git history for this test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');

const manifest = JSON.parse(fs.readFileSync('theme.json', 'utf8'));
const changedAt = Date.parse(manifest.updatedAt);
assert(Number.isFinite(changedAt), 'theme.json.updatedAt must be a valid timestamp');
assert.match(manifest.updatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/,
  'Sine updatedAt must be a complete UTC ISO timestamp');
assert(changedAt <= Date.now() + 15 * 60 * 1000, 'updatedAt cannot be in the future');
let previousTag;
try {
  previousTag = cp.execFileSync('git',
    ['describe', '--tags', '--abbrev=0', 'HEAD^'], {encoding:'utf8'}).trim();
} catch (error) {
  if (process.env.CI) throw error;
  console.log('SKIP: previous release Git tag unavailable in this checkout');
  process.exit(0);
}
const previous = JSON.parse(cp.execFileSync('git',
  ['show', previousTag + ':theme.json'], {encoding:'utf8'}));
const previousTime = Date.parse(previous.updatedAt);
assert(Number.isFinite(previousTime), 'previous release must have valid updatedAt');
if (manifest.version !== previous.version) {
  assert(changedAt > previousTime,
    'Sine will miss version '+manifest.version+': '+manifest.updatedAt+
    ' must be newer than '+previousTag+' ('+previous.updatedAt+')');
}
console.log('PASS: Sine detects '+manifest.version+' after '+previousTag);
