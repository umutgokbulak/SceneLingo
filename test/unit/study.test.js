const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../../extension/shared.js');
globalThis.slIsDue = shared.slIsDue;
globalThis.SL_DAY = shared.SL_DAY;
const S = require('../../extension/study.js');
const { matchWords } = require('../../extension/core.js');

const NOW = new Date(2026, 9, 16, 20, 0).getTime();
const DAY = shared.SL_DAY;
const ripped = { word: 'ripped', kind: 'word', context: "It's not my fault you ripped off the wrong people, Addison.", contextPhrase: 'rip off' };

test('a word is recognised first, then filled into its sentence, then produced', () => {
  let item = { ...ripped };
  assert.equal(S.slCardType(item), 'recognize');
  item = { ...item, ...S.slAdvance(item, 'good') };
  assert.equal(S.slCardType(item), 'cloze');
  item = { ...item, ...S.slAdvance(item, 'good') };
  assert.equal(S.slCardType(item), 'cloze', 'two successes are needed in the gap');
  item = { ...item, ...S.slAdvance(item, 'good') };
  assert.equal(S.slCardType(item), 'produce');
  item = { ...item, ...S.slAdvance(item, 'again') };
  assert.equal(S.slCardType(item), 'cloze', 'a miss steps back one');
  assert.equal({ ...item, ...S.slAdvance(item, 'easy') }.stage, 2, 'easy counts twice');
});

test('a sentence, or a word its sentence does not contain, has no gap to fill', () => {
  assert.equal(S.slCardType({ word: 'Might even have a girl for you.', kind: 'sentence', stage: 1 }), 'produce');
  assert.equal(S.slCardType({ word: 'swoop', kind: 'word', context: 'Nothing like it here.', stage: 1 }), 'produce');
});

test('the gap is the word as the sentence has it, matched as a whole word', () => {
  assert.deepEqual(S.slClozeParts(ripped), { before: "It's not my fault you ", answer: 'ripped', after: ' off the wrong people, Addison.' });
  assert.equal(S.slClozeParts({ word: 'might', context: 'Might even have a girl for you.' }).answer, 'Might');
  assert.equal(S.slClozeParts({ word: 'rip', context: 'You ripped it.' }), null, 'not inside another word');
  assert.equal(S.slClozeParts({ word: 'make up', contextPhrase: 'make up', context: "I can't make up my mind." }).answer, 'make up');
});

test('typed answers: right, a slip of the keyboard, or wrong', () => {
  assert.equal(S.slCheckAnswer(' Ripped ', ['ripped']), 'right');
  assert.equal(S.slCheckAnswer('riped', ['ripped']), 'close');
  assert.equal(S.slCheckAnswer('Mihgt', ['Might']), 'close', 'two letters swapped are one slip');
  assert.equal(S.slCheckAnswer('ran', ['run']), 'wrong', 'no slips allowed in a short word');
  assert.equal(S.slCheckAnswer('dont', ["don't"]), 'right');
  assert.equal(S.slCheckAnswer('rip off', S.slAccepted(ripped, 'produce')), 'right', 'the phrase counts when producing');
  assert.equal(S.slCheckAnswer('rip off', S.slAccepted(ripped, 'cloze')), 'wrong', 'the gap wants the form the sentence has');
  assert.equal(S.slCheckAnswer('', ['x']), 'wrong');
});

test('a sentence said from its translation is scored by the words said in order', () => {
  assert.equal(S.slSentenceScore('Might even have a girl for you.', 'might have a girl for you', matchWords), 6 / 7);
});

test('a subtitle line is read without the notes for the hard of hearing', () => {
  assert.equal(S.slCleanLine("[Grace] I'm just going through the whole light spectrum here."), "I'm just going through the whole light spectrum here.");
  assert.equal(S.slCleanLine('- (sighs) Well, ♪ maybe ♪ not.'), 'Well, maybe not.');
  assert.equal(S.slCleanLine('[man]'), '[man]', 'a line that is only a note stays');
});

