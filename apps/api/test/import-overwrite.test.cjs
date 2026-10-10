const test = require('node:test');
const assert = require('node:assert/strict');
const {
  importDiffRequiresOverwrite,
} = require('./compiled-root.cjs')('ws6/import-overwrite.js');

test('requires explicit confirmation when preview contains overwrites', () => {
  assert.equal(importDiffRequiresOverwrite({ overwriteCount: 2 }), true);
  assert.equal(importDiffRequiresOverwrite({ overwriteCount: '1' }), true);
});

test('allows confirmation when preview has no overwrites', () => {
  assert.equal(importDiffRequiresOverwrite({ overwriteCount: 0 }), false);
  assert.equal(importDiffRequiresOverwrite({ insertCount: 3 }), false);
  assert.equal(importDiffRequiresOverwrite(null), false);
});
