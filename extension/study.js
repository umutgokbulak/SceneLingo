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

// A subtitle line as a sentence to read: without the notes for the hard of hearing ("[Grace]",
// "(sighs)", "♪") and the dash that marks a new speaker. A line that is nothing but a note stays.
function slCleanLine(text) {
  const raw = String(text || '');
  const clean = raw
    .replace(/\[[^\]]*\]|\([^)]*\)|♪+/g, ' ')
    .replace(/^\s*[-–—]\s*/, '')
    .replace(/\s+([,.!?;:…])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return /\p{L}/u.test(clean) ? clean : raw.trim();
}

// A hint for a typed answer: its first `shown` letters, the rest as gaps, spaces and
// apostrophes kept so that the shape of the answer shows ("go through" -> "g_ _______").
function slHintMask(answer, shown) {
  let left = shown;
  return [...String(answer || '')]
    .map((ch) => {
      if (!/[\p{L}\p{N}]/u.test(ch)) return ch;
      if (left > 0) {
        left -= 1;
        return ch;
      }
      return '_';
    })
    .join('');
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

// ---- backups ----

// Everything learnt, in one file: the cards with their schedules, sentences and scenes, the
// record of the days, and which cards were deleted when (so that a copy elsewhere does not bring
// them back). Not the Gemini key: that stays in the browser it was given to.
function slBackup(words, log, now, version, deleted) {
  return { app: 'SceneLingo', kind: 'backup', version: version || '', exported: new Date(now).toISOString(), words, reviewLog: log, deleted: deleted || {} };
}

// When a card last changed: saved, studied or edited.
function slStamp(w) {
  return Math.max(w.updated || 0, w.last || 0, w.added || 0);
}

// Two copies of everything made one, as when this browser meets its copy in the cloud, or a
// backup file: a card in both keeps the copy changed last; a card deleted on one side after it
// last changed on the other stays deleted; the days' records keep the larger counts. Deletions
// older than half a year are forgotten. `added` and `updated` count what the second copy brought.
function slMergeAll(here, there, now) {
  const key = (w) => String(w.word || '').toLowerCase();
  const deleted = { ...(here.deleted || {}) };
  for (const [k, t] of Object.entries(there.deleted || {})) deleted[k] = Math.max(deleted[k] || 0, t);
  for (const k of Object.keys(deleted)) if (now && now - deleted[k] > 183 * 86400000) delete deleted[k];
  const byKey = new Map();
  for (const w of here.words || []) if (w && w.word) byKey.set(key(w), w);
  let added = 0;
  let updated = 0;
  for (const w of there.words || []) {
    if (!w || !w.word) continue;
    const mine = byKey.get(key(w));
    if (!mine) {
      byKey.set(key(w), w);
      added += 1;
    } else if (slStamp(w) > slStamp(mine)) {
      byKey.set(key(w), w);
      updated += 1;
    }
  }
  for (const [k, w] of byKey) {
    if (deleted[k] && deleted[k] >= slStamp(w)) {
      byKey.delete(k);
    } else if (deleted[k]) delete deleted[k]; // saved again after it was deleted
  }
  const reviewLog = { ...(here.reviewLog || {}) };
  for (const [day, d] of Object.entries(there.reviewLog || {})) {
    const h = reviewLog[day] || {};
    reviewLog[day] = {
      reviews: Math.max(h.reviews || 0, d.reviews || 0),
      correct: Math.max(h.correct || 0, d.correct || 0),
      newSeen: Math.max(h.newSeen || 0, d.newSeen || 0),
    };
  }
  return { words: [...byKey.values()], reviewLog, deleted, added, updated };
}

// A backup read back in, merged with what is here. Restoring is asked for: a card in the file
// that was deleted here comes back (and counts as changed now, so that a sync keeps it).
function slRestore(words, log, data, deleted) {
  if (!data || data.app !== 'SceneLingo' || !Array.isArray(data.words)) throw new Error('not a SceneLingo backup');
  const now = Date.now();
  const gone = { ...(deleted || {}) };
  const fileGone = data.deleted || {};
  const back = data.words.map((w) => {
    const k = String((w && w.word) || '').toLowerCase();
    if (!gone[k] || fileGone[k]) return w;
    delete gone[k];
    return { ...w, updated: now };
  });
  const r = slMergeAll({ words, reviewLog: log, deleted: gone }, { ...data, words: back }, now);
  return { words: r.words, log: r.reviewLog, deleted: r.deleted, added: r.added, updated: r.updated };
}

// The word list an earlier version saved as CSV ("Download CSV"), read back as cards: the word,
// its translation, pronunciation, definition, sentence, language, source and date. What the
// cards had learnt is not in it, so they start anew.
function slFromCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ';' || ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  const now = Date.now();
  return rows
    .slice(1)
    .filter((r) => r[0] && r[0].trim())
    .map((r, i) => {
      const word = r[0].trim();
      const added = Date.parse(r[7] || '') || now - i;
      return {
        word,
        kind: /[.!?]$/.test(word) || word.split(/\s+/).length > 5 ? 'sentence' : /\s/.test(word) ? 'phrase' : 'word',
        translation: (r[1] || '').trim(),
        ipa: (r[2] || '').trim(),
        definition: (r[3] || '').trim(),
        context: (r[4] || '').trim(),
        lang: (r[5] || '').trim() || 'en',
        title: (r[6] || '').trim(),
        added,
      };
    });
}

// Where a card stands: new, being learnt, learnt (three weeks apart or more), or hard (missed
// three times or more), for the list of all cards.
function slStatus(item) {
  if (slIsNew(item)) return 'new';
  if ((item.lapses || 0) >= 3 && (item.interval || 0) < 21) return 'hard';
  return (item.interval || 0) >= 21 ? 'learned' : 'learning';
}

if (typeof module !== 'undefined') {
  module.exports = { SL_STAGES, slFromCsv, slBackup, slStamp, slMergeAll, slRestore, slStatus, slCleanLine, slHintMask, slCardType, slAdvance, slClozeParts, slCheckAnswer, slAccepted, slSentenceScore, slDayKey, slIsNew, slTodayQueue, slLogged, slStats, slDueCount, slAddExample, slMerge, slNormalize };
}
