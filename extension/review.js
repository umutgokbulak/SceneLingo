const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'kindWordCard', phrase: 'kindPhraseCard', sentence: 'kindSentenceCard' };

let settings = { ...SL_DEFAULTS };
let words = [];
let queue = []; // keys still to go in this session; a missed card goes back to the end
let current = null;
let revealed = false;
let finished = 0;
const audio = new Audio();

function speak(slow) {
  if (!current) return;
  const lang = current.lang === 'en' ? settings.accent : current.lang || 'en';
  chrome.runtime.sendMessage({ type: 'tts', text: current.word, lang, slow: !!slow }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    audio.src = 'data:audio/mpeg;base64,' + res.result;
    audio.volume = Math.min(1, settings.speechVolume / 100);
    audio.playbackRate = slow ? 0.7 : 1; // the element keeps the pitch when it slows down
    audio.play().catch(() => {});
  });
}

function intervalLabel(item) {
  if (!item.interval) return slT('inMinutes');
  return item.interval === 1 ? slT('tomorrow') : slT('inDays', item.interval);
}

// The sentence the item was saved from, with the item itself marked.
function fillContext(box, item) {
  box.textContent = '';
  const context = item.context || '';
  const at = context.toLowerCase().indexOf(keyOf(item));
  if (!context || item.kind === 'sentence') return;
  if (at < 0) {
    box.textContent = context;
    return;
  }
  const mark = document.createElement('b');
  mark.textContent = context.slice(at, at + item.word.length);
  box.append(context.slice(0, at), mark, context.slice(at + item.word.length));
}

function show() {
  current = null;
  while (queue.length && !current) {
    const key = queue[0];
    current = words.find((w) => keyOf(w) === key) || null;
    if (!current) queue.shift();
  }
  $('progress').textContent = slT('progress', queue.length, finished);
  $('card').hidden = !current;
  $('empty').hidden = !!current;
  if (!current) return showEmpty();

  revealed = false;
  const kind = current.kind || (/\s/.test(current.word) ? 'phrase' : 'word');
  $('kind').textContent = KIND_LABEL[kind] ? slT(KIND_LABEL[kind]) : '';
  $('term').textContent = current.word;
  $('term').classList.toggle('long', current.word.length > 28);
  $('ipa').textContent = current.ipa ? '/' + current.ipa + '/' : '';
  fillContext($('context'), { ...current, kind });
  $('source').textContent = current.title || '';
  $('translation').textContent = current.translation || '—';
  showContextTranslation(current, kind);
  refreshWord(current, kind);
  $('definition').textContent = current.definition || '';
  $('synonyms').textContent = current.synonyms && current.synonyms.length ? slT('synonymsOf', current.synonyms.join(', ')) : '';
  $('answer').hidden = true;
  $('grades').hidden = true;
  $('show').hidden = false;
  const now = Date.now();
  for (const grade of ['again', 'good', 'easy']) {
    $(grade).querySelector('small').textContent = intervalLabel(slGrade(current, grade, now));
  }
  if (settings.autoSpeak) speak(false);
}

// The sentence the word came from, in one's own language: a word means what it means there
// ("might" in "Might even have a girl for you" is "belki", not "güç"). Items saved before this
// was kept have it fetched once, and kept.
function showContextTranslation(item, kind) {
  const box = $('contextTr');
  const said = (text) => (box.textContent = text ? '“' + text + '”' : '');
  said(kind === 'sentence' ? '' : item.contextTranslation);
  if (kind === 'sentence' || !item.context || item.contextTranslation) return;
  const key = keyOf(item);
  chrome.runtime.sendMessage({ type: 'translate', texts: [item.context], sl: item.lang || settings.learnLang, tl: settings.nativeLang }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok || !res.result[0]) return;
    const text = String(res.result[0]).trim();
    if (current && keyOf(current) === key) said(text);
    update((list) => list.map((w) => (keyOf(w) === key ? { ...w, contextTranslation: text } : w)), () => {});
  });
}

// Words saved by earlier versions were given the dictionary's first noun even where the service
// knew better ("might" -> "güç" rather than "belki"); each is looked up again once.
const LOOKUP_VERSION = 2;
function refreshWord(item, kind) {
  if (kind !== 'word' || (item.looked || 0) >= LOOKUP_VERSION) return;
  const key = keyOf(item);
  chrome.runtime.sendMessage({ type: 'lookup', text: item.word, sl: item.lang || settings.learnLang, tl: settings.nativeLang }, (res) => {
    if (chrome.runtime.lastError || !res || !res.ok) return;
    const info = res.result;
    const fresh = {
      translation: info.translation || item.translation,
      definition: info.defs && info.defs[0] ? info.defs[0].text : item.definition,
      synonyms: info.synonyms || [],
      looked: LOOKUP_VERSION,
    };
    if (current && keyOf(current) === key) {
      Object.assign(current, fresh);
      $('translation').textContent = current.translation || '—';
      $('definition').textContent = current.definition || '';
      $('synonyms').textContent = current.synonyms.length ? slT('synonymsOf', current.synonyms.join(', ')) : '';
    }
    update((list) => list.map((w) => (keyOf(w) === key ? { ...w, ...fresh } : w)), () => {});
  });
}

function showEmpty() {
  const now = Date.now();
  const next = words.map((w) => w.due || 0).filter((d) => d > now).sort((a, b) => a - b)[0];
  let text;
  if (!words.length) text = slT('noSaved');
  else if (finished) text = slT('doneToday', finished);
  else text = slT('nothingDue');
  if (next) {
    const hours = (next - now) / 3600000;
    text += hours < 1 ? slT('nextSoon') : hours < 24 ? slT('nextHours', Math.round(hours)) : slT('nextDays', Math.round(hours / 24));
  }
  $('emptyText').textContent = text;
  $('studyAll').hidden = !words.length;
}

function reveal() {
  if (!current || revealed) return;
  revealed = true;
  $('answer').hidden = false;
  $('grades').hidden = false;
  $('show').hidden = true;
}

// Storage is re-read before every write so a word saved in another tab meanwhile is not lost.
function update(change, then) {
  chrome.storage.local.get({ words: [] }, (data) => {
    words = change(data.words);
    chrome.storage.local.set({ words }, then);
  });
}

function grade(value) {
  if (!current || !revealed) return;
  const key = keyOf(current);
  const graded = slGrade(current, value, Date.now());
  queue.shift();
  if (value === 'again') queue.push(key);
  else finished++;
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
  queue = words
    .filter((w) => all || slIsDue(w, now))
    .sort((a, b) => (a.due || 0) - (b.due || 0))
    .map(keyOf);
  finished = 0;
  show();
}

// A focused button would also react to Space; keep the keyboard for the shortcuts below.
document.addEventListener('click', (e) => {
  const button = e.target.closest('button');
  if (button) button.blur();
});
$('show').addEventListener('click', reveal);
$('say').addEventListener('click', () => speak(false));
$('saySlow').addEventListener('click', () => speak(true));
$('remove').addEventListener('click', removeCurrent);
$('studyAll').addEventListener('click', () => start(true));
for (const g of ['again', 'good', 'easy']) $(g).addEventListener('click', () => grade(g));

document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || !current) return;
  if (e.code === 'Space' || e.code === 'Enter') reveal();
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
  chrome.storage.local.get({ words: [] }, (data) => {
    words = data.words;
    start(false);
  });
});
