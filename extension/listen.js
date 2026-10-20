// Listening: a saved sentence is read out, and what was heard is typed. Then, word by word, what
// was heard right, what nearly, and what not; and what the sentence means.
const $ = (id) => document.getElementById(id);
const ROUND = 10; // sentences at a time
const DAY = 86400000;

let settings = { ...SL_DEFAULTS };
let rest = {}; // sentence -> until when it is not asked again
let round = [];
let at = 0;
let results = []; // { text, score }
let checked = false;
let plays = 0;
let hintLevel = 0;
const audio = new Audio();

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (content, onClick, cls) => {
  const b = el('button', cls);
  for (const c of [].concat(content)) b.append(c);
  b.addEventListener('click', onClick);
  return b;
};
const withKey = (button, label, key) => {
  button.textContent = '';
  button.append(el('span', null, label));
  if (key) button.append(el('kbd', null, key));
};
const ask = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' } : res)));
const verdictOf = (score) => (score >= 0.9 ? 'right' : score >= 0.6 ? 'close' : 'wrong');
const sentence = () => round[at];

// ---------- the voice ----------

function play(slow) {
  const s = sentence();
  if (!s) return;
  plays++;
  paintTimes();
  const lang = s.lang === 'en' ? settings.accent : s.lang;
  ask({ type: 'tts', text: s.text, lang, slow: !!slow }).then((res) => {
    // On the phone the page speaks for itself, and says so.
    if (!res.ok) return;
    audio.src = 'data:audio/mpeg;base64,' + res.result;
    audio.volume = Math.min(1, settings.speechVolume / 100);
    audio.playbackRate = slow ? 0.7 : 1;
    audio.play().catch(() => {});
  });
  if (!checked) $('typed').focus();
}
audio.addEventListener('playing', () => $('play').classList.add('on'));
for (const e of ['ended', 'pause', 'error']) audio.addEventListener(e, () => $('play').classList.remove('on'));

function paintTimes() {
  $('times').textContent = plays > 1 ? slT('listenPlays', plays) : '';
}

// ---------- one sentence ----------

function paintTop() {
  const total = round.length;
  $('bar').style.width = total ? Math.round((at / total) * 100) + '%' : '0';
  $('count').textContent = total && at < total ? at + 1 + ' / ' + total : '';
}

function show() {
  paintTop();
  const s = sentence();
  if (!s) return showEnd();
  checked = false;
  plays = 0;
  hintLevel = 0;
  $('card').hidden = false;
  $('end').hidden = true;
  const head = $('head');
  head.textContent = '';
  head.append(el('span', 'label', slT('listenAsk')));
  if (s.title) head.append(el('span', null, '· ' + slSourceName(s.title)));
  if (s.source && s.source.url) head.append(btn([slIcon('play'), slT('openScene')], () => ask({ type: 'open-scene', url: s.source.url, time: s.source.time }), 'link'));
  $('typed').value = '';
  $('typed').disabled = false;
  $('mask').hidden = true;
  $('result').hidden = true;
  $('result').textContent = '';
  $('hint').hidden = false;
  $('giveUp').hidden = false;
  withKey($('go'), slT('checkAnswer'), 'Enter');
  paintTimes();
  play(false);
}

// One more word of the sentence, the rest as gaps.
function giveHint() {
  if (checked) return;
  hintLevel++;
  $('mask').hidden = false;
  $('mask').textContent = sentence()
    .text.split(' ')
    .map((w, i) => (i < hintLevel ? w : w.replace(/[\p{L}\p{N}]/gu, '_')))
    .join(' ');
  $('typed').focus();
}

