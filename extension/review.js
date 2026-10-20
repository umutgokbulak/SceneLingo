const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'kindWordCard', phrase: 'kindPhraseCard', sentence: 'kindSentenceCard' };
const TYPE_LABEL = { recognize: 'typeRecognize', cloze: 'typeCloze', produce: 'typeProduce' };
const SECONDS_PER_CARD = 15; // for the time the session will take, roughly
const ENRICH_VERSION = 2; // 2: with the pronunciation in IPA

let settings = { ...SL_DEFAULTS };
let words = [];
let log = {};
let queue = []; // keys still to go in this session; a missed card goes back to the end
let sessionSize = 0; // for the bar at the top
let current = null;
let type = 'recognize';
let revealed = false;
let verdict = null; // 'right' | 'close' | 'wrong' for a typed answer, null for a recalled one
let hintLevel = 0; // letters (or words, in a sentence) shown as a hint
let finished = 0;
let geminiKey = ''; // shown form only: whether there is a key
let answerInput = null;
const audio = new Audio();

// ---------- small things ----------

const icon = slIcon;
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
const btn = (content, onClick, cls = 'btn small') => {
  const b = el('button', cls);
  for (const c of [].concat(content)) b.append(c);
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
// The item as it is read: a sentence without its notes for the hard of hearing.
const itemText = (item) => (slKindOf(item) === 'sentence' ? slCleanLine(item.word) : item.word);
function speak(slow) {
  if (current && (type === 'recognize' || revealed)) speakText(itemText(current), voiceOf(current), slow);
}

function intervalLabel(item) {
  if (!item.interval) return slT('inMinutes');
  return item.interval === 1 ? slT('tomorrow') : slT('inDays', item.interval);
}
const percent = (n) => slT('percent', n);
const ago = slAgo;
const sourceName = slSourceName;

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

function ipaOf(item) {
  if (item.extra && item.extra.ipa) return item.extra.ipa;
  return item.ipa ? '/' + item.ipa + '/' : '';
}

// The word, big, with its pronunciation and its two voices beside it.
function headword(item) {
  const box = el('div', 'head');
  const text = itemText(item);
  const term = el('div', 'term', text);
  term.classList.toggle('long', text.length > 28);
  box.append(term);
  const ipa = ipaOf(item);
  if (ipa && slKindOf(item) !== 'sentence') box.append(el('span', 'ipa', ipa));
  const lang = voiceOf(item);
  const listen = btn(icon('speaker'), () => speakText(text, lang, false), 'round');
  listen.title = slT('reviewListen') + ' (R)';
  const slow = btn('0.7×', () => speakText(text, lang, true), 'round slow');
  slow.title = slT('reviewSlow');
  const say = el('span', 'say');
  say.append(listen, slow);
  box.append(say);
  return box;
}

// The sentence the item was saved from, with the item marked, or with a gap to type it in.
function contextLine(item, gap) {
  if (!item.context || slKindOf(item) === 'sentence') return null;
  const shown = { ...item, context: slCleanLine(item.context) };
  const box = el('div', 'quote');
  const parts = slClozeParts(shown);
  if (!parts) box.textContent = shown.context;
  else if (gap) {
    gap.size = Math.max(4, parts.answer.length + 2);
    box.append(parts.before, gap, parts.after);
  } else box.append(parts.before, el('b', null, parts.answer), parts.after);
  return box;
}

// Where the item comes from, and a way back to that scene.
function sourceLine(item) {
  const has = item.source && item.source.url;
  if (!item.title && !has) return null;
  const box = el('div', 'source');
  if (item.title) box.append(el('span', null, sourceName(item.title)));
  if (has) box.append(btn([icon('play'), slT('openScene')], () => openScene(item.source), 'link'));
  return box;
}

function openScene(source) {
  ask({ type: 'open-scene', url: source.url, time: source.time });
}

// ---------- the front: what is asked ----------

function paintTop() {
  const top = $('top');
  top.textContent = '';
  const kind = slKindOf(current);
  top.append(el('span', 'label', [slT(KIND_LABEL[kind] || 'kindWordCard'), slT(TYPE_LABEL[type])].join(' · ')));
  const extra = current.extra || {};
  if (extra.level) top.append(el('span', 'chip level', extra.level));
  if (extra.academic) top.append(el('span', 'chip academic', slT('academic')));
  if ((current.lapses || 0) >= 3) top.append(el('span', 'chip hard', slT('hardCard')));
  $('editBtn').hidden = !revealed;
  resetRemove();
}

function paintFront() {
  const front = $('front');
  front.textContent = '';
  answerInput = null;
  const item = current;
  const add = (...nodes) => front.append(...nodes.filter(Boolean));
  if (type === 'recognize') {
    add(headword(item), contextLine(item), sourceLine(item));
    return;
  }
  if (type === 'cloze') {
    // The meaning is the clue: given before the sentence, so that the gap is filled from it.
    answerInput = el('input');
    const clue = item.contextMeaning || item.translation;
    add(el('div', 'ask', slT('askCloze')), clue && el('div', 'clue', clue), contextLine(item, answerInput), sourceLine(item));
  } else {
    // Producing: from the meaning in one's own language to the item itself.
    const sentence = slKindOf(item) === 'sentence';
    const meaning = sentence ? item.translation : item.contextMeaning || item.translation;
    add(el('div', 'ask', slT(sentence ? 'askSentence' : 'askProduce', slLangName(item.lang || settings.learnLang))));
    const head = el('div', 'head');
    const m = el('div', 'term meaning', meaning || '—');
    m.classList.toggle('long', (meaning || '').length > 40);
    head.append(m);
    add(head);
    if (!sentence && item.contextTranslation) add(el('div', 'hintline', '“' + slCleanLine(item.contextTranslation) + '”'));
    const mask = el('div', 'mask');
    mask.id = 'mask';
    mask.hidden = true;
    const row = el('div', 'typed');
    answerInput = el(sentence ? 'textarea' : 'input');
    answerInput.placeholder = slT('typeHere');
    row.append(answerInput);
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (Recognition) {
      const mic = btn(icon('mic'), () => listen(Recognition, voiceOf(item), mic), 'round');
      mic.title = slT('sayIt');
      row.append(mic);
    }
    add(mask, row);
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

// One more letter of the answer (or one more word of a sentence), as a shape to fill in.
function giveHint() {
  if (!current || revealed || type === 'recognize') return;
  hintLevel += 1;
  let mask;
  if (slKindOf(current) === 'sentence') {
    mask = slCleanLine(current.word)
      .split(' ')
      .map((w, i) => (i < hintLevel ? w : w.replace(/[\p{L}\p{N}]/gu, '_')))
      .join(' ');
  } else mask = slHintMask(slAccepted(current, type)[0] || current.word, hintLevel);
  if (type === 'cloze' && answerInput) answerInput.placeholder = mask;
  else if ($('mask')) {
    $('mask').hidden = false;
    $('mask').textContent = mask;
  }
  if (answerInput) answerInput.focus();
}

// ---------- the back: the answer ----------

function paintBack() {
  const back = $('back');
  back.textContent = '';
  const item = current;
  const kind = slKindOf(item);
  const add = (...nodes) => back.append(...nodes.filter(Boolean));

  // What was asked for, in full, when the front did not show it.
  if (type !== 'recognize') {
    const head = el('div', 'answerhead');
    head.append(headword(item));
    const c = type === 'produce' && contextLine(item);
    if (c) head.append(c);
    add(head);
  }

  // The meaning in this sentence first, since that is the one to learn.
  const phrase = item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word) ? item.contextPhrase : '';
  const main = el('div', 'sense-main');
  if (item.contextMeaning && kind !== 'sentence') {
    const gemini = item.senseEngine === 'gemini';
    const top = el('div', 'sense-top');
    top.append(el('span', 'label', slT('inSentence').replace(/:$/, '')), el('span', 'engine' + (gemini ? ' gemini' : ''), gemini ? 'Gemini' : slT('engineMarked')));
    add(top);
    if (phrase) main.append(el('span', 'ph', phrase), el('span', 'arrow', '→'));
    main.append(el('span', 'tr', item.contextMeaning));
    add(main);
    if (item.contextNote) add(el('div', 'note', item.contextNote));
  } else {
    add(el('div', 'label', slT('editTranslation')));
    main.append(el('span', 'tr', item.translation || '—'));
    add(main);
  }

  // Then what supports it: the sentence in one's own language, and the dictionary's word.
  const facts = el('dl', 'facts');
  const fact = (label, value, cls) => {
    facts.append(el('dt', null, label), el('dd', cls, value));
  };
  if (item.contextTranslation && kind !== 'sentence') fact(slT('factSentence'), slCleanLine(item.contextTranslation), 'it');
  if (item.contextMeaning && kind !== 'sentence' && item.translation && !slNormalize(item.contextMeaning).includes(slNormalize(item.translation))) {
    fact(slT('factDictionary'), item.translation);
  }
  if (facts.childNodes.length) add(facts);

  // Turning a word into the phrase it belongs to: "through" into "go through".
  if (phrase) add(btn([icon('plus'), slT('makePhrase', phrase)], () => saveEdit({ word: phrase, translation: item.contextMeaning || item.translation }), 'suggest'));
  paintSide();
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
  const row = el('div', 'row');
  const save = () => saveEdit({ word: w.value.trim(), translation: t.value.trim() });
  for (const i of [w, t]) i.addEventListener('keydown', (e) => e.key === 'Enter' && save());
  row.append(btn(slT('editSave'), save, 'btn small primary'), btn(slT('editCancel'), paintBack, 'btn small ghost'));
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
      fillExtra(current);
      paintTop();
      if (type === 'recognize') paintFront();
      paintBack();
    }
  );
}

