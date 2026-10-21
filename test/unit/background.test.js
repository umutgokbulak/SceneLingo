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
  storage: {
    local: { get: async (defaults) => ({ ...defaults, geminiKey: site.geminiKey || '' }) },
    sync: { get: async (defaults) => ({ ...defaults, ...(site.useGemini === false ? { useGemini: false } : {}) }) },
  },
  contextMenus: { create() {}, onClicked: noEvent },
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
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  url.init = init;
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
  assert.deepEqual(script.js, ['messages.js', 'shared.js', 'study.js', 'core.js', 'subtitles.js', 'overlay-base.js', 'overlay-tracks.js', 'overlay-lines.js', 'overlay-words.js', 'overlay-practice.js', 'overlay-ui.js', 'content.js', 'select.js']);
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
  assert.deepEqual(res, { ok: true, result: ['T(Hello there, how are you?)', 'T()', 'T(Bye.)'], engine: 'online', canGet: false });
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

test('sentences are translated inside the browser when it can, and say so', async () => {
  reset((url) => translated(url.searchParams.get('q')));
  const asked = [];
  globalThis.Translator = Object.assign(function Translator() {}, {
    availability: async (pair) => (asked.push(pair.sourceLanguage + '>' + pair.targetLanguage), pair.targetLanguage === 'tr' ? 'available' : pair.targetLanguage === 'de' ? 'downloadable' : 'unavailable'),
    create: async (pair) => ({ translate: async (text) => 'B(' + text + ')' }),
  });
  try {
    const own = await ask({ type: 'translate', texts: ['One.', 'Two\nlines.', ''], sl: 'en-US', tl: 'tr' });
    assert.deepEqual(own, { ok: true, result: ['B(One.)', 'B(Two lines.)', ''], engine: 'browser', canGet: false });
    assert.equal(calls.length, 0); // nothing went to the network
    // A pair whose language pack has not been fetched: the network, and a note that it could be.
    const pack = await ask({ type: 'translate', texts: ['One.'], sl: 'en', tl: 'de' });
    assert.deepEqual([pack.result, pack.engine, pack.canGet], [['T(One.)'], 'online', true]);
    // A pair the browser does not have. Hebrew is tried under both of its codes.
    const none = await ask({ type: 'translate', texts: ['One.'], sl: 'en', tl: 'he' });
    assert.deepEqual([none.engine, none.canGet], ['online', false]);
    assert.ok(asked.includes('en>he') && asked.includes('en>iw'));
    // Without the service a word still gets its translation, if not its dictionary entry.
    reset(() => ({ status: 429, json: null }));
    const word = await ask({ type: 'lookup', text: 'umbrella', sl: 'en', tl: 'tr' });
    assert.deepEqual(word.result, { translation: 'B(umbrella)', dict: [], ipa: '', defs: [], synonyms: [] });
  } finally {
    delete globalThis.Translator;
  }
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
  assert.deepEqual(result, { translation: 'kararını ver', src: '', dict: [], ipa: '', defs: [], synonyms: [] });
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

test('sense: without a key the sentence is translated with the word marked, and the marked part is the meaning', async () => {
  site.geminiKey = '';
  reset(() => ({ json: [[['Yanlış insanları <b>soyman</b> benim suçum değil.', 'x']]] }));
  const res = await ask({ type: 'sense', word: 'ripped off', sentence: 'It is not my fault you ripped off the wrong people.', sl: 'en', tl: 'tr' });
  assert.deepEqual(res.result, { meaning: 'soyman', engine: 'marked' });
  assert.equal(calls[0].searchParams.get('q'), 'It is not my fault you <b>ripped off</b> the wrong people.');
});

test('sense: with a key Gemini answers, and the phrase it names is kept', async () => {
  site.geminiKey = 'test-key';
  reset((url) => {
    if (url.hostname !== 'generativelanguage.googleapis.com') throw new Error('not expected: ' + url);
    return { json: { candidates: [{ content: { parts: [{ text: '{"phrase":"rip off","meaning":"soymak, dolandırmak","note":"Argo."}' }] } }] } };
  });
  const res = await ask({ type: 'sense', word: 'ripped', sentence: 'You ripped off the wrong people again.', sl: 'en', tl: 'tr' });
  assert.deepEqual(res.result, { meaning: 'soymak, dolandırmak', phrase: 'rip off', note: 'Argo.', engine: 'gemini' });
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'test-key');
  assert.ok(!calls[0].search.includes('test-key'), 'the key is not put in the address');
});

test('sense: an answer Gemini gave is not shown once Gemini is switched off', async () => {
  site.geminiKey = 'test-key';
  reset((url) =>
    url.hostname === 'generativelanguage.googleapis.com'
      ? { json: { candidates: [{ content: { parts: [{ text: '{"phrase":"","meaning":"keskin","note":""}' }] } }] } }
      : { json: [[['O halde <b>sivri</b> bir zekan mı var?', 'x']]] }
  );
  const msg = { type: 'sense', word: 'keen', sentence: 'Possessed of a keen wit, then?', sl: 'en', tl: 'tr' };
  assert.equal((await ask(msg)).result.engine, 'gemini');
  site.useGemini = false;
  const off = (await ask(msg)).result;
  assert.deepEqual(off, { meaning: 'sivri', engine: 'marked' });
  site.useGemini = undefined;
  site.geminiKey = '';
});

test('review cards use Gemini even when it is switched off for the video', async () => {
  site.geminiKey = 'test-key';
  site.useGemini = false;
  reset(() => ({ json: { candidates: [{ content: { parts: [{ text: '{"phrase":"","meaning":"belki","note":""}' }] } }] } }));
  const res = await ask({ type: 'sense', word: 'Might', sentence: 'Might even have a girl for you, if you like.', sl: 'en', tl: 'tr', always: true });
  assert.equal(res.result.engine, 'gemini');
  site.useGemini = undefined;
  site.geminiKey = '';
});

test('enrich and check-sentence ask Gemini once each, and need a key', async () => {
  site.geminiKey = '';
  assert.equal((await ask({ type: 'enrich', word: 'keen', sl: 'en', tl: 'tr' })).error, 'noKey');
  site.geminiKey = 'test-key';
  const answer = (o) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] } });
  reset(() => answer({ level: 'b2', academic: true, collocations: [{ text: 'keen on', meaning: 'meraklı' }, { meaning: 'no text' }], examples: [{ text: 'She is keen on music.', translation: 'Müziğe meraklı.' }] }));
  const extra = (await ask({ type: 'enrich', word: 'keen', sentence: 'a keen wit', sl: 'en', tl: 'tr' })).result;
  assert.deepEqual(extra, { ipa: '', level: 'B2', academic: true, collocations: [{ text: 'keen on', meaning: 'meraklı' }], examples: [{ text: 'She is keen on music.', translation: 'Müziğe meraklı.' }] });
  reset(() => answer({ correct: false, better: 'I am keen on football.', note: 'keen on kalıbı.' }));
  const checked = (await ask({ type: 'check-sentence', word: 'keen', sentence: 'I am keen to football.', sl: 'en', tl: 'tr' })).result;
  assert.deepEqual(checked, { correct: false, better: 'I am keen on football.', note: 'keen on kalıbı.' });
  reset(() => answer({ parts: [{ text: 'ripped off', base: 'rip off', meaning: 'dolandırmak' }, { text: 'fault', base: 'fault', meaning: 'suç' }, { text: 'wrong' }] }));
  const parts = (await ask({ type: 'gloss', sentence: "It's not my fault you ripped off the wrong people.", sl: 'en', tl: 'tr' })).result;
  assert.deepEqual(parts, [{ text: 'ripped off', base: 'rip off', meaning: 'dolandırmak' }, { text: 'fault', base: '', meaning: 'suç' }]);
  site.geminiKey = '';
});

