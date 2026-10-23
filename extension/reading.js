// Reading practice: a text and questions on it, written by Gemini, put in order here, marked, and,
// for IELTS, turned into a band. Pure: tested in Node.

// A test of one passage: IELTS gives three in an hour, with 40 questions; one is a third of it.
const SL_READ_KINDS = {
  academic: { minutes: 20, paragraphs: 5, tfng: 4, choice: 2, gaps: 2 },
  general: { minutes: 20, paragraphs: 5, tfng: 4, choice: 2, gaps: 2 },
  daily: { minutes: 0, paragraphs: 4, tfng: 3, choice: 4, gaps: 0 },
};
// How long a text is at each level, in words (for IELTS, the length of a passage of the test).
const SL_READ_WORDS = { A1: 120, A2: 180, B1: 280, B2: 400, C1: 550, C2: 650, academic: 750, general: 650 };

// What IELTS passages are about, so that Gemini does not write about the same few things.
const SL_READ_TOPICS = {
  academic: [
    'the history of glass-making', 'how bees choose a new nest', 'the invention of the shipping container', 'sleep and memory in teenagers',
    'urban heat islands and street trees', 'the decline of minority languages', 'how the Inca built roads without the wheel', 'the economics of fast fashion',
    'coral reef restoration', 'the psychology of queuing', 'early aviation and the Wright brothers', 'microplastics in rivers', 'the science of taste',
    'how maps changed in the age of exploration', 'the domestication of the horse', 'desert solar farms', 'why some animals migrate at night',
    'the origins of the modern library', 'antibiotic resistance', 'play and learning in early childhood', 'the history of tea in Britain',
    'earthquake-proof buildings', 'birdsong dialects', 'the rise of remote work and city centres', 'the chemistry of colour in fireworks',
  ],
  general: [
    'a guide for new staff at a hotel', 'the rules of a community sports centre', 'a leaflet about recycling services in a town', 'how to apply for a library card',
    'safety instructions for a factory warehouse', 'a comparison of five local evening courses', 'advice for people starting their first job', 'a holiday rental agreement',
    'a company policy on working from home', 'a guide to renting a flat', 'tips for a job interview', 'a notice about changes to a bus service',
  ],
};
// Everyday reading: what the text is, chosen by the learner.
const SL_READ_DAILY = [
  { id: 'story', icon: '📖', title: { en: 'A short story', tr: 'Kısa hikâye' }, ask: 'a short story with a clear plot and some dialogue' },
  { id: 'news', icon: '📰', title: { en: 'News', tr: 'Haber' }, ask: 'a news article about an everyday event (made up, but realistic)' },
  { id: 'travel', icon: '✈️', title: { en: 'Travel', tr: 'Seyahat' }, ask: 'a travel blog post about a city or a region' },
  { id: 'work', icon: '💼', title: { en: 'Work', tr: 'İş hayatı' }, ask: 'a text about working life: an email, a workplace story or advice' },
  { id: 'science', icon: '🔬', title: { en: 'Science', tr: 'Bilim' }, ask: 'a popular science article explaining something surprising' },
  { id: 'health', icon: '🥗', title: { en: 'Health', tr: 'Sağlık' }, ask: 'a magazine article about health, food or sport' },
  { id: 'culture', icon: '🎭', title: { en: 'Culture', tr: 'Kültür' }, ask: 'a text about a tradition, a festival, a film or music' },
  { id: 'tech', icon: '💡', title: { en: 'Technology', tr: 'Teknoloji' }, ask: 'an article about technology in daily life' },
];

const SL_TFNG = ['T', 'F', 'NG'];
const SL_ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

