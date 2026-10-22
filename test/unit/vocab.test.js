const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const V = require('../../extension/vocab.js');

const list = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'freq', 'en.txt'), 'utf8').split('\n').map((w) => w.trim()).filter(Boolean);
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

test('words are drawn from each of the ten stretches of the list', () => {
  const bands = V.slVocabDraw(list, rand);
  assert.equal(bands.length, 10);
  bands.forEach((words, b) => {
    assert.equal(words.length, V.SL_VOCAB_DRAW);
    for (const w of words) {
      const rank = list.indexOf(w);
      assert.ok(rank >= b * 2000 && rank < (b + 1) * 2000, w + ' in stretch ' + b);
      assert.ok(w.length >= 3);
    }
  });
});

test('a fair question: not a name or a place, nor a word that looks like its meaning', () => {
  assert.ok(V.slAlike('chaos', 'kaos') >= 0.6);
  assert.ok(V.slAlike('umbrella', 'şemsiye') < 0.3);
  const bands = [['taylor', 'mexico', 'chaos', 'house', 'tree', 'water', 'dog', 'cat', 'sun', 'moon'], ['umbrella', 'spoon', 'bridge', 'cloud', 'river', 'stone', 'bread']];
  const meanings = ['taylor', 'Meksika', 'kaos', 'ev', 'ağaç', 'su', 'köpek', 'kedi', 'güneş', 'ay', 'şemsiye', 'kaşık', 'köprü', 'bulut', 'nehir', 'taş', 'ekmek'];
  const fair = V.slVocabFair(bands, meanings);
  assert.deepEqual(fair[0].map((w) => w.word), ['house', 'tree', 'water', 'dog', 'cat', 'sun'], 'six of the fair ones');
  // a name read as a word does not come back from its meaning
  assert.ok(V.slVocabFair([['custer']], ['müşteri'], ['customer'])[0].length === 0, '"custer" is not "customer"');
  const items = V.slVocabItems(fair, rand);
  for (const item of items) {
    assert.equal(item.options.length, 4);
    assert.equal(new Set(item.options).size, 4);
    assert.equal(item.options[item.answer], item.meaning);
  }
});

test('the wrong options: the meanings of words that look like it, but not of another form of it', () => {
  assert.deepEqual(V.slVocabLookalikes('infantry', ['infant', 'industry', 'apple', 'infantry', 'inventory', 'i']).slice(0, 2), ['infant', 'inventory']);
  assert.deepEqual(V.slVocabLookalikes('includes', ['included', 'including', 'include', 'intrudes']), ['intrudes'], 'not its own other forms');
  const fair = [[{ word: 'infantry', meaning: 'piyade' }, { word: 'tree', meaning: 'ağaç' }, { word: 'water', meaning: 'su' }, { word: 'dog', meaning: 'köpek' }]];
  const looks = new Map([['infantry', ['bebek', 'piyadeler', 'endüstri', 'envanter']]]);
  const item = V.slVocabItems(fair, rand, looks).find((i) => i.word === 'infantry');
  assert.deepEqual([...item.options].sort(), ['bebek', 'endüstri', 'envanter', 'piyade'], 'look-alikes first; "piyadeler" is the same word');
});

test('the estimate: the share known in each stretch, less what guessing would get, and its level', () => {
  const items = [];
  for (let b = 0; b < 10; b++) for (let k = 0; k < 4; k++) items.push({ band: b, answer: 0 });
  // all known up to 6,000; half of the next; then "I don't know"
  const answers = items.map((it) => (it.band < 3 ? 0 : it.band === 3 ? (items.indexOf(it) % 2 ? 0 : -1) : -1));
  const s = V.slVocabScore(items, answers);
  assert.equal(s.size, 7000);
  assert.equal(s.level, 'B2');
  assert.deepEqual(s.shares.slice(0, 5), [1, 1, 1, 0.5, 0]);
  // guessing: two right and two wrong out of four is not half known
  const guessed = V.slVocabScore(items.slice(0, 4), [0, 0, 1, 2]);
  assert.equal(guessed.shares[0], 0.33);
  assert.equal(V.slVocabLevel(1400), 'A1');
  assert.equal(V.slVocabLevel(2500), 'A2');
  assert.equal(V.slVocabLevel(12000), 'C1');
});

test('the test stops once two stretches in a row had nothing known', () => {
  const items = [];
  for (let b = 0; b < 10; b++) for (let k = 0; k < 2; k++) items.push({ band: b, answer: 0 });
  const answers = [0, 0, 0, -1, -1, -1, 1, -1]; // stretches 0 and 1 known, 2 and 3 not
  assert.equal(V.slVocabDone(items, answers, 7), false, 'still in the middle of stretch 3');
  assert.equal(V.slVocabDone(items, answers, 8), true);
  assert.equal(V.slVocabDone(items, [0, 0, 0, 0, -1, -1, 0, 0], 8), false, 'something known in the last one');
});