// Deleting asks twice: it cannot be undone.
function resetRemove() {
  const b = $('removeBtn');
  delete b.dataset.sure;
  b.textContent = '';
  b.append(icon('trash'));
}
function removeClicked() {
  const b = $('removeBtn');
  if (b.dataset.sure) return removeCurrent();
  b.dataset.sure = '1';
  b.append(el('span', 't', slT('removeConfirm')));
}

// ---------- the panel beside the card ----------

function sec(title, count, ...children) {
  const box = el('div', 'sec');
  const head = el('div', 'label', title);
  if (count) head.append(el('span', 'n', String(count)));
  box.append(head, ...children.filter(Boolean));
  return box;
}

// Before the answer: the card's way so far, and how to study this kind of card; nothing that
// gives the answer away. After it: the word in use, all of it at once, and a sentence of one's
// own at the foot, where it is always in reach.
function paintSide() {
  const body = $('sideBody');
  const foot = $('sideFoot');
  body.textContent = '';
  foot.textContent = '';
  foot.hidden = true;
  $('side').classList.toggle('waiting', !revealed);
  if (!revealed) return paintJourney(body);
  const item = current;
  const kind = slKindOf(item);
  const extra = item.extra || {};
  const lang = voiceOf(item);

  if ((extra.collocations || []).length) {
    const pairs = el('div', 'pairs');
    for (const c of extra.collocations) pairs.append(el('span', null, c.text), el('span', null, c.meaning));
    body.append(sec(slT('collocations'), extra.collocations.length, pairs));
  }
  const rows = (list) => {
    const box = el('div', 'rows');
    for (const r of list) {
      const row = el('div');
      row.append(r.button);
      const t = el('div', 't');
      t.append(el('div', null, r.text));
      if (r.sub) t.append(el('small', null, r.sub));
      row.append(t);
      box.append(row);
    }
    return box;
  };
  if ((extra.examples || []).length) {
    const list = extra.examples.map((e) => {
      const b = btn(icon('speaker'), () => speakText(e.text, lang, false), 'mini');
      b.title = slT('reviewListen');
      return { button: b, text: e.text, sub: e.translation };
    });
    body.append(sec(slT('moreExamples'), list.length, rows(list)));
  }
  if ((item.examples || []).length) {
    const list = item.examples.map((e) => {
      const scene = e.source && e.source.url;
      const b = scene ? btn(icon('play'), () => openScene(e.source), 'mini') : btn(icon('speaker'), () => speakText(e.text, lang, false), 'mini');
      b.title = scene ? slT('openScene') : slT('reviewListen');
      return { button: b, text: slCleanLine(e.text), sub: sourceName(e.title) };
    });
    body.append(sec(slT('metAgain'), list.length, rows(list)));
  }
  if (item.definition || (item.synonyms || []).length) {
    const tags = (item.synonyms || []).length ? el('div', 'tags') : null;
    if (tags) {
      tags.append(el('small', 'quiet', slT('synonyms')));
      for (const s of item.synonyms) tags.append(el('span', null, s));
    }
    body.append(sec(slT('definitionHead'), 0, item.definition && el('div', 'def', item.definition), tags));
  }
  if (!body.childNodes.length) body.append(el('div', 'quiet', slT('sideNothing')));
  if (geminiKey && kind !== 'sentence') {
    foot.hidden = false;
    ownSentence(foot);
  }
}

