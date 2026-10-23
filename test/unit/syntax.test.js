const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Every script of the extension can be read: a page whose script does not parse shows nothing,
// and most pages are not loaded by the other unit tests.
test('every script of the extension parses', () => {
  const dir = path.join(__dirname, '..', '..', 'extension');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  assert.ok(files.length > 30);
  for (const f of files) assert.doesNotThrow(() => new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }), f);
});
