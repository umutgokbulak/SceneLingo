// The level test: how many words of a language a learner knows, estimated from a few of each
// stretch of the list of the commonest words in film subtitles (freq/), each asked as its meaning
// out of four. Pure: tested in Node.

const SL_VOCAB_BAND = 2000; // the list in ten stretches of 2,000 words
const SL_VOCAB_BANDS = 10;
const SL_VOCAB_ASK = 4; // words asked from each stretch
const SL_VOCAB_DRAW = 14; // words drawn from each, of which those that make a fair question are kept

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

// The questions: in each stretch, the words whose meaning makes a fair question (not a name or a
// place, which comes back as it is or with a capital, nor a word that looks like its meaning),
// each with its meaning and three others from words near it in the list, in an order of their own.
// `meanings` is the translation of each drawn word, in the same order; `back`, if given, each
// meaning translated back, which must give the word again: a name read as a word ("custer",
// "müşteri", "customer") or a form translated wrongly does not.
function slVocabItems(bands, meanings, rand = Math.random, back = null) {
  let at = 0;
  const again = (word, b) => {
    const x = String(b || '').trim().toLowerCase().replace(/^(to|the|a|an|der|die|das|ein|eine|zu|sich) /, '');
    return x === word || (x.length >= 4 && word.startsWith(x.slice(0, 4))) || slAlike(word, x) >= 0.6;
  };
  const fair = bands.map((words) =>
    words
      .map((word) => ({ word, meaning: String(meanings[at] || '').trim(), back: back ? back[at++] : (at++, null) }))
      .filter(({ word, meaning, back: b }) => meaning && meaning === meaning.toLowerCase() && !/[0-9]/.test(meaning) && slAlike(word, meaning) < 0.6 && (!back || again(word, b)))
  );
  const items = [];
  fair.forEach((words, b) => {
    const asked = [];
    for (const w of words) if (asked.length < SL_VOCAB_ASK && !asked.some((a) => a.meaning === w.meaning)) asked.push(w);
    for (const w of asked) {
      // Others from this stretch and the ones beside it, so that they are about as common.
      const near = [...(fair[b - 1] || []), ...words, ...(fair[b + 1] || [])].map((x) => x.meaning).filter((m) => m !== w.meaning);
      const others = [...new Set(near)].map((m) => ({ m, k: rand() })).sort((x, y) => x.k - y.k).slice(0, 3).map((x) => x.m);
      if (others.length < 3) continue;
      const options = [w.meaning, ...others].map((m) => ({ m, k: rand() })).sort((x, y) => x.k - y.k).map((x) => x.m);
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
  module.exports = { SL_VOCAB_BAND, SL_VOCAB_BANDS, SL_VOCAB_ASK, SL_VOCAB_DRAW, slVocabDraw, slAlike, slVocabItems, slVocabScore, slVocabLevel, slVocabDone };
}
