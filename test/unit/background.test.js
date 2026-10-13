// Runs the real background message handler against a stubbed network.
const test = require('node:test');
const assert = require('node:assert/strict');

let handler;
const noEvent = { addListener() {} };
const site = { allowed: false, registered: [], calls: [] };
globalThis.chrome = {
  runtime: {
    onMessage: { addListener: (fn) => (handler = fn) },
    getURL: (p) => 'ext://' + p,
    getManifest: () => require('../../extension/manifest.json'),
    onInstalled: noEvent,
    onStartup: noEvent,
  },
  tabs: { create: async (opts) => opts },
  permissions: { contains: async () => site.allowed, onAdded: noEvent, onRemoved: noEvent },
  scripting: {
    getRegisteredContentScripts: async () => site.registered,
    registerContentScripts: async (list) => {
      site.calls.push('register');
      site.registered = list;
    },
    unregisterContentScripts: async () => {
      site.calls.push('unregister');
      site.registered = [];
    },
  },
};
let respond; // set by each test: (URL) => { status?, json?, bytes? }
const calls = [];
globalThis.fetch = async (input) => {
  const url = new URL(String(input));
  calls.push(url);
  const r = respond(url);
  return { ok: (r.status || 200) < 400, status: r.status || 200, json: async () => r.json, arrayBuffer: async () => r.bytes.buffer };
};
require('../../extension/background.js');

const ask = (msg) => new Promise((resolve) => handler(msg, {}, resolve));

test('the content script is registered for other sites only while the user allows it', async () => {
  assert.deepEqual(await ask({ type: 'sync-sites' }), { ok: true, result: false });
  assert.deepEqual(site.calls, []);
  site.allowed = true;
  assert.deepEqual(await ask({ type: 'sync-sites' }), { ok: true, result: true });
  await ask({ type: 'sync-sites' });
  assert.deepEqual(site.calls, ['register']); // once, however often it is asked
  const [script] = site.registered;
  assert.deepEqual(script.matches, ['*://*/*']);
  assert.deepEqual(script.js, ['shared.js', 'core.js', 'subtitles.js', 'content.js']);
  assert.equal(script.runAt, 'document_start');
  assert.equal(script.allFrames, true);
  // The sites the manifest covers are left to the manifest, so nothing runs twice there.
  assert.ok(script.excludeMatches.includes('https://www.youtube.com/*'));
  assert.ok(script.excludeMatches.includes('https://*.primevideo.com/*'));
  site.allowed = false;
  await ask({ type: 'sync-sites' });
  assert.deepEqual(site.calls, ['register', 'unregister']);
});
const translated = (q, mark = (line) => 'T(' + line + ')') => ({ json: [[[q.split('\n').map(mark).join('\n'), q]]] });
const reset = (fn) => {
  calls.length = 0;
  respond = fn;
};

test('translate sends many cues in one request and splits the answer back', async () => {
  reset((url) => translated(url.searchParams.get('q')));
  const res = await ask({ type: 'translate', texts: ['Hello there,\nhow are you?', '', 'Bye.'], sl: 'en-us', tl: 'tr' });
  assert.deepEqual(res, { ok: true, result: ['T(Hello there, how are you?)', 'T()', 'T(Bye.)'] });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].searchParams.get('sl'), 'en');
  assert.equal(calls[0].searchParams.get('tl'), 'tr');
});

test('translate retries cue by cue when the service merges lines', async () => {
  reset((url) => {
    const q = url.searchParams.get('q');
    return q.includes('\n') ? { json: [[[q.replace(/\n/g, ' '), q]]] } : translated(q);
  });
  const res = await ask({ type: 'translate', texts: ['one', 'two', 'three'], sl: 'en', tl: 'tr' });
  assert.deepEqual(res.result, ['T(one)', 'T(two)', 'T(three)']);
  assert.equal(calls.length, 4); // the joined attempt, then one per cue
});

test('translate splits long batches so no request URL gets too long', async () => {
  reset((url) => translated(url.searchParams.get('q')));
  const texts = Array.from({ length: 60 }, (_, i) => `This is test sentence number ${i + 1}, and it is fairly long.`);
  const res = await ask({ type: 'translate', texts, sl: 'en', tl: 'tr' });
  assert.equal(res.result.length, 60);
  assert.equal(res.result[59], 'T(' + texts[59] + ')');
  assert.ok(calls.length > 1);
  for (const url of calls) assert.ok(encodeURIComponent(url.searchParams.get('q')).length <= 1700);
});