test('a hint shows the first letters and the shape of the answer', () => {
  assert.equal(S.slHintMask('go through', 1), 'g_ _______');
  assert.equal(S.slHintMask('go through', 3), 'go t______');
  assert.equal(S.slHintMask("don't", 2), "do_'_");
  assert.equal(S.slHintMask('keen', 9), 'keen');
});

test('a backup holds the cards and the days, and merges back in without losing either side', () => {
  const here = [{ word: 'keen', added: 1, last: 50, interval: 8 }, { word: 'might', added: 2 }];
  const file = JSON.parse(JSON.stringify(S.slBackup([{ word: 'Keen', added: 1, last: 10, interval: 1 }, { word: 'through', added: 3 }, { word: 'might', added: 2, last: 90, interval: 3 }], { '2026-10-10': { reviews: 5, correct: 4, newSeen: 2 } }, NOW, '0.16.0')));
  assert.equal(file.app, 'SceneLingo');
  assert.ok(!('geminiKey' in file));
  const r = S.slRestore(here, { '2026-10-10': { reviews: 7, correct: 3, newSeen: 1 } }, file);
  assert.deepEqual([r.added, r.updated], [1, 1]);
  assert.equal(r.words.find((w) => w.word === 'keen').interval, 8, 'the copy studied last stays');
  assert.equal(r.words.find((w) => w.word === 'might').interval, 3, 'the backup studied it later');
  assert.deepEqual(r.log['2026-10-10'], { reviews: 7, correct: 4, newSeen: 2 });
  assert.throws(() => S.slRestore(here, {}, { words: [] }), /not a SceneLingo backup/);
  const revived = S.slRestore([], {}, file, { through: Date.now() });
  assert.ok(revived.words.some((w) => w.word === 'through') && !revived.deleted.through, 'a deleted card in the restored file comes back');
});

test('the practice records go into a backup and come back merged: no score twice, none lost', () => {
  const a = { at: NOW - 3 * DAY, part: 1, bands: { fluency: 6, lexical: 6, grammar: 5.5, pronunciation: 6.5 } };
  const b = { at: NOW - DAY, part: 2, bands: { fluency: 6.5, lexical: 6, grammar: 6, pronunciation: 6.5 } };
  const essay = { at: NOW - 2 * DAY, task: 'task2', bands: { task: 6, coherence: 6, lexical: 6.5, grammar: 6 } };
  const test1 = { at: NOW - DAY, task: 'academic', score: 10, total: 13, band: 7, title: 'A history of glass' };
  const file = JSON.parse(JSON.stringify(S.slBackup([], {}, NOW, '0.27.0', {}, { speakLog: [a, b], writeLog: [essay], readLog: [test1], listenRest: { 'its my fault': Date.now() + DAY, 'old one': Date.now() - DAY } })));
  assert.equal(file.speakLog.length, 2);
  assert.deepEqual(S.slBackup([], {}, NOW, '0.26.0').readLog, [], 'a backup always has every record, empty or not');
  // (a restore happens now: rests are measured from the clock, not from the tests' day)
  const later = Date.now() + 3 * DAY;
  const here = { speakLog: [a, { at: NOW, part: 3, bands: b.bands }], writeLog: [], listenRest: { 'its my fault': later } };
  const r = S.slRestore([], {}, file, {}, here);
  assert.deepEqual(r.speakLog.map((x) => x.part), [1, 2, 3], 'in the order they were given, the one in both once');
  assert.deepEqual(r.writeLog, [essay]);
  assert.deepEqual(r.readLog, [test1]);
  assert.deepEqual(S.slRestore([], {}, { ...file, readLog: undefined }, {}, { readLog: [test1] }).readLog, [test1], 'an older backup takes no test away');
  assert.deepEqual(r.listenRest, { 'its my fault': later }, 'the later of the two; a rest that is over is dropped');
  const many = Array.from({ length: 150 }, (_, i) => ({ at: i + 1, part: 1, bands: a.bands }));
  assert.equal(S.slMergeRecords({ speakLog: many }, {}, NOW).speakLog.length, 100, 'the latest hundred');
});

