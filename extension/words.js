// Every saved word, phrase and sentence in one place: found by search, kind, source and where it
// stands; each opens to show all that is known of it. Backups are made and read back here.
const $ = (id) => document.getElementById(id);
const keyOf = (item) => item.word.toLowerCase();
const KIND_LABEL = { word: 'kindWordCard', phrase: 'kindPhraseCard', sentence: 'kindSentenceCard' };
const STATUS_LABEL = { new: 'statNew', learning: 'statLearning', learned: 'statLearned', hard: 'statHard' };
const PAGE = 150; // rows drawn at once; more on asking
const DAY = 86400000;

let settings = { ...SL_DEFAULTS };
let words = [];
let log = {};
let lastBackup = 0;
const filter = { status: 'all', kind: 'all', source: 'all', q: '', sort: 'new' };
const open = new Set(); // keys of the rows shown open
const sure = new Set(); // keys whose delete button has been clicked once
let editing = '';
let limit = PAGE;
const audio = new Audio();

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
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick(e);
  });
  return b;
};
const ask = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' } : res)));

function speak(text, item) {
  const lang = (item.lang || 'en') === 'en' ? settings.accent : item.lang;
  ask({ type: 'tts', text, lang }).then((res) => {
    if (!res.ok) return;
    audio.src = 'data:audio/mpeg;base64,' + res.result;
    audio.volume = Math.min(1, settings.speechVolume / 100);
    audio.play().catch(() => {});
  });
}

// Storage is re-read before every write so a word saved in another tab meanwhile is not lost.
function update(change, then) {
  chrome.storage.local.get({ words: [] }, (data) => {
    words = change(data.words);
    chrome.storage.local.set({ words }, () => {
      render();
      if (then) then();
    });
  });
}

// ---------- what is shown ----------

const itemText = (item) => (slKindOf(item) === 'sentence' ? slCleanLine(item.word) : item.word);
const meaningOf = (item) => (slKindOf(item) !== 'sentence' && item.contextMeaning) || item.translation || '';

function matches(item) {
  if (filter.status !== 'all' && slStatus(item) !== filter.status) return false;
  if (filter.kind !== 'all' && slKindOf(item) !== filter.kind) return false;
  if (filter.source !== 'all' && slSourceName(item.title) !== filter.source) return false;
  if (!filter.q) return true;
  const q = slNormalize(filter.q);
  return [item.word, item.translation, item.contextMeaning, item.contextPhrase, item.context, item.contextTranslation].some((t) => t && slNormalize(t).includes(q));
}

function sorted(list) {
  const by = {
    new: (a, b) => (b.added || 0) - (a.added || 0),
    az: (a, b) => itemText(a).localeCompare(itemText(b), settings.learnLang),
    due: (a, b) => (slIsNew(a) - slIsNew(b)) || (a.due || 0) - (b.due || 0),
    hard: (a, b) => (b.lapses || 0) - (a.lapses || 0) || (b.added || 0) - (a.added || 0),
  }[filter.sort];
  return list.slice().sort(by);
}

function dueText(item) {
  if (slIsNew(item)) return slT('statNew');
  const now = Date.now();
  if (!item.due || item.due <= now || slDayKey(item.due) === slDayKey(now)) return slT('dueToday');
  if (slDayKey(item.due) === slDayKey(now + DAY)) return slT('tomorrow');
  return slT('inDays', Math.ceil((item.due - now) / DAY));
}

// The sentence with the item marked in it.
function marked(item, tag = 'mark') {
  const shown = { ...item, context: slCleanLine(item.context || '') };
  const parts = slClozeParts(shown);
  const box = document.createDocumentFragment();
  if (!parts) box.append(shown.context);
  else box.append(parts.before, el(tag, null, parts.answer), parts.after);
  return box;
}

function render() {
  paintBanner();
  paintSummary();
  paintSources();
  const list = $('list');
  list.textContent = '';
  $('count').textContent = slT('wordsCount', words.length);
  if (!words.length) {
    list.append(el('div', 'empty', slT('noSaved')));
    return;
  }
  const shown = sorted(words.filter(matches));
  if (!shown.length) {
    list.append(el('div', 'empty', slT('noMatch')));
    return;
  }
  for (const item of shown.slice(0, limit)) list.append(row(item));
  if (shown.length > limit) {
    const more = el('div', 'more');
    more.append(btn(slT('showMore', shown.length - limit), () => {
      limit += PAGE;
      render();
    }));
    list.append(more);
  }
}

