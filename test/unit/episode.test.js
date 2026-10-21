const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const shared = require('../../extension/shared.js');
globalThis.slIsDue = shared.slIsDue;
globalThis.SL_DAY = shared.SL_DAY;
Object.assign(globalThis, require('../../extension/study.js'));
const E = require('../../extension/episode.js');

const list = (lang) => E.slRanks(fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'freq', lang + '.txt'), 'utf8'));

test('the lists hold the commonest words of film subtitles, the commonest first', () => {
  const en = list('en');
  const de = list('de');
  assert.equal(en.size, 20000);
  assert.equal(en.get('you'), 1);
  assert.ok(en.get('umbrella') > 3000 && en.get('umbrella') < 10000);
  assert.ok(de.get('ich') < 5 && de.get('schläft') > 1000, 'German letters are read as they are');
});

test("an episode's words: how often, where first, and whether it is a name", () => {
  const t = E.slEpisodeTokens([
    "[Addison] It's not my fault you ripped off Addison.",
    'Addison, listen. RIPPED OFF, I said!',
    '- Ripped? She ripped it.',
  ]);
  assert.deepEqual(t.get('ripped'), { word: 'ripped', count: 4, first: 0, capitalMid: 0, lower: 2 }, 'in capitals or at the start of a sentence a word says nothing of being a name');
  assert.equal(t.get('addison').capitalMid, 1, 'the note for the hard of hearing is not read');
  assert.equal(t.get('addison').lower, 0);
  assert.equal(t.has('it'), false, 'words of two letters are left out');
  const sounds = E.slEpisodeTokens(['Hah! Hmm, ugh. Nooo, aaah, whoa. Shh! Huh?', 'Well, the umbrella.']);
  assert.deepEqual([...sounds.keys()], ['well', 'the', 'umbrella'], 'sounds are not words to learn');
});

test('the words to learn: not common enough for the level, not names, not saved, the frequent ones first', () => {
  const ranks = list('en');
  const lines = [
    'Addison, the umbrella is in the car.',
    "Don't forget your umbrella, Addison.",
    'They swoop in at night and they swoop out again.',
    'I need a solicitor, and an umbrella.',
    'That sounds wonderful.',
  ];
  const at = (level, known) => E.slEpisodeWords({ lines, ranks, lang: 'en', level, known: new Set(known || []) }).map((w) => w.word + '×' + w.count);
  assert.deepEqual(at('B1'), ['umbrella×3', 'swoop×2', 'solicitor×1'], "Addison is a name; wonderful is too common for B1, and so is don't");
  assert.deepEqual(at('C1'), ['swoop×2'], 'at C1 only the rarest');
  assert.deepEqual(at('B1', ['umbrella']), ['swoop×2', 'solicitor×1'], 'a saved word is not offered again');
  assert.equal(E.slEpisodeWords({ lines, ranks, lang: 'en', level: 'B1', known: new Set() })[0].first, 0);
});

test('in German a capital is no sign of a name, unless the word is not in the list', () => {
  const ranks = list('de');
  const lines = ['Der Verbrecher trägt eine Maske.', 'Frau Kowalczyk sieht den Verbrecher.'];
  const words = E.slEpisodeWords({ lines, ranks, lang: 'de', level: 'A2', known: new Set() }).map((w) => w.word);
  assert.ok(words.includes('verbrecher'), 'a noun, written with a capital as all nouns are');
  assert.ok(!words.includes('kowalczyk'), 'a name');
});

test('an episode is known again by its lines', () => {
  const a = E.slEpisodeKey(['One.', 'Two.']);
  assert.equal(a, E.slEpisodeKey(['One.', 'Two.']));
  assert.notEqual(a, E.slEpisodeKey(['One.', 'Three.']));
});
