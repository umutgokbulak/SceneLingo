// The level test: how many words of a language a learner recognises, estimated from a few of each
// stretch of the list of the commonest words in film subtitles (freq/), each asked as its meaning
// out of four. Pure: tested in Node.

const SL_VOCAB_BAND = 2000; // the list in ten stretches of 2,000 words
const SL_VOCAB_BANDS = 10;
const SL_VOCAB_ASK = 6; // words asked from each stretch
const SL_VOCAB_DRAW = 20; // words drawn from each, of which those that make a fair question are kept

// Words drawn from each stretch, to be translated: letters only, not too short, and not in
// `other` (the English words of German subtitles: "okay", "sorry", "woody").
function slVocabDraw(list, rand = Math.random, other = null) {
  const bands = [];
  for (let b = 0; b < SL_VOCAB_BANDS; b++) {
    const pool = list.slice(b * SL_VOCAB_BAND, (b + 1) * SL_VOCAB_BAND).filter((w) => w.length >= 3 && /^\p{L}+$/u.test(w) && !(other && other.has(w)));
    const picked = new Set();
    while (picked.size < Math.min(SL_VOCAB_DRAW, pool.length)) picked.add(pool[Math.floor(rand() * pool.length)]);
    bands.push([...picked]);
  }
  return bands;
}

// How alike two words look, from 0 to 1 (1: the same): "chaos" and "kaos" are alike.
function slAlike(a, b) {
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (!a.length || !b.length) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

// The words of each stretch that make a fair question: not a name or a place, which comes back as
// it is or with a capital, nor a word that looks like its meaning. `meanings` is the translation
// of each drawn word, in the same order; `back`, if given, each meaning translated back, which
// must give the word again: a name read as a word ("custer", "müşteri", "customer") or a form
// translated wrongly does not. Of each stretch, the first SL_VOCAB_ASK with meanings of their own.
function slVocabFair(bands, meanings, back = null) {
  let at = 0;
  const again = (word, b) => {
    const x = String(b || '').trim().toLowerCase().replace(/^(to|the|a|an|i|der|die|das|ein|eine|zu|sich|ich) /, '');
    return x === word || slAlike(word, x) >= 0.8 || (x.length >= 4 && (word.startsWith(x) || x.startsWith(word)));
  };
  return bands.map((words) => {
    const fair = words
      .map((word) => ({ word, meaning: String(meanings[at] || '').trim(), back: back ? back[at++] : (at++, null) }))
      .filter(({ word, meaning, back: b }) => slFairMeaning(word, meaning) && (!back || again(word, b)));
    const asked = [];
    for (const w of fair) if (asked.length < SL_VOCAB_ASK && !asked.some((a) => a.meaning === w.meaning)) asked.push({ word: w.word, meaning: w.meaning });
    return asked;
  });
}
const slFairMeaning = (word, meaning) => !!meaning && meaning === meaning.toLowerCase() && !/[0-9]/.test(meaning) && slAlike(word, meaning) < 0.6;

// A word without its ending, roughly: "includes", "included" and "including" are one word, whose
// meanings would all be right; "infant" and "infantry" are two.
function slStem(word) {
  let w = word.toLowerCase();
  const end = ['ings', 'ing', 'ies', 'ied', 'est', 'es', 'ed', 'er', 'ly', 'en', 'st', 'te', 's', 'd', 'y', 'e', 'n', 't'].find((x) => w.endsWith(x) && w.length - x.length >= 3);
  if (end) w = w.slice(0, -end.length);
  return w.replace(/e$/, '');
}

// Words of the list that look like `word` ("infantry": "infant", "industry"), whose meanings make
// the wrong options: someone who only half knows the word is caught by them, as in the tests made
// by people. The same first letter, about as long, the most alike first.
function slVocabLookalikes(word, list, n = 4) {
  const stem = slStem(word);
  return list
    .filter((w) => w !== word && w[0] === word[0] && Math.abs(w.length - word.length) <= 2 && w.length >= 3 && slStem(w) !== stem)
    .map((w) => ({ w, a: slAlike(word, w) }))
    .filter((x) => x.a >= 0.4)
    .sort((x, y) => y.a - x.a)
    .slice(0, n)
    .map((x) => x.w);
}

// The questions: each word with its meaning and three others, in an order of their own. The others
// are first the meanings of words that look like it (`looks`: word -> [meaning, ...]), none like
// its own meaning (another form of the same word); then meanings of words near it in the list.
function slVocabItems(fair, rand = Math.random, looks = new Map()) {
  const items = [];
  const mixed = (list) => list.map((m) => ({ m, k: rand() })).sort((x, y) => x.k - y.k).map((x) => x.m);
  fair.forEach((words, b) => {
    for (const w of words) {
      const unlike = (m) => m && m !== w.meaning && slAlike(m, w.meaning) < 0.5 && !(m.length >= 4 && w.meaning.startsWith(m.slice(0, 4)));
      const others = [];
      for (const m of looks.get(w.word) || []) if (others.length < 3 && unlike(m) && !others.includes(m)) others.push(m);
      const near = mixed([...(fair[b - 1] || []), ...words, ...(fair[b + 1] || [])].map((x) => x.meaning));
      for (const m of near) if (others.length < 3 && unlike(m) && !others.includes(m)) others.push(m);
      if (others.length < 3) continue;
      const options = mixed([w.meaning, ...others]);
      items.push({ band: b, word: w.word, meaning: w.meaning, options, answer: options.indexOf(w.meaning) });
    }
  });
  return items;
}

// The estimate. In each stretch, the share known: right answers, less what guessing alone would
// have got right (one in three of the wrong ones; "I don't know" is no guess). A stretch not
// asked, after two in a row with nothing known, counts as not known.
// `answers[i]`: the option chosen for items[i], or -1 for "I don't know".
function slVocabScore(items, answers) {
  const bands = Array.from({ length: SL_VOCAB_BANDS }, () => ({ asked: 0, right: 0, wrong: 0 }));
  items.forEach((item, i) => {
    if (answers[i] === undefined) return;
    const b = bands[item.band];
    b.asked += 1;
    if (answers[i] === item.answer) b.right += 1;
    else if (answers[i] >= 0) b.wrong += 1;
  });
  const shares = bands.map((b) => (b.asked ? Math.max(0, Math.min(1, (b.right - b.wrong / 3) / b.asked)) : 0));
  const size = Math.round(shares.reduce((a, s) => a + s * SL_VOCAB_BAND, 0) / 100) * 100;
  return { size, level: slVocabLevel(size), shares: shares.map((s) => Math.round(s * 100) / 100) };
}

// The level the size makes, by the same measure as an episode's words (SL_LEVEL_RANK in
// episode.js): how far down the list a learner at each level knows.
function slVocabLevel(size) {
  return size >= 12000 ? 'C1' : size >= 6000 ? 'B2' : size >= 3000 ? 'B1' : size >= 1500 ? 'A2' : 'A1';
}

// Whether the test can stop early: the last two stretches asked had nothing known.
function slVocabDone(items, answers, next) {
  if (next >= items.length) return true;
  const band = items[next].band;
  if (band < 2 || items[next - 1].band === band) return false;
  const known = (b) => items.some((it, i) => it.band === b && answers[i] === it.answer);
  return !known(band - 1) && !known(band - 2);
}

if (typeof module !== 'undefined') {
  module.exports = { SL_VOCAB_BAND, SL_VOCAB_BANDS, SL_VOCAB_ASK, SL_VOCAB_DRAW, slVocabDraw, slAlike, slVocabFair, slVocabLookalikes, slVocabItems, slVocabScore, slVocabLevel, slVocabDone };
}
