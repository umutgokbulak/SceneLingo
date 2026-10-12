const test = require('node:test');
const assert = require('node:assert/strict');
const { SL_DAY, slIsDue, slGrade } = require('../../extension/shared.js');

const review = (grades) => {
  let item = { word: 'umbrella' };
  let now = 0;
  const intervals = [];
  for (const grade of grades) {
    item = slGrade(item, grade, now);
    intervals.push(item.interval);
    now = item.due;
  }
  return { item, intervals };
};

test('a new item is due at once, a scheduled one only when its time comes', () => {
  assert.ok(slIsDue({ word: 'x' }, 1));
  assert.ok(!slIsDue({ word: 'x', due: 100 }, 99));
  assert.ok(slIsDue({ word: 'x', due: 100 }, 100));
});

test('remembered items come back at growing intervals', () => {
  assert.deepEqual(review(['good', 'good', 'good', 'good']).intervals, [1, 3, 8, 20]);
});

test('a missed item returns in ten minutes and starts over with a lower ease', () => {
  const { item } = review(['good', 'good', 'good']);
  const missed = slGrade(item, 'again', 1000);
  assert.equal(missed.due, 1000 + 10 * 60000);
  assert.equal(missed.reps, 0);
  assert.equal(missed.lapses, 1);
  assert.ok(missed.ease < item.ease);
  assert.equal(slGrade(missed, 'good', 0).interval, 1);
});

test('ease never drops below 1.3', () => {
  let item = { word: 'x' };
  for (let i = 0; i < 20; i++) item = slGrade(item, 'again', 0);
  assert.equal(item.ease, 1.3);
});

test('easy skips ahead and raises the ease', () => {
  const first = slGrade({ word: 'x' }, 'easy', 0);
  assert.equal(first.interval, 4);
  assert.equal(first.due, 4 * SL_DAY);
  assert.ok(first.ease > 2.5);
});

test('grading keeps the rest of the saved item', () => {
  const graded = slGrade({ word: 'x', translation: 'y', context: 'z' }, 'good', 0);
  assert.equal(graded.translation, 'y');
  assert.equal(graded.context, 'z');
});
