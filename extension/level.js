// The level test: about forty words, from the commonest to the rare ones, each to be matched with
// its meaning out of four (or "I don't know"); from them, how many words of the language are known
// and what level that is. The level can then be used everywhere it is chosen, and the common
// words not known saved to learn.
let settings = { ...SL_DEFAULTS };
let lang = 'en';
let items = [];
let answers = [];
let at = 0;
let nouns = null; // German nouns, to be written with their capital

const LISTED = ['en', 'de']; // the languages there is a list of common words for
const EXPLAIN = { A1: 'levelExplainFirst', A2: 'levelExplainBasic', B1: 'levelExplainMiddle', B2: 'levelExplainUpper', C1: 'levelExplainAdvanced' };

function screen(id) {
  for (const s of ['start', 'making', 'asking', 'result']) $(s).hidden = s !== id;
  scrollTo(0, 0);
}

// ---------- before ----------

function paintStart() {
  screen('start');
  $('lead').textContent = slT('levelLead', slLangName(lang));
  const listed = LISTED.includes(lang);
  $('noList').hidden = listed;
  $('noList').textContent = slT('levelNoList', slLangName(lang));
  $('begin').disabled = !listed;
  chrome.storage.local.get({ levelLog: [] }, (data) => {
    const past = (data.levelLog || []).filter((r) => r.lang === lang).slice(-5).reverse();
    $('past').textContent = '';
    if (past.length) $('past').append(el('div', 'label', slT('levelPast')));
    for (const r of past) {
      const row = el('div');
      row.append(el('b', null, '~' + r.size.toLocaleString(slUiLang)), el('span', null, r.level), el('span', 'muted', new Date(r.at).toLocaleDateString(slUiLang)));
      $('past').append(row);
    }
  });
}

// The words drawn, translated in one go, and made into questions.
async function begin() {
  screen('making');
  $('makingText').textContent = slT('levelMaking');
  try {
    const read = (l) => fetch('freq/' + l + '.txt').then((r) => r.text()).then((t) => t.split('\n').map((w) => w.trim()).filter(Boolean));
    const list = await read(lang);
    // German subtitles have English words in them; they are not asked.
    const other = lang === 'de' ? new Set(await read('en')) : null;
    if (lang === 'de') nouns = await slNouns();
    const bands = slVocabDraw(list, Math.random, other);
    const res = await ask({ type: 'translate', texts: bands.flat(), sl: lang, tl: settings.nativeLang });
    if (!res.ok) throw new Error(res.error || '?');
    // Each meaning translated back: only a word that comes back is asked.
    const back = await ask({ type: 'translate', texts: res.result.map((m) => m || '-'), sl: settings.nativeLang, tl: lang });
    const fair = slVocabFair(bands, res.result, back.ok ? back.result : null);
    // The wrong options: the meanings of words that look like each one, in one more request.
    const look = new Map(fair.flat().map((w) => [w.word, slVocabLookalikes(w.word, list)]));
    const alike = [...new Set([...look.values()].flat())];
    const meant = alike.length ? await ask({ type: 'translate', texts: alike, sl: lang, tl: settings.nativeLang }) : { ok: false };
    const meaningOf = new Map(meant.ok ? alike.map((w, i) => [w, String(meant.result[i] || '').trim()]) : []);
    const looks = new Map([...look].map(([w, list]) => [w, list.filter((x) => slFairMeaning(x, meaningOf.get(x))).map((x) => meaningOf.get(x))]));
    items = slVocabItems(fair, Math.random, looks);
    if (items.length < 20) throw new Error(slT('levelTooFew'));
  } catch (e) {
    $('makingText').textContent = slT('levelFailed', e.message);
    $('making').querySelector('.inner').append(btn(slT('writeLeave'), paintStart, 'btn'));
    return;
  }
  answers = [];
  at = 0;
  screen('asking');
  paintItem();
}

// ---------- asking ----------

// A German noun is written as it is in German, with its capital.
const shownWord = (word) => {
  const n = nouns && slNoun(nouns, word);
  return n && n.lemma.toLowerCase() === word ? n.lemma : word;
};

