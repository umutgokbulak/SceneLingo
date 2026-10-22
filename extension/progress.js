// Progress: today's plan, the last seven days of study day by day, what they added up to, and the
// IELTS bands the speaking, writing and reading practice estimated, as they went.
// [kind, its count in the record of days, its name, what fills a day's cell]
const kinds = (goals) => [
  ['review', 'reviews', 'planReview', 10],
  ['listen', 'listen', 'planListen', goals.listen || SL_PLAN.listen],
  ['speak', 'speak', 'planSpeak', goals.speak || SL_PLAN.speak],
  ['write', 'write', 'writeTitle', 1],
  ['read', 'read', 'readTitle', 1],
];
// What can be chosen as a goal.
const GOALS = [
  ['goalListen', 'planListen', [0, 3, 5, 10, 15, 20]],
  ['goalSpeak', 'planSpeak', [0, 1, 2, 3]],
  ['goalWrite', 'planWrite', [0, 1, 2, 3, 5, 7]],
  ['goalRead', 'planRead', [0, 1, 2, 3, 5, 7]],
];
const SHOWN = 10; // the latest scores shown as bars

let settings = { ...SL_DEFAULTS };
const load = () => chrome.storage.local.get({ words: [], reviewLog: {}, speakLog: [], writeLog: [], readLog: [], levelLog: [], geminiKey: '', geminiUsage: null }, paint);

