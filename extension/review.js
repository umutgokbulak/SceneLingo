const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'Kelime', phrase: 'Kalıp', sentence: 'Cümle' };

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
  if (!item.interval) return '10 dakika sonra';
  return item.interval === 1 ? 'yarın' : item.interval + ' gün sonra';
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
  $('progress').textContent = `Kalan ${queue.length} · Biten ${finished}`;
  $('card').hidden = !current;
  $('empty').hidden = !!current;
  if (!current) return showEmpty();

  revealed = false;
  const kind = current.kind || (/\s/.test(current.word) ? 'phrase' : 'word');
  $('kind').textContent = KIND_LABEL[kind] || '';
  $('term').textContent = current.word;
  $('term').classList.toggle('long', current.word.length > 28);
  $('ipa').textContent = current.ipa ? '/' + current.ipa + '/' : '';
  fillContext($('context'), { ...current, kind });
  $('source').textContent = current.title || '';
  $('translation').textContent = current.translation || '—';
  $('definition').textContent = current.definition || '';
  $('synonyms').textContent = current.synonyms && current.synonyms.length ? 'Eş anlamlı: ' + current.synonyms.join(', ') : '';
  $('answer').hidden = true;
  $('grades').hidden = true;
  $('show').hidden = false;
  const now = Date.now();
  for (const grade of ['again', 'good', 'easy']) {
    $(grade).querySelector('small').textContent = intervalLabel(slGrade(current, grade, now));
  }
  if (settings.autoSpeak) speak(false);
}

function showEmpty() {
  const now = Date.now();
  const next = words.map((w) => w.due || 0).filter((d) => d > now).sort((a, b) => a - b)[0];
  let text;
  if (!words.length) text = 'Henüz kayıtlı kelime yok. Film izlerken bir kelimeye tıkla ve ☆ Kaydet de.';
  else if (finished) text = `Bugünlük bitti: ${finished} kart tekrar edildi.`;
  else text = 'Şu an tekrar zamanı gelen kart yok.';
  if (next) {
    const hours = (next - now) / 3600000;
    text += ' Sıradaki kart ' + (hours < 1 ? 'bir saat içinde' : hours < 24 ? Math.round(hours) + ' saat sonra' : Math.round(hours / 24) + ' gün sonra') + ' hazır.';
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
  chrome.storage.local.get({ words: [] }, (data) => {
    words = data.words;
    start(false);
  });
});
