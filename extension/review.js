const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'kindWordCard', phrase: 'kindPhraseCard', sentence: 'kindSentenceCard' };
const TYPE_LABEL = { recognize: '', cloze: 'typeCloze', produce: 'typeProduce' };

let settings = { ...SL_DEFAULTS };
let words = [];
let log = {};
let queue = []; // keys still to go in this session; a missed card goes back to the end
let current = null;
let type = 'recognize';
let revealed = false;
let verdict = null; // 'right' | 'close' | 'wrong' for a typed answer, null for a recalled one
let finished = 0;
let geminiKey = ''; // shown form only: whether there is a key
const audio = new Audio();

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (label, onClick, cls) => {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
};
const ask = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' } : res)));

function voiceOf(item) {
  return (item.lang || 'en') === 'en' ? settings.accent : item.lang;
}

function speakText(text, lang, slow) {
  ask({ type: 'tts', text, lang, slow: !!slow }).then((res) => {
    if (!res.ok) return;
    audio.src = 'data:audio/mpeg;base64,' + res.result;
    audio.volume = Math.min(1, settings.speechVolume / 100);
    audio.playbackRate = slow ? 0.7 : 1; // the element keeps the pitch when it slows down
    audio.play().catch(() => {});
  });
}
function speak(slow) {
  if (current && (type === 'recognize' || revealed)) speakText(current.word, voiceOf(current), slow);
}

function intervalLabel(item) {
  if (!item.interval) return slT('inMinutes');
  return item.interval === 1 ? slT('tomorrow') : slT('inDays', item.interval);
}

// Storage is re-read before every write so a word saved in another tab meanwhile is not lost.
function update(change, then) {
  chrome.storage.local.get({ words: [] }, (data) => {
    words = change(data.words);
    chrome.storage.local.set({ words }, then);
  });
}
function patchCurrent(fresh) {
  const key = keyOf(current);
  Object.assign(current, fresh);
  update((list) => list.map((w) => (keyOf(w) === key ? { ...w, ...fresh } : w)), () => {});
}

// ---------- the parts of a card ----------

// The sentence the item was saved from, with the item marked, or with a gap to type it in.
function contextLine(item, gap) {
  const box = el('div', 'context');
  const context = item.context || '';
  const parts = slClozeParts(item);
  if (!context || slKindOf(item) === 'sentence') return null;
  if (!parts) {
    box.textContent = context;
    return box;
  }
  if (gap) {
    gap.size = Math.max(4, parts.answer.length + 1);
    box.append(parts.before, gap, parts.after);
  } else {
    box.append(parts.before, el('b', null, parts.answer), parts.after);
  }
  return box;
}

function sourceLine(item) {
  const box = el('div', 'source', item.title || '');
  return item.title ? box : null;
}

function audioButtons(text, lang) {
  const box = el('div', 'audio');
  box.append(btn(slT('reviewListen'), () => speakText(text, lang, false)), btn(slT('reviewSlow'), () => speakText(text, lang, true)));
  return box;
}

function senseBox(item) {
  if (!item.contextMeaning) return null;
  const box = el('div', 'sense');
  box.append(el('span', 'label', slT('inSentence')), (item.contextPhrase ? item.contextPhrase + ' — ' : '') + item.contextMeaning);
  box.append(el('span', 'tag', item.senseEngine === 'gemini' ? 'Gemini' : slT('engineMarked')));
  if (item.contextNote) box.append(el('small', null, item.contextNote));
  return box;
}

// Scenes: the one the item was saved in, and the others it was met in since.
function openScene(source) {
  ask({ type: 'open-scene', url: source.url, time: source.time });
}

function block(title, items) {
  if (!items.length) return null;
  const box = el('div', 'block');
  const list = el('ul');
  for (const li of items) list.append(li);
  box.append(el('h3', null, title), list);
  return box;
}

// ---------- the front: what is asked ----------

let answerInput = null;

function paintTop() {
  const top = $('top');
  top.textContent = '';
  const kind = slKindOf(current);
  const label = [slT(KIND_LABEL[kind] || 'kindWordCard'), TYPE_LABEL[type] && slT(TYPE_LABEL[type])].filter(Boolean).join(' · ');
  top.append(el('span', null, label));
  top.firstChild.id = 'kind';
  const extra = current.extra || {};
  if (extra.level) top.append(el('span', 'badge level', extra.level));
  if (extra.academic) top.append(el('span', 'badge academic', slT('academic')));
  if ((current.lapses || 0) >= 3) top.append(el('span', 'badge hard', slT('hardCard')));
}