test('explain: several words get a translation that is not word for word, and their idioms', async () => {
  site.geminiKey = '';
  assert.equal((await ask({ type: 'explain', text: 'die Polizei tanzt nach seiner Pfeife', sl: 'de', tl: 'tr' })).result, null, 'nothing without a key');
  site.geminiKey = 'test-key';
  reset(() => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify({ translation: 'polis onun dediğini yapıyor', idioms: [{ text: 'nach jemandes Pfeife tanzen', meaning: 'birinin dediğini yapmak', literal: 'birinin düdüğüyle dans etmek' }, { meaning: 'no text' }], note: '' }) }] } }] } }));
  const res = await ask({ type: 'explain', text: 'die Polizei tanzt nach seiner Pfeife', sentence: 'Verbrechen überall, und die Polizei tanzt nach seiner Pfeife.', sl: 'de', tl: 'tr' });
  assert.deepEqual(res.result, { translation: 'polis onun dediğini yapıyor', idioms: [{ text: 'nach jemandes Pfeife tanzen', meaning: 'birinin dediğini yapmak', literal: 'birinin düdüğüyle dans etmek' }], note: '', engine: 'gemini' });
  site.useGemini = false;
  assert.equal((await ask({ type: 'explain', text: 'eins zwei drei', sl: 'de', tl: 'tr' })).result, null, 'switched off for the video');
  assert.equal((await ask({ type: 'explain', text: 'eins zwei drei', sl: 'de', tl: 'tr', always: true })).result.engine, 'gemini', 'the review page asks anyway');
  site.useGemini = undefined;
  site.geminiKey = '';
});

