// IELTS Listening practice: a recording written by Gemini, a conversation or a talk, read aloud in
// two or three voices, with the questions of one part of the test. Put in order here, marked (with
// reading.js) and turned into a band. Pure: tested in Node.

// The parts: who speaks, what about, and the questions, as in the test.
const SL_LISTEN_PARTS = {
  1: { speakers: 2, gaps: 10, choice: 0 },
  3: { speakers: 3, gaps: 4, choice: 6 },
  4: { speakers: 1, gaps: 10, choice: 0 },
};
// The voices, one for each speaker: English as it is spoken in Britain, America and Australia.
const SL_LISTEN_VOICES = ['en-GB', 'en-US', 'en-AU'];

// Gemini's answer put in order: the lines of the recording (`script`: the background's answers
// take `lines` for a translation's), each with who says it, and the
// questions, numbered through. A gap whose answer is nowhere in the recording cannot be heard, and
// is left out; a test with too little left is refused.
function slListenParts(json, part, shuffle = Math.random) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => String(v == null ? '' : v).trim();
  const speakers = list(json.speakers).map(str).filter(Boolean).slice(0, 3);
  if (!speakers.length) speakers.push('Speaker');
  const lines = list(json.lines)
    .map((l) => ({ speaker: Math.min(speakers.length - 1, Math.max(0, +l.speaker || 0)), text: str(l.text) }))
    .filter((l) => l.text);
  if (lines.length < 6) throw new Error('Gemini: no recording in the answer');
  const heard = (answers) => {
    const said = lines.map((l) => ' ' + slLoose(l.text) + ' ');
    return answers.some((a) => said.some((s) => s.includes(' ' + slLoose(a) + ' ')));
  };
  const lineNo = (v) => (Number.isInteger(+v) && +v >= 0 && +v < lines.length ? +v : null);
  let n = 0;
  const groups = [];
  const choice = [];
  for (const c of list(json.choice)) {
    const options = list(c.options).map(str).filter(Boolean).slice(0, 3);
    const right = +c.answer;
    if (!str(c.q) || options.length < 3 || !(right >= 0 && right < options.length)) continue;
    const order = options.map((o, i) => ({ i, k: shuffle() })).sort((a, b) => a.k - b.k).map((x) => x.i);
    choice.push({ q: str(c.q), options: order.map((i) => options[i]), answer: order.indexOf(right), why: str(c.why), line: lineNo(c.line) });
  }
  if (choice.length) groups.push({ type: 'choice', items: choice.map((c) => ({ ...c, id: 'q' + ++n })) });
  const gaps = [];
  for (const g of list(json.gaps)) {
    const answers = list(g.answers).map(str).filter((a) => a && a.split(/\s+/).length <= 3);
    if (!answers.length || !heard(answers)) continue;
    gaps.push({ q: (str(g.before) + ' ____ ' + str(g.after)).trim(), answers, why: str(g.why), line: lineNo(g.line) });
  }
  if (gaps.length) groups.push({ type: 'gaps', max: 3, title: str(json.notesTitle), items: gaps.map((g) => ({ ...g, id: 'q' + ++n })) });
  if (n < 5) throw new Error('Gemini: too few questions in the answer');
  return { part, title: str(json.title), context: str(json.context), speakers, script: lines, groups, total: n };
}

// A line cut into pieces the speech service takes (200 letters at most), at the ends of
// sentences, else at commas, else between words.
function slSpeechChunks(text, max = 190) {
  const out = [];
  let rest = String(text).replace(/\s+/g, ' ').trim();
  while (rest.length > max) {
    const head = rest.slice(0, max);
    let cut = Math.max(head.lastIndexOf('. '), head.lastIndexOf('? '), head.lastIndexOf('! '));
    if (cut < max / 3) cut = Math.max(head.lastIndexOf(', '), head.lastIndexOf('; '));
    if (cut < max / 3) cut = head.lastIndexOf(' ');
    if (cut < 1) cut = max - 1;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

// How many of 40 make which band in the Listening test; one part is counted as a quarter of it.
const SL_LISTEN_BANDS = [[39, 9], [37, 8.5], [35, 8], [32, 7.5], [30, 7], [26, 6.5], [23, 6], [18, 5.5], [16, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [0, 1]];
function slListenBand(score, total) {
  if (!total) return null;
  const of40 = Math.round((score / total) * 40);
  return SL_LISTEN_BANDS.find(([least]) => of40 >= least)[1];
}

if (typeof module !== 'undefined') module.exports = { SL_LISTEN_PARTS, SL_LISTEN_VOICES, slListenParts, slSpeechChunks, slListenBand };
