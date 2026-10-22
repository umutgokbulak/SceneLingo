const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../../extension/reading.js');

// An answer as Gemini gives it: five paragraphs, seven headings, and the four kinds of questions.
const paragraphs = [
  'Glass was first made in Mesopotamia around 3500 BC, probably by accident.',
  'The Romans learned to blow glass, which made it cheap enough for ordinary homes.',
  'Venice later became famous for clear glass, and its makers were forbidden to leave the city.',
  'In the nineteenth century, machines replaced most of the work of glassblowers.',
  'Today, researchers such as Dr Lena Ortiz argue that recycled glass is underused in building.',
];
const answer = () => ({
  title: 'A history of glass',
  paragraphs,
  headings: ['Kept behind city walls', 'An accidental beginning', 'A modern opportunity', 'Glass in religion', 'From luxury to everyday object', 'The end of handwork', 'Why glass breaks'],
  headingAnswers: [
    { heading: 1, why: 'Kaza ile başladı.' },
    { heading: 4, why: 'Ucuzladı.' },
    { heading: 0, why: 'Şehirden çıkamazlardı.' },
    { heading: 5, why: 'Makineler.' },
    { heading: 2, why: 'Geri dönüşüm.' },
  ],
  tfng: [
    { statement: 'Glass was first made on purpose.', answer: 'FALSE', why: 'Kaza.', quote: 'probably by accident' },
    { statement: 'Roman glass was affordable.', answer: 'TRUE', why: 'Ucuz.', quote: 'which made it cheap enough for ordinary homes.' },
    { statement: 'Venetian glass was exported to Asia.', answer: 'NOT GIVEN', why: 'Söylenmiyor.', quote: 'anything' },
    { statement: 'A statement with no answer', answer: 'MAYBE' },
  ],
  choice: [{ q: 'What did Venice forbid?', options: ['Selling glass', 'Makers leaving', 'Blowing glass', 'Coloured glass'], answer: 1, why: 'Ayrılmak yasaktı.', quote: 'its makers were forbidden to leave the city' }],
  gaps: [
    { sentence: 'In the 1800s, ____ took over from glassblowers.', answers: ['machines'], why: 'Makineler.', quote: 'machines replaced most of the work' },
    { sentence: 'Dr Ortiz thinks ___ is underused.', answers: ['recycled glass'], quote: 'recycled glass is underused' },
  ],
});
const keep = () => 0.5; // a "shuffle" that leaves the order as it is

test('a reading test: lettered paragraphs, questions numbered through, the place of each answer found', () => {
  const t = R.slReadingParts(answer(), 'academic', keep);
  assert.deepEqual(t.paragraphs.map((p) => p.label), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(t.groups.map((g) => g.type), ['headings', 'tfng', 'choice', 'gaps']);
  assert.equal(t.total, 5 + 3 + 1 + 2, 'the statement without a proper answer is left out');
  assert.deepEqual(t.groups.flatMap((g) => g.items.map((i) => i.id)), ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10', 'q11']);
  const [headings, tfng, choice, gaps] = t.groups;
  assert.deepEqual(headings.items.map((i) => [i.para, headings.list[i.answer]]), [
    ['A', 'An accidental beginning'],
    ['B', 'From luxury to everyday object'],
    ['C', 'Kept behind city walls'],
    ['D', 'The end of handwork'],
    ['E', 'A modern opportunity'],
  ]);
  assert.deepEqual(tfng.items.map((i) => [i.answer, i.para]), [['F', 'A'], ['T', 'B'], ['NG', null]], 'NOT GIVEN is nowhere in the text');
  assert.equal(choice.items[0].para, 'C');
  assert.equal(gaps.items[1].q, 'Dr Ortiz thinks ____ is underused.', 'any way of writing the gap');
  assert.equal(gaps.items[0].para, 'D');
});

test('options and headings are put in an order of their own, and their answers follow them', () => {
  let n = 0;
  const backwards = () => -n++; // each next one sorts first: the order turned round
  const t = R.slReadingParts(answer(), 'academic', backwards);
  const [headings, , choice] = t.groups;
  assert.equal(headings.list[0], 'Why glass breaks');
  assert.equal(headings.list[headings.items[0].answer], 'An accidental beginning');
  assert.deepEqual(choice.items[0].options, ['Coloured glass', 'Blowing glass', 'Makers leaving', 'Selling glass']);
  assert.equal(choice.items[0].options[choice.items[0].answer], 'Makers leaving');
});

test('headings that do not hold together are left out; a test with too few questions is refused', () => {
  const twice = { ...answer(), headingAnswers: answer().headingAnswers.map(() => ({ heading: 0 })) };
  assert.ok(!R.slReadingParts(twice, 'academic', keep).groups.some((g) => g.type === 'headings'));
  const few = { ...answer(), headings: ['only', 'two'], tfng: [], gaps: [] };
  assert.throws(() => R.slReadingParts(few, 'academic', keep), /too few questions/);
  assert.throws(() => R.slReadingParts({ paragraphs: [] }, 'daily', keep), /no text/);
});

test('a gap is right with the words of the text, whatever their case, with or without "the"; not with too many', () => {
  assert.ok(R.slGapRight('Machines', ['machines']));
  assert.ok(R.slGapRight(' the machines. ', ['machines']));
  assert.ok(R.slGapRight('recycled  glass', ['recycled glass']));
  assert.ok(!R.slGapRight('glass', ['recycled glass']));
  assert.ok(!R.slGapRight('the old recycled glass', ['recycled glass']));
  assert.ok(!R.slGapRight('', ['machines']));
  assert.ok(!R.slGapRight(undefined, ['machines']));
});

test('marking: each answer right or not, and how many were right', () => {
  const t = R.slReadingParts(answer(), 'academic', keep);
  const answers = { q1: 1, q2: 4, q3: 2, q6: 'F', q7: 'NG', q8: 'NG', q9: 1, q10: 'Machines', q11: 'glass' };
  const m = R.slReadingMark(t, answers);
  assert.equal(m.score, 6);
  assert.equal(m.total, 11);
  assert.deepEqual(
    Object.entries(m.right).filter(([, ok]) => !ok).map(([id]) => id),
    ['q3', 'q4', 'q5', 'q7', 'q11']
  );
});

test('the band: one passage counted as a third of the test, by the Academic and the General Training tables', () => {
  assert.equal(R.slReadingBand(13, 13, 'academic'), 9);
  assert.equal(R.slReadingBand(10, 13, 'academic'), 7, '31 of 40');
  assert.equal(R.slReadingBand(10, 13, 'general'), 6, 'the same is lower in General Training');
  assert.equal(R.slReadingBand(7, 13, 'academic'), 5.5, '22 of 40');
  assert.equal(R.slReadingBand(0, 13, 'academic'), 1);
  assert.equal(R.slReadingBand(5, 7, 'daily'), null, 'everyday reading has no band');
});