function paintItem() {
  const item = items[at];
  $('bar').style.width = Math.round((at / items.length) * 100) + '%';
  $('count').textContent = slT('levelCount', at + 1, items.length);
  $('word').textContent = shownWord(item.word);
  const box = $('options');
  box.textContent = '';
  item.options.forEach((m, i) => box.append(btn([el('kbd', null, String(i + 1)), el('span', null, m)], () => answer(i))));
}

function answer(i) {
  if ($('asking').hidden) return;
  answers[at] = i;
  at += 1;
  if (slVocabDone(items, answers, at)) finish();
  else paintItem();
}

$('idk').addEventListener('click', () => answer(-1));
document.addEventListener('keydown', (e) => {
  if ($('asking').hidden || e.ctrlKey || e.metaKey || e.altKey) return;
  const n = /^(Digit|Numpad)([1-4])$/.exec(e.code);
  if (n) answer(+n[2] - 1);
  else if (e.code === 'Digit0' || e.code === 'Numpad0' || e.code === 'Space') answer(-1);
  else return;
  e.preventDefault();
});

// ---------- the result ----------

function finish() {
  const score = slVocabScore(items, answers);
  chrome.storage.local.get({ levelLog: [] }, (data) => {
    const entry = { at: Date.now(), task: lang, lang, size: score.size, level: score.level, shares: score.shares };
    chrome.storage.local.set({ levelLog: [...(data.levelLog || []), entry].slice(-SL_LOG_KEPT) });
  });
  slLogPractice('level');
  screen('result');
  $('size').textContent = '~' + score.size.toLocaleString(slUiLang);
  $('sizeText').textContent = slT('levelWords');
  $('lv').textContent = score.level;
  $('explain').textContent = slT(EXPLAIN[score.level]) + ' ' + slT('levelForms');
  // Each stretch of the list: how much of it is known.
  $('bars').textContent = '';
  $('ranks').textContent = '';
  score.shares.forEach((s, b) => {
    const bar = el('i', s ? null : 'none');
    bar.style.height = Math.max(3, Math.round(s * 100)) + '%';
    bar.title = slT('levelBand', (b * SL_VOCAB_BAND + 1).toLocaleString(slUiLang), ((b + 1) * SL_VOCAB_BAND).toLocaleString(slUiLang)) + ': %' + Math.round(s * 100);
    $('bars').append(bar);
    $('ranks').append(el('span', null, (b + 1) * 2 + 'k'));
  });
  // The level, for the episode's words and the practice where a level is chosen.
  const apply = $('apply');
  apply.textContent = '';
  apply.append(el('span', null, slT('levelApplyText', score.level)));
  const set = btn(slT('levelApply', score.level), () => {
    chrome.storage.sync.set({ wordLevel: score.level });
    // Recognising words is the measure for which words to learn and what to read; writing and
    // speaking are asked of them, and keep their own level.
    chrome.storage.local.set({ readLevel: score.level });
    set.disabled = true;
    set.textContent = '✓ ' + slT('levelApplied');
  }, 'btn small primary');
  apply.append(set);
  // The commonest words not known: the first ones worth learning.
  const missed = items.filter((it, i) => answers[i] !== undefined && answers[i] !== it.answer).slice(0, 10);
  const box = $('missed');
  box.textContent = '';
  if (missed.length) {
    box.append(el('div', 'label', slT('levelMissed')));
    for (const it of missed) {
      const row = el('div', 'mrow');
      const word = shownWord(it.word);
      row.append(el('b', null, word), el('span', null, it.meaning), starFor({ word, kind: 'word', translation: it.meaning, lang, title: slT('levelTitle') }));
      box.append(row);
    }
  }
}

$('begin').addEventListener('click', begin);
$('again').addEventListener('click', paintStart);

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  slNav('today');
  document.title = slT('levelTitle') + ' — SceneLingo';
  lang = settings.learnLang;
  withKey($('begin'), slT('levelBegin'), '');
  $('idk').append(slT('levelIdk'), el('kbd', null, '0'));
  $('again').textContent = slT('levelAgain');
  paintStart();
});