function paintJourney(body) {
  const item = current;
  const kind = slKindOf(item);
  const steps = kind === 'sentence' ? ['recognize', 'produce'] : ['recognize', 'cloze', 'produce'];
  const now = steps.indexOf(type);
  const stepper = el('div', 'steps');
  steps.forEach((s, i) => {
    if (i) stepper.append(el('span', 'line'));
    const step = el('span', 'step' + (i < now ? ' done' : i === now ? ' now' : ''));
    if (i < now) step.append(icon('check'));
    step.append(slT(TYPE_LABEL[s]));
    stepper.append(step);
  });
  const facts = el('dl', 'facts');
  const fact = (label, value) => facts.append(el('dt', null, label), el('dd', null, String(value)));
  if (slIsNew(item)) facts.append(el('dd', 'quiet', slT('histNew')));
  else {
    fact(slT('histReps'), item.reps || 0);
    if (item.last) fact(slT('histLast'), ago(item.last));
    if (item.interval) fact(slT('histInterval'), slT('statDays', item.interval));
    if (item.lapses) fact(slT('histLapses'), item.lapses);
  }
  body.append(sec(slT('cardJourney'), 0, stepper, facts));

  const tipKey = kind === 'sentence' && type === 'produce' ? 'tipSentence' : { recognize: 'tipRecognize', cloze: 'tipCloze', produce: 'tipProduce' }[type];
  const tip = el('div', 'tip');
  tip.append(icon('bulb'), el('div', null, slT(tipKey)));
  body.append(tip);

  const keys = el('div', 'keys');
  const key = (caps, what) => {
    const k = el('span');
    for (const c of caps) k.append(el('kbd', null, c));
    keys.append(k, el('span', null, what));
  };
  key(type === 'recognize' ? [slT('keySpace')] : ['Enter'], slT('keyReveal'));
  key(['1', '2', '3'], [slT('again'), slT('good'), slT('easy')].join(' · '));
  key(['R'], slT('keyListen'));
  body.append(sec(slT('shortcuts'), 0, keys));
}