function check() {
  if (checked) return next();
  const s = sentence();
  const { parts, score } = slDictation(s.text, $('typed').value);
  checked = true;
  // A hint is help: the sentence counts as heard, not as heard right.
  const counted = hintLevel ? Math.min(score, 0.89) : score;
  results.push({ text: s.text, score: counted });
  // Heard right, it rests a week; nearly, three days; missed, it comes back tomorrow.
  rest[s.key] = Date.now() + (counted >= 0.9 ? 7 : counted >= 0.6 ? 3 : 1) * DAY;
  saveRest();
  $('typed').disabled = true;
  $('mask').hidden = true;
  $('hint').hidden = true;
  $('giveUp').hidden = true;
  withKey($('go'), slT(at + 1 < round.length ? 'listenNext' : 'listenFinish'), 'Enter');

  const box = $('result');
  box.textContent = '';
  const v = verdictOf(counted);
  const bar = el('div', 'scorebar');
  bar.append(el('span', 'verdict ' + v, (v === 'right' ? '✓ ' : v === 'close' ? '≈ ' : '✗ ') + slT('listenScore', Math.round(score * 100))));
  box.append(bar);
  const line = el('div', 'heard');
  for (const p of parts) {
    const w = el('span', p.state === 'right' ? null : p.state, p.word);
    if (p.typed && p.state !== 'right') {
      w.title = slT('listenYouTyped', p.typed);
      w.append(el('s', null, p.typed));
    }
    line.append(w, ' ');
  }
  box.append(line);
  if (s.translation) box.append(el('div', 'meaning', '“' + s.translation + '”'));
  if (s.word) {
    const w = el('div', 'word');
    w.append(el('b', null, s.word));
    if (s.meaning) w.append(el('span', null, '— ' + s.meaning));
    box.append(w);
  }
  if (parts.some((p) => p.state !== 'right')) {
    const legend = el('div', 'legend');
    const key = (color, label) => {
      const k = el('span');
      const i = el('i');
      i.style.background = color;
      k.append(i, label);
      legend.append(k);
    };
    if (parts.some((p) => p.state === 'close')) key('var(--gold)', slT('listenClose'));
    if (parts.some((p) => p.state === 'wrong' || p.state === 'missed')) key('var(--red)', slT('listenMissed'));
    if (parts.some((p) => p.state === 'extra')) key('var(--muted)', slT('listenExtra'));
    box.append(legend);
  }
  box.hidden = false;
  // Heard once more, now that it can be followed word by word.
  if (score < 1) play(false);
}

function next() {
  at++;
  show();
}

function saveRest() {
  const now = Date.now();
  for (const k of Object.keys(rest)) if (rest[k] < now) delete rest[k];
  chrome.storage.local.set({ listenRest: rest });
}

// ---------- the round ----------

function showEnd() {
  $('card').hidden = true;
  const end = $('end');
  end.hidden = false;
  end.textContent = '';
  if (!results.length) {
    end.append(el('h2', null, slT('listenNoneTitle')), el('p', null, slT('listenNone')));
    const row = el('div', 'row');
    row.append(btn(slT('wordsTitle'), () => (location.href = 'words.html'), 'btn'));
    end.append(row);
    return;
  }
  const average = results.reduce((a, r) => a + r.score, 0) / results.length;
  end.append(el('div', 'big', slT('percent', Math.round(average * 100))), el('h2', null, slT('listenDoneTitle')), el('p', null, slT('listenDone', results.length)));
  const list = el('div', 'list');
  for (const r of results) {
    const row = el('div');
    row.append(el('b', verdictOf(r.score), slT('percent', Math.round(r.score * 100))), el('span', null, r.text));
    list.append(row);
  }
  end.append(list);
  const row = el('div', 'row');
  row.append(btn(slT('listenAgain'), startRound, 'btn primary'), btn(slT('reviewTitle'), () => (location.href = 'review.html'), 'btn'));
  end.append(row);
}

function startRound() {
  chrome.storage.local.get({ words: [], listenRest: {} }, (data) => {
    rest = data.listenRest || {};
    round = slDictationPool(data.words, settings.learnLang, rest, Date.now(), ROUND);
    at = 0;
    results = [];
    show();
  });
}

// ---------- the keys ----------

$('play').append(slIcon('speaker'));
$('play').addEventListener('click', () => play(false));
$('slow').addEventListener('click', () => play(true));
$('hint').addEventListener('click', giveHint);
$('giveUp').addEventListener('click', () => {
  $('typed').value = '';
  check();
});
$('go').addEventListener('click', check);
$('typed').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    check();
  }
});
document.addEventListener('keydown', (e) => {
  if ($('card').hidden) return;
  // Ctrl+Space: once more; Ctrl+Shift+Space: slowly. They work while typing.
  if (e.ctrlKey && e.code === 'Space') play(e.shiftKey);
  else if (checked && e.key === 'Enter' && !/^(BUTTON|A)$/.test(e.target.tagName)) next();
  else return;
  e.preventDefault();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('listenTitle') + ' — SceneLingo';
  $('toReview').append(slIcon('cards'), el('span', 't', slT('reviewTitle')));
  $('toWords').append(slIcon('search'), el('span', 't', slT('wordsTitle')));
  $('hint').textContent = '';
  $('hint').append(slIcon('bulb'), slT('listenHint'));
  $('play').title = slT('reviewListen') + ' (Ctrl+Space)';
  $('slow').title = slT('reviewSlow') + ' (Ctrl+Shift+Space)';
  startRound();
});
