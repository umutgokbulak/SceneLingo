// What the speaking and the writing practice share: small ways of building the page, the star that
// saves something learnt as a card, the saved words to try to use, and the parts of Gemini's
// feedback that both show (the scores, what to put right, phrases to learn).
const $ = (id) => document.getElementById(id);
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
// A button's words with its key beside them.
const withKey = (button, label, key) => {
  button.textContent = '';
  button.append(el('span', null, label));
  if (key) button.append(el('kbd', null, key));
};
const ask = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' } : res)));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
const clock = (s) => Math.floor(Math.abs(s) / 60) + ':' + String(Math.abs(s) % 60).padStart(2, '0');
const failed = (error) => (error === 'noKey' ? slT('practiceNoKey') : slT('practiceFailed', error || '?'));

// ---------- saving what was learnt ----------

function savedHas(list, word) {
  return list.some((w) => w.word.toLowerCase() === word.toLowerCase());
}

// A star that saves (or unsaves) a card made from what is given.
function starFor(card) {
  const star = el('button', 'star');
  const paint = (on) => {
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('on', on);
    star.title = slT(on ? 'saved' : 'save');
  };
  paint(false);
  chrome.storage.local.get({ words: [] }, (data) => paint(savedHas(data.words, card.word)));
  star.addEventListener('click', () => {
    chrome.storage.local.get({ words: [] }, (data) => {
      const has = savedHas(data.words, card.word);
      if (has) slForget(card.word);
      const list = has ? data.words.filter((w) => w.word.toLowerCase() !== card.word.toLowerCase()) : [{ added: Date.now(), ...card }, ...data.words];
      chrome.storage.local.set({ words: list }, () => paint(!has));
    });
  });
  return star;
}

// The sentence of a text that holds the phrase: the context of a card made from it.
function sentenceWith(text, phrase) {
  const sentences = String(text).match(/[^.!?]+[.!?]*/g) || [text];
  return (sentences.find((s) => s.toLowerCase().includes(phrase.toLowerCase())) || text).trim();
}

// A saved word used rightly: the learner's own sentence becomes one of its examples.
function rememberUsed(used, title) {
  const good = (used || []).filter((u) => u.ok && u.sentence);
  if (!good.length) return;
  chrome.storage.local.get({ words: [] }, (data) => {
    const list = data.words.map((w) => {
      const u = good.find((g) => g.word.toLowerCase() === w.word.toLowerCase());
      return u ? slAddExample(w, { text: u.sentence, title }) : w;
    });
    chrome.storage.local.set({ words: list });
  });
}

// ---------- the saved words to try ----------

function wordsToTry(box, list) {
  box.textContent = '';
  box.hidden = !list.length;
  if (!list.length) return;
  box.append(el('b', null, slT('practiceTry')));
  for (const w of list) {
    const chip = el('span', null, w);
    chip.dataset.word = w.toLowerCase();
    box.append(chip);
  }
}

// A word to try, once it has been used, is marked.
function markUsed(box, text) {
  const said = ' ' + slNormalize(text) + ' ';
  for (const chip of box.querySelectorAll('span[data-word]')) chip.classList.toggle('ok', said.includes(' ' + slNormalize(chip.dataset.word) + ' '));
}

// ---------- the parts of the feedback ----------

// The overall band, then one box for each criterion: `criteria` is [[key, text], ...].
function bandsBox(bands, overall, criteria) {
  const box = el('div', 'bands');
  if (overall != null) {
    const all = el('div', 'band all');
    all.append(el('small', null, 'Band'), el('b', null, overall.toFixed(1)));
    box.append(all);
  }
  for (const [k, label] of criteria) {
    const b = el('div', 'band');
    b.append(el('small', null, slT(label)), el('b', null, Number(bands[k]).toFixed(1)));
    box.append(b);
  }
  return box;
}

function block(label, ...children) {
  const box = el('div', 'block');
  box.append(el('div', 'label', label), ...children);
  return box;
}

// The mistakes: what was written or said, crossed out, and the same put right.
function fixesBlock(corrections) {
  if (!corrections.length) return null;
  return block(
    slT('practiceCorrections'),
    ...corrections.map((c) => {
      const row = el('div', 'fix');
      row.append(el('s', null, c.said), ' → ', el('span', 'to', c.better));
      if (c.note) row.append(el('small', null, c.note));
      return row;
    })
  );
}

// Phrases to learn, each to be saved; `cardOf` makes the card of one.
function phrasesBlock(phrases, cardOf) {
  if (!phrases.length) return null;
  return block(
    slT('practicePhrases'),
    ...phrases.map((p) => {
      const row = el('div', 'phrase');
      row.append(el('b', null, p.text), el('span', null, p.meaning), starFor(cardOf(p)));
      return row;
    })
  );
}

// The saved words that were to be tried: used rightly or not.
function usedBlock(used) {
  if (!used.length) return null;
  return block(
    slT('practiceUsed'),
    ...used.map((u) => {
      const row = el('div', 'used');
      row.append(el('span', u.ok ? 'yes' : 'no', (u.ok ? '✓ ' : '– ') + u.word));
      if (u.ok && u.sentence) row.append(el('small', null, '“' + u.sentence + '” · ' + slT('practiceUsedSaved')));
      return row;
    })
  );
}

// The latest scores of a kind of practice (`speakLog`, `writeLog`), on average.
function averageBands(log, keys) {
  if (!log.length) return null;
  const mean = {};
  for (const k of keys) mean[k] = log.reduce((a, r) => a + r.bands[k], 0) / log.length;
  return mean;
}