test('two copies made one: the later change wins, and a deletion is not undone by an older copy', () => {
  const T = 1000000;
  const here = {
    words: [{ word: 'keen', added: 1, last: T + 50 }, { word: 'might', added: 2 }, { word: 'kept', added: 3 }],
    reviewLog: {},
    deleted: { gone: T + 10 },
  };
  const there = {
    words: [{ word: 'keen', added: 1, last: T + 20 }, { word: 'gone', added: 5, last: T }, { word: 'kept', added: 3, updated: T + 99, translation: 'edited' }, { word: 'back', added: T + 30 }],
    reviewLog: {},
    deleted: { might: T + 40, back: T + 20 },
  };
  const r = S.slMergeAll(here, there, T + 100);
  const names = r.words.map((w) => w.word).sort();
  assert.deepEqual(names, ['back', 'keen', 'kept'], 'might deleted there after it changed here; gone deleted here after it changed there');
  assert.equal(r.words.find((w) => w.word === 'keen').last, T + 50, 'studied later here');
  assert.equal(r.words.find((w) => w.word === 'kept').translation, 'edited', 'edited later there');
  assert.equal(r.deleted.back, undefined, 'saved again after it was deleted: no longer deleted');
  assert.equal(r.deleted.might, T + 40);
  assert.deepEqual(S.slMergeAll({ words: [], deleted: { old: 1 } }, { words: [] }, 400 * 86400000).deleted, {}, 'old deletions are forgotten');
});

test('the word list of an earlier version, saved as CSV, is read back as cards', () => {
  const csv = '﻿"Kelime";"Çeviri";"Okunuş";"Tanım";"Cümle";"Dil";"Kaynak";"Tarih"\r\n' +
    '"keen";"keskin";"kēn";"sharp";"Possessed of a ""keen"" wit, then?";"en";"Prime Video: Spider-Noir";"2026-10-12"\r\n' +
    '"rip off";"soymak";"";"";"";"en";"";"2026-10-13"\r\n';
  const cards = S.slFromCsv(csv);
  assert.equal(cards.length, 2);
  assert.deepEqual([cards[0].word, cards[0].translation, cards[0].context, cards[0].kind], ['keen', 'keskin', 'Possessed of a "keen" wit, then?', 'word']);
  assert.equal(cards[1].kind, 'phrase');
  assert.equal(cards[0].added, Date.parse('2026-10-12'));
  assert.ok(S.slIsNew(cards[0]), 'starts anew');
});

test('one card changed on two devices keeps both changes', () => {
  // studied on the computer; enriched by Gemini on the phone
  const computer = { word: 'keen', added: 1, translation: 'keskin', reps: 3, interval: 8, due: 900, last: 500, stage: 2 };
  const phone = { word: 'keen', added: 1, translation: 'keskin', reps: 2, interval: 3, due: 400, last: 300, stage: 1, extra: { level: 'B2', ipa: '/kiːn/' }, enriched: 2, contextMeaning: 'keskin', senseEngine: 'gemini', examples: [{ text: 'A keen eye.' }] };
  for (const [a, b] of [[computer, phone], [phone, computer]]) {
    const m = S.slMergeCard(a, b);
    assert.deepEqual([m.reps, m.interval, m.due, m.last, m.stage], [3, 8, 900, 500, 2], 'the progress of the copy studied last');
    assert.equal(m.extra.level, 'B2', 'what Gemini found');
    assert.equal(m.senseEngine, 'gemini');
    assert.equal(m.examples.length, 1);
  }
  // edited on one side: the edit stays, whatever was studied where
  const edited = S.slMergeCard({ ...computer, translation: 'hevesli', updated: 600 }, phone);
  assert.equal(edited.translation, 'hevesli');
});

