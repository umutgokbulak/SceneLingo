// Listening: a saved sentence is read out, and what was heard is typed. Then, word by word, what
// was heard right, what nearly, and what not; and what the sentence means.
const $ = (id) => document.getElementById(id);
const ROUND = 10; // sentences at a time
const DAY = 86400000;
const GLOSS_KEPT = 300; // sentences whose parts are kept, so that Gemini is asked once for each

let settings = { ...SL_DEFAULTS };
let round = [];
let at = 0;
let results = []; // { text, score }
let checked = false;
let plays = 0;
let hintLevel = 0;
let geminiKey = ''; // shown form only: whether there is a key
let saved = new Set(); // the saved words, in lower case
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
  glossOf(s);
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
  slLogPractice('listen', Math.round(counted * 100));
  // Heard right, it rests a week; nearly, three days; missed, it comes back tomorrow.
  restUntil(s.key, Date.now() + (counted >= 0.9 ? 7 : counted >= 0.6 ? 3 : 1) * DAY);
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
    // A word of the sentence opens its card: its meaning here, its voice, a way to save it.
    if (p.state !== 'extra') w.dataset.w = p.word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}']+$/gu, '');
    if (p.typed && p.state !== 'right') {
      w.title = slT('listenYouTyped', p.typed);
      w.append(el('s', null, p.typed));
    }
    line.append(w, ' ');
  }
  box.append(line);
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
  if (s.translation) box.append(el('div', 'meaning', '“' + s.translation + '”'));
  // The saved word the sentence came from; with Gemini it is among the sentence's words below.
  if (s.word && !geminiKey) {
    const w = el('div', 'word');
    w.append(el('b', null, s.word));
    if (s.meaning) w.append(el('span', null, '— ' + s.meaning));
    box.append(w);
  }
  box.append(paintParts(s));
  box.hidden = false;
  // Heard once more, now that it can be followed word by word.
  if (score < 1) play(false);
}

// The words and phrases of the sentence with what they mean in it, each one to be saved. Gemini
// is asked once for a sentence; without a key, a word is tapped to see what it means.
function paintParts(s) {
  const box = el('div', 'parts');
  if (!geminiKey) {
    box.append(el('div', 'tip', slT('listenTap')));
    return box;
  }
  const head = el('div', 'label');
  head.append(el('span', null, slT('listenParts')), el('span', 'engine', 'Gemini'));
  const list = el('div', 'tip', slT('lookingUp'));
  box.append(head, list);
  const fill = (parts) => {
    list.textContent = '';
    for (const p of parts) {
      const row = el('div', 'part');
      const word = el('b', null, p.text);
      if (p.base) word.append(el('small', null, p.base));
      const star = el('button', 'star');
      const paint = () => {
        const on = saved.has((p.base || p.text).toLowerCase()) || saved.has(p.text.toLowerCase());
        star.textContent = on ? '★' : '☆';
        star.classList.toggle('on', on);
        star.title = slT(on ? 'saved' : 'save');
      };
      paint();
      star.addEventListener('click', () => toggleSave(s, p, paint));
      row.append(word, el('span', null, p.meaning), star);
      list.append(row);
    }
    if (!parts.length) list.textContent = '';
    box.append(el('div', 'tip', slT('listenTap')));
  };
  glossOf(s).then((parts) => {
    if (parts) return fill(parts);
    list.textContent = '';
    box.querySelector('.label').remove();
    box.append(el('div', 'tip', slT('listenTap')));
  });
  return box;
}

// The parts of a sentence: kept from an earlier time, or asked for. Asked as soon as the sentence
// is shown, while it is being listened to, so that they are there when it has been checked.
const glossing = new Map();
function glossOf(s) {
  if (!geminiKey) return Promise.resolve(null);
  if (glossing.has(s.key)) return glossing.get(s.key);
  const job = new Promise((resolve) => {
    chrome.storage.local.get({ listenGloss: {} }, async (data) => {
      const kept = data.listenGloss || {};
      if (kept[s.key]) return resolve(kept[s.key].parts);
      const res = await ask({ type: 'gloss', sentence: s.text, sl: s.lang, tl: settings.nativeLang });
      if (!res.ok) {
        glossing.delete(s.key); // asked again next time
        return resolve(null);
      }
      resolve(res.result);
      // Kept, the newest first, so that the same sentence costs nothing next time.
      chrome.storage.local.get({ listenGloss: {} }, (fresh) => {
        const all = { ...(fresh.listenGloss || {}), [s.key]: { parts: res.result, at: Date.now() } };
        const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
        for (const k of keys.slice(GLOSS_KEPT)) delete all[k];
        chrome.storage.local.set({ listenGloss: all });
      });
    });
  });
  glossing.set(s.key, job);
  return job;
}

// A part of the sentence saved as a card of its own, with this sentence as its sentence; or, saved
// already, taken off again.
function toggleSave(s, p, then) {
  const word = p.text;
  const keys = [word.toLowerCase(), (p.base || word).toLowerCase()];
  chrome.storage.local.get({ words: [] }, (data) => {
    const has = data.words.find((w) => keys.includes(w.word.toLowerCase()));
    let words;
    if (has) {
      slForget(has.word);
      words = data.words.filter((w) => w !== has);
      saved.delete(has.word.toLowerCase());
    } else {
      words = [
        {
          word,
          kind: /\s/.test(word) ? 'phrase' : 'word',
          translation: p.meaning,
          context: s.text,
          contextTranslation: s.translation,
          contextMeaning: p.meaning,
          contextPhrase: p.base,
          senseEngine: 'gemini',
          sensed: true,
          lang: s.lang,
          title: s.title,
          source: s.source || undefined,
          added: Date.now(),
        },
        ...data.words,
      ];
      saved.add(word.toLowerCase());
    }
    chrome.storage.local.set({ words }, then);
  });
}

// A tapped word of the sentence: its card, from the same code that reads a selection on any page.
$('result').addEventListener('click', (e) => {
  const w = e.target.closest('[data-w]');
  if (!w || !w.dataset.w) return;
  const r = w.getBoundingClientRect();
  window.dispatchEvent(new CustomEvent('sl-lookup', { detail: { text: w.dataset.w, context: sentence() ? sentence().text : '', rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } } }));
});

function next() {
  at++;
  show();
}

// A sentence rests until then: written into what is kept now (another device's rests may have come
// with the cloud meanwhile), and the rests that are over are dropped.
function restUntil(key, until) {
  chrome.storage.local.get({ listenRest: {} }, (data) => {
    const all = { ...(data.listenRest || {}), [key]: until };
    const now = Date.now();
    for (const k of Object.keys(all)) if (all[k] < now) delete all[k];
    chrome.storage.local.set({ listenRest: all });
  });
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
    saved = new Set(data.words.map((w) => w.word.toLowerCase()));
    round = slDictationPool(data.words, settings.learnLang, data.listenRest || {}, Date.now(), ROUND);
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
  else if (checked && e.key === 'Enter' && !e.defaultPrevented && !/^(BUTTON|A|TEXTAREA)$/.test(e.target.tagName)) next();
  else return;
  e.preventDefault();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  slNav('listen');
  document.title = slT('listenTitle') + ' — SceneLingo';
  $('hint').textContent = '';
  $('hint').append(slIcon('bulb'), slT('listenHint'));
  $('play').title = slT('reviewListen') + ' (Ctrl+Space)';
  $('slow').title = slT('reviewSlow') + ' (Ctrl+Shift+Space)';
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    startRound();
  });
});
