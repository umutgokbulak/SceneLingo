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