test('where a card stands', () => {
  assert.equal(S.slStatus({ word: 'a' }), 'new');
  assert.equal(S.slStatus({ word: 'a', reps: 1, interval: 3, due: 1 }), 'learning');
  assert.equal(S.slStatus({ word: 'a', reps: 5, interval: 30, due: 1 }), 'learned');
  assert.equal(S.slStatus({ word: 'a', lapses: 3, interval: 1, due: 1 }), 'hard');
});

test("today's queue: what is due, and new cards up to the day's limit", () => {
  const words = [
    { word: 'a', added: 1 },
    { word: 'b', added: 2 },
    { word: 'c', added: 3 },
    { word: 'd', reps: 2, interval: 3, due: NOW - DAY },
    { word: 'e', reps: 1, interval: 1, due: NOW + DAY },
    { word: 'f', lapses: 1, due: NOW - 60000 },
  ];
  assert.deepEqual(S.slTodayQueue(words, NOW, {}, 2).map((w) => w.word), ['d', 'f', 'a', 'b']);
  const log = S.slLogged({}, NOW, { isNew: true, correct: true });
  assert.deepEqual(S.slTodayQueue(words, NOW, log, 2).map((w) => w.word), ['d', 'f', 'a'], 'one new card already begun today');
  assert.equal(S.slDueCount(words, NOW, log, 2), 3);
});

test('the record of the days gives the streak, the words learned and how much is remembered', () => {
  let log = {};
  for (const back of [1, 2, 3, 5]) log = S.slLogged(log, NOW - back * DAY, { isNew: false, correct: back !== 2 });
  const words = [{ word: 'a', interval: 30 }, { word: 'b', interval: 4, reps: 2 }, { word: 'c' }];
  const before = S.slStats(words, log, NOW);
  assert.equal(before.streak, 3, 'today is still open: counted up to yesterday');
  assert.equal(before.retention, 75);
  assert.deepEqual([before.learned, before.learning, before.fresh], [1, 1, 1]);
  log = S.slLogged(log, NOW, { isNew: false, correct: true });
  assert.equal(S.slStats(words, log, NOW).streak, 4);
});

test('another sentence the word was met in is kept as an example, once', () => {
  let item = { ...ripped };
  item = S.slAddExample(item, { text: 'They ripped us off.', title: 'Film' });
  item = S.slAddExample(item, { text: 'They ripped us off!', title: 'Film' });
  item = S.slAddExample(item, { text: ripped.context });
  assert.equal(item.examples.length, 1);
  assert.equal(item.seen, 1);
});

test('two cards for one thing become one: the further studied keeps its schedule', () => {
  const phrase = { word: 'rip off', kind: 'phrase', translation: 'soymak', interval: 1, context: 'Rip off the band-aid.' };
  const merged = S.slMerge(phrase, { ...ripped, translation: 'yırtık', interval: 8, due: 123 });
  assert.equal(merged.word, 'rip off');
  assert.equal(merged.translation, 'soymak');
  assert.equal(merged.interval, 8);
  assert.equal(merged.examples[0].text, phrase.context);
});

test('dictation: each word of the sentence against what was typed', () => {
  const states = (r) => r.parts.map((p) => p.word + ':' + p.state + (p.typed ? '=' + p.typed : '')).join(' ');
  let r = S.slDictation("It's not my fault you ripped off the wrong people.", 'its not my fault you ripped off the wrong people');
  assert.equal(r.score, 1, 'case, punctuation and apostrophes do not count');
  r = S.slDictation('You ripped off the wrong people.', 'you riped of the people');
  assert.equal(states(r), 'You:right ripped:close=riped off:wrong=of the:right wrong:missed people.:right');
  assert.equal(r.score, 3.5 / 6);
  r = S.slDictation('Might even have a girl for you.', 'might even have girl for you you');
  assert.equal(states(r), 'Might:right even:right have:right a:missed girl:right for:right you.:right you:extra');
  assert.equal(r.score, 6 / 8);
  assert.equal(S.slDictation('Wie geht es dir?', '').score, 0);
  assert.equal(S.slDictation('Wie geht es dir?', '').parts.every((p) => p.state === 'missed'), true);
});

