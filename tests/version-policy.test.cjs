const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'theme.json'), 'utf8'));
const valid = /^\d+\.[0-9]\.[0-9]$/;
assert.match(manifest.version, valid,
  'Minor and patch segments must each contain one digit. Use 0.7.9 -> 0.8.0, never 0.7.10.');
assert.equal(manifest.version, '0.9.0',
  'Current release version in this branch must be v0.9.0');
assert.equal(/^\d+\.[0-9]\.[0-9]$/.test('0.7.10'), false,
  'A two-digit patch must never be accepted again');
assert.equal(valid.test('0.8.0'), true);
assert.equal(valid.test('1.0.0'), true);
console.log('PASS: single-digit minor / patch with carry-over; published v0.9.0');
