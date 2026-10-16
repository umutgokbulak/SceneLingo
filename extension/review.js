const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'kindWordCard', phrase: 'kindPhraseCard', sentence: 'kindSentenceCard' };
const TYPE_LABEL = { recognize: '', cloze: 'typeCloze', produce: 'typeProduce' };

let settings = { ...SL_DEFAULTS };
let words = [];
let log = {};
let queue = []; // keys still to go in this session; a missed card goes back to the end
let sessionSize = 0; // for the bar at the top
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
const btn = (label, onClick, cls = 'btn small') => {
  const b = el('button', cls, label);
  b.addEventListener('click', onClick);
  return b;
};
// A button's words with its key beside them.
const withKey = (button, label, key) => {
  button.textContent = '';
  button.append(el('span', null, label));
  if (key) button.append(el('kbd', null, key));
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

// The word, big, with its two voices beside it.
function headword(item) {
  const box = el('div', 'headword');
  const term = el('div', 'term', item.word);
  term.classList.toggle('long', item.word.length > 28);
  const lang = voiceOf(item);
  const listen = btn('🔊', () => speakText(item.word, lang, false), 'icon');
  listen.title = slT('reviewListen') + ' (R)';
  const slow = btn('🐢', () => speakText(item.word, lang, true), 'icon');
  slow.title = slT('reviewSlow');
  box.append(term, listen, slow);
  return box;
}

// The sentence the item was saved from, with the item marked, or with a gap to type it in.
function contextLine(item, gap) {
  const context = item.context || '';
  if (!context || slKindOf(item) === 'sentence') return null;
  const box = el('div', 'quote');
  const parts = slClozeParts(item);
  if (!parts) box.textContent = context;
  else if (gap) {
    gap.size = Math.max(4, parts.answer.length + 1);
    box.append(parts.before, gap, parts.after);
  } else box.append(parts.before, el('b', null, parts.answer), parts.after);
  return box;
}

const sourceLine = (item) => (item.title ? el('div', 'source', item.title) : null);

function openScene(source) {
  ask({ type: 'open-scene', url: source.url, time: source.time });
}

function section(title, ...children) {
  const box = el('div', 'section');
  box.append(el('h3', null, title), ...children.filter(Boolean));
  return box;
}

// Rows of a list: the text, what it means, and a button for its scene when it has one.
function listOf(rows) {
  const list = el('ul', 'list');
  for (const { text, sub, source } of rows) {
    const li = el('li');
    const t = el('div', 't');
    t.append(el('div', null, text));
    if (sub) t.append(el('small', null, sub));
    li.append(t);
    if (source && source.url) {
      const play = btn('▶', () => openScene(source), 'play');
      play.title = slT('openScene');
      li.append(play);
    }
    list.append(li);
  }
  return list;
}

// ---------- the front: what is asked ----------

let answerInput = null;

function paintTop() {
  const top = $('top');
  top.textContent = '';
  const kind = slKindOf(current);
  top.append(el('span', 'kind', [slT(KIND_LABEL[kind] || 'kindWordCard'), TYPE_LABEL[type] && slT(TYPE_LABEL[type])].filter(Boolean).join(' · ')));
  const extra = current.extra || {};
  if (extra.level) top.append(el('span', 'chip level', extra.level));
  if (extra.academic) top.append(el('span', 'chip academic', slT('academic')));
  if ((current.lapses || 0) >= 3) top.append(el('span', 'chip hard', slT('hardCard')));
}

function paintFront() {
  const front = $('front');
  front.textContent = '';
  answerInput = null;
  const item = current;
  const add = (...nodes) => front.append(...nodes.filter(Boolean));
  if (type === 'recognize') {
    add(headword(item), el('div', 'ipa', item.ipa ? '/' + item.ipa + '/' : ''), contextLine(item), sourceLine(item));
    return;
  }
  if (type === 'cloze') {
    answerInput = el('input');
    const hint = item.contextMeaning || item.translation;
    add(el('div', 'ask', slT('askCloze')), contextLine(item, answerInput), hint && el('div', 'hintline', hint), sourceLine(item));
  } else {
    // Producing: from the meaning in one's own language to the item itself.
    const sentence = slKindOf(item) === 'sentence';
    const meaning = sentence ? item.translation : item.contextMeaning || item.translation;
    add(el('div', 'ask', slT(sentence ? 'askSentence' : 'askProduce', slLangName(item.lang || settings.learnLang))));
    const m = el('div', 'term meaning', meaning || '—');
    m.classList.toggle('long', (meaning || '').length > 40);
    add(el('div', 'headword'));
    front.lastChild.append(m);
    if (!sentence && item.contextTranslation) add(el('div', 'hintline', '“' + item.contextTranslation + '”'));
    const row = el('div', 'typed');
    answerInput = el(sentence ? 'textarea' : 'input');
    answerInput.placeholder = slT('typeHere');
    row.append(answerInput);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const mic = btn('🎤', () => listen(Recognition, voiceOf(item), mic), 'icon');
      mic.title = slT('sayIt');
      mic.style.cssText = 'width:46px;height:auto;border-radius:10px';
      row.append(mic);
    }
    add(row);
  }
  answerInput.autocomplete = 'off';
  answerInput.spellcheck = false;
  answerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !(e.shiftKey && answerInput.tagName === 'TEXTAREA')) {
      e.preventDefault();
      check();
    }
  });
  setTimeout(() => answerInput && answerInput.focus(), 0);
}