function row(item) {
  const key = keyOf(item);
  const kind = slKindOf(item);
  const status = slStatus(item);
  const box = el('div', 'row' + (open.has(key) ? ' open' : ''));
  const line = el('div', 'line');
  line.addEventListener('click', () => {
    if (open.has(key)) open.delete(key);
    else open.add(key);
    render();
  });

  const chev = el('span', 'chev');
  chev.append(icon('chevron'));

  const w = el('div', 'w');
  const top = el('div', 'top');
  top.append(el('b', kind === 'sentence' ? 'sentence' : null, itemText(item)));
  const ipa = item.extra && item.extra.ipa ? item.extra.ipa : item.ipa ? '/' + item.ipa + '/' : '';
  if (ipa && kind !== 'sentence') top.append(el('span', 'ipa', ipa));
  if (kind !== 'word') top.append(el('span', 'chip', slT(KIND_LABEL[kind])));
  if (item.extra && item.extra.level) top.append(el('span', 'chip level', item.extra.level));
  w.append(top);
  if (item.context && kind !== 'sentence') {
    const ctx = el('div', 'ctx');
    ctx.append(marked(item));
    w.append(ctx);
  }

  const m = el('div', 'm', meaningOf(item) || '—');
  if (item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word)) m.append(el('small', null, item.contextPhrase));

  const due = el('div', 'due');
  due.append(el('span', 'st ' + status, slT(STATUS_LABEL[status])), el('small', null, status === 'new' ? slSourceName(item.title) : dueText(item)));

  const ops = el('div', 'ops');
  const listen = btn(icon('speaker'), () => speak(itemText(item), item), 'iconbtn');
  listen.title = slT('reviewListen');
  ops.append(listen);
  if (item.source && item.source.url) {
    const scene = btn(icon('play'), () => ask({ type: 'open-scene', url: item.source.url, time: item.source.time }), 'iconbtn');
    scene.title = slT('openScene');
    ops.append(scene);
  }
  const del = btn(sure.has(key) ? [icon('trash'), el('span', 't', slT('removeConfirm'))] : icon('trash'), () => {
    if (sure.has(key)) return remove(key);
    sure.add(key);
    render();
  }, 'iconbtn danger');
  del.title = slT('removeCard');
  ops.append(del);

  line.append(chev, w, m, due, ops);
  box.append(line);
  if (open.has(key)) box.append(detail(item));
  return box;
}