function paint(data) {
  const now = Date.now();
  const words = data.words;
  const log = data.reviewLog || {};
  const stats = slStats(words, log, now);
  $('streak').textContent = String(stats.streak);
  $('streakText').textContent = slT('progressStreak');

  const goals = slGoals(settings);
  const plan = slTodayPlan(words, log, now, settings.newPerDay, goals);
  const go = (id) => (location.href = SL_PLAN_PAGES[id]);
  $('plan').textContent = '';
  $('plan').append(slPlanBox(plan, go), slPlanNext(plan, go));

  // The week: a row for each kind of practice, a column for each day. A day that met its goal is
  // full; one with some of it, lit.
  const week = slWeek(words, log, now);
  $('active').textContent = slT('progressActive', week.active);
  const grid = $('grid');
  grid.textContent = '';
  const dayName = new Intl.DateTimeFormat(slUiLang, { weekday: 'short' });
  grid.append(el('span'));
  for (const d of week.days) grid.append(el('span', 'day' + (d.key === week.days[6].key ? ' today' : ''), dayName.format(new Date(d.at))));
  for (const [, field, label, goal] of kinds(goals)) {
    grid.append(el('span', 'kind', slT(label)));
    for (const d of week.days) {
      const n = d[field] || 0;
      const cell = el('span', 'cell' + (n >= goal ? ' full' : n ? ' on' : ''), n ? String(n) : '');
      cell.title = slT(label) + ': ' + n;
      grid.append(cell);
    }
  }

  const metrics = $('metrics');
  metrics.textContent = '';
  const metric = (label, value, extra) => {
    const m = el('div', 'metric');
    const b = el('b', null, value);
    if (extra) b.append(el('em', null, extra));
    m.append(el('small', null, label), b);
    metrics.append(m);
  };
  metric(slT('progressReviews'), String(week.reviews), week.retention != null ? slT('percent', week.retention) + ' ' + slT('progressRight') : '');
  metric(slT('progressSaved'), String(week.saved), week.started ? slT('progressStarted', week.started) : '');
  metric(slT('progressListened'), String(week.listened), week.heard != null ? slT('percent', week.heard) + ' ' + slT('progressHeard') : '');
  metric(slT('progressSpoken'), String(week.spoken));
  metric(slT('progressWritten'), String(week.written));
  metric(slT('progressRead'), String(week.read), week.understood != null ? slT('percent', week.understood) + ' ' + slT('progressUnderstood') : '');
  metric(slT('statLearned'), String(stats.learned), slT('progressOfAll', stats.total));

  // IELTS: the bands of the latest answers, texts and tests, on average, and each one as a bar.
  // `overall` is a record's band.
  const shownBands = (log, overall, title) => {
    const box = el('div', 'metric');
    const recent = (log || []).slice(-SHOWN);
    box.append(el('small', null, title));
    if (!recent.length) {
      box.append(el('div', 'empty-note', slT('progressNone')));
      return box;
    }
    const last = recent.slice(-5);
    const mean = Math.round((last.reduce((a, r) => a + overall(r), 0) / last.length) * 2) / 2;
    const b = el('b', null, 'Band ' + mean.toFixed(1));
    b.append(el('em', null, slT('progressLast', Math.min(5, recent.length))));
    const trend = el('div', 'trend');
    for (const r of recent) {
      const band = overall(r);
      const bar = el('i');
      // From band 4 to band 9: the steps between the bands people practise at show.
      bar.style.height = Math.round((Math.max(0.5, band - 4) / 5) * 100) + '%';
      bar.title = new Date(r.at).toLocaleDateString(slUiLang) + ': ' + band.toFixed(1);
      trend.append(bar);
    }
    box.append(b, trend);
    return box;
  };
  // The vocabulary: the latest level test of the language being learnt, and the ones before it.
  const tests = (data.levelLog || []).filter((r) => r.lang === settings.learnLang);
  const last = tests[tests.length - 1];
  $('vocabText').textContent = '';
  if (last) $('vocabText').append(el('span', 'vocabbig', '~' + last.size.toLocaleString(slUiLang)), slT('progressLevelLast', last.level, slAgo(last.at)));
  else $('vocabText').textContent = slT('progressLevelNone');
  $('vocabTrend').textContent = '';
  if (tests.length > 1) {
    for (const r of tests.slice(-12)) {
      const bar = el('i');
      bar.style.height = Math.max(8, Math.round((r.size / 20000) * 100)) + '%';
      bar.title = new Date(r.at).toLocaleDateString(slUiLang) + ': ' + r.size;
      $('vocabTrend').append(bar);
    }
  }

  const speaking = data.speakLog || [];
  const writing = data.writeLog || [];
  const reading = (data.readLog || []).filter((r) => r.band != null);
  $('ielts').hidden = settings.learnLang !== 'en' && !speaking.length && !writing.length && !reading.length;
  $('bands').textContent = '';
  $('bands').append(
    shownBands(speaking, (r) => slIeltsOverall(r.bands, SL_SPEAKING_KEYS), 'Speaking'),
    shownBands(writing, (r) => slIeltsOverall(r.bands, SL_WRITING_KEYS), 'Writing'),
    shownBands(reading, (r) => r.band, 'Reading')
  );

  $('usage').textContent = '';
  if (data.geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
}

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  slNav('today');
  $('toLevel').append(slIcon('chart'), el('span', null, slT('levelTitle')));
  document.title = slT('progressTitle') + ' — SceneLingo';
  // The goals of today's plan, each a choice; the plan follows at once.
  const box = $('goals');
  for (const [key, label, options] of GOALS) {
    const row = el('label', 'goal');
    const sel = el('select');
    for (const n of options) sel.append(Object.assign(el('option', null, n ? String(n) : slT('goalOff')), { value: n }));
    sel.value = settings[key];
    sel.addEventListener('change', () => {
      settings[key] = +sel.value;
      chrome.storage.sync.set({ [key]: settings[key] }, load);
    });
    row.append(el('span', null, slT(label)), sel);
    box.append(row);
  }
  // The daily reminder: a notification from the browser, so not on the phone.
  if (chrome.runtime.getManifest().version !== 'web') {
    $('remindRow').hidden = false;
    $('remindOn').checked = settings.remindOn;
    $('remindAt').value = settings.remindAt;
    $('remindAt').disabled = !settings.remindOn;
    $('remindOn').addEventListener('change', () => {
      $('remindAt').disabled = !$('remindOn').checked;
      chrome.storage.sync.set({ remindOn: $('remindOn').checked });
    });
    $('remindAt').addEventListener('change', () => $('remindAt').value && chrome.storage.sync.set({ remindAt: $('remindAt').value }));
  }
  load();
  // Coming back to the tab after practising elsewhere: up to date.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
});
