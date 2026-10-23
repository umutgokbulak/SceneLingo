const test = require('node:test');
const assert = require('node:assert/strict');
Object.assign(globalThis, require('../../extension/reading.js'));
const L = require('../../extension/listentest.js');

const keep = () => 0.5;
const answer = () => ({
  title: 'Joining a sports centre',
  context: 'You will hear a man phoning a sports centre.',
  speakers: ['Receptionist', 'Caller'],
  lines: [
    { speaker: 0, text: 'Good morning, Riverside Sports Centre.' },
    { speaker: 1, text: "Hi, I'd like to join. My name is Tom Ellis, that's E-L-L-I-S." },
    { speaker: 0, text: 'Thank you. And your address?' },
    { speaker: 1, text: '42 Mill Road. Sorry, I mean 24 Mill Road.' },
    { speaker: 0, text: 'Which membership would you like? We have the gold one at 60 pounds a month.' },
    { speaker: 1, text: 'That is too much. The silver one, please, at 35 pounds.' },
    { speaker: 9, text: 'Classes start at half past seven.' },
  ],
  choice: [{ q: 'Why does he choose silver?', options: ['It is cheaper', 'It has a pool', 'It starts later'], answer: 0, line: 5, why: 'Altın pahalı.' }],
  notesTitle: 'Membership form',
  gaps: [
    { before: 'Surname:', answers: ['Ellis'], line: 1 },
    { before: 'Address:', after: 'Mill Road', answers: ['24'], line: 3 },
    { before: 'Monthly fee: £', answers: ['35'], line: 5 },
    { before: 'Classes start at', answers: ['7.30', 'half past seven'], line: 6 },
    { before: 'Locker number:', answers: ['117'], line: 2, why: 'never said' },
  ],
});

test('a part of the listening test: its lines with who says them, and the questions that can be heard', () => {
  const t = L.slListenParts(answer(), 1, keep);
  assert.equal(t.script.length, 7);
  assert.equal(t.script[6].speaker, 1, 'a speaker who is not there is the last one');
  assert.deepEqual(t.groups.map((g) => g.type), ['choice', 'gaps']);
  assert.equal(t.groups[1].title, 'Membership form');
  assert.equal(t.total, 5, 'the locker number is never said: no question');
  assert.deepEqual(t.groups[1].items.map((i) => [i.id, i.q]), [['q2', 'Surname: ____'], ['q3', 'Address: ____ Mill Road'], ['q4', 'Monthly fee: £ ____'], ['q5', 'Classes start at ____']]);
  const m = slReadingMark(t, { q1: t.groups[0].items[0].answer, q2: 'ellis', q3: '42', q4: '35', q5: '7:30' });
  assert.equal(m.score, 4, 'the corrected address is the answer; 7:30 is 7.30');
  assert.throws(() => L.slListenParts({ lines: [] }, 1), /no recording/);
});

test('a line cut for the speech service, at the ends of sentences, never longer than it takes', () => {
  const long = 'This is the first sentence of a long line, which goes on for a while. '.repeat(5);
  const pieces = L.slSpeechChunks(long);
  assert.ok(pieces.length >= 2);
  assert.ok(pieces.every((p) => p.length <= 190), pieces.map((p) => p.length).join());
  assert.ok(pieces[0].endsWith('.'));
  assert.equal(pieces.join(' ').replace(/\s+/g, ' '), long.trim().replace(/\s+/g, ' '));
  assert.deepEqual(L.slSpeechChunks('Short.'), ['Short.']);
});

test('the band of the listening test, one part counted as a quarter of it', () => {
  assert.equal(L.slListenBand(10, 10), 9);
  assert.equal(L.slListenBand(8, 10), 7.5, '32 of 40');
  assert.equal(L.slListenBand(6, 10), 6, '24 of 40');
  assert.equal(L.slListenBand(0, 10), 1);
});