// A sentence of one's own with the word, checked by Gemini: at the panel's foot.
function ownSentence(foot) {
  const word = current.contextPhrase || current.word;
  const result = el('div', 'ownResult');
  const row = el('div', 'own-row');
  const input = el('input');
  input.placeholder = slT('ownSentencePh', word);
  const go = btn(slT('ownCheck'), async () => {
    const text = input.value.trim();
    if (!text) return input.focus();
    go.disabled = true;
    result.textContent = '…';
    const res = await ask({ type: 'check-sentence', word, sentence: text, sl: current.lang || settings.learnLang, tl: settings.nativeLang });
    go.disabled = false;
    result.textContent = '';
    if (!res.ok) return (result.textContent = slT('ownFailed', res.error === 'noKey' ? slT('geminiNone') : res.error));
    const r = res.result;
    result.append(el('div', r.correct ? 'ok' : null, r.correct ? '✓ ' + slT('ownGood') : '✗ ' + slT('ownBetter')));
    if (r.better && !r.correct) result.append(el('div', 'fix', r.better));
    if (r.note) result.append(el('div', null, r.note));
    patchCurrent({ mine: [...(current.mine || []), { text, better: r.better, correct: r.correct }].slice(-3) });
  }, 'btn small primary');
  input.addEventListener('keydown', (e) => e.key === 'Enter' && go.click());
  for (const m of (current.mine || []).slice().reverse()) {
    result.append(el('div', m.correct ? 'ok' : 'fix', (m.correct ? '✓ ' : '• ') + (m.better || m.text)));
  }
  row.append(input, go);
  foot.append(el('div', 'label', slT('ownSentence')), result, row);
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
    ask({ type: 'translate', texts: [slCleanLine(item.context)], sl: lang, tl: settings.nativeLang }).then((res) => {
      if (!res.ok || !res.result[0] || !same()) return;
      patchCurrent({ contextTranslation: String(res.result[0]).trim() });
      if (revealed) paintBack();
    });
  }
  const better = geminiKey && item.senseEngine !== 'gemini';
  if (item.contextMeaning && !better) return;
  if (!item.contextMeaning && item.sensed && !geminiKey) return;
  ask({ type: 'sense', word: item.word, sentence: slCleanLine(item.context), sl: lang, tl: settings.nativeLang, always: true }).then((res) => {
    if (!res.ok || !res.result || !res.result.meaning || !same()) return;
    const s = res.result;
    if (item.contextMeaning && s.engine !== 'gemini') return;
    patchCurrent({ contextMeaning: s.meaning, contextPhrase: s.phrase || '', contextNote: s.note || '', senseEngine: s.engine, sensed: true });
    if (type === 'produce' && !revealed) return; // the question stays as it was asked
    if (revealed) paintBack();
  });
}

