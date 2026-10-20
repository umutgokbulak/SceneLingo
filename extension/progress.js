// Progress: today's plan, the last seven days of study day by day, what they added up to, and the
// IELTS bands the speaking and writing practice estimated, as they went.
const KINDS = [
  ['review', 'reviews', 'planReview', 10],
  ['listen', 'listen', 'planListen', SL_PLAN.listen],
  ['speak', 'speak', 'planSpeak', SL_PLAN.speak],
  ['write', 'write', 'writeTitle', 1],
];
const SHOWN = 10; // the latest scores shown as bars

let settings = { ...SL_DEFAULTS };

function paint(data) {
  const now = Date.now();
  const words = data.words;
  const log = data.reviewLog || {};
  const stats = slStats(words, log, now);
  $('streak').textContent = String(stats.streak);
  $('streakText').textContent = slT('progressStreak');

  const plan = slTodayPlan(words, log, now, settings.newPerDay);
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
  for (const [, field, label, goal] of KINDS) {
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
  metric(slT('statLearned'), String(stats.learned), slT('progressOfAll', stats.total));

  // IELTS: the bands of the latest answers and texts, on average, and each one as a bar.
  const shownBands = (log, keys, title) => {
    const box = el('div', 'metric');
    const recent = (log || []).slice(-SHOWN);
    box.append(el('small', null, title));
    if (!recent.length) {
      box.append(el('div', 'empty-note', slT('progressNone')));
      return box;
    }
    const mean = slIeltsOverall(averageBands(recent.slice(-5), keys), keys);
    const b = el('b', null, 'Band ' + mean.toFixed(1));
    b.append(el('em', null, slT('progressLast', Math.min(5, recent.length))));
    const trend = el('div', 'trend');
    for (const r of recent) {
      const overall = slIeltsOverall(r.bands, keys);
      const bar = el('i');
      // From band 4 to band 9: the steps between the bands people practise at show.
      bar.style.height = Math.round((Math.max(0.5, overall - 4) / 5) * 100) + '%';
      bar.title = new Date(r.at).toLocaleDateString(slUiLang) + ': ' + overall.toFixed(1);
      trend.append(bar);
    }
    box.append(b, trend);
    return box;
  };
  const speaking = data.speakLog || [];
  const writing = data.writeLog || [];
  $('ielts').hidden = settings.learnLang !== 'en' && !speaking.length && !writing.length;
  $('bands').textContent = '';
  $('bands').append(shownBands(speaking, SL_SPEAKING_KEYS, 'Speaking'), shownBands(writing, SL_WRITING_KEYS, 'Writing'));

  $('usage').textContent = '';
  if (data.geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
}

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('progressTitle') + ' — SceneLingo';
  $('toReview').append(slIcon('cards'), el('span', 't', slT('reviewTitle')));
  $('toWords').append(slIcon('search'), el('span', 't', slT('wordsTitle')));
  const load = () => chrome.storage.local.get({ words: [], reviewLog: {}, speakLog: [], writeLog: [], geminiKey: '', geminiUsage: null }, paint);
  load();
  // Coming back to the tab after practising elsewhere: up to date.
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && load());
});