test('language codes are mapped to what the service expects', async () => {
  reset((url) => translated(url.searchParams.get('q')));
  await ask({ type: 'translate', texts: ['x'], sl: 'zh-Hant', tl: 'nb-NO' });
  await ask({ type: 'translate', texts: ['x'], sl: '', tl: 'he' });
  assert.deepEqual(calls.map((u) => [u.searchParams.get('sl'), u.searchParams.get('tl')]), [['zh-TW', 'no'], ['auto', 'iw']]);
});

test('a failing service is reported instead of thrown', async () => {
  reset(() => ({ status: 429, json: null }));
  const res = await ask({ type: 'translate', texts: ['x'], sl: 'en', tl: 'tr' });
  assert.equal(res.ok, false);
  assert.match(res.error, /429/);
});

test('lookup returns translation, phonetic spelling, definitions and first-sense synonyms', async () => {
  // Trimmed copy of a real response for "umbrella" (en -> tr).
  const data = [];
  data[0] = [['şemsiye', 'umbrella', null, null, 2], [null, null, null, 'ˌəmˈbrelə']];
  data[1] = [['noun', ['şemsiye', 'koruyucu', 'koruma'], [], 'umbrella', 1]];
  data[11] = [['noun', [[['brolly', 'gamp'], 'id1', [['informal']]], [['parasol', 'sunshade'], 'id1'], [['aegis', 'patronage'], 'id2']], 'umbrella', 1]];
  data[12] = [['noun', [['a device used as protection against rain.', 'id1'], ['a protecting force or influence.', 'id2', 'the nuclear umbrella'], ['third', 'id3']], 'umbrella', 1]];
  reset(() => ({ json: data }));
  const { ok, result } = await ask({ type: 'lookup', text: 'umbrella', sl: 'en-us', tl: 'tr' });
  assert.ok(ok);
  assert.equal(result.translation, 'şemsiye');
  assert.equal(result.ipa, 'ˌəmˈbrelə');
  assert.deepEqual(result.dict, [{ pos: 'noun', terms: ['şemsiye', 'koruyucu', 'koruma'] }]);
  assert.deepEqual(result.defs.map((d) => d.text), ['a device used as protection against rain.', 'a protecting force or influence.']);
  assert.equal(result.defs[1].example, 'the nuclear umbrella');
  assert.deepEqual(result.synonyms, ['parasol', 'sunshade']); // not the informal set, not the figurative sense
});

test('lookup prefers the dictionary when the one-line answer is some other word', async () => {
  const data = [];
  data[0] = [['BT', 'it', null, null, 1]];
  data[1] = [['pronoun', ['onu', 'o', 'ona'], [], 'it', 1]];
  reset(() => ({ json: data }));
  assert.equal((await ask({ type: 'lookup', text: 'it', sl: 'en', tl: 'tr' })).result.translation, 'onu');

  // ...but keeps the answer when the dictionary agrees with it, whatever the order or case.
  data[0] = [['Adam', 'man', null, null, 1]];
  data[1] = [['noun', ['erkek', 'adam', 'insan'], [], 'man', 1]];
  assert.equal((await ask({ type: 'lookup', text: 'man', sl: 'en', tl: 'tr' })).result.translation, 'Adam');
});

test('lookup of a phrase copes with a response that has only the translation', async () => {
  reset(() => ({ json: [[['kararını ver', 'make up your mind']]] }));
  const { result } = await ask({ type: 'lookup', text: 'make up your mind', sl: 'en', tl: 'tr' });
  assert.deepEqual(result, { translation: 'kararını ver', dict: [], ipa: '', defs: [], synonyms: [] });
});

test('tts returns the audio as base64 and asks for the slow voice when told to', async () => {
  const bytes = Uint8Array.from({ length: 70000 }, (_, i) => i % 251);
  reset(() => ({ bytes }));
  const res = await ask({ type: 'tts', text: 'umbrella', lang: 'en-GB', slow: true });
  assert.ok(res.ok);
  assert.deepEqual(Uint8Array.from(Buffer.from(res.result, 'base64')), bytes);
  assert.equal(calls[0].searchParams.get('tl'), 'en-GB');
  assert.equal(calls[0].searchParams.get('ttsspeed'), '0.24');

  await ask({ type: 'tts', text: 'umbrella', lang: 'en-GB' });
  assert.equal(calls[1].searchParams.get('ttsspeed'), null);
});

test('tts rejects an empty audio answer', async () => {
  reset(() => ({ bytes: new Uint8Array(10) }));
  assert.equal((await ask({ type: 'tts', text: 'x', lang: 'en' })).ok, false);
});

test('unknown messages are left for other listeners', () => {
  assert.equal(handler({ type: 'something-else' }, {}, () => {}), false);
});