// All that is known of one item.
function detail(item) {
  const key = keyOf(item);
  const kind = slKindOf(item);
  const box = el('div', 'detail');
  const block = (title, ...children) => {
    const b = el('div');
    b.append(el('div', 'label', title), ...children.filter(Boolean));
    return b;
  };

  if (editing === key) {
    const form = el('div', 'edit wide');
    const field = (label, value) => {
      const l = el('label', null, label);
      const i = el('input');
      i.value = value || '';
      l.append(i);
      form.append(l);
      return i;
    };
    const wIn = field(slT('editWord'), item.word);
    const tIn = field(slT('editTranslation'), item.translation);
    const save = () => saveEdit(item, wIn.value.trim(), tIn.value.trim());
    for (const i of [wIn, tIn]) i.addEventListener('keydown', (e) => e.key === 'Enter' && save());
    form.append(btn(slT('editSave'), save, 'btn small primary'), btn(slT('editCancel'), () => ((editing = ''), render()), 'btn small ghost'));
    box.append(form);
    setTimeout(() => wIn.focus(), 0);
    return box;
  }

  if (item.context && kind !== 'sentence') {
    const q = el('p', 'quote');
    q.append(marked(item, 'b'));
    const src = el('div', 'sub', slSourceName(item.title));
    if (item.source && item.source.url) {
      src.append(' · ', btn([icon('play'), slT('openScene')], () => ask({ type: 'open-scene', url: item.source.url, time: item.source.time }), 'link'));
    }
    box.append(block(slT('factSentence'), q, item.contextTranslation && el('div', 'sub', '“' + slCleanLine(item.contextTranslation) + '”'), src));
  } else if (kind === 'sentence') {
    box.append(block(slT('kindSentenceCard'), el('p', null, itemText(item)), el('div', 'sub', item.translation || ''), el('div', 'sub', slSourceName(item.title))));
  }

  const meaning = [];
  if (item.contextMeaning && kind !== 'sentence') {
    const phrase = item.contextPhrase && slNormalize(item.contextPhrase) !== slNormalize(item.word) ? item.contextPhrase + ' — ' : '';
    meaning.push(el('p', null, phrase + item.contextMeaning));
    if (item.contextNote) meaning.push(el('div', 'sub', item.contextNote));
  }
  if (item.translation && kind !== 'sentence' && !(item.contextMeaning && slNormalize(item.contextMeaning).includes(slNormalize(item.translation)))) {
    meaning.push(el(item.contextMeaning ? 'div' : 'p', item.contextMeaning ? 'sub' : null, (item.contextMeaning ? slT('factDictionary') + ': ' : '') + item.translation));
  }
  if (item.definition) meaning.push(el('div', 'sub', item.definition));
  if (meaning.length) box.append(block(slT('editTranslation'), ...meaning));

  const extra = item.extra || {};
  const list = (rows) => {
    const ul = el('ul');
    for (const r of rows) {
      const li = el('li', null, r.text);
      if (r.sub) li.append(el('small', null, r.sub));
      ul.append(li);
    }
    return ul;
  };
  if ((extra.collocations || []).length) box.append(block(slT('collocations'), list(extra.collocations.map((c) => ({ text: c.text, sub: c.meaning })))));
  if ((extra.examples || []).length) box.append(block(slT('moreExamples'), list(extra.examples.map((e) => ({ text: e.text, sub: e.translation })))));
  if ((item.examples || []).length) box.append(block(slT('metAgain'), list(item.examples.map((e) => ({ text: slCleanLine(e.text), sub: slSourceName(e.title) })))));
  if ((item.mine || []).length) box.append(block(slT('ownSentence'), list(item.mine.map((m) => ({ text: m.better || m.text, sub: m.better && m.better !== m.text ? m.text : '' })))));

  // Where it stands, and when it was met.
  const meta = el('div', 'meta wide');
  const fact = (label, value) => {
    const s = el('span', null, label + ' ');
    s.append(el('b', null, String(value)));
    meta.append(s);
  };
  if (item.added) fact(slT('metaSaved'), new Date(item.added).toLocaleDateString(document.documentElement.lang));
  if (item.last) fact(slT('histLast'), slAgo(item.last));
  if (!slIsNew(item)) {
    fact(slT('histInterval'), slT('statDays', item.interval || 0));
    fact(slT('histReps'), item.reps || 0);
  }
  if (item.lapses) fact(slT('histLapses'), item.lapses);
  meta.append(btn([icon('edit'), slT('editCard')], () => ((editing = key), render()), 'link'));
  box.append(meta);
  return box;
}

// A changed word may be one there is already a card for: the two become one.
function saveEdit(item, word, translation) {
  if (!word) return;
  const oldKey = keyOf(item);
  const newKey = word.toLowerCase();
  const kind = slKindOf(item) === 'sentence' ? 'sentence' : /\s/.test(word) ? 'phrase' : 'word';
  let edited = { ...item, word, kind, translation, updated: Date.now() };
  if (newKey !== oldKey) slForget(oldKey);
  if (newKey !== oldKey) Object.assign(edited, { ipa: '', definition: '', synonyms: [], looked: 0, enriched: false, extra: null });
  editing = '';
  open.delete(oldKey);
  open.add(newKey);
  update((list) => {
    const other = newKey !== oldKey && list.find((x) => keyOf(x) === newKey);
    if (other) edited = slMerge(edited, other);
    return list.filter((x) => keyOf(x) !== newKey && keyOf(x) !== oldKey).concat(edited);
  });
}

function remove(key) {
  slForget(key);
  sure.delete(key);
  open.delete(key);
  update((list) => list.filter((w) => keyOf(w) !== key));
}

// ---------- the cloud ----------

// Signed in: who, when the last sync was, and (in the extension) where the phone finds the cards.
// Signed out: what the cloud is for, and the way in. Not shown before the app is set up.
// Google's answers, said plainly.
function cloudError(e) {
  if (e === 'noDrive') return slT('cloudNoDrive');
  if (e === 'access_denied') return slT('cloudDenied');
  if (e === 'signed out' || e === 'interaction_required' || e === 'login_required') return slT('cloudAgain');
  return slT('cloudFailed', e);
}