// Saying the answer instead of typing it.
function listen(Recognition, lang, mic) {
  const r = new Recognition();
  r.lang = lang;
  r.interimResults = false;
  r.maxAlternatives = 3;
  mic.style.borderColor = 'var(--red)';
  r.onresult = (e) => {
    const said = [...e.results[0]].map((a) => a.transcript);
    // Of what the recogniser heard, the reading that matches best.
    const accepted = slAccepted(current, type);
    answerInput.value = said.find((s) => slCheckAnswer(s, accepted) === 'right') || said[0] || '';
    check();
  };
  r.onend = () => (mic.style.borderColor = '');
  r.onerror = () => {};
  r.start();
}

// ---------- the back: the answer, and what goes with it ----------

function paintBack() {
  const back = $('back');
  back.textContent = '';
  const item = current;
  const kind = slKindOf(item);
  // Two columns on a wide screen: the meaning and what to do with the card on the left, the
  // practice and the rest on the right; one after the other on a narrow one.
  const left = el('div', 'back-main');
  const side = el('div', 'back-side');
  const add = (...nodes) => left.append(...nodes.filter(Boolean));

  // What was asked for, in full, when the front did not show it.
  if (type !== 'recognize') {
    const head = el('div', 'answerhead');
    head.append(headword(item), el('div', 'ipa', item.ipa ? '/' + item.ipa + '/' : ''));
    // After a gap the sentence is on the front already, filled in.
    const c = type === 'produce' && contextLine(item);
    if (c) head.append(c);
    add(head);
  }

  // The meaning: in this sentence first, since that is the one to learn; the dictionary's after it.
  const meaning = el('div', 'meaning-box');
  if (item.contextMeaning && kind !== 'sentence') {
    meaning.append(el('div', 'm-label', slT('inSentence').replace(/:$/, '')));
    const main = el('div', 'm-main');
    if (item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word)) main.append(el('span', 'm-phrase', item.contextPhrase + ' — '));
    main.append(item.contextMeaning);
    const engine = el('span', 'engine' + (item.senseEngine === 'gemini' ? ' gemini' : ''), item.senseEngine === 'gemini' ? 'Gemini' : slT('engineMarked'));
    main.append(engine);
    meaning.append(main);
    if (item.contextNote) meaning.append(el('div', 'm-note', item.contextNote));
    if (item.translation && !slNormalize(item.contextMeaning).includes(slNormalize(item.translation))) {
      const dict = el('div', 'm-dict', slT('inDictionary') + ' ');
      dict.append(el('b', null, item.translation));
      meaning.append(dict);
    }
  } else {
    meaning.append(el('div', 'm-main', item.translation || '—'));
  }
  if (item.contextTranslation && kind !== 'sentence') meaning.append(el('div', 'm-ctx', '“' + item.contextTranslation + '”'));
  add(meaning);

  // The practice first, then what shows the word in use, then the dictionary.
  if (geminiKey && kind !== 'sentence') side.append(ownSentence());
  const extra = item.extra || {};
  if ((extra.collocations || []).length) side.append(section(slT('collocations'), listOf(extra.collocations.map((c) => ({ text: c.text, sub: c.meaning })))));
  if ((extra.examples || []).length) side.append(section(slT('moreExamples'), listOf(extra.examples.map((e) => ({ text: e.text, sub: e.translation })))));
  if ((item.examples || []).length) side.append(section(slT('metAgain'), listOf(item.examples.map((e) => ({ text: e.text, sub: e.title, source: e.source })))));
  const def = item.definition && el('p', null, item.definition);
  const syn = item.synonyms && item.synonyms.length && el('div', 'syn', slT('synonymsOf', item.synonyms.join(', ')));
  if (def || syn) side.append(section(slT('definitionHead'), def, syn));

  // What can be done with the card.
  const tools = el('div', 'tools');
  if (item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word)) {
    tools.append(btn('⇄ ' + slT('makePhrase', item.contextPhrase), () => saveEdit({ word: item.contextPhrase, translation: item.contextMeaning || item.translation })));
  }
  if (item.source && item.source.url) tools.append(btn('▶ ' + slT('openScene'), () => openScene(item.source)));
  tools.append(btn('✎ ' + slT('editCard'), paintEdit, 'btn small ghost'));
  const remove = btn(slT('removeCard'), () => {
    // Asked twice: it cannot be undone.
    if (remove.dataset.sure) return removeCurrent();
    remove.dataset.sure = '1';
    remove.textContent = slT('removeSure');
  }, 'btn small ghost danger');
  tools.append(remove);
  add(tools);
  back.append(left);
  if (side.childNodes.length) back.append(side);
  back.classList.toggle('single', !side.childNodes.length);
}