function paintFront() {
  const front = $('front');
  front.textContent = '';
  answerInput = null;
  const item = current;
  const lang = voiceOf(item);
  if (type === 'recognize') {
    const term = el('div', 'term', item.word);
    term.classList.toggle('long', item.word.length > 28);
    front.append(term, el('div', 'ipa', item.ipa ? '/' + item.ipa + '/' : ''), audioButtons(item.word, lang));
    for (const n of [contextLine(item), sourceLine(item)]) if (n) front.append(n);
    return;
  }
  if (type === 'cloze') {
    answerInput = el('input');
    answerInput.autocomplete = 'off';
    answerInput.spellcheck = false;
    front.append(el('div', 'ask', slT('askCloze')), contextLine(item, answerInput));
    const hint = item.contextMeaning || item.translation;
    if (hint) front.append(el('div', 'hintline', '(' + hint + ')'));
    const s = sourceLine(item);
    if (s) front.append(s);
  } else {
    // Producing: from the meaning in one's own language to the item itself.
    const sentence = slKindOf(item) === 'sentence';
    const meaning = sentence ? item.translation : item.contextMeaning || item.translation;
    front.append(el('div', 'ask', slT(sentence ? 'askSentence' : 'askProduce', slLangName(item.lang || settings.learnLang))));
    front.append(el('div', 'term meaning', meaning || '—'));
    if (!sentence && item.contextTranslation) front.append(el('div', 'hintline', '“' + item.contextTranslation + '”'));
    const row = el('div', 'typed');
    answerInput = el(sentence ? 'textarea' : 'input');
    answerInput.autocomplete = 'off';
    answerInput.spellcheck = false;
    row.append(answerInput);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) row.append(btn('🎤', () => listen(Recognition, lang)));
    front.append(row);
  }
  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !(e.shiftKey && answerInput.tagName === 'TEXTAREA')) {
      e.preventDefault();
      check();
    }
  });
  setTimeout(() => answerInput && answerInput.focus(), 0);
}

// Saying the answer instead of typing it.
function listen(Recognition, lang) {
  const r = new Recognition();
  r.lang = lang;
  r.interimResults = false;
  r.maxAlternatives = 3;
  r.onresult = (e) => {
    const said = [...e.results[0]].map((a) => a.transcript);
    // Of what the recogniser heard, the reading that matches best.
    const accepted = slAccepted(current, type);
    answerInput.value = said.find((s) => slCheckAnswer(s, accepted) === 'right') || said[0] || '';
    check();
  };
  r.onerror = () => {};
  r.start();
}

// ---------- the back: the answer, and what goes with it ----------

function paintBack() {
  const back = $('back');
  back.textContent = '';
  const item = current;
  const lang = voiceOf(item);
  if (type !== 'recognize') {
    // What was asked for, in full now.
    const term = el('div', 'term', item.word);
    term.classList.toggle('long', item.word.length > 28);
    back.append(term, el('div', 'ipa', item.ipa ? '/' + item.ipa + '/' : ''), audioButtons(item.word, lang));
    const c = contextLine(item);
    if (c) back.append(c);
  }
  back.append(el('div', 'translation', item.translation || '—'));
  const sense = senseBox(item);
  if (sense) back.append(sense);
  if (item.contextTranslation && slKindOf(item) !== 'sentence') back.append(el('div', 'contextTr', '“' + item.contextTranslation + '”'));
  if (item.definition) back.append(el('div', 'definition', item.definition));
  if (item.synonyms && item.synonyms.length) back.append(el('div', 'synonyms', slT('synonymsOf', item.synonyms.join(', '))));

  // Turning a word into the phrase it belongs to: "ripped" into "rip off".
  const tools = el('div', 'tools');
  if (item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word)) {
    tools.append(btn(slT('makePhrase', item.contextPhrase), () => saveEdit({ word: item.contextPhrase, translation: item.contextMeaning || item.translation })));
  }
  if (item.source && item.source.url) tools.append(btn('▶ ' + slT('openScene'), () => openScene(item.source)));
  tools.append(btn('✎ ' + slT('editCard'), paintEdit));
  back.append(tools);

  const extra = item.extra || {};
  const li = (main, sub, source) => {
    const row = el('li', null, main);
    if (source && source.url) row.append(btn('▶', () => openScene(source)));
    if (sub) row.append(el('small', null, sub));
    return row;
  };
  for (const b of [
    block(slT('collocations'), (extra.collocations || []).map((c) => li(c.text, c.meaning))),
    block(slT('moreExamples'), (extra.examples || []).map((e) => li(e.text, e.translation))),
    block(slT('metAgain'), (item.examples || []).map((e) => li(e.text, e.title, e.source))),
  ]) {
    if (b) back.append(b);
  }
  if (geminiKey && slKindOf(item) !== 'sentence') back.append(ownSentence());
}