test('dictation: the sentences come from the saved ones, those not resting and still learnt first', () => {
  const words = [
    { word: 'ripped', context: "It's not my fault you ripped off the wrong people.", contextTranslation: 'Benim suçum değil.', interval: 30, examples: [{ text: 'They ripped me off again.', title: 'Suits' }] },
    { word: 'Might even have a girl for you.', kind: 'sentence', translation: 'Belki sana bir kız bile bulurum.' },
    { word: 'swoop', context: 'Swoop!' },
    { word: 'Hund', lang: 'de', context: 'Der Hund schläft im Garten.' },
  ];
  const rest = { [S.slNormalize('Might even have a girl for you.')]: NOW + DAY, [S.slNormalize('They ripped me off again.')]: NOW - DAY };
  const pool = S.slDictationPool(words, 'en', rest, NOW, 10, () => 0.5);
  assert.deepEqual(pool.map((s) => s.text), ["It's not my fault you ripped off the wrong people.", 'They ripped me off again.', 'Might even have a girl for you.']);
  assert.equal(pool[0].word, 'ripped');
  assert.equal(pool[1].title, 'Suits');
  assert.equal(pool[2].word, '', 'a saved sentence has no word to point at');
  assert.deepEqual(S.slDictationPool(words, 'de', {}, NOW, 10).map((s) => s.text), ['Der Hund schläft im Garten.']);
});

test('the record of days keeps the other practice too, and a day of it counts towards the streak', () => {
  let log = {};
  log = S.slLogActivity(log, NOW, 'listen', 80);
  log = S.slLogActivity(log, NOW, 'listen', 100);
  log = S.slLogActivity(log, NOW - DAY, 'speak');
  log = S.slLogged(log, NOW - 2 * DAY, { isNew: true, correct: true });
  const today = log[S.slDayKey(NOW)];
  assert.deepEqual(today, { listen: 2, listenScore: 180 });
  assert.equal(S.slStats([], log, NOW).streak, 3, 'listening today, speaking yesterday, cards the day before');
  // merged with another device's: each count the larger
  const other = { [S.slDayKey(NOW)]: { listen: 1, listenScore: 50, write: 1 } };
  const merged = S.slMergeAll({ words: [], reviewLog: log }, { words: [], reviewLog: other }, NOW).reviewLog[S.slDayKey(NOW)];
  assert.deepEqual(merged, { listen: 2, listenScore: 180, write: 1 });
});

test("today's plan: the cards, five sentences, one conversation; two texts written and two read a week", () => {
  const words = [{ word: 'keen', due: NOW - 1000, reps: 1, interval: 1, last: NOW - DAY }];
  let log = {};
  let plan = S.slTodayPlan(words, log, NOW, 15);
  assert.equal(plan.next, 'review');
  assert.deepEqual(plan.steps.map((s) => s.done), [false, false, false]);
  const studied = [{ ...words[0], due: NOW + DAY }];
  for (let i = 0; i < 5; i++) log = S.slLogActivity(log, NOW, 'listen', 90);
  plan = S.slTodayPlan(studied, log, NOW, 15);
  assert.equal(plan.next, 'speak');
  log = S.slLogActivity(log, NOW, 'speak');
  plan = S.slTodayPlan(studied, log, NOW, 15);
  assert.ok(plan.done);
  assert.equal(plan.next, 'write', 'the day is done; the week still wants its texts');
  log = S.slLogActivity(log, NOW - 3 * DAY, 'write');
  log = S.slLogActivity(log, NOW, 'write');
  assert.equal(S.slTodayPlan(studied, log, NOW, 15).next, 'read', 'written; the week still wants its reading');
  log = S.slLogActivity(log, NOW - 2 * DAY, 'read', 80);
  log = S.slLogActivity(log, NOW, 'read', 60);
  plan = S.slTodayPlan(studied, log, NOW, 15);
  assert.equal(plan.next, null);
  assert.deepEqual(plan.week.map((s) => [s.id, s.have, s.done]), [['write', 2, true], ['read', 2, true]]);
  // goals of one's own: more listening, no writing
  const goals = S.slGoals({ goalListen: 10, goalSpeak: 1, goalWrite: 0, goalRead: 3 });
  plan = S.slTodayPlan(studied, log, NOW, 15, goals);
  assert.equal(plan.next, 'listen', 'five sentences are not ten');
  assert.deepEqual(plan.week.map((s) => s.id), ['read'], 'no writing; three texts to read');
  assert.deepEqual(plan.steps.map((s) => s.id), ['review', 'listen', 'speak']);
  assert.deepEqual(S.slTodayPlan(studied, log, NOW, 15, S.slGoals({ goalListen: 0, goalSpeak: 0, goalWrite: 0 })).steps.map((s) => s.id), ['review']);
  assert.deepEqual(S.slTodayPlan(studied, log, NOW, 15, S.slGoals({ goalWrite: 0, goalRead: 0 })).week, []);
  assert.deepEqual(S.slGoals({}), S.SL_PLAN, 'nothing chosen: the usual goals');
});