test('sense: when Gemini refuses (quota), the marked sentence answers instead', async () => {
  site.geminiKey = 'test-key';
  reset((url) => (url.hostname === 'generativelanguage.googleapis.com' ? { status: 429, json: { error: { message: 'quota' } } } : { json: [[['Hatta <b>belki</b> sana bir kız bile bulurum.', 'x']]] }));
  const res = await ask({ type: 'sense', word: 'Might', sentence: 'Might even find you a girl.', sl: 'en', tl: 'tr' });
  assert.equal(res.result.meaning, 'belki');
  assert.equal(res.result.engine, 'marked');
  site.geminiKey = '';
});

test('sense: with Gemini switched off the key is kept but not used', async () => {
  site.geminiKey = 'test-key';
  site.useGemini = false;
  reset((url) => {
    if (url.hostname === 'generativelanguage.googleapis.com') throw new Error('Gemini was asked');
    return { json: [[['Pencereyi <b>açtı</b>.', 'x']]] };
  });
  const res = await ask({ type: 'sense', word: 'aufgemacht', sentence: 'Er hat das Fenster aufgemacht.', sl: 'de', tl: 'tr' });
  assert.deepEqual(res.result, { meaning: 'açtı', engine: 'marked' });
  assert.equal((await ask({ type: 'gemini-key' })).result, 'test…-key');
  site.useGemini = undefined;
  site.geminiKey = '';
  assert.equal((await ask({ type: 'gemini-key' })).result, '');
});

test('speaking: an IELTS answer scored by Gemini, and a conversation it plays along with', async () => {
  site.geminiKey = 'test-key';
  const answer = (o) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] } });
  reset(() =>
    answer({
      bands: { fluency: 6, lexical: '5.5', grammar: 6.3, pronunciation: 7 },
      summary: 'İyi.',
      corrections: [{ said: 'I am agree', better: 'I agree', note: 'agree fiil' }, { said: 'no better' }],
      better: 'I agree.',
      phrases: [{ text: 'to some extent', meaning: 'bir dereceye kadar' }],
      used: [{ word: 'keen', ok: true, sentence: 'I am keen on films.' }],
    })
  );
  const res = (await ask({ type: 'speak-feedback', part: 1, question: 'Do you like films?', answer: 'yes I am agree', words: ['keen'], sl: 'en', tl: 'tr' })).result;
  assert.deepEqual(res.bands, { fluency: 6, lexical: 5.5, grammar: 6.5, pronunciation: 7 });
  assert.deepEqual(res.corrections, [{ said: 'I am agree', better: 'I agree', note: 'agree fiil' }]);
  assert.deepEqual(res.used, [{ word: 'keen', ok: true, sentence: 'I am keen on films.' }]);
  assert.match(calls[0].init.body, /keen/, 'the words to try are named');
  assert.doesNotMatch(calls[0].init.body, /thinkingBudget/, 'a score is thought through');
  reset(() => answer({ bands: { fluency: 6 } }));
  assert.match((await ask({ type: 'speak-feedback', part: 1, question: 'q', answer: 'a', sl: 'en', tl: 'tr' })).error, /no score/);

  const scene = { role: 'a waiter', situation: 'At a café.' };
  reset(() => answer({ reply: 'Hallo! Was darf es sein?', translation: 'Merhaba! Ne alırsınız?', correction: { ok: false, better: 'x' }, done: false }));
  const first = (await ask({ type: 'roleplay', scene, level: 'A2', history: [], sl: 'de', tl: 'tr' })).result;
  assert.deepEqual(first, { reply: 'Hallo! Was darf es sein?', translation: 'Merhaba! Ne alırsınız?', correction: null, done: false }, 'nothing to put right before the learner speaks');
  assert.doesNotMatch(calls[0].init.body, /thinkingBudget/, 'what is put right is thought through');
  reset(() => answer({ reply: 'Gerne.', translation: 'Memnuniyetle.', correction: { ok: false, better: 'Ich hätte gern einen Kaffee.', meaning: 'Bir kahve rica ediyorum.', note: 'gern' }, done: true }));
  const next = (await ask({ type: 'roleplay', scene, level: 'A2', history: [{ who: 'them', text: 'Hallo!' }, { who: 'me', text: 'ich will kaffee' }], sl: 'de', tl: 'tr' })).result;
  assert.deepEqual(next.correction, { ok: false, better: 'Ich hätte gern einen Kaffee.', meaning: 'Bir kahve rica ediyorum.', note: 'gern' });
  assert.equal(next.done, true);
  assert.match(calls[0].init.body, /Learner: ich will kaffee/);
  site.geminiKey = '';
});

