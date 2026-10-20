const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../../extension/shared.js');
globalThis.slIsDue = shared.slIsDue;
globalThis.SL_DAY = shared.SL_DAY;
const study = require('../../extension/study.js');
globalThis.slStatus = study.slStatus;
globalThis.slKindOf = (item) => item.kind || (/\s/.test(item.word) ? 'phrase' : 'word');
const S = require('../../extension/speak-data.js');

test('the overall band: the mean of the four, to the nearest half, a quarter going up', () => {
  assert.equal(S.slIeltsOverall({ fluency: 6, lexical: 6, grammar: 6, pronunciation: 7 }), 6.5);
  assert.equal(S.slIeltsOverall({ fluency: 6, lexical: 6, grammar: 6, pronunciation: 6.5 }), 6);
  assert.equal(S.slIeltsOverall({ fluency: 7, lexical: 6.5, grammar: 6.5, pronunciation: 7 }), 7);
  assert.equal(S.slIeltsOverall({ fluency: 6 }), null);
});

test('every part of the test and every situation has what the page shows', () => {
  assert.ok(S.SL_IELTS.part1.length >= 10 && S.SL_IELTS.part1.every((t) => t.topic && t.questions.length >= 3));
  assert.ok(S.SL_IELTS.part2.length >= 10 && S.SL_IELTS.part2.every((c) => c.card && c.points.length === 4 && c.part3.length === 3));
  const ids = new Set();
  for (const s of S.SL_SCENES) {
    assert.ok(s.title.en && s.title.tr && s.role && s.situation && s.icon, s.id);
    assert.ok(!ids.has(s.id), s.id);
    ids.add(s.id);
  }
});

test('words to try: of the language, not sentences, those still learnt first', () => {
  const words = [
    { word: 'keen', lang: 'en', interval: 40 },
    { word: 'swoop', lang: 'en', interval: 2 },
    { word: 'Hund', lang: 'de' },
    { word: 'It is what it is.', kind: 'sentence', lang: 'en' },
    { word: 'rip off', lang: 'en' },
    { word: 'Approaching', lang: 'en', interval: 50 },
    { word: 'NASA', lang: 'en', interval: 60 },
  ];
  assert.deepEqual(S.slWordsToTry(words, 'en', 2, () => 0.5), ['swoop', 'rip off']);
  assert.deepEqual(S.slWordsToTry(words, 'en', 5, () => 0.5), ['swoop', 'rip off', 'keen', 'approaching', 'NASA']);
  assert.deepEqual(S.slWordsToTry(words, 'de', 5), ['Hund']);
});
