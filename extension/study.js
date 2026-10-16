// How a saved item is studied: which kind of card it is shown as, how a typed answer is judged,
// which items come up today, and what the record of the days says. No DOM and no extension APIs,
// so it can be unit-tested with Node; used by the review page and the background.

// A word is first recognised (shown in English, its meaning recalled), then filled into the
// sentence it came from, then produced (shown its meaning, the English said or typed). Each step
// is harder and nearer to using the word; a miss steps back one.
const SL_STAGES = ['recognize', 'cloze', 'produce'];
const SL_STAGE_WINS = [1, 2]; // successes needed to leave stage 0 and stage 1

function slKindOf(item) {
  return item.kind || (/\s/.test(item.word) ? 'phrase' : 'word');
}

// The kind of card the item is shown as now. A word whose sentence does not contain it has no
// gap to fill; a sentence has no gap at all: both go from recognising straight to producing.
function slCardType(item) {
  const stage = Math.min(item.stage || 0, 2);
  if (stage === 0) return 'recognize';
  if (stage === 1 && slKindOf(item) !== 'sentence' && slClozeParts(item)) return 'cloze';
  return 'produce';
}

function slAdvance(item, grade) {
  let stage = item.stage || 0;
  let wins = item.stageWins || 0;
  if (grade === 'again') return { stage: Math.max(0, stage - 1), stageWins: 0 };
  wins += grade === 'easy' ? 2 : 1;
  if (stage < 2 && wins >= SL_STAGE_WINS[stage]) {
    stage += 1;
    wins = 0;
  }
  return { stage, stageWins: wins };
}

const slEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The sentence split around the item: { before, answer, after }, the answer as the sentence has
// it ("Ripped" at the start of a line). Null when the sentence does not contain it as a word.
function slClozeParts(item) {
  const context = item.context || '';
  for (const form of [item.word, item.contextPhrase].filter(Boolean)) {
    const m = new RegExp('(^|[^\\p{L}\\p{N}\'’])(' + slEscape(form) + ')(?=$|[^\\p{L}\\p{N}])', 'iu').exec(context);
    if (m) {
      const at = m.index + m[1].length;
      return { before: context.slice(0, at), answer: m[2], after: context.slice(at + m[2].length) };
    }
  }
  return null;
}

function slNormalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/[^\p{L}\p{N}' ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Edits between two words; two neighbouring letters swapped ("mihgt") count as one.
function slDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

// 'right', 'close' (a slip of the keyboard: one letter in a word of five or more, two in a long
// one) or 'wrong', against any of the accepted answers.
function slCheckAnswer(typed, accepted) {
  const t = slNormalize(typed);
  if (!t) return 'wrong';
  let best = 'wrong';
  for (const a of accepted.map(slNormalize).filter(Boolean)) {
    if (t === a || t.replace(/'/g, '') === a.replace(/'/g, '')) return 'right';
    const allowed = a.length >= 9 ? 2 : a.length >= 5 ? 1 : 0;
    if (allowed && slDistance(t, a) <= allowed) best = 'close';
  }
  return best;
}

// What counts as the answer: in a gap, the form the sentence has; when producing, the saved word,
// the phrase it belongs to, or the sentence's own form.
function slAccepted(item, type) {
  const gap = slClozeParts(item);
  if (type === 'cloze') return gap ? [gap.answer] : [item.word];
  return [item.word, item.contextPhrase, gap && gap.answer].filter(Boolean);
}

// For a sentence produced from its translation: the share of its words that were said, in order.
function slSentenceScore(expected, typed, match) {
  const want = slNormalize(expected).split(' ').filter(Boolean);
  const got = slNormalize(typed).split(' ').filter(Boolean);
  if (!want.length) return 0;
  const hit = match(want, got);
  return hit.filter(Boolean).length / want.length;
}

// ---- the days ----

function slDayKey(now) {
  const d = new Date(now);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

const slIsNew = (item) => !item.due && !item.reps && !item.lapses && !item.interval;

// Today's cards: everything due that has been studied before, and new ones up to the day's
// limit, less the new ones already begun today. The oldest due come first; new ones in the
// order they were saved.
function slTodayQueue(words, now, log, newPerDay) {
  const today = (log && log[slDayKey(now)]) || {};
  const room = Math.max(0, newPerDay - (today.newSeen || 0));
  const due = words.filter((w) => !slIsNew(w) && slIsDue(w, now)).sort((a, b) => (a.due || 0) - (b.due || 0));
  const fresh = words.filter(slIsNew).sort((a, b) => (a.added || 0) - (b.added || 0)).slice(0, room);
  return [...due, ...fresh];
}

// One more card done today.
function slLogged(log, now, { isNew, correct }) {
  const key = slDayKey(now);
  const day = { reviews: 0, correct: 0, newSeen: 0, ...(log[key] || {}) };
  day.reviews += 1;
  if (correct) day.correct += 1;
  if (isNew) day.newSeen += 1;
  const out = { ...log, [key]: day };
  // A year of days is plenty.
  const keys = Object.keys(out).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 370))) delete out[k];
  return out;
}

function slStats(words, log, now) {
  const learned = words.filter((w) => (w.interval || 0) >= 21).length;
  const fresh = words.filter(slIsNew).length;
  // Days in a row with some study, up to today (or up to yesterday, while today is still open).
  let streak = 0;
  let day = now;
  if (!(log[slDayKey(day)] || {}).reviews) day -= SL_DAY;
  while ((log[slDayKey(day)] || {}).reviews) {
    streak += 1;
    day -= SL_DAY;
  }
  let reviews = 0;
  let correct = 0;
  for (let i = 0; i < 30; i++) {
    const d = log[slDayKey(now - i * SL_DAY)];
    if (d) {
      reviews += d.reviews || 0;
      correct += d.correct || 0;
    }
  }
  return {
    total: words.length,
    learned,
    learning: words.length - learned - fresh,
    fresh,
    streak,
    retention: reviews ? Math.round((correct / reviews) * 100) : null,
    today: log[slDayKey(now)] || { reviews: 0, correct: 0, newSeen: 0 },
  };
}

// The number the toolbar icon shows: what today's queue holds.
function slDueCount(words, now, log, newPerDay) {
  return slTodayQueue(words, now, log, newPerDay).length;
}

// ---- cards ----

// Another sentence the item was met in: kept with the first one, at most five, none twice.
function slAddExample(item, example) {
  const text = String(example.text || '').trim();
  const seen = (s) => slNormalize(s) === slNormalize(text);
  if (!text || seen(item.context || '') || (item.examples || []).some((e) => seen(e.text))) return item;
  const examples = [...(item.examples || []), { ...example, text }].slice(-5);
  return { ...item, examples, seen: (item.seen || 0) + 1 };
}

// Two cards for one thing ("ripped" and "rip off"): the one studied further keeps its schedule,
// the other's sentences become examples.
function slMerge(keep, other) {
  const [lead, rest] = (other.interval || 0) > (keep.interval || 0) ? [{ ...other, word: keep.word, kind: keep.kind }, keep] : [keep, other];
  let out = { ...lead, translation: keep.translation || other.translation };
  for (const e of [{ text: rest.context, translation: rest.contextTranslation, title: rest.title }, ...(rest.examples || [])]) {
    out = slAddExample(out, e);
  }
  return out;
}

if (typeof module !== 'undefined') {
  module.exports = { SL_STAGES, slCardType, slAdvance, slClozeParts, slCheckAnswer, slAccepted, slSentenceScore, slDayKey, slIsNew, slTodayQueue, slLogged, slStats, slDueCount, slAddExample, slMerge, slNormalize };
}