test('writing: an IELTS text scored on its own four criteria, and an everyday one given its level', async () => {
  site.geminiKey = 'test-key';
  const answer = (o) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] } });
  reset(() => answer({ bands: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 }, summary: 'İyi.', corrections: [{ said: 'peoples', better: 'people', note: 'çoğul' }], better: 'Better.', phrases: [{ text: 'on the other hand', meaning: 'öte yandan' }], used: [] }));
  const table = { title: 'Visitors', columns: ['Museum', '2019'], rows: [['Art', '640']] };
  const r = (await ask({ type: 'ielts-writing', task: 'task1a', prompt: 'Summarise the table.', table, text: 'The table shows peoples.', tl: 'tr' })).result;
  assert.deepEqual(r.bands, { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 });
  assert.deepEqual(r.corrections, [{ said: 'peoples', better: 'people', note: 'çoğul' }]);
  assert.match(calls[0].init.body, /Art \| 640/, 'the figures are given');
  assert.match(calls[0].init.body, /Task Achievement/);
  reset(() => answer({ level: 'b1', points: [true, false], summary: 'Gut.', corrections: [], better: 'Sehr geehrter Herr Braun, ...', phrases: [] }));
  const e = (await ask({ type: 'everyday-writing', task: 'Write to your landlord.', points: ['what is wrong', 'when to come'], level: 'B1', text: 'Hallo, die Heizung ist kaputt.', sl: 'de', tl: 'tr' })).result;
  assert.equal(e.level, 'B1');
  assert.deepEqual(e.points, [{ point: 'what is wrong', done: true }, { point: 'when to come', done: false }]);
  site.geminiKey = '';
});

test('every request to Gemini is counted for the day, with its tokens and whether it was refused', async () => {
  const kept = {};
  const realLocal = chrome.storage.local;
  chrome.storage.local = { get: async (d) => ({ ...d, geminiKey: 'test-key', ...kept }), set: async (o) => Object.assign(kept, o) };
  const answer = (o) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }], usageMetadata: { totalTokenCount: 120 } } });
  reset(() => answer({ parts: [{ text: 'fault', meaning: 'suç' }] }));
  await ask({ type: 'gloss', sentence: 'One.', sl: 'en', tl: 'tr' });
  await ask({ type: 'gloss', sentence: 'Two.', sl: 'en', tl: 'tr' });
  reset(() => ({ status: 429, json: { error: { message: 'Resource exhausted' } } }));
  await ask({ type: 'gloss', sentence: 'Three.', sl: 'en', tl: 'tr' });
  await new Promise((r) => setTimeout(r, 20));
  const [day] = Object.values(kept.geminiUsage.days);
  assert.deepEqual(day, { requests: 3, tokens: 240, refused: 1 });
  assert.ok(kept.geminiUsage.limited > 0);
  chrome.storage.local = realLocal;
});

test('a model that must think is asked again without being told not to, and then always so', async () => {
  site.geminiKey = 'test-key';
  const answer = (o) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] } });
  reset((url) => (/thinkingBudget/.test(url.init.body) ? { status: 400, json: { error: { message: 'Request contains an invalid argument.' } } } : answer({ parts: [{ text: 'fault', meaning: 'suç' }] })));
  const parts = (await ask({ type: 'gloss', sentence: "It's my fault.", sl: 'en', tl: 'tr' })).result;
  assert.deepEqual(parts, [{ text: 'fault', base: '', meaning: 'suç' }]);
  assert.equal(calls.length, 2);
  await ask({ type: 'gloss', sentence: 'Another one.', sl: 'en', tl: 'tr' });
  assert.equal(calls.length, 3, 'not tried quick again');
  site.geminiKey = '';
});