async function paintCloud(note) {
  const res = await ask({ type: 'cloud-state' });
  if (!note && res.ok && res.result.error) note = cloudError(res.result.error);
  const box = $('cloud');
  box.textContent = '';
  const st = res.ok ? res.result : null;
  box.hidden = !st || !st.configured;
  if (box.hidden) return;
  const what = el('div', 'what');
  if (st.email) {
    const line = el('span', null, slT('cloudOn') + ' ');
    line.append(el('b', null, st.email));
    what.append(line, el('small', null, note || (st.lastSync ? slT('cloudSynced', slAgo(st.lastSync)) : slT('cloudNever'))));
    if (st.web) {
      const phone = el('small', null, slT('cloudPhone') + ' ');
      phone.append(el('code', null, st.web));
      what.append(phone);
    }
    box.append(icon('cloud'), what, btn([icon('sync'), slT('cloudSyncNow')], () => cloudSync(true)), btn(slT('cloudSignOut'), signOut, 'btn small ghost'));
  } else {
    what.append(el('span', null, slT('cloudTip')));
    if (note) what.append(el('small', null, note));
  }
  if ((st.log || []).length) {
    const steps = el('details', 'steps');
    steps.append(el('summary', null, slT('cloudSteps')), el('pre', null, st.log.join('\n')));
    what.append(steps);
  }
  if (!st.email) {
    box.append(icon('cloud'), what, btn([icon('cloud'), slT('cloudConnect')], () => cloudSync(true), 'btn small primary'));
  }
}

async function cloudSync(interactive) {
  paintCloud(slT('cloudSyncing'));
  const res = await ask({ type: 'cloud-sync', interactive });
  if (!res.ok) return paintCloud(cloudError(res.error));
  const r = res.result;
  paintCloud(r.added || r.updated ? slT('restored', r.added, r.updated) : '');
}

async function signOut() {
  await ask({ type: 'cloud-signout' });
  paintCloud();
}

// ---------- Gemini, on the phone ----------

// In the extension the key is set in its popup. On the phone the pages run alone, so the key is
// given here; it stays in this phone's browser and is not sent to the cloud.
const onPhone = chrome.runtime.getManifest().version === 'web';

async function paintGemini(note) {
  const box = $('gemini');
  box.hidden = !onPhone;
  if (!onPhone) return;
  box.textContent = '';
  const res = await ask({ type: 'gemini-key' });
  const shown = res.ok ? res.result : '';
  const what = el('div', 'what');
  box.append(icon('bulb'), what);
  if (shown) {
    what.append(el('span', null, 'Gemini · ' + slT('geminiKeyShown', shown)));
    if (note) what.append(el('small', null, note));
    box.append(btn(slT('geminiRemove'), async () => {
      await ask({ type: 'gemini-remove' });
      paintGemini();
    }, 'btn small ghost'));
    return;
  }
  what.append(el('span', null, slT('geminiPhoneTip')));
  if (note) what.append(el('small', null, note));
  const link = el('a', null, slT('geminiGetKey'));
  link.href = 'https://aistudio.google.com/apikey';
  link.target = '_blank';
  link.rel = 'noopener';
  what.append(el('br'), link);
  const input = el('input');
  input.type = 'password';
  input.autocomplete = 'off';
  input.placeholder = slT('geminiKeyPh');
  const save = btn(slT('geminiSave'), async () => {
    const key = input.value.trim();
    if (!key) return input.focus();
    save.disabled = true;
    paintGemini(slT('geminiTrying'));
    const r = await ask({ type: 'gemini-save', key, tl: settings.nativeLang });
    paintGemini(r.ok ? slT('geminiWorks', (r.result.phrase ? r.result.phrase + ' — ' : '') + r.result.meaning) : slT('geminiFailed', r.error));
  }, 'btn small primary');
  box.append(input, save);
}

// ---------- the parts above the list ----------

function paintSummary() {
  const box = $('summary');
  box.textContent = '';
  const counts = { all: words.length, new: 0, learning: 0, learned: 0, hard: 0 };
  for (const w of words) counts[slStatus(w)] += 1;
  for (const [status, label] of [['all', 'statTotal'], ['new', 'statNew'], ['learning', 'statLearning'], ['learned', 'statLearned'], ['hard', 'statHard']]) {
    const b = el('button', 'sum ' + status + (filter.status === status ? ' on' : ''));
    b.append(el('small', null, slT(label)), el('b', null, String(counts[status])));
    b.addEventListener('click', () => {
      filter.status = filter.status === status ? 'all' : status;
      limit = PAGE;
      render();
    });
    box.append(b);
  }
}

function fillSelect(sel, options, value) {
  sel.textContent = '';
  for (const [v, label] of options) {
    const o = el('option', null, label);
    o.value = v;
    sel.append(o);
  }
  sel.value = value;
}

