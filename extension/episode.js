// An episode's (or a film's) own words: the ones in its subtitles that a learner at a level is not
// likely to know yet, found by how common each word is in film subtitles in general (the lists in
// freq/). Pure: tested in Node.

// How far down the list of the commonest words a learner at each level is taken to know.
const SL_LEVEL_RANK = { A2: 1500, B1: 3000, B2: 6000, C1: 12000 };

// Sounds rather than words: "hah", "hmm", "ugh", and anything drawn out ("nooo", "aaah").
const SL_SOUND = /^(?:a+h+|a+w+|h+a+h*|h+e+h+|h+u+h+|h+m+|u+h+|u+m+|o+h+|o+o+h+|s+h+|p+s+t+|e+h+|w+h*o+a+|y+a+y+|u+g+h+|a+r+g+h+|p+f+t+|m+h*m+|o+w+)$|(\p{L})\1\1/u;

// The words of the lines: how often each comes, the line it comes in first, and how it is
// written. A word written with a capital where no sentence begins, and never without one, is a
// name; in German every noun is written so, and there only a word the list does not know counts.
function slEpisodeTokens(lines) {
  const out = new Map();
  const word = /\p{L}+(?:['’]\p{L}+)*/gu;
  lines.forEach((line, i) => {
    const text = slCleanLine(String(line || '')).replace(/\s+/g, ' ');
    const shouting = text === text.toUpperCase() && /\p{Lu}{2}/u.test(text);
    for (const m of text.matchAll(word)) {
      const raw = m[0].replace(/’/g, "'");
      const key = raw.toLowerCase();
      if (key.length < 3 || SL_SOUND.test(key)) continue;
      let t = out.get(key);
      if (!t) out.set(key, (t = { word: key, count: 0, first: i, capitalMid: 0, lower: 0 }));
      t.count += 1;
      if (shouting) continue; // a line in capitals says nothing of how its words are written
      const startsSentence = /(^|[.!?…:;"“(\[♪–—-])\s*$/u.test(text.slice(0, m.index));
      if (raw[0] !== raw[0].toLowerCase()) {
        if (!startsSentence) t.capitalMid += 1;
      } else t.lower += 1;
    }
  });
  return out;
}

// The words to learn before (or while) watching: not among the commonest `SL_LEVEL_RANK[level]`
// words of the language, not names, not saved already (`known`, in lower case); the ones that
// come most often first, and of those the commoner ones, which are the more useful.
function slEpisodeWords({ lines, ranks, lang, level, known, max = 30 }) {
  const limit = SL_LEVEL_RANK[level] || SL_LEVEL_RANK.B1;
  const out = [];
  for (const t of slEpisodeTokens(lines).values()) {
    if (known && known.has(t.word)) continue;
    // The lists count "don't" as "don" and "t": a word with an apostrophe is as common as its first part.
    const rank = ranks.get(t.word.split("'")[0]);
    const name = t.capitalMid > 0 && t.lower === 0 && (lang !== 'de' || rank === undefined);
    if (name || (rank !== undefined && rank <= limit)) continue;
    out.push({ word: t.word, count: t.count, first: t.first, rank: rank === undefined ? null : rank });
  }
  const order = (r) => (r === null ? Infinity : r);
  return out.sort((a, b) => b.count - a.count || order(a.rank) - order(b.rank)).slice(0, max);
}

// A list of the commonest words, one a line, as word -> rank (1 for the commonest).
function slRanks(text) {
  const ranks = new Map();
  String(text || '')
    .split('\n')
    .forEach((w, i) => {
      const word = w.trim();
      if (word && !ranks.has(word)) ranks.set(word, i + 1);
    });
  return ranks;
}

// The same episode, met again, is known by its lines: a short fingerprint of them.
function slEpisodeKey(lines) {
  let h = 5381;
  const text = lines.slice(0, 300).join('\n');
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36) + '-' + lines.length;
}

if (typeof module !== 'undefined') module.exports = { SL_LEVEL_RANK, slEpisodeTokens, slEpisodeWords, slRanks, slEpisodeKey };