test('the reminder: at the chosen time today if it is still to come, or else tomorrow', () => {
  const at = (t) => new Date(t).toTimeString().slice(0, 5) + (new Date(t).getDate() === new Date(NOW).getDate() ? ' today' : ' tomorrow');
  assert.equal(at(S.slNextAt(NOW, '20:30')), '20:30 today', 'it is 20:00');
  assert.equal(at(S.slNextAt(NOW, '20:00')), '20:00 tomorrow', 'not now: tomorrow');
  assert.equal(at(S.slNextAt(NOW, '08:15')), '08:15 tomorrow');
});

test('the week: what was done in each of the last seven days, and in all of them', () => {
  let log = {};
  log = S.slLogged(log, NOW, { isNew: true, correct: true });
  log = S.slLogged(log, NOW, { isNew: false, correct: false });
  log = S.slLogActivity(log, NOW - DAY, 'listen', 60);
  log = S.slLogActivity(log, NOW - DAY, 'listen', 100);
  log = S.slLogActivity(log, NOW - 9 * DAY, 'write');
  log = S.slLogActivity(log, NOW, 'read', 70);
  log = S.slLogActivity(log, NOW - 2 * DAY, 'read', 90);
  const w = S.slWeek([{ word: 'a', added: NOW - DAY }, { word: 'b', added: NOW - 20 * DAY }], log, NOW);
  assert.equal(w.days.length, 7);
  assert.equal(w.days[6].key, S.slDayKey(NOW));
  assert.equal(w.active, 3);
  assert.equal(w.read, 2);
  assert.equal(w.understood, 80);
  assert.equal(w.retention, 50);
  assert.equal(w.heard, 80);
  assert.equal(w.written, 0, 'nine days ago is not this week');
  assert.equal(w.saved, 1);
});

test('a saved word is known in its other forms: endings, doubled letters, irregular verbs', () => {
  const saved = new Set(['negotiate', 'stop', 'study', 'go', 'big', 'glass', 'woman', 'car']);
  const form = (w, lang) => S.slSavedForm(w, saved, lang);
  assert.equal(form('negotiated'), 'negotiate');
  assert.equal(form('negotiating'), 'negotiate');
  assert.equal(form('stopped'), 'stop');
  assert.equal(form('studies'), 'study');
  assert.equal(form('went'), 'go');
  assert.equal(form('bigger'), 'big');
  assert.equal(form('glasses'), 'glass');
  assert.equal(form('women'), 'woman');
  assert.equal(form("car's"), 'car');
  assert.equal(form('cares'), '', 'not a form of "car"');
  assert.equal(form('careful'), '');
  assert.equal(S.slSavedForm('Häusern', new Set(['häuser']), 'de'), 'häuser');
  assert.equal(S.slSavedForm('negotiated', saved, 'fr'), '', 'only English and German endings are known');
});
