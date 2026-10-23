// Writing practice. Everyday messages and letters, in the language being learnt and at a level;
// and, in English, the IELTS Writing tasks. Each text is put right by Gemini, with a better version
// to learn from and, for IELTS, an estimated band on the four criteria. What is being written is
// kept as it is typed, so that nothing is lost when the page is closed.
const IELTS = {
  task1a: { name: 'Task 1 · Academic', minutes: 20, words: 150, sub: 'writeAcademicSub' },
  task1g: { name: 'Task 1 · General Training', minutes: 20, words: 150, sub: 'writeGeneralSub' },
  task2: { name: 'Task 2', minutes: 40, words: 250, sub: 'writeEssaySub' },
};
const criteriaOf = (task) => [
  ['task', task === 'task2' ? 'writeTaskResponse' : 'writeTaskAchievement'],
  ['coherence', 'writeCoherence'],
  ['lexical', 'practiceLexical'],
  ['grammar', 'practiceGrammar'],
];

let settings = { ...SL_DEFAULTS };
let geminiKey = '';
let level = 'B1';
let current = null; // the task being written
let checked = false;
let timer = null;
let saving = null;
let saved = []; // the saved words, as they were when the page was opened: to choose words to try

const learnt = () => settings.learnLang;
const inUi = (texts) => texts[slUiLang] || texts.en;

function screen(id) {
  for (const s of ['home', 'desk']) $(s).hidden = s !== id;
  $('toHome').hidden = id === 'home';
  scrollTo(0, 0);
}

// ---------- choosing ----------