function paintSources() {
  const names = [...new Set(words.map((w) => slSourceName(w.title)).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (filter.source !== 'all' && !names.includes(filter.source)) filter.source = 'all';
  fillSelect($('source'), [['all', slT('sourceAll')], ...names.map((n) => [n, n])], filter.source);
}

// Words live only in this browser: a reminder once a week that a copy should be kept elsewhere.
function paintBanner() {
  const banner = $('banner');
  banner.textContent = '';
  const due = words.length && (!lastBackup || Date.now() - lastBackup > 7 * DAY);
  banner.hidden = !due;
  if (!due) return;
  banner.append(icon('download'), el('div', null, lastBackup ? slT('backupOld', slAgo(lastBackup)) : slT('backupNever')), btn([icon('download'), slT('backupNow')], backup, 'btn small primary'));
}

function notice(text, bad) {
  const n = $('notice');
  n.textContent = text;
  n.classList.toggle('bad', !!bad);
  n.hidden = false;
  clearTimeout(notice.timer);
  notice.timer = setTimeout(() => (n.hidden = true), 6000);
}

function download(name, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function backup() {
  chrome.storage.local.get({ words: [], reviewLog: {}, deleted: {} }, (data) => {
    const now = Date.now();
    const file = slBackup(data.words, data.reviewLog, now, chrome.runtime.getManifest().version, data.deleted);
    const name = slT('backupName', slDayKey(now));
    download(name, new Blob([JSON.stringify(file, null, 1)], { type: 'application/json' }));
    lastBackup = now;
    chrome.storage.local.set({ lastBackup: now });
    notice(slT('backedUp', name));
    render();
  });
}

function restore(fileObj) {
  fileObj.text().then(
    (text) => {
      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        return notice(slT('restoreFailed', e.message), true);
      }
      chrome.storage.local.get({ words: [], reviewLog: {}, deleted: {} }, (here) => {
        let r;
        try {
          r = slRestore(here.words, here.reviewLog, data, here.deleted);
        } catch (e) {
          return notice(slT('restoreFailed', e.message), true);
        }
        chrome.storage.local.set({ words: r.words, reviewLog: r.log, deleted: r.deleted }, () => {
          words = r.words;
          log = r.log;
          notice(slT('restored', r.added, r.updated));
          render();
        });
      });
    },
    (e) => notice(slT('restoreFailed', e.message), true)
  );
}

function csv() {
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [slT('csvHead').split(';').map(cell).join(';')];
  for (const w of sorted(words.filter(matches))) {
    lines.push([w.word, meaningOf(w), w.ipa, w.definition, slCleanLine(w.context || ''), w.lang, w.title, w.added ? new Date(w.added).toISOString().slice(0, 10) : ''].map(cell).join(';'));
  }
  download(slT('csvName'), new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
}

// ---------- start ----------

$('backup').addEventListener('click', backup);
$('restore').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', () => {
  if ($('file').files[0]) restore($('file').files[0]);
  $('file').value = '';
});
$('csv').addEventListener('click', csv);
$('study').addEventListener('click', () => (location.href = chrome.runtime.getURL('review.html')));
$('searchIcon').append(icon('search'));
$('q').addEventListener('input', () => {
  filter.q = $('q').value.trim();
  limit = PAGE;
  render();
});
for (const id of ['kind', 'source', 'sort']) {
  $(id).addEventListener('change', () => {
    filter[id] = $(id).value;
    limit = PAGE;
    render();
  });
}
// Saved in another tab, or reviewed: the list follows.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.lastBackup) lastBackup = changes.lastBackup.newValue || 0;
  if (changes.words) words = changes.words.newValue || [];
  if (changes.words || changes.lastBackup) render();
  if (changes.cloudEmail || changes.lastSync || changes.cloudError) paintCloud();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('wordsTitle') + ' — SceneLingo';
  // Words on the page only once the language of the interface is known.
  $('backup').append(icon('download'), slT('backupNow'));
  $('restore').append(icon('upload'), slT('restoreBackup'));
  $('study').append(icon('cards'), slT('studyNow'));
  $('q').placeholder = slT('searchPh');
  fillSelect($('kind'), [['all', slT('kindAll')], ['word', slT('kindWordCard')], ['phrase', slT('kindPhraseCard')], ['sentence', slT('kindSentenceCard')]], filter.kind);
  fillSelect($('sort'), [['new', slT('sortNew')], ['az', slT('sortAz')], ['due', slT('sortDue')], ['hard', slT('sortHard')]], filter.sort);
  chrome.storage.local.get({ words: [], reviewLog: {}, lastBackup: 0 }, (data) => {
    words = data.words;
    log = data.reviewLog;
    lastBackup = data.lastBackup;
    render();
    paintCloud();
    paintGemini();
  });
});