// Text compared loosely: in lower case, without punctuation or space around it.
const slLoose = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/[^\p{L}\p{N}'\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Gemini's answer put in order: the paragraphs, lettered; the questions in groups, numbered through,
// each with its answer, why, and the words of the text that say so (with the paragraph they are
// in). Options and headings are put in an order of their own, so that the answer is not always
// the first. What does not hold together is left out; a test with too little left is refused.
function slReadingParts(json, kind, shuffle = Math.random) {
  const list = (v) => (Array.isArray(v) ? v : []);
  const str = (v) => String(v == null ? '' : v).trim();
  const paragraphs = list(json.paragraphs)
    .map(str)
    .filter(Boolean)
    .slice(0, 8)
    .map((text, i) => ({ label: String.fromCharCode(65 + i), text }));
  if (paragraphs.length < 2) throw new Error('Gemini: no text in the answer');
  const where = (quote) => {
    const q = slLoose(quote);
    if (q.length < 8) return null;
    const p = paragraphs.find((x) => slLoose(x.text).includes(q));
    return p ? p.label : null;
  };
  const mixed = (n) =>
    Array.from({ length: n }, (_, i) => ({ i, k: shuffle() }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.i);
  let n = 0;
  const id = () => 'q' + ++n;
  const groups = [];

  // Headings: one for each paragraph, out of more than there are paragraphs.
  const headings = list(json.headings).map(str).filter(Boolean).slice(0, SL_ROMAN.length);
  const chosen = list(json.headingAnswers).slice(0, paragraphs.length);
  const asHeading = (h) => (h && typeof h === 'object' ? h : { heading: h });
  const picks = chosen.map((h) => +asHeading(h).heading);
  if (headings.length > paragraphs.length && chosen.length === paragraphs.length && picks.every((h) => h >= 0 && h < headings.length) && new Set(picks).size === picks.length) {
    const order = mixed(headings.length); // order[shown] = given
    const shownOf = (given) => order.indexOf(given);
    groups.push({
      type: 'headings',
      list: order.map((g) => headings[g]),
      items: paragraphs.map((p, i) => ({ id: id(), para: p.label, answer: shownOf(picks[i]), why: str(asHeading(chosen[i]).why) })),
    });
  }

  const tfng = [];
  for (const t of list(json.tfng)) {
    const a = str(t.answer).toUpperCase().replace(/[^A-Z ]/g, '');
    const answer = /^(TRUE|YES)$/.test(a) ? 'T' : /^(FALSE|NO)$/.test(a) ? 'F' : /^NOT ?GIVEN$/.test(a) ? 'NG' : null;
    if (!str(t.statement) || !answer) continue;
    const quote = answer === 'NG' ? '' : str(t.quote);
    tfng.push({ id: '', q: str(t.statement), answer, why: str(t.why), quote, para: where(quote) });
  }
  if (tfng.length) groups.push({ type: 'tfng', items: tfng.map((t) => ({ ...t, id: id() })) });

  const choice = [];
  for (const c of list(json.choice)) {
    const options = list(c.options).map(str).filter(Boolean);
    const right = +c.answer;
    if (!str(c.q) || options.length < 3 || !(right >= 0 && right < options.length)) continue;
    const order = mixed(options.length);
    choice.push({ q: str(c.q), options: order.map((g) => options[g]), answer: order.indexOf(right), why: str(c.why), quote: str(c.quote), para: where(c.quote) });
  }
  if (choice.length) groups.push({ type: 'choice', items: choice.map((c) => ({ ...c, id: id() })) });

  // Gaps: a sentence with a gap that words of the text fill, no more than two of them.
  const gaps = [];
  for (const g of list(json.gaps)) {
    const sentence = str(g.sentence).replace(/_{2,}|\.{3,}|…/, '____');
    const answers = list(g.answers).map(str).filter((a) => a && a.split(/\s+/).length <= 3);
    if (!sentence.includes('____') || !answers.length) continue;
    gaps.push({ q: sentence, answers, why: str(g.why), quote: str(g.quote), para: where(g.quote) });
  }
  if (gaps.length) groups.push({ type: 'gaps', max: 2, items: gaps.map((g) => ({ ...g, id: id() })) });

  if (n < 4) throw new Error('Gemini: too few questions in the answer');
  return { kind, title: str(json.title), paragraphs, groups, total: n };
}

// A gap filled rightly: the same words as one of the answers, whatever the case or the
// punctuation, with or without "a", "an" or "the" before them; and no more words than allowed.
function slGapRight(given, answers, max = 2) {
  const bare = (s) => slLoose(s).replace(/^(a|an|the)\s+/, '');
  const g = bare(given);
  if (!g || g.split(' ').length > max) return false;
  return answers.some((a) => bare(a) === g);
}

// The answers marked: { id: right or not }, and how many were right.
function slReadingMark(test, answers) {
  const right = {};
  let score = 0;
  for (const group of test.groups) {
    for (const item of group.items) {
      const a = answers[item.id];
      const ok = group.type === 'gaps' ? slGapRight(a, item.answers, group.max) : a != null && a === item.answer;
      right[item.id] = ok;
      if (ok) score += 1;
    }
  }
  return { right, score, total: test.total };
}

// How many of 40 make which band, in the Academic and the General Training test. One passage is
// counted as a third of the test: an estimate, no more.
const SL_READ_BANDS = {
  academic: [[39, 9], [37, 8.5], [35, 8], [33, 7.5], [30, 7], [27, 6.5], [23, 6], [19, 5.5], [15, 5], [13, 4.5], [10, 4], [8, 3.5], [6, 3], [4, 2.5], [2, 2], [0, 1]],
  general: [[40, 9], [39, 8.5], [37, 8], [36, 7.5], [34, 7], [32, 6.5], [30, 6], [27, 5.5], [23, 5], [19, 4.5], [15, 4], [12, 3.5], [9, 3], [6, 2.5], [3, 2], [0, 1]],
};
function slReadingBand(score, total, kind) {
  const table = SL_READ_BANDS[kind];
  if (!table || !total) return null;
  const of40 = Math.round((score / total) * 40);
  return table.find(([least]) => of40 >= least)[1];
}

if (typeof module !== 'undefined') {
  Object.assign(module.exports, { SL_READ_KINDS, SL_READ_WORDS, SL_READ_TOPICS, SL_READ_DAILY, SL_TFNG, SL_ROMAN, slLoose, slReadingParts, slGapRight, slReadingMark, slReadingBand });
}
