const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTime, lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch } = require('../../extension/core.js');

test('parseTime reads the time formats TTML allows', () => {
  assert.equal(parseTime('00:01:02.500', 1e7, 30), 62.5);
  assert.equal(parseTime('01:00:00', 1e7, 30), 3600);
  assert.equal(parseTime('00:00:10:15', 1e7, 30), 10.5); // frames
  assert.equal(parseTime('25000000t', 1e7, 30), 2.5); // ticks
  assert.equal(parseTime('1.5s', 1e7, 30), 1.5);
  assert.equal(parseTime('250ms', 1e7, 30), 0.25);
  assert.ok(Number.isNaN(parseTime('soon', 1e7, 30)));
  assert.ok(Number.isNaN(parseTime(null, 1e7, 30)));
});

test('findCue returns the cue on screen, lastStarted the latest one begun', () => {
  const cues = [{ start: 0, end: 1 }, { start: 2, end: 3 }, { start: 3, end: 5 }];
  assert.equal(findCue(cues, 0.5), 0);
  assert.equal(findCue(cues, 1.5), -1); // gap between lines
  assert.equal(lastStarted(cues, 1.5), 0);
  assert.equal(findCue(cues, 3), 2); // a cue ends where the next begins
  assert.equal(lastStarted(cues, -1), -1);
  assert.equal(lastStarted(cues, 99), 2);
  assert.equal(findCue([], 1), -1);
});

test('alignTranslation gives each line the translation cues that overlap it most', () => {
  const pri = [{ start: 0, end: 2, text: 'a' }, { start: 2, end: 4, text: 'b' }];
  const sec = [
    { start: 0.2, end: 1.8, text: 'A' },
    { start: 2.1, end: 3, text: 'B1' },
    { start: 3, end: 3.9, text: 'B2\nmore' },
    { start: 9, end: 10, text: 'orphan' },
  ];
  alignTranslation(pri, sec);
  assert.equal(pri[0].tr, 'A');
  assert.equal(pri[1].tr, 'B1 B2 more');
});

test('alignTranslation: a translation that starts early still belongs to its own line', () => {
  // The translated track is cut a little ahead of the original, as on real titles: just before
  // line 1 ends, the cue on screen is already the translation of line 2.
  const pri = [{ start: 10, end: 12, text: 'one' }, { start: 12.1, end: 14, text: 'two' }];
  const sec = [{ start: 9.8, end: 11.8, text: 'bir' }, { start: 11.85, end: 13.9, text: 'iki' }];
  alignTranslation(pri, sec);
  assert.deepEqual(pri.map((p) => p.tr), ['bir', 'iki']);
});

test('alignTranslation: a translation spanning two lines is shown for both', () => {
  const pri = [{ start: 0, end: 2, text: 'one' }, { start: 2, end: 3.5, text: 'two' }, { start: 20, end: 21, text: 'far away' }];
  const sec = [{ start: 0, end: 3.5, text: 'bir iki' }];
  alignTranslation(pri, sec);
  assert.deepEqual(pri.map((p) => p.tr), ['bir iki', 'bir iki', undefined]);
});

test('spokenWords keeps only what a listener would type', () => {
  assert.deepEqual(spokenWords('[music] JOHN: Don’t stop,\n(laughs) Mary!'), ["don't", 'stop', 'mary']);
  assert.deepEqual(spokenWords('♪ ♪'), []);
  assert.deepEqual(spokenWords('- Çok güzel. - Évidemment 2024'), ['çok', 'güzel', 'évidemment', '2024']);
});

test('matchWords marks expected words found in order in the answer', () => {
  const hit = (a, b) => matchWords(spokenWords(a), spokenWords(b));
  assert.deepEqual(hit('where are we going', 'where we going'), [true, false, true, true]);
  assert.deepEqual(hit("don't forget your umbrella", 'dont forget you umbrella'), [true, true, false, true]);
  assert.deepEqual(hit('one two three', ''), [false, false, false]);
  assert.deepEqual(hit('one two', 'two one'), [false, true]); // order matters
});

test('stretch makes audio longer without changing its pitch or level', () => {
  const rate = 16000;
  const hz = 220;
  const input = Float32Array.from({ length: rate }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / rate));
  const out = stretch(input, rate, 0.7);

  assert.ok(Math.abs(out.length / input.length - 1 / 0.7) < 0.06, 'about 1/0.7 times as long');

  // Measure the steady middle part, away from the fade at either end.
  const from = Math.round(out.length * 0.2);
  const to = Math.round(out.length * 0.8);
  let crossings = 0;
  let peak = 0;
  for (let i = from + 1; i < to; i++) {
    if (out[i - 1] < 0 !== out[i] < 0) crossings++;
    peak = Math.max(peak, Math.abs(out[i]));
  }
  const measuredHz = crossings / 2 / ((to - from) / rate);
  assert.ok(Math.abs(measuredHz - hz) < hz * 0.03, `pitch stays near ${hz} Hz, got ${measuredHz.toFixed(1)}`);
  assert.ok(peak > 0.42 && peak < 0.58, `level stays near 0.5, got ${peak.toFixed(2)}`);
  assert.ok(out.every(Number.isFinite));
});