// Once for each card, with a key: its pronunciation, its level, the words it goes with, two more
// sentences. Cards enriched before the pronunciation was asked for are asked again, once.
function fillExtra(item) {
  if (!geminiKey || item.enriched === ENRICH_VERSION || slKindOf(item) === 'sentence') return;
  const key = keyOf(item);
  ask({ type: 'enrich', word: item.word, phrase: item.contextPhrase, sentence: item.context && slCleanLine(item.context), sl: item.lang || settings.learnLang, tl: settings.nativeLang }).then((res) => {
    if (!res.ok || !current || keyOf(current) !== key) return;
    patchCurrent({ extra: res.result, enriched: ENRICH_VERSION });
    paintTop();
    if (type === 'recognize') paintFront();
    if (revealed) paintBack();
  });
}

// ---------- the session ----------

function paintTopbar() {
  const total = Math.max(sessionSize, finished + queue.length);
  $('bar').style.width = total ? Math.round((finished / total) * 100) + '%' : '0';
  $('left').textContent = queue.length ? slT('leftTime', queue.length, Math.max(1, Math.ceil((queue.length * SECONDS_PER_CARD) / 60))) : '';
  const s = slStats(words, log, Date.now());
  const chips = $('chips');
  chips.textContent = '';
  if (s.streak) {
    const p = el('span', 'pill fire');
    p.append(icon('flame'), el('b', null, slT('statDays', s.streak)));
    chips.append(p);
  }
  if (s.retention != null) {
    const p = el('span', 'pill', slT('statRetention'));
    p.append(el('b', null, percent(s.retention)));
    chips.append(p);
  }
}

// The settings and the numbers behind the bar, under the button on the right.
function paintGear() {
  const menu = $('gearMenu');
  menu.textContent = '';
  const s = slStats(words, log, Date.now());
  const facts = el('div', 'facts');
  const fact = (label, value) => facts.append(el('span', null, label), el('b', null, String(value)));
  fact(slT('statStreak'), slT('statDays', s.streak));
  fact(slT('statLearned'), s.learned);
  fact(slT('statLearning'), s.learning);
  fact(slT('statNew'), s.fresh);
  if (s.retention != null) fact(slT('statRetention'), percent(s.retention));
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
    menu.hidden = true;
    start(false);
  });
  label.append(sel);
  menu.append(facts, label);
}

function show() {
  current = null;
  while (queue.length && !current) {
    const key = queue[0];
    current = words.find((w) => keyOf(w) === key) || null;
    if (!current) queue.shift();
  }
  paintTopbar();
  $('card').hidden = !current;
  $('side').hidden = !current;
  $('stage').classList.toggle('alone', !current);
  $('empty').hidden = !!current;
  if (!current) return showEmpty();

  type = slCardType(current);
  revealed = false;
  verdict = null;
  hintLevel = 0;
  $('card').classList.remove('revealed');
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
  $('hintBtn').hidden = type === 'recognize';
  $('hintBtn').textContent = '';
  $('hintBtn').append(icon('bulb'), slT('hint'));
  paintSide();
  refreshWord(current);
  fillContext(current);
  fillExtra(current);
  if (settings.autoSpeak && type === 'recognize') speak(false);
}

