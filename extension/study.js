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

// The forms a written word may be of: itself, and what it is without an ending ("negotiated",
// "negotiate"; "stopping", "stop"; "studies", "study"; "went", "go"), so that a saved word is known
// in all its forms. Rough on purpose: a form that is no word does no harm, it only matches nothing.
const SL_IRREGULAR = Object.fromEntries(
  ('went go,gone go,saw see,seen see,came come,took take,taken take,gave give,given give,got get,gotten get,made make,' +
    'said say,told tell,thought think,brought bring,bought buy,caught catch,taught teach,found find,felt feel,kept keep,' +
    'left leave,lost lose,meant mean,met meet,paid pay,sent send,spent spend,stood stand,understood understand,won win,' +
    'wrote write,written write,broke break,broken break,chose choose,chosen choose,drove drive,driven drive,ate eat,eaten eat,' +
    'fell fall,fallen fall,forgot forget,forgotten forget,froze freeze,frozen freeze,hid hide,hidden hide,knew know,known know,' +
    'ran run,rang ring,rung ring,rose rise,risen rise,sang sing,sung sing,spoke speak,spoken speak,stole steal,stolen steal,' +
    'swam swim,threw throw,thrown throw,woke wake,woken wake,wore wear,worn wear,began begin,begun begin,became become,' +
    'built build,held hold,led lead,heard hear,slept sleep,sold sell,shot shoot,sat sit,fought fight,flew fly,flown fly,' +
    'drew draw,drawn draw,drank drink,drunk drink,grew grow,grown grow,blew blow,blown blow,dealt deal,dug dig,fed feed,' +
    'fled flee,forgave forgive,forgiven forgive,hung hang,laid lay,lay lie,lit light,shook shake,shaken shake,sank sink,' +
    'slid slide,stuck stick,struck strike,swore swear,sworn swear,tore tear,torn tear,wept weep,wound wind,men man,women woman,' +
    'children child,people person,feet foot,teeth tooth,mice mouse,better good,best good,worse bad,worst bad')
    .split(',')
    .map((p) => p.split(' '))
);
function slForms(word, lang = 'en') {
  const w = String(word || '').toLowerCase().replace(/[’`]/g, "'").replace(/'s$/, '');
  const out = new Set([w]);
  const add = (x) => x.length >= 3 && out.add(x);
  if (lang === 'de') {
    for (const end of ['en', 'em', 'er', 'es', 'est', 'et', 'ten', 'te', 'st', 'e', 'n', 's', 't']) if (w.endsWith(end)) add(w.slice(0, -end.length));
    return [...out];
  }
  if (lang !== 'en') return [...out];
  if (SL_IRREGULAR[w]) out.add(SL_IRREGULAR[w]);
  const doubled = (stem) => stem.length >= 3 && stem[stem.length - 1] === stem[stem.length - 2] && !/[aeiou]/.test(stem[stem.length - 1]);
  if (/ies$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/ied$/.test(w)) add(w.slice(0, -3) + 'y');
  if (/(s|x|z|ch|sh|o)es$/.test(w)) add(w.slice(0, -2));
  if (/[^s]s$/.test(w)) add(w.slice(0, -1));
  for (const end of ['ed', 'ing', 'er', 'est']) {
    if (!w.endsWith(end)) continue;
    const stem = w.slice(0, -end.length);
    add(stem);
    add(stem + 'e');
    if (doubled(stem)) add(stem.slice(0, -1));
    if (/i$/.test(stem) && end !== 'ing') add(stem.slice(0, -1) + 'y');
  }
  return [...out];
}

// The saved word (in lower case) a word of a line is a form of, or ''.
function slSavedForm(word, saved, lang) {
  for (const f of slForms(word, lang)) if (saved.has(f)) return f;
  return '';
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
  return slYear({ ...log, [key]: day });
}

// A year of days is plenty.
function slYear(log) {
  const keys = Object.keys(log).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 370))) delete log[k];
  return log;
}

// The other practice, in the same record of days: a sentence listened to (`listen`, with how much
// of it was heard, 0-100), a spoken answer or conversation (`speak`), a text written (`write`), a
// text read and its questions answered (`read`, with the share answered right, 0-100).
function slLogActivity(log, now, kind, score) {
  const key = slDayKey(now);
  const day = { ...(log[key] || {}) };
  day[kind] = (day[kind] || 0) + 1;
  if (score != null) day[kind + 'Score'] = (day[kind + 'Score'] || 0) + score;
  return slYear({ ...log, [key]: day });
}

// The next time the clock shows `hhmm` ("20:00"): later today, or else tomorrow.
function slNextAt(now, hhmm) {
  const [h, m] = String(hhmm || '20:00').split(':').map(Number);
  const at = new Date(now);
  at.setHours(h || 0, m || 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

// A day with any study in it.
const slActive = (day) => !!(day && (day.reviews || day.listen || day.speak || day.write || day.read || day.quiz || day.level));

// What a day asks for, every day: the cards that are due, some sentences listened to, and some
// conversations or spoken answers; and, in the week, some texts written and some read. How many
// is the user's to choose (`goals`); a goal of 0 leaves its step out. `next` is the first step
// not yet done: the day's before the week's.
const SL_PLAN = { listen: 5, speak: 1, write: 2, read: 2 };
const slGoals = (settings) => {
  const goal = (key, kind) => (settings && settings[key] != null ? +settings[key] : SL_PLAN[kind]);
  return { listen: goal('goalListen', 'listen'), speak: goal('goalSpeak', 'speak'), write: goal('goalWrite', 'write'), read: goal('goalRead', 'read') };
};
function slTodayPlan(words, log, now, newPerDay, goals = SL_PLAN) {
  const today = log[slDayKey(now)] || {};
  const due = slDueCount(words, now, log, newPerDay);
  const inWeek = (kind) => {
    let n = 0;
    for (let i = 0; i < 7; i++) n += (log[slDayKey(now - i * SL_DAY)] || {})[kind] || 0;
    return n;
  };
  const step = (id, have, goal) => ({ id, have, goal, done: have >= goal });
  const steps = [{ id: 'review', have: today.reviews || 0, left: due, done: due === 0 }];
  if (goals.listen > 0) steps.push(step('listen', today.listen || 0, goals.listen));
  if (goals.speak > 0) steps.push(step('speak', today.speak || 0, goals.speak));
  const week = ['write', 'read'].filter((k) => goals[k] > 0).map((k) => step(k, inWeek(k), goals[k]));
  const next = steps.find((s) => !s.done) || week.find((s) => !s.done);
  return { steps, week, next: next ? next.id : null, done: steps.every((s) => s.done) };
}

// The last seven days, oldest first, and what was done in them.
function slWeek(words, log, now) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const t = now - i * SL_DAY;
    days.push({ key: slDayKey(t), at: t, ...(log[slDayKey(t)] || {}) });
  }
  const sum = (k) => days.reduce((a, d) => a + (d[k] || 0), 0);
  const listened = sum('listen');
  const since = now - 7 * SL_DAY;
  return {
    days,
    active: days.filter(slActive).length,
    reviews: sum('reviews'),
    retention: sum('reviews') ? Math.round((sum('correct') / sum('reviews')) * 100) : null,
    started: sum('newSeen'),
    saved: words.filter((w) => (w.added || 0) >= since).length,
    listened,
    heard: listened ? Math.round(sum('listenScore') / listened) : null,
    spoken: sum('speak'),
    written: sum('write'),
    read: sum('read'),
    understood: sum('read') ? Math.round(sum('readScore') / sum('read')) : null,
  };
}

function slStats(words, log, now) {
  const learned = words.filter((w) => (w.interval || 0) >= 21).length;
  const fresh = words.filter(slIsNew).length;
  // Days in a row with some study, up to today (or up to yesterday, while today is still open).
  let streak = 0;
  let day = now;
  if (!slActive(log[slDayKey(day)])) day -= SL_DAY;
  while (slActive(log[slDayKey(day)])) {
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
function slBackup(words, log, now, version, deleted, records) {
  const r = records || {};
  return {
    app: 'SceneLingo',
    kind: 'backup',
    version: version || '',
    exported: new Date(now).toISOString(),
    words,
    reviewLog: log,
    deleted: deleted || {},
    ...slNoRecords(),
    ...Object.fromEntries(SL_RECORDS.filter((k) => r[k]).map((k) => [k, r[k]])),
  };
}

// The practice kept beside the cards: the scores of spoken answers, written texts and reading
// tests (lists of { at, ... }, the latest hundred), and until when each sentence of the listening
// practice rests. They go into backups and to the cloud with the cards.
const SL_RECORDS = ['speakLog', 'writeLog', 'readLog', 'levelLog', 'listenRest'];
const SL_LOG_KEPT = 100;
const slNoRecords = () => ({ speakLog: [], writeLog: [], readLog: [], levelLog: [], listenRest: {} });
function slMergeRecords(here, there, now) {
  const logOf = (a, b) => {
    const byTime = new Map();
    for (const r of [...(a || []), ...(b || [])]) if (r && r.at) byTime.set(r.at + '|' + (r.part || r.task || ''), r);
    return [...byTime.values()].sort((x, y) => x.at - y.at).slice(-SL_LOG_KEPT);
  };
  const rest = { ...(here.listenRest || {}) };
  for (const [k, until] of Object.entries(there.listenRest || {})) rest[k] = Math.max(rest[k] || 0, until);
  for (const k of Object.keys(rest)) if (now && rest[k] < now) delete rest[k];
  return { speakLog: logOf(here.speakLog, there.speakLog), writeLog: logOf(here.writeLog, there.writeLog), readLog: logOf(here.readLog, there.readLog), levelLog: logOf(here.levelLog, there.levelLog), listenRest: rest };
}

// When a card last changed: saved, studied or edited.
function slStamp(w) {
  return Math.max(w.updated || 0, w.last || 0, w.added || 0);
}

// Two copies of one card made one, field by field: the word and its meaning as edited last; how
// far it has been learnt from the copy studied last; and what is known about it (its sentence's
// meaning, examples, pronunciation, level...) from whichever copy has it. So a card enriched on
// the phone and studied on the computer keeps both.
// The same data whatever order its fields were written in.
function slCanon(v) {
  return JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => ((o[key] = x[key]), o), {}) : x));
}

const SL_PROGRESS = ['due', 'interval', 'ease', 'reps', 'lapses', 'stage', 'stageWins', 'last'];
const SL_EDITED = ['word', 'kind', 'translation', 'updated'];

function slMergeCard(a, b) {
  const filled = (v) => v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length);
  const byEdit = (b.updated || 0) > (a.updated || 0) ? b : a;
  const byStudy = (b.last || 0) > (a.last || 0) ? b : a;
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) if (!filled(out[k]) && filled(v)) out[k] = v;
  for (const k of SL_EDITED) if (k in byEdit) out[k] = byEdit[k];
  for (const k of SL_PROGRESS) {
    if (k in byStudy) out[k] = byStudy[k];
    else delete out[k];
  }
  // Of what a card has learnt about itself, the fuller copy; of sentences met again, all of them.
  if (((b.enriched || 0) > (a.enriched || 0) && b.extra) || (!a.extra && b.extra)) out.extra = b.extra;
  out.enriched = Math.max(+a.enriched || 0, +b.enriched || 0) || a.enriched || b.enriched;
  if (b.senseEngine === 'gemini' && a.senseEngine !== 'gemini') {
    for (const k of ['contextMeaning', 'contextPhrase', 'contextNote', 'senseEngine']) out[k] = b[k];
  }
  let merged = { ...out, examples: a.examples || [] };
  for (const e of b.examples || []) merged = slAddExample(merged, e);
  if (!merged.examples.length) delete merged.examples;
  merged.seen = Math.max(a.seen || 0, b.seen || 0) || undefined;
  if (merged.seen === undefined) delete merged.seen;
  const mine = [...(a.mine || []), ...(b.mine || [])].filter((m, i, all) => all.findIndex((x) => x.text === m.text) === i).slice(-3);
  if (mine.length) merged.mine = mine;
  return merged;
}

// Two copies of everything made one, as when this browser meets its copy in the cloud, or a
// backup file: a card in both keeps the copy changed last; a card deleted on one side after it
// last changed on the other stays deleted; the days' records keep the larger counts; the scores of
// the practice are put together. Deletions older than half a year are forgotten. `added` and
// `updated` count what the second copy brought.
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
    } else {
      const both = slMergeCard(mine, w);
      if (slCanon(both) !== slCanon(mine)) {
        byKey.set(key(w), both);
        updated += 1;
      }
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
    // Each count, as the copy that has more of it says (the same day studied on two devices is
    // counted as the larger of the two).
    reviewLog[day] = { ...h };
    for (const [k, v] of Object.entries(d)) if (typeof v === 'number') reviewLog[day][k] = Math.max(h[k] || 0, v);
  }
  return { words: [...byKey.values()], reviewLog, deleted, added, updated, ...slMergeRecords(here, there, now) };
}

// A backup read back in, merged with what is here. Restoring is asked for: a card in the file
// that was deleted here comes back (and counts as changed now, so that a sync keeps it).
function slRestore(words, log, data, deleted, records) {
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
  const r = slMergeAll({ ...(records || {}), words, reviewLog: log, deleted: gone }, { ...data, words: back }, now);
  const kept = Object.fromEntries(SL_RECORDS.map((k) => [k, r[k]]));
  return { words: r.words, log: r.reviewLog, deleted: r.deleted, added: r.added, updated: r.updated, ...kept };
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

// Dictation: the sentence that was read, word by word against what was typed. Each of its words is
// 'right', 'close' (heard, but spelt a letter or two off), 'wrong' (another word typed in its place)
// or 'missed'; a typed word with nothing in its place is 'extra'. A close word counts half, an extra
// word against.
function slDictation(expected, typed) {
  const tokens = (text) =>
    (String(text || '').match(/\S+/g) || []).map((shown) => ({ shown, norm: slNormalize(shown).replace(/[' ]/g, '') })).filter((t) => t.norm);
  const want = tokens(expected);
  const got = tokens(typed);
  const n = want.length;
  const m = got.length;
  const value = (a, b) => {
    if (a === b) return 2;
    const allowed = a.length >= 9 ? 2 : a.length >= 5 ? 1 : 0;
    return allowed && slDistance(a, b) <= allowed ? 1 : 0;
  };
  // The best match of the two, a right word worth more than a close one.
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const v = value(want[i].norm, got[j].norm);
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], v ? v + best[i + 1][j + 1] : 0);
    }
  }
  const parts = [];
  // Between two matched words: the sentence's words paired with what was typed instead.
  const gap = (i0, i1, j0, j1) => {
    for (let k = 0; k < Math.max(i1 - i0, j1 - j0); k++) {
      if (i0 + k < i1 && j0 + k < j1) parts.push({ word: want[i0 + k].shown, state: 'wrong', typed: got[j0 + k].shown });
      else if (i0 + k < i1) parts.push({ word: want[i0 + k].shown, state: 'missed' });
      else parts.push({ word: got[j0 + k].shown, state: 'extra' });
    }
  };
  let i = 0;
  let j = 0;
  let pi = 0;
  let pj = 0;
  while (i < n && j < m) {
    const v = value(want[i].norm, got[j].norm);
    if (v && best[i][j] === v + best[i + 1][j + 1]) {
      gap(pi, i, pj, j);
      parts.push(v === 2 ? { word: want[i].shown, state: 'right' } : { word: want[i].shown, state: 'close', typed: got[j].shown });
      pi = ++i;
      pj = ++j;
    } else if (best[i + 1][j] >= best[i][j + 1]) i++;
    else j++;
  }
  gap(pi, n, pj, m);
  const count = (state) => parts.filter((p) => p.state === state).length;
  const score = n ? (count('right') + count('close') / 2) / (n + count('extra')) : 0;
  return { parts, score };
}

// The sentences to listen to, in the language being learnt: the saved sentences, and the ones the
// saved words were saved from and met again in. First those not resting (`rest`: sentence -> until
// when), then those of words still being learnt; in a random order otherwise.
function slDictationPool(words, lang, rest, now, size, rand = Math.random) {
  const all = new Map();
  const add = (text, translation, item, extra) => {
    const clean = slCleanLine(text || '');
    const count = clean.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const key = slNormalize(clean);
    if (count < 3 || count > 30 || all.has(key)) return;
    all.set(key, {
      key,
      text: clean,
      translation: translation ? slCleanLine(translation) : '',
      word: slKindOf(item) === 'sentence' ? '' : item.word,
      meaning: slKindOf(item) === 'sentence' ? '' : item.contextMeaning || item.translation || '',
      lang,
      title: extra.title || '',
      source: extra.source || null,
      learning: slStatus(item) !== 'learned',
      order: rand(),
    });
  };
  for (const item of words) {
    if ((item.lang || 'en') !== lang) continue;
    if (slKindOf(item) === 'sentence') add(item.word, item.translation, item, item);
    else {
      add(item.context, item.contextTranslation, item, item);
      for (const e of item.examples || []) add(e.text, e.translation, item, e);
    }
  }
  const fresh = (s) => !(rest[s.key] > now);
  return [...all.values()]
    .sort((a, b) => fresh(b) - fresh(a) || b.learning - a.learning || a.order - b.order)
    .slice(0, size)
    .map(({ learning, order, ...s }) => s);
}

if (typeof module !== 'undefined') {
  module.exports = { SL_IRREGULAR, slForms, slSavedForm, SL_RECORDS, SL_LOG_KEPT, slNoRecords, slMergeRecords, SL_PLAN, slGoals, slNextAt, slLogActivity, slActive, slTodayPlan, slWeek, SL_STAGES, slDictation, slDictationPool, slCanon, slFromCsv, slBackup, slStamp, slMergeCard, slMergeAll, slRestore, slStatus, slCleanLine, slHintMask, slCardType, slAdvance, slClozeParts, slCheckAnswer, slAccepted, slSentenceScore, slDayKey, slIsNew, slTodayQueue, slLogged, slStats, slDueCount, slAddExample, slMerge, slNormalize };
}