// A sentence of one's own with the word, checked by Gemini.
function ownSentence() {
  const box = el('div', 'block');
  box.append(el('h3', null, slT('ownSentence')));
  const row = el('div', 'own');
  const input = el('input');
  input.placeholder = slT('ownSentencePh', current.contextPhrase || current.word);
  const result = el('div', 'ownResult');
  const go = btn(slT('ownCheck'), async () => {
    const text = input.value.trim();
    if (!text) return;
    go.disabled = true;
    result.textContent = '…';
    const res = await ask({ type: 'check-sentence', word: current.contextPhrase || current.word, sentence: text, sl: current.lang || settings.learnLang, tl: settings.nativeLang });
    go.disabled = false;
    result.textContent = '';
    if (!res.ok) return (result.textContent = slT('ownFailed', res.error === 'noKey' ? slT('geminiNone') : res.error));
    const r = res.result;
    result.append(el('div', r.correct ? 'better' : null, r.correct ? '✓ ' + slT('ownGood') : '✗ ' + slT('ownBetter')));
    if (r.better && !r.correct) result.append(el('div', 'better', r.better));
    if (r.note) result.append(el('div', null, r.note));
    patchCurrent({ mine: [...(current.mine || []), { text, better: r.better, correct: r.correct }].slice(-3) });
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  row.append(input, go);
  box.append(row, result);
  for (const m of (current.mine || []).slice().reverse()) {
    result.append(el('div', m.correct ? 'better' : null, (m.correct ? '✓ ' : '• ') + (m.better || m.text)));
  }
  return box;
}

// Editing the card: the word itself (its dictionary form) and its meaning.
function paintEdit() {
  const back = $('back');
  const form = el('div', 'edit');
  const field = (label, value) => {
    const l = el('label', null, label);
    const i = el('input');
    i.value = value || '';
    l.append(i);
    form.append(l);
    return i;
  };
  const w = field(slT('editWord'), current.word);
  const t = field(slT('editTranslation'), current.translation);
  const row = el('div', 'tools');
  row.append(btn(slT('editSave'), () => saveEdit({ word: w.value.trim(), translation: t.value.trim() }), 'main'), btn(slT('editCancel'), paintBack));
  form.append(row);
  back.textContent = '';
  back.append(form);
  w.focus();
}

// A changed word may be one there is already a card for: the two become one.
function saveEdit({ word, translation }) {
  if (!word) return;
  const oldKey = keyOf(current);
  const newKey = word.toLowerCase();
  const kind = slKindOf(current) === 'sentence' ? 'sentence' : /\s/.test(word) ? 'phrase' : 'word';
  let edited = { ...current, word, kind, translation };
  if (newKey !== oldKey) Object.assign(edited, { ipa: '', definition: '', synonyms: [], looked: 0, enriched: false, extra: null });
  update(
    (list) => {
      const other = newKey !== oldKey && list.find((x) => keyOf(x) === newKey);
      if (other) edited = slMerge(edited, other);
      return list.filter((x) => keyOf(x) !== newKey && keyOf(x) !== oldKey).concat(edited);
    },
    () => {
      queue = queue.filter((k) => k !== newKey).map((k) => (k === oldKey ? newKey : k));
      current = words.find((x) => keyOf(x) === newKey);
      refreshWord(current);
      paintTop();
      if (type === 'recognize') paintFront();
      paintBack();
    }
  );
}

// ---------- asking the background for what a card lacks ----------

// Words saved by earlier versions were given the dictionary's first noun even where the service
// knew better ("might" -> "güç" rather than "belki"); each is looked up again once.
const LOOKUP_VERSION = 2;
function refreshWord(item) {
  if (slKindOf(item) !== 'word' || (item.looked || 0) >= LOOKUP_VERSION) return;
  const key = keyOf(item);
  ask({ type: 'lookup', text: item.word, sl: item.lang || settings.learnLang, tl: settings.nativeLang }).then((res) => {
    if (!res.ok || !current || keyOf(current) !== key) return;
    const info = res.result;
    patchCurrent({
      translation: info.translation || item.translation,
      ipa: info.ipa || item.ipa || '',
      definition: info.defs && info.defs[0] ? info.defs[0].text : item.definition,
      synonyms: info.synonyms || [],
      looked: LOOKUP_VERSION,
    });
    if (revealed) paintBack();
  });
}

// The sentence's translation, and what the word means in it: on a review card Gemini is used
// whenever there is a key (a card asks once), and an answer from the marked sentence is replaced
// by Gemini's once there is one.
function fillContext(item) {
  const key = keyOf(item);
  const same = () => current && keyOf(current) === key;
  const lang = item.lang || settings.learnLang;
  if (slKindOf(item) === 'sentence' || !item.context) return;
  if (!item.contextTranslation) {
    ask({ type: 'translate', texts: [item.context], sl: lang, tl: settings.nativeLang }).then((res) => {
      if (!res.ok || !res.result[0] || !same()) return;
      patchCurrent({ contextTranslation: String(res.result[0]).trim() });
      if (revealed) paintBack();
    });
  }
  const better = geminiKey && item.senseEngine !== 'gemini';
  if (item.contextMeaning && !better) return;
  if (!item.contextMeaning && item.sensed && !geminiKey) return;
  ask({ type: 'sense', word: item.word, sentence: item.context, sl: lang, tl: settings.nativeLang, always: true }).then((res) => {
    if (!res.ok || !res.result || !res.result.meaning || !same()) return;
    const s = res.result;
    if (item.contextMeaning && s.engine !== 'gemini') return;
    patchCurrent({ contextMeaning: s.meaning, contextPhrase: s.phrase || '', contextNote: s.note || '', senseEngine: s.engine, sensed: true });
    if (type === 'produce' && !revealed) return; // the question stays as it was asked
    if (revealed) paintBack();
  });
}

// Once for each card, with a key: its level, the words it goes with, two more sentences.
function fillExtra(item) {
  if (!geminiKey || item.enriched || slKindOf(item) === 'sentence') return;
  const key = keyOf(item);
  ask({ type: 'enrich', word: item.word, phrase: item.contextPhrase, sentence: item.context, sl: item.lang || settings.learnLang, tl: settings.nativeLang }).then((res) => {
    if (!res.ok || !current || keyOf(current) !== key) return;
    patchCurrent({ extra: res.result, enriched: true });
    paintTop();
    if (revealed) paintBack();
  });
}

// ---------- the session ----------

function show() {
  current = null;
  while (queue.length && !current) {
    const key = queue[0];
    current = words.find((w) => keyOf(w) === key) || null;
    if (!current) queue.shift();
  }
  $('progress').textContent = slT('progress', queue.length, finished);
  paintStats();
  $('card').hidden = !current;
  $('empty').hidden = !!current;
  if (!current) return showEmpty();

  type = slCardType(current);
  revealed = false;
  verdict = null;
  paintTop();
  paintFront();
  $('back').hidden = true;
  $('back').textContent = '';
  $('grades').hidden = true;
  $('countIt').hidden = true;
  $('show').hidden = false;
  $('show').textContent = slT(type === 'recognize' ? 'showAnswer' : 'checkAnswer');
  $('dontKnow').hidden = type === 'recognize';
  $('keys').textContent = slT(type === 'recognize' ? 'reviewKeys' : 'reviewKeysTyped');
  refreshWord(current);
  fillContext(current);
  fillExtra(current);
  if (settings.autoSpeak && type === 'recognize') speak(false);
}

function showEmpty() {
  const now = Date.now();
  const next = words.map((w) => w.due || 0).filter((d) => d > now).sort((a, b) => a - b)[0];
  const waiting = words.filter(slIsNew).length;
  let text;
  if (!words.length) text = slT('noSaved');
  else if (finished) text = slT('doneToday', finished);
  else text = slT('nothingDue');
  if (next) {
    const hours = (next - now) / 3600000;
    text += hours < 1 ? slT('nextSoon') : hours < 24 ? slT('nextHours', Math.round(hours)) : slT('nextDays', Math.round(hours / 24));
  }
  if (waiting) text += ' ' + slT('newWaiting', waiting);
  $('emptyText').textContent = text;
  $('studyAll').hidden = !words.length;
  $('keys').textContent = '';
}

function paintStats() {
  const s = slStats(words, log, Date.now());
  const box = $('stats');
  box.textContent = '';
  const part = (label, value) => {
    const span = el('span', null, label + ' ');
    span.append(el('b', null, String(value)));
    box.append(span);
  };
  part(slT('statStreak'), slT('statDays', s.streak));
  part(slT('statLearned'), s.learned);
  part(slT('statLearning'), s.learning);
  part(slT('statNew'), s.fresh);
  if (s.retention != null) part(slT('statRetention'), '%' + s.retention);
  const label = el('label', null, slT('newPerDay'));
  const sel = el('select');
  for (const n of [5, 10, 15, 20, 30, 50]) {
    const o = el('option', null, String(n));
    o.value = n;
    sel.append(o);
  }
  sel.value = settings.newPerDay;
  sel.addEventListener('change', () => {
    settings.newPerDay = +sel.value;
    chrome.storage.sync.set({ newPerDay: settings.newPerDay });
    start(false);
  });
  label.append(sel);
  box.append(label);
}

// The answer: shown (a recalled card) or checked (a typed one).
function check() {
  if (!current || revealed) return;
  if (type !== 'recognize') {
    const typed = answerInput ? answerInput.value : '';
    if (slKindOf(current) === 'sentence') {
      const score = slSentenceScore(current.word, typed, SubtitleCore.matchWords);
      verdict = score >= 0.9 ? 'right' : score >= 0.6 ? 'close' : 'wrong';
    } else verdict = slCheckAnswer(typed, slAccepted(current, type));
    if (answerInput) answerInput.disabled = true;
    const line = el('div', 'verdict ' + verdict, verdict === 'right' ? '✓ ' + slT('verdictRight') : verdict === 'close' ? '≈ ' + slT('verdictClose') : '✗ ' + slT('verdictWrong', slAccepted(current, type)[0]));
    $('front').append(line);
    speakText(current.word, voiceOf(current), false);
  }
  reveal();
}

function giveUp() {
  if (!current || revealed) return;
  if (answerInput) answerInput.value = '';
  check();
}

function reveal() {
  revealed = true;
  paintBack();
  $('back').hidden = false;
  $('show').hidden = true;
  $('dontKnow').hidden = true;
  $('grades').hidden = false;
  const wrong = verdict === 'wrong';
  // A typed answer that was wrong is a miss: only "missed it", unless one says it was right after all.
  $('good').hidden = wrong;
  $('easy').hidden = wrong;
  $('countIt').hidden = !wrong;
  const now = Date.now();
  for (const g of ['again', 'good', 'easy']) $(g).querySelector('small').textContent = intervalLabel(slGrade(current, g, now));
}

function grade(value) {
  if (!current || !revealed) return;
  if (value !== 'again' && verdict === 'wrong') return;
  const key = keyOf(current);
  const now = Date.now();
  const isNew = slIsNew(current);
  const graded = { ...slGrade(current, value, now), ...slAdvance(current, value) };
  queue.shift();
  if (value === 'again') queue.push(key);
  else finished++;
  log = slLogged(log, now, { isNew, correct: value !== 'again' });
  chrome.storage.local.set({ reviewLog: log });
  update((list) => list.map((w) => (keyOf(w) === key ? { ...w, ...graded } : w)), show);
}

function removeCurrent() {
  if (!current) return;
  const key = keyOf(current);
  queue.shift();
  update((list) => list.filter((w) => keyOf(w) !== key), show);
}

function start(all) {
  const now = Date.now();
  const list = all ? words.slice().sort((a, b) => (a.due || 0) - (b.due || 0)) : slTodayQueue(words, now, log, settings.newPerDay);
  queue = list.map(keyOf);
  finished = 0;
  show();
}

// A focused button would also react to Space; keep the keyboard for the shortcuts below.
document.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (button) button.blur();
});
$('show').addEventListener('click', check);
$('dontKnow').addEventListener('click', giveUp);
$('countIt').addEventListener('click', () => {
  verdict = 'close';
  reveal();
});
$('remove').addEventListener('click', removeCurrent);
$('studyAll').addEventListener('click', () => start(true));
for (const g of ['again', 'good', 'easy']) $(g).addEventListener('click', () => grade(g));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !current) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName)) return;
  if (!revealed && (e.code === 'Space' || e.code === 'Enter')) check();
  else if (e.code === 'KeyR') speak(false);
  else if (revealed && (e.code === 'Digit1' || e.code === 'Numpad1')) grade('again');
  else if (revealed && (e.code === 'Digit2' || e.code === 'Numpad2')) grade('good');
  else if (revealed && (e.code === 'Digit3' || e.code === 'Numpad3')) grade('easy');
  else return;
  e.preventDefault();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('reviewTitle') + ' — SceneLingo';
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    chrome.storage.local.get({ words: [], reviewLog: {} }, (data) => {
      words = data.words;
      log = data.reviewLog;
      start(false);
    });
  });
});