function showEmpty() {
  const now = Date.now();
  const next = words.map((w) => w.due || 0).filter((d) => d > now).sort((a, b) => a - b)[0];
  const waiting = words.filter(slIsNew).length;
  const s = slStats(words, log, now);
  let title;
  let text = '';
  if (!words.length) {
    title = slT('emptyNoneTitle');
    text = slT('noSaved');
  } else if (s.today.reviews) {
    title = slT('emptyDoneTitle');
    text = slT('doneTodayStats', s.today.reviews, Math.round((s.today.correct / s.today.reviews) * 100));
  } else {
    title = slT('emptyRestTitle');
    text = slT('nothingDue');
  }
  if (next) {
    const hours = (next - now) / 3600000;
    text += hours < 1 ? slT('nextSoon') : hours < 24 ? slT('nextHours', Math.round(hours)) : slT('nextDays', Math.round(hours / 24));
  }
  if (waiting) text += ' ' + slT('newWaiting', waiting);
  $('doneMark').textContent = '';
  $('doneMark').append(icon('check'));
  $('emptyTitle').textContent = title;
  $('emptyText').textContent = text;
  const metrics = $('emptyStats');
  metrics.textContent = '';
  const metric = (label, value) => {
    const m = el('div', 'metric');
    m.append(el('small', null, label), el('b', null, String(value)));
    metrics.append(m);
  };
  if (words.length) {
    metric(slT('statStreak'), slT('statDays', s.streak));
    metric(slT('statLearned'), s.learned);
    metric(slT('statLearning'), s.learning);
    metric(slT('statNew'), s.fresh);
    if (s.retention != null) metric(slT('statRetention'), percent(s.retention));
  }
  $('studyAll').hidden = !words.length;
}

// The answer: shown (a recalled card) or checked (a typed one).
function check() {
  if (!current || revealed) return;
  if (type !== 'recognize') {
    const typed = answerInput ? answerInput.value : '';
    if (slKindOf(current) === 'sentence') {
      const score = slSentenceScore(slCleanLine(current.word), typed, SubtitleCore.matchWords);
      verdict = score >= 0.9 ? 'right' : score >= 0.6 ? 'close' : 'wrong';
    } else verdict = slCheckAnswer(typed, slAccepted(current, type));
    if (answerInput) answerInput.disabled = true;
    const shown = slKindOf(current) === 'sentence' ? slCleanLine(current.word) : slAccepted(current, type)[0];
    const text = verdict === 'right' ? '✓ ' + slT('verdictRight') : verdict === 'close' ? '≈ ' + slT('verdictClose') : '✗ ' + slT('verdictWrong', shown);
    $('front').append(el('div', 'verdict ' + verdict, text));
    speakText(itemText(current), voiceOf(current), false);
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
  paintTop();
  paintBack();
  $('back').hidden = false;
  $('show').hidden = true;
  $('dontKnow').hidden = true;
  $('hintBtn').hidden = true;
  $('grades').hidden = false;
  const wrong = verdict === 'wrong';
  // A typed answer that was wrong is a miss: only "missed it", unless one says it was right after
  // all. With a hint it was not easy.
  $('good').hidden = wrong;
  $('easy').hidden = wrong || hintLevel > 0;
  const shownGrades = ['again', 'good', 'easy'].filter((g) => !$(g).hidden).length;
  $('grades').style.gridTemplateColumns = shownGrades === 3 ? '' : 'repeat(' + shownGrades + ', minmax(0, 220px))';
  $('grades').style.justifyContent = 'center';
  $('countIt').hidden = !wrong;
  const now = Date.now();
  for (const g of ['again', 'good', 'easy']) $(g).querySelector('small').textContent = intervalLabel(slGrade(current, g, now));
  $('back').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function grade(value) {
  if (!current || !revealed || $(value).hidden) return;
  const key = keyOf(current);
  const now = Date.now();
  const isNew = slIsNew(current);
  const graded = { ...slGrade(current, value, now), ...slAdvance(current, value), last: now };
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
  if (!e.target.closest('.gear')) $('gearMenu').hidden = true;
});
$('show').addEventListener('click', check);
$('dontKnow').addEventListener('click', giveUp);
$('hintBtn').addEventListener('click', giveHint);
$('countIt').addEventListener('click', () => {
  verdict = 'close';
  reveal();
});
$('editBtn').append(icon('edit'));
$('editBtn').addEventListener('click', () => revealed && paintEdit());
$('removeBtn').addEventListener('click', removeClicked);
$('allWords').append(icon('cards'));
$('gear').append(icon('sliders'));
$('gear').addEventListener('click', () => {
  const menu = $('gearMenu');
  if (menu.hidden) paintGear();
  menu.hidden = !menu.hidden;
});
$('studyAll').addEventListener('click', () => start(true));
for (const g of ['again', 'good', 'easy']) $(g).addEventListener('click', () => grade(g));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('gearMenu').hidden = true;
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
