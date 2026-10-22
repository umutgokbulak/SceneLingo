// Reading practice. Every day, a text of the kind chosen in the language being learnt, at a level;
// and, in English, one passage of the IELTS Reading test against the clock. Gemini writes the text
// and its questions; the answers are marked here, each with why and where in the text it is, and
// for IELTS an estimated band. Once marked, every word of the text opens its meaning.
let settings = { ...SL_DEFAULTS };
let geminiKey = '';
let level = 'B1';
let current = null; // { test, answers, id, started }: `started` as if the time spent on it had been spent at once
let checked = null; // the marks, once the answers are checked
let timer = null;
let making = 0; // the test being written: a number, so that one asked for and left is not shown
let shown = null; // the place in the text shown for a question

const learnt = () => settings.learnLang;
const inUi = (texts) => texts[slUiLang] || texts.en;
const KIND_NAMES = { academic: 'Academic', general: 'General Training' };

function screen(id) {
  for (const s of ['home', 'making', 'desk']) $(s).hidden = s !== id;
  $('toHome').hidden = id === 'home';
  document.body.classList.toggle('reading', id === 'desk');
  scrollTo(0, 0);
}

// ---------- choosing ----------

function paintHome() {
  screen('home');
  making += 1;
  clearInterval(timer);
  $('noKey').hidden = !!geminiKey;
  $('noKey').textContent = slT('practiceNoKey');
  const lv = $('level');
  lv.textContent = '';
  for (const l of SL_LEVELS) lv.append(Object.assign(el('option', null, l), { value: l }));
  lv.value = level;
  const kinds = $('kinds');
  kinds.textContent = '';
  for (const d of SL_READ_DAILY) {
    const tile = btn([el('span', 'ic', d.icon), el('span', null, inUi(d.title))], () => make({ kind: 'daily', topic: d.ask, level, sl: learnt(), what: d.id }), 'tile');
    tile.disabled = !geminiKey;
    kinds.append(tile);
  }
  $('ieltsBox').hidden = learnt() !== 'en';
  const parts = $('parts');
  parts.textContent = '';
  for (const kind of ['academic', 'general']) {
    const tile = btn([el('b', null, KIND_NAMES[kind]), el('small', null, slT(kind === 'academic' ? 'readAcademicSub' : 'readGeneralSub'))], () => makeIelts(kind), 'tile');
    tile.disabled = !geminiKey;
    parts.append(tile);
  }
  chrome.storage.local.get({ readLog: [], readDraft: null, geminiUsage: null }, (data) => {
    const recent = (data.readLog || []).filter((r) => r.band != null).slice(-5);
    $('last').textContent = '';
    if (recent.length) $('last').append(slT('readLast', recent.length) + ' ', el('b', null, 'Band ' + meanBand(recent).toFixed(1)));
    $('usage').textContent = '';
    if (geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
    // A test begun and left: back to it, or away with it.
    const draft = data.readDraft;
    const resume = $('resume');
    resume.textContent = '';
    resume.hidden = !(draft && draft.test);
    if (resume.hidden) return;
    resume.append(
      el('span', null, slT('readResume', draft.test.title, answeredOf(draft.test, draft.answers), draft.test.total)),
      btn(slT('writeDiscard'), () => chrome.storage.local.set({ readDraft: null }, paintHome), 'btn small ghost'),
      btn(slT('writeContinue'), () => openDesk(draft), 'btn small primary')
    );
  });
}
$('level').addEventListener('change', () => {
  level = $('level').value;
  chrome.storage.local.set({ readLevel: level });
});

// The mean of some bands, to the nearest half.
const meanBand = (list) => Math.round((list.reduce((a, r) => a + r.band, 0) / list.length) * 2) / 2;

// IELTS: on a subject not met in the latest tests.
function makeIelts(kind) {
  chrome.storage.local.get({ readLog: [] }, (data) => {
    const recent = new Set((data.readLog || []).slice(-20).map((r) => r.topic));
    const fresh = SL_READ_TOPICS[kind].filter((t) => !recent.has(t));
    make({ kind, topic: pick(fresh.length ? fresh : SL_READ_TOPICS[kind]), sl: 'en' });
  });
}

// Gemini writes the test. Left before it is done, it is kept to come back to.
async function make(req) {
  const mine = ++making;
  screen('making');
  $('makingText').textContent = slT(req.kind === 'daily' ? 'readMaking' : 'readMakingIelts');
  const { readLog } = await chrome.storage.local.get({ readLog: [] });
  const avoid = (readLog || []).slice(-10).map((r) => r.title).filter(Boolean);
  const res = await ask({ type: 'reading-test', kind: req.kind, topic: req.topic, level: req.level, sl: req.sl, tl: settings.nativeLang, avoid });
  if (!res.ok) {
    if (mine !== making) return;
    screen('making');
    $('makingText').textContent = failed(res.error);
    return;
  }
  const draft = { test: { ...res.result, what: req.what || req.kind }, answers: {}, id: Date.now(), spent: 0 };
  if (mine !== making) {
    chrome.storage.local.get({ readDraft: null }, (data) => !data.readDraft && chrome.storage.local.set({ readDraft: draft }, () => !$('home').hidden && paintHome()));
    return;
  }
  chrome.storage.local.set({ readDraft: draft });
  openDesk(draft);
}
$('stopMaking').addEventListener('click', paintHome);

// ---------- reading ----------

// A test come back to goes on from the time spent on it, not from when it was begun.
function openDesk(draft) {
  current = { test: draft.test, answers: { ...(draft.answers || {}) }, id: draft.id, started: Date.now() - (draft.spent || 0) };
  checked = null;
  shown = null;
  screen('desk');
  const t = current.test;
  const ielts = t.kind !== 'daily';
  $('deskHead').textContent = ielts ? 'IELTS Reading · ' + KIND_NAMES[t.kind] : slT('readTitle') + ' · ' + slLangName(t.lang) + (t.level ? ' · ' + t.level : '');
  $('title').textContent = t.title;
  $('result').hidden = true;
  $('result').textContent = '';
  $('tapNote').hidden = true;
  $('leave').hidden = false;
  paintText();
  paintQuestions();
  paintAnswered();
  paintGo();
  clearInterval(timer);
  $('timer').hidden = !ielts;
  if (ielts) {
    paintTimer();
    timer = setInterval(paintTimer, 1000);
  }
  $('passageScroll').scrollTop = 0;
  $('qScroll').scrollTop = 0;
}

// The text: its paragraphs lettered (IELTS asks about them by letter), the place a question was
// answered from marked, and, once the answers are checked, every word a button to its meaning.
function paintText() {
  const box = $('text');
  box.textContent = '';
  const lettered = current.test.kind !== 'daily' || current.test.groups.some((g) => g.type === 'headings');
  for (const p of current.test.paragraphs) {
    const para = el('p');
    para.dataset.para = p.label;
    if (lettered) para.append(el('span', 'pl', p.label));
    const range = shown && shown.para === p.label && shown.quote ? rangeOf(p.text, shown.quote) : null;
    if (range) {
      para.append(...words(p.text.slice(0, range[0])));
      const mark = el('mark');
      mark.append(...words(p.text.slice(range[0], range[1])));
      para.append(mark, ...words(p.text.slice(range[1])));
    } else para.append(...words(p.text));
    if (shown && shown.para === p.label && !range) para.classList.add('lit');
    box.append(para);
  }
}

// A piece of the text: as it is while the test is on, as words to tap once it is checked.
function words(text) {
  if (!checked) return [text];
  const out = [];
  let at = 0;
  for (const m of text.matchAll(/\p{L}+(?:['’-]\p{L}+)*/gu)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    const w = el('span', null, m[0]);
    w.dataset.w = m[0];
    out.push(w);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

// Where the words a question was answered from are in a paragraph: as they are, or nearly.
function rangeOf(text, quote) {
  const hay = text.toLowerCase();
  for (const q of [quote, quote.replace(/[.,;:!?"“”]+$/, ''), quote.slice(0, 60)]) {
    const needle = q.toLowerCase().trim();
    if (needle.length < 6) continue;
    const i = hay.indexOf(needle);
    if (i >= 0) return [i, i + needle.length];
  }
  return null;
}

function showInText(item) {
  shown = { para: item.para, quote: item.quote };
  paintText();
  const target = $('text').querySelector('mark') || $('text').querySelector('p.lit');
  if (target) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

$('text').addEventListener('click', (e) => {
  const w = e.target.closest('[data-w]');
  if (!w || !checked) return;
  const p = w.closest('p');
  const r = w.getBoundingClientRect();
  const context = sentenceWith(current.test.paragraphs.find((x) => x.label === p.dataset.para).text, w.dataset.w);
  window.dispatchEvent(new CustomEvent('sl-lookup', { detail: { text: w.dataset.w, context, rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } } }));
});

// ---------- the questions ----------

const numberOf = (item) => item.id.slice(1);
const tfngNames = () =>
  current.test.kind === 'daily' ? { T: slT('readTrue'), F: slT('readFalse'), NG: slT('readNotGiven') } : { T: 'TRUE', F: 'FALSE', NG: 'NOT GIVEN' };
const easy = () => current.test.kind === 'daily' && /^A/.test(current.test.level || '');

function paintQuestions() {
  const qs = $('qs');
  qs.textContent = '';
  for (const g of current.test.groups) {
    const box = el('div', 'qgroup');
    if (g.type === 'headings') {
      box.append(el('h3', null, slT('readHeadings')), el('p', 'how', slT('readHeadingsHow')));
      const list = el('div', 'hlist');
      g.list.forEach((h, i) => {
        const row = el('div');
        row.append(el('b', null, SL_ROMAN[i]), el('span', null, h));
        list.append(row);
      });
      box.append(list);
    } else if (g.type === 'tfng') box.append(el('h3', null, slT('readTfng')), el('p', 'how', slT(easy() ? 'readTfHow' : 'readTfngHow')));
    else if (g.type === 'choice') box.append(el('h3', null, slT('readChoice')), el('p', 'how', slT('readChoiceHow')));
    else box.append(el('h3', null, slT('readGaps')), el('p', 'how', slT('readGapsHow')));
    for (const item of g.items) box.append(question(g, item));
    qs.append(box);
  }
  if (checked) paintResult();
}

// One question: its number, what it asks, the way to answer; once checked, right or wrong, the
// answer, why, and a button to the place in the text.
function question(g, item) {
  const done = !!checked;
  const given = current.answers[item.id];
  const q = el('div', 'q' + (done ? (checked.right[item.id] ? ' right' : ' wrong') : ''));
  q.dataset.id = item.id;
  const stem = el('div', 'stem');
  const body = el('div', 'body');
  const set = (value) => {
    if (checked) return;
    current.answers[item.id] = value;
    keepDraft();
    paintAnswered();
    paintGo();
  };
  if (g.type === 'headings') {
    stem.append(el('span', 'no', numberOf(item)), el('span', null, slT('readParagraph', item.para)));
    const sel = el('select');
    sel.append(Object.assign(el('option', null, '—'), { value: '' }));
    g.list.forEach((_, i) => sel.append(Object.assign(el('option', null, SL_ROMAN[i]), { value: String(i) })));
    sel.value = given != null ? String(given) : '';
    sel.disabled = done;
    sel.addEventListener('change', () => set(sel.value === '' ? undefined : +sel.value));
    const wrap = el('div', 'hsel');
    wrap.append(sel);
    body.append(wrap);
  } else if (g.type === 'tfng') {
    stem.append(el('span', 'no', numberOf(item)), el('span', null, item.q));
    const names = tfngNames();
    const seg = el('div', 'seg');
    for (const v of easy() ? ['T', 'F'] : SL_TFNG) {
      const b = btn(names[v], () => {
        set(v);
        for (const x of seg.children) x.classList.toggle('on', x === b);
      });
      b.classList.toggle('on', given === v);
      if (done) {
        b.disabled = true;
        b.classList.toggle('is', v === item.answer);
        b.classList.toggle('not', given === v && v !== item.answer);
      }
      seg.append(b);
    }
    body.append(seg);
  } else if (g.type === 'choice') {
    stem.append(el('span', 'no', numberOf(item)), el('span', null, item.q));
    const opts = el('div', 'opts');
    item.options.forEach((o, i) => {
      const b = btn([el('b', null, 'ABCD'[i] || ''), el('span', null, o)], () => {
        set(i);
        for (const x of opts.children) x.classList.toggle('on', x === b);
      });
      b.classList.toggle('on', given === i);
      if (done) {
        b.disabled = true;
        b.classList.toggle('is', i === item.answer);
        b.classList.toggle('not', given === i && i !== item.answer);
      }
      opts.append(b);
    });
    body.append(opts);
  } else {
    // The sentence with a box where the gap is.
    const [before, after] = item.q.split('____');
    const input = el('input', 'gap');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = given || '';
    input.disabled = done;
    input.addEventListener('input', () => set(input.value.trim() || undefined));
    const line = el('span');
    line.append(before, input, after || '');
    stem.append(el('span', 'no', numberOf(item)), line);
  }
  q.append(stem);
  if (body.childNodes.length) q.append(body);
  if (done) q.append(explanation(g, item));
  return q;
}

function explanation(g, item) {
  const box = el('div', 'why');
  const answer =
    g.type === 'headings' ? SL_ROMAN[item.answer] + ' · ' + g.list[item.answer] : g.type === 'tfng' ? tfngNames()[item.answer] : g.type === 'choice' ? 'ABCD'[item.answer] + ' · ' + item.options[item.answer] : item.answers.join(' / ');
  box.append(el('span', 'ans', slT('readAnswer', answer)));
  if (item.why) box.append(el('span', null, item.why));
  if (item.para) {
    const link = btn([slIcon('search'), el('span', null, slT('readShow'))], () => showInText(item), 'link');
    box.append(el('br'), link);
  }
  return box;
}

const answeredOf = (test, answers) => test.groups.reduce((n, g) => n + g.items.filter((i) => (answers || {})[i.id] != null).length, 0);

function paintAnswered() {
  const n = answeredOf(current.test, current.answers);
  const pill = $('answered');
  pill.textContent = checked ? slT('readScore', checked.score, checked.total) : slT('readAnswered', n, current.test.total);
  pill.className = 'pill' + (checked || n === current.test.total ? ' enough' : '');
}

// IELTS: twenty minutes for one passage, counting down; then the time over it. Once checked, the
// time it took.
function paintTimer() {
  if (checked) {
    clearInterval(timer);
    $('timer').textContent = slT('readTook', clock(Math.round((checked.at - current.started) / 1000)));
    $('timer').className = 'pill';
    return;
  }
  const left = Math.round((current.started + SL_READ_KINDS[current.test.kind].minutes * 60000 - Date.now()) / 1000);
  $('timer').textContent = left >= 0 ? slT('writeTime', clock(left)) : slT('writeOver', clock(left));
  $('timer').className = 'pill' + (left < 0 ? ' over' : left < 180 ? ' short' : '');
}

function paintGo() {
  if (checked) withKey($('go'), slT('readNew'), '');
  else withKey($('go'), slT('readCheck'), 'Ctrl+Enter');
  $('go').disabled = !checked && !answeredOf(current.test, current.answers);
}

let saving = null;
function keepDraft() {
  clearTimeout(saving);
  const draft = { test: current.test, answers: current.answers, id: current.id, spent: Date.now() - current.started };
  saving = setTimeout(() => chrome.storage.local.set({ readDraft: draft }), 300);
}

// ---------- marking ----------

function check() {
  if (checked || !answeredOf(current.test, current.answers)) return;
  clearTimeout(saving);
  clearInterval(timer);
  checked = { ...slReadingMark(current.test, current.answers), at: Date.now() };
  const t = current.test;
  const band = slReadingBand(checked.score, checked.total, t.kind);
  checked.band = band;
  keep(t, checked, band);
  $('leave').hidden = true;
  $('tapNote').hidden = false;
  paintText();
  paintQuestions();
  paintAnswered();
  paintGo();
  if (t.kind !== 'daily') paintTimer();
  $('qScroll').scrollTop = 0;
  scrollTo({ top: 0, behavior: 'smooth' });
}

// A test checked: in the record of days (with the share right), in the list of tests, and its
// draft done with.
function keep(t, marks, band) {
  const id = current.id;
  slLogPractice('read', Math.round((marks.score / marks.total) * 100));
  chrome.storage.local.get({ readLog: [], readDraft: null }, (data) => {
    const entry = { at: Date.now(), task: t.kind, score: marks.score, total: marks.total, title: t.title, topic: t.topic, lang: t.lang };
    if (band != null) entry.band = band;
    const changes = { readLog: [...(data.readLog || []), entry].slice(-SL_LOG_KEPT) };
    if (data.readDraft && data.readDraft.id === id) changes.readDraft = null;
    chrome.storage.local.set(changes);
  });
}

function paintResult() {
  const box = $('result');
  box.textContent = '';
  box.hidden = false;
  box.className = 'result';
  const big = el('div', 'big', String(checked.score));
  big.append(el('small', null, ' / ' + checked.total));
  box.append(big);
  if (checked.band != null) {
    const band = el('div', 'band all');
    band.append(el('small', null, 'Band'), el('b', null, '≈ ' + checked.band.toFixed(1)));
    box.append(band, el('p', 'note', slT('readBandNote')));
  } else box.append(el('span', null, slT('readScore', checked.score, checked.total)));
}

$('go').addEventListener('click', () => (checked ? paintHome() : check()));
$('leave').addEventListener('click', paintHome);
$('toHome').addEventListener('click', (e) => {
  e.preventDefault();
  paintHome();
});
document.addEventListener('keydown', (e) => {
  if ($('desk').hidden || !(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
  e.preventDefault();
  check();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  slNav('read');
  document.title = slT('readTitle') + ' — SceneLingo';
  $('toHome').append(slIcon('back'), el('span', 't', slT('practiceHome')));
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    chrome.storage.local.get({ readLevel: 'B1' }, (data) => {
      level = SL_LEVELS.includes(data.readLevel) ? data.readLevel : 'B1';
      paintHome();
    });
  });
});
