const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'extension');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const exists = (file) => fs.existsSync(path.join(dir, file));

test('every file the manifest names exists', () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    ...Object.values(manifest.icons),
    ...manifest.content_scripts.flatMap((c) => [...(c.js || []), ...(c.css || [])]),
  ];
  for (const file of files) assert.ok(exists(file), file + ' is missing');
});

test('pages load the scripts they depend on, in order', () => {
  for (const page of ['popup.html', 'review.html', 'words.html', 'welcome.html', 'listen.html', 'speak.html', 'write.html', 'read.html', 'level.html', 'progress.html']) {
    const scripts = [...fs.readFileSync(path.join(dir, page), 'utf8').matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
    assert.deepEqual(scripts.filter((s) => s !== 'web.js').slice(0, 2), ['messages.js', 'shared.js'], page);
    for (const s of scripts) assert.ok(exists(s), s + ' is missing');
  }
  const isolated = manifest.content_scripts.find((c) => c.world !== 'MAIN').js;
  assert.deepEqual(isolated, ['messages.js', 'shared.js', 'study.js', 'core.js', 'subtitles.js', 'episode.js', 'nouns.js', 'overlay-base.js', 'overlay-tracks.js', 'overlay-lines.js', 'overlay-words.js', 'overlay-practice.js', 'overlay-ui.js', 'overlay-episode.js', 'content.js', 'select.js']);
});

test('the page-world hooks and the content script run on the same pages', () => {
  const hooks = manifest.content_scripts.filter((c) => c.world === 'MAIN');
  const [content] = manifest.content_scripts.filter((c) => c.world !== 'MAIN');
  assert.deepEqual(hooks.flatMap((c) => c.matches), content.matches);
  for (const hook of hooks) assert.equal(hook.run_at, 'document_start');
});

test('it asks for little, and for other sites only when the user says so', () => {
  assert.deepEqual(manifest.permissions, ['storage', 'scripting', 'tabCapture', 'offscreen', 'activeTab', 'contextMenus', 'alarms', 'identity', 'notifications']);
  assert.deepEqual(manifest.host_permissions, ['https://translate.googleapis.com/*', 'https://generativelanguage.googleapis.com/*', 'https://www.googleapis.com/*']);
  assert.deepEqual(manifest.optional_host_permissions, ['*://*/*']);
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
});