// A sentence of one's own with the word, checked by Gemini.
function ownSentence() {
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
    result.append(el('div', r.correct ? 'ok' : null, r.correct ? '✓ ' + slT('ownGood') : '✗ ' + slT('ownBetter')));
    if (r.better && !r.correct) result.append(el('div', 'fix', r.better));
    if (r.note) result.append(el('div', null, r.note));
    patchCurrent({ mine: [...(current.mine || []), { text, better: r.better, correct: r.correct }].slice(-3) });
  });
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  row.append(input, go);
  for (const m of (current.mine || []).slice().reverse()) {
    result.append(el('div', m.correct ? 'ok' : 'fix', (m.correct ? '✓ ' : '• ') + (m.better || m.text)));
  }
  return section(slT('ownSentence'), row, result);
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
  const save = () => saveEdit({ word: w.value.trim(), translation: t.value.trim() });
  for (const i of [w, t]) i.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  row.append(btn(slT('editSave'), save, 'btn small primary'), btn(slT('editCancel'), paintBack, 'btn small ghost'));
  form.append(row);
  back.textContent = '';
  back.classList.add('single');
  const box = el('div', 'back-main');
  box.append(form);
  back.append(box);
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
      fillExtra(current);
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

function paintProgress() {
  $('progress').textContent = slT('progress', queue.length, finished);
  const total = Math.max(sessionSize, finished + queue.length);
  $('bar').style.width = total ? Math.round((finished / total) * 100) + '%' : '0';
}