function paintHome() {
  screen('home');
  clearInterval(timer);
  $('noKey').hidden = !!geminiKey;
  $('noKey').textContent = slT('practiceNoKey');
  const lv = $('level');
  lv.textContent = '';
  for (const l of SL_LEVELS) lv.append(Object.assign(el('option', null, l), { value: l }));
  lv.value = level;
  const tasks = $('tasks');
  tasks.textContent = '';
  for (const w of SL_WRITES) {
    const tile = btn([el('span', 'ic', w.icon), el('span', null, inUi(w.title))], () => startDaily(w), 'tile');
    tile.disabled = !geminiKey;
    tasks.append(tile);
  }
  $('ieltsBox').hidden = learnt() !== 'en';
  const parts = $('parts');
  parts.textContent = '';
  for (const [task, t] of Object.entries(IELTS)) {
    const tile = btn([el('b', null, t.name), el('small', null, slT(t.sub))], () => startIelts(task), 'tile');
    tile.disabled = !geminiKey;
    parts.append(tile);
  }
  chrome.storage.local.get({ writeLog: [], writeDraft: null, geminiUsage: null }, (data) => {
    const recent = (data.writeLog || []).slice(-5);
    $('last').textContent = '';
    const mean = averageBands(recent, SL_WRITING_KEYS);
    if (mean) $('last').append(slT('writeLast', recent.length) + ' ', el('b', null, 'Band ' + slIeltsOverall(mean, SL_WRITING_KEYS).toFixed(1)));
    $('usage').textContent = '';
    if (geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
    // A text left half-written: back to it, or away with it.
    const draft = data.writeDraft;
    const resume = $('resume');
    resume.textContent = '';
    resume.hidden = !(draft && draft.text && draft.task);
    if (resume.hidden) return;
    resume.append(
      el('span', null, slT('writeResume', titleOf(draft.task), slWordCount(draft.text))),
      btn(slT('writeDiscard'), () => chrome.storage.local.set({ writeDraft: null }, paintHome), 'btn small ghost'),
      btn(slT('writeContinue'), () => openDesk(draft.task, draft.text), 'btn small primary')
    );
  });
}
$('level').addEventListener('change', () => {
  level = $('level').value;
  chrome.storage.local.set({ writeLevel: level });
});

const titleOf = (task) => (task.kind === 'ielts' ? 'IELTS ' + IELTS[task.task].name : inUi(SL_WRITES.find((w) => w.id === task.id).title));

function startDaily(w) {
  openDesk(
    {
      kind: 'daily',
      id: w.id,
      level,
      lang: learnt(),
      tries: slWordsToTry(saved, learnt(), 3),
      started: Date.now(),
    },
    ''
  );
}

// A new task written by Gemini, on a subject not met lately (and for Academic Task 1, a figure of
// a kind in turn: a line graph, a bar chart, pie charts or a table); one of those kept here if
// Gemini does not answer.
let figureTurn = Math.floor(Math.random() * SL_CHART_KINDS.length);
async function startIelts(task) {
  if (!geminiKey) return startKept(task);
  screen('desk');
  $('deskHead').textContent = '';
  $('task').textContent = '';
  $('task').append(el('div', 'muted making', slT('writeMaking')));
  $('deskTry').hidden = true;
  $('text').disabled = true;
  $('go').disabled = true;
  const kind = SL_CHART_KINDS[figureTurn++ % SL_CHART_KINDS.length];
  const { writeTopics } = await chrome.storage.local.get({ writeTopics: [] });
  const res = await ask({ type: 'ielts-task', task, kind, avoid: writeTopics || [] });
  if ($('desk').hidden) return; // left while it was being written
  if (!res.ok) return startKept(task);
  const r = res.result;
  const t = { kind: 'ielts', task, lang: 'en', started: Date.now(), tries: task === 'task1a' ? [] : slWordsToTry(saved, 'en', 3), fresh: true };
  if (task === 'task1g') {
    t.prompt = r.situation + ' Write a letter about it.';
    t.points = r.points;
  } else t.prompt = r.prompt;
  if (r.table) t.table = r.table;
  const topic = r.table ? r.table.title : r.situation || r.prompt;
  chrome.storage.local.set({ writeTopics: [topic, ...(writeTopics || [])].slice(0, 15) });
  openDesk(t, '');
}

function startKept(task) {
  const t = { kind: 'ielts', task, lang: 'en', started: Date.now(), tries: task === 'task1a' ? [] : slWordsToTry(saved, 'en', 3) };
  if (task === 'task2') t.prompt = pick(SL_WRITING.task2);
  if (task === 'task1g') {
    const letter = pick(SL_WRITING.letters);
    t.prompt = letter.situation + ' Write a letter about it.';
    t.points = letter.points;
  }
  if (task === 'task1a') {
    t.table = pick(SL_WRITING.tables);
    t.prompt = 'The table below gives information about ' + t.table.title.charAt(0).toLowerCase() + t.table.title.slice(1) + '. Summarise the information by selecting and reporting the main features, and make comparisons where relevant.';
  }
  openDesk(t, '');
}

// ---------- writing ----------

function openDesk(task, text) {
  current = task;
  checked = false;
  screen('desk');
  const head = $('deskHead');
  head.textContent = '';
  const box = $('task');
  box.textContent = '';
  if (task.kind === 'ielts') {
    head.append(el('span', 'label', 'IELTS · ' + IELTS[task.task].name));
    if (task.fresh) head.append(el('span', null, '· ' + slT('writeFresh')));
    box.append(el('div', 'task' + (task.task === 'task2' ? ' essay' : ''), task.prompt));
    if (task.points) {
      const ul = el('ul', 'points');
      ul.append(el('li', 'lead', slT('practiceYouShouldSay')), ...task.points.map((p) => el('li', null, p)));
      box.append(ul);
    }
    if (task.table) box.append(figures(task.table));
    if (task.task === 'task2') box.append(el('div', 'sub', 'Give reasons for your answer and include any relevant examples from your own knowledge or experience.'));
  } else {
    const w = SL_WRITES.find((x) => x.id === task.id);
    head.append(el('span', null, w.icon), el('span', 'label', inUi(w.title)), el('span', null, '· ' + slLangName(task.lang) + ' · ' + task.level));
    box.append(el('div', 'task', inUi(w.task)));
    const points = inUi(w.points);
    if (points.length) {
      const ul = el('ul', 'points');
      ul.append(el('li', 'lead', slT('practiceYouShouldSay')), ...points.map((p) => el('li', null, p)));
      box.append(ul);
    }
  }
  wordsToTry($('deskTry'), task.tries || []);
  $('text').value = text || '';
  $('text').disabled = false;
  $('fb').hidden = true;
  $('fb').textContent = '';
  $('saved').textContent = '';
  $('leave').hidden = false;
  paintCount();
  paintGo();
  clearInterval(timer);
  $('timer').hidden = task.kind !== 'ielts';
  if (task.kind === 'ielts') {
    paintTimer();
    timer = setInterval(paintTimer, 1000);
  }
  $('text').focus();
}

// The figure: drawn as a graph or chart when it is one, with its numbers to open as a table; or
// the table itself.
function figures(fig) {
  const svg = typeof slChartSvg === 'function' ? slChartSvg(fig) : null;
  if (!svg) return tableOf(fig);
  const box = el('div', 'figure');
  box.append(el('div', 'figtitle', fig.title + (fig.unit ? ' (' + fig.unit + ')' : '')));
  const drawing = el('div', 'drawing');
  drawing.innerHTML = svg; // drawn from numbers and escaped text only (charts.js)
  const numbers = el('details', 'numbers');
  numbers.append(el('summary', null, slT('writeNumbers')), tableOf(fig));
  box.append(drawing, numbers);
  return box;
}

function tableOf(table) {
  const wrap = el('div', 'figures');
  const t = el('table');
  const caption = el('caption', null, table.title);
  const head = el('tr');
  for (const c of table.columns) head.append(el('th', null, c));
  t.append(caption, head);
  for (const r of table.rows) {
    const row = el('tr');
    for (const c of r) row.append(el('td', null, c));
    t.append(row);
  }
  wrap.append(t);
  return wrap;
}

const target = () => (current.kind === 'ielts' ? IELTS[current.task].words : SL_WRITE_WORDS[current.level] || 80);

function paintCount() {
  const n = slWordCount($('text').value);
  const goal = target();
  const pill = $('count');
  pill.textContent = current.kind === 'ielts' ? slT('writeWords', n, goal) : slT('writeWordsAbout', n, goal);
  pill.className = 'pill ' + (n >= goal ? 'enough' : n ? 'short' : '');
  markUsed($('deskTry'), $('text').value);
}

// IELTS: the time the task is given, counting down; then the time over it.
function paintTimer() {
  if (checked) return clearInterval(timer);
  const left = Math.round((current.started + IELTS[current.task].minutes * 60000 - Date.now()) / 1000);
  $('timer').textContent = left >= 0 ? slT('writeTime', clock(left)) : slT('writeOver', clock(left));
  $('timer').className = 'pill' + (left < 0 ? ' over' : left < 300 ? ' short' : '');
}

function paintGo() {
  if (checked) withKey($('go'), slT('writeNew'), '');
  else withKey($('go'), slT('writeCheck'), 'Ctrl+Enter');
  $('go').disabled = !checked && !slWordCount($('text').value);
}

// What is typed is kept a moment after typing stops.
function keepDraft() {
  clearTimeout(saving);
  saving = setTimeout(() => {
    chrome.storage.local.set({ writeDraft: { task: current, text: $('text').value, at: Date.now() } }, () => ($('saved').textContent = slT('writeSaved')));
  }, 600);
}

$('text').addEventListener('input', () => {
  paintCount();
  paintGo();
  keepDraft();
});

async function check() {
  const text = $('text').value.trim();
  if (checked || !slWordCount(text)) return;
  clearTimeout(saving);
  checked = true;
  clearInterval(timer);
  $('text').disabled = true;
  $('go').disabled = true;
  $('leave').hidden = true;
  const fb = $('fb');
  fb.hidden = false;
  fb.textContent = '';
  fb.append(el('div', 'muted', slT(current.kind === 'ielts' ? 'writeCheckingIelts' : 'writeChecking')));
  fb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const task = current;
  const w = task.kind === 'daily' && SL_WRITES.find((x) => x.id === task.id);
  const res =
    task.kind === 'ielts'
      ? await ask({ type: 'ielts-writing', task: task.task, prompt: task.prompt, points: task.points, table: task.table, text, words: task.tries, tl: settings.nativeLang })
      : await ask({ type: 'everyday-writing', task: w.task.en, points: w.points.en, level: task.level, text, words: task.tries, sl: task.lang, tl: settings.nativeLang });
  if (res.ok) keepText(task, res.result);
  // Another task was begun while this text was being read: its score is kept, and the page (and
  // the draft of the new text) are left as they are.
  if (current !== task) return;
  fb.textContent = '';
  if (!res.ok) {
    // Not lost: still there, to be sent again.
    checked = false;
    $('text').disabled = false;
    $('leave').hidden = false;
    fb.append(el('div', 'notice', failed(res.error)));
    paintGo();
    return;
  }
  paintFeedback(fb, res.result, w);
  paintGo();
}

// A text read by Gemini: in the record of days and, for IELTS, the list of scores; the words used
// on their cards; and its draft, done with.
function keepText(task, r) {
  slLogPractice('write');
  rememberUsed(r.used, slT('writeTitle'));
  chrome.storage.local.get({ writeLog: [], writeDraft: null }, (data) => {
    const changes = {};
    if (task.kind === 'ielts') changes.writeLog = [...(data.writeLog || []), { at: Date.now(), task: task.task, bands: r.bands }].slice(-SL_LOG_KEPT);
    if (data.writeDraft && data.writeDraft.task && data.writeDraft.task.started === task.started) changes.writeDraft = null;
    chrome.storage.local.set(changes);
  });
}

function paintFeedback(fb, r, w) {
  const add = (...nodes) => fb.append(...nodes.filter(Boolean));
  const ielts = current.kind === 'ielts';
  if (ielts) {
    const overall = slIeltsOverall(r.bands, SL_WRITING_KEYS);
    add(bandsBox(r.bands, overall, criteriaOf(current.task)));
  } else {
    const lv = el('div', 'level');
    lv.append(el('small', null, slT('writeLevel')), el('b', null, r.level || '—'), el('small', null, slT('writeLevelGoal', current.level)));
    add(lv);
    if (r.points.length) {
      const checks = el('div', 'checks');
      const shown = inUi(w.points);
      r.points.forEach((p, i) => checks.append(el('div', p.done ? 'yes' : 'no', (p.done ? '✓ ' : '✗ ') + (shown[i] || p.point))));
      add(checks);
    }
  }
  add(r.summary && el('div', 'summary', r.summary), fixesBlock(r.corrections));
  if (r.better) {
    const model = el('div', 'model');
    model.append(el('p', null, r.better));
    add(block(slT(ielts ? 'writeBetterIelts' : 'writeBetter'), model));
  }
  const title = ielts ? 'IELTS Writing · ' + IELTS[current.task].name : slT('writeTitle') + ' · ' + inUi(w.title);
  add(rewriteBlock(r.rewrite || []));
  add(
    phrasesBlock(r.phrases, (p) => ({ word: p.text, kind: /\s/.test(p.text) ? 'phrase' : 'word', translation: p.meaning, context: sentenceWith(r.better, p.text), contextMeaning: p.meaning, senseEngine: 'gemini', sensed: true, lang: current.lang, title })),
    usedBlock(r.used)
  );
  const after = el('div', 'after');
  const again = { ...current, started: Date.now() };
  after.append(btn(slT('writeAgain'), () => openDesk(again, ''), 'btn'), btn(slT('writeNew'), paintHome, 'btn primary'));
  add(after);
}

// A few sentences of the text to write again, each as asked ("join them with a relative clause"):
// written, checked by Gemini, and then the model shown. Writing it oneself is what is learnt from;
// reading the better version alone is not.
function rewriteBlock(list) {
  if (!list.length) return null;
  const lang = current.lang;
  return block(
    slT('writeRewrite'),
    el('p', 'muted rwhow', slT('writeRewriteHow')),
    ...list.map((r) => {
      const box = el('div', 'rw');
      box.append(el('div', 'rwfrom', '“' + r.sentence + '”'), el('div', 'rwaim', r.aim));
      const input = el('textarea');
      input.rows = 2;
      input.spellcheck = false;
      input.placeholder = slT('writeRewritePh');
      const out = el('div', 'rwout');
      const go = btn(slT('writeRewriteCheck'), async () => {
        const attempt = input.value.trim();
        if (!attempt) return;
        go.disabled = true;
        input.disabled = true;
        out.textContent = slT('writeChecking');
        const res = await ask({ type: 'rewrite-check', original: r.sentence, aim: r.aim, attempt, sl: lang, tl: settings.nativeLang });
        out.textContent = '';
        if (!res.ok) {
          go.disabled = false;
          input.disabled = false;
          out.append(el('div', 'notice', failed(res.error)));
          return;
        }
        const v = res.result;
        out.append(el('div', v.ok ? 'yes' : 'no', (v.ok ? '✓ ' : '≈ ') + v.note));
        if (v.better && !v.ok) out.append(el('div', 'rwbetter', v.better));
        const model = el('div', 'rwmodel');
        model.append(el('small', null, slT('writeRewriteModel')), el('span', null, r.model));
        out.append(model);
      }, 'btn small');
      const show = btn(slT('writeRewriteShow'), () => {
        show.remove();
        const model = el('div', 'rwmodel');
        model.append(el('small', null, slT('writeRewriteModel')), el('span', null, r.model));
        out.append(model);
      }, 'btn small ghost');
      const row = el('div', 'rwbtns');
      row.append(go, show);
      box.append(input, row, out);
      return box;
    })
  );
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
  slNav('write');
  document.title = slT('writeTitle') + ' — SceneLingo';
  $('toHome').append(slIcon('back'), el('span', 't', slT('practiceHome')));
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    chrome.storage.local.get({ words: [], writeLevel: 'B1' }, (data) => {
      saved = data.words;
      level = SL_LEVELS.includes(data.writeLevel) ? data.writeLevel : 'B1';
      paintHome();
    });
  });
});