function show() {
  current = null;
  while (queue.length && !current) {
    const key = queue[0];
    current = words.find((w) => keyOf(w) === key) || null;
    if (!current) queue.shift();
  }
  paintProgress();
  paintStats();
  $('card').hidden = !current;
  $('dock').hidden = !current;
  $('empty').hidden = !!current;
  if (!current) return showEmpty();

  type = slCardType(current);
  revealed = false;
  $('card').classList.remove('revealed');
  verdict = null;
  paintTop();
  paintFront();
  $('back').hidden = true;
  $('back').textContent = '';
  $('grades').hidden = true;
  $('countIt').hidden = true;
  $('show').hidden = false;
  withKey($('show'), slT(type === 'recognize' ? 'showAnswer' : 'checkAnswer'), type === 'recognize' ? slT('keySpace') : 'Enter');
  $('dontKnow').hidden = type === 'recognize';
  $('dontKnow').textContent = slT('dontKnow');
  window.scrollTo({ top: 0 });
  refreshWord(current);
  fillContext(current);
  fillExtra(current);
  if (settings.autoSpeak && type === 'recognize') speak(false);
}

function showEmpty() {
  const now = Date.now();
  const next = words.map((w) => w.due || 0).filter((d) => d > now).sort((a, b) => a - b)[0];
  const waiting = words.filter(slIsNew).length;
  const today = slStats(words, log, now).today;
  let title;
  let text = '';
  if (!words.length) {
    title = slT('emptyNoneTitle');
    text = slT('noSaved');
  } else if (today.reviews) {
    title = slT('emptyDoneTitle');
    text = slT('doneTodayStats', today.reviews, Math.round((today.correct / today.reviews) * 100));
  } else {
    title = slT('emptyRestTitle');
    text = slT('nothingDue');
  }
  if (next) {
    const hours = (next - now) / 3600000;
    text += hours < 1 ? slT('nextSoon') : hours < 24 ? slT('nextHours', Math.round(hours)) : slT('nextDays', Math.round(hours / 24));
  }
  if (waiting) text += ' ' + slT('newWaiting', waiting);
  $('emptyTitle').textContent = title;
  $('emptyText').textContent = text;
  $('studyAll').hidden = !words.length;
}

function paintStats() {
  const s = slStats(words, log, Date.now());
  const box = $('stats');
  box.textContent = '';
  const stat = (label, value, cls) => {
    const span = el('span', 'stat' + (cls ? ' ' + cls : ''), label);
    span.append(el('b', null, String(value)));
    box.append(span);
  };
  if (s.streak) stat('🔥', slT('statDays', s.streak), 'fire');
  stat(slT('statLearned'), s.learned);
  stat(slT('statLearning'), s.learning);
  stat(slT('statNew'), s.fresh);
  if (s.retention != null) stat(slT('statRetention'), '%' + s.retention);
  const label = el('label', 'daily', slT('newPerDay'));
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
    const text = verdict === 'right' ? '✓ ' + slT('verdictRight') : verdict === 'close' ? '≈ ' + slT('verdictClose') : '✗ ' + slT('verdictWrong', slAccepted(current, type)[0]);
    $('front').append(el('div', 'verdict ' + verdict, text));
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
  $('card').classList.add('revealed');
  paintBack();
  $('back').hidden = false;
  // On a short screen the answer may start below the fold: brought up into view.
  const top = $('back').getBoundingClientRect().top;
  if (top > innerHeight * 0.55) window.scrollBy({ top: top - 72, behavior: 'smooth' });
  $('show').hidden = true;
  $('dontKnow').hidden = true;
  $('grades').hidden = false;
  const wrong = verdict === 'wrong';
  // A typed answer that was wrong is a miss: only "missed it", unless one says it was right after all.
  $('good').hidden = wrong;
  $('easy').hidden = wrong;
  $('grades').style.gridTemplateColumns = wrong ? 'minmax(0, 260px)' : '';
  $('grades').style.justifyContent = wrong ? 'center' : '';
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
  sessionSize = Math.max(0, sessionSize - 1);
  update((list) => list.filter((w) => keyOf(w) !== key), show);
}

function start(all) {
  const now = Date.now();
  const list = all ? words.slice().sort((a, b) => (a.due || 0) - (b.due || 0)) : slTodayQueue(words, now, log, settings.newPerDay);
  queue = list.map(keyOf);
  sessionSize = queue.length;
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
