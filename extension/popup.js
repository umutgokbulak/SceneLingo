const $ = (id) => document.getElementById(id);
let settings = { ...SL_DEFAULTS };
let words = [];

const option = (value, label) => {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
};

// Everything that is words: said again whenever the language of the interface changes.
function paint() {
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  for (const id of ['learnLang', 'nativeLang']) {
    $(id).textContent = '';
    for (const code of SL_LANGS) $(id).appendChild(option(code, slLangName(code)));
    $(id).value = settings[id];
  }
  // The interface's own languages, each under its own name.
  const own = (code) => {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  };
  $('uiLang').textContent = '';
  $('uiLang').append(option('auto', slT('uiAuto')), ...Object.keys(SL_TEXTS).map((code) => option(code, own(code))));
  $('uiLang').value = settings.uiLang;
  renderWords();
  showEngine();
}

for (const id of ['learnLang', 'nativeLang', 'uiLang']) {
  $(id).addEventListener('change', () => {
    settings[id] = $(id).value;
    chrome.storage.sync.set({ [id]: $(id).value });
    if (id === 'uiLang') paint();
    else showEngine();
  });
}
for (const id of ['enabled', 'preferHuman']) {
  $(id).addEventListener('change', () => chrome.storage.sync.set({ [id]: $(id).checked }));
}

// The label follows the slider while it moves; the setting is saved once it is released.
$('volume').addEventListener('input', () => {
  $('volumeValue').textContent = $('volume').value + '%';
});
$('volume').addEventListener('change', () => chrome.storage.sync.set({ speechVolume: +$('volume').value }));

function renderWords() {
  const box = $('words');
  box.textContent = '';
  $('wordsHead').textContent = slT('headWords', words.length);
  const due = words.filter((w) => slIsDue(w, Date.now())).length;
  $('review').textContent = due ? slT('reviewDue', due) : slT('reviewOpen');
  if (!words.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = slT('noWordsYet');
    box.appendChild(empty);
    return;
  }
  for (const w of words) {
    const row = document.createElement('div');
    row.className = 'word';
    const main = document.createElement('div');
    main.className = 'word-main';
    const head = document.createElement('div');
    const b = document.createElement('b');
    b.textContent = w.word;
    const kind = document.createElement('span');
    kind.className = 'kind';
    kind.textContent = w.kind === 'phrase' ? slT('kindPhrase') : w.kind === 'sentence' ? slT('kindSentence') : '';
    const tr = document.createElement('span');
    tr.className = 'tr';
    tr.textContent = w.translation ? ' — ' + w.translation : '';
    head.append(b, kind, tr);
    const ctx = document.createElement('div');
    ctx.className = 'ctx';
    ctx.textContent = w.context || '';
    main.append(head, ctx);
    const del = document.createElement('button');
    del.className = 'del';
    del.textContent = '✕';
    del.title = slT('remove');
    del.addEventListener('click', () => {
      words = words.filter((x) => x !== w);
      chrome.storage.local.set({ words });
      renderWords();
    });
    row.append(main, del);
    box.appendChild(row);
  }
}

$('review').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }));

// Translation inside the browser. The browser fetches a language pack the first time a pair of
// languages is used, and only when a person asks for it: so the asking is done here, with a
// button. After that the background translates with it, on every site.
const pair = () => {
  const names = (code) => ({ he: ['he', 'iw'], no: ['no', 'nb'] })[code] || [code];
  const all = [];
  for (const sourceLanguage of names(settings.learnLang)) for (const targetLanguage of names(settings.nativeLang)) all.push({ sourceLanguage, targetLanguage });
  return all;
};

async function showEngine() {
  const from = slLangName(settings.learnLang);
  const to = slLangName(settings.nativeLang);
  const say = (text, button) => {
    $('engineState').textContent = text;
    $('engineGet').hidden = !button;
    $('engineGet').textContent = button || '';
    $('engineGet').disabled = false;
  };
  if (settings.learnLang === settings.nativeLang) return say('');
  if (typeof Translator !== 'function') return say(slT('engineNone', from, to));
  let best = 'unavailable';
  for (const langs of pair()) {
    const state = await Translator.availability(langs).catch(() => 'unavailable');
    if (state === 'available') return say(slT('engineReady', from, to));
    if (state !== 'unavailable') best = state;
  }
  if (best === 'unavailable') say(slT('engineNone', from, to));
  else say(slT('engineNote'), slT('engineGet', from, to));
}

$('engineGet').addEventListener('click', async () => {
  $('engineGet').disabled = true;
  let failure = null;
  for (const langs of pair()) {
    try {
      const translator = await Translator.create({
        ...langs,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => ($('engineGet').textContent = slT('engineGetting', Math.round(e.loaded * 100))));
        },
      });
      if (translator.destroy) translator.destroy();
      return showEngine();
    } catch (e) {
      failure = e;
    }
  }
  $('engineGet').disabled = false;
  $('engineState').textContent = slT('engineFailed', (failure && failure.message) || failure);
});

// Other sites: access is asked for when the switch is turned on, and given back when it is turned
// off. The background registers the content script to match.
const EVERYWHERE = { origins: ['*://*/*'] };
const siteNote = (text) => ($('siteNote').textContent = text);
const activeTab = () => new Promise((resolve) => chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve(tabs[0])));
const toTab = (tab, msg) =>
  new Promise((resolve) => chrome.tabs.sendMessage(tab.id, msg, (res) => resolve(chrome.runtime.lastError ? null : res)));

chrome.permissions.contains(EVERYWHERE, (has) => ($('everywhere').checked = has));
$('everywhere').addEventListener('change', () => {
  const done = (has) => {
    $('everywhere').checked = has;
    chrome.runtime.sendMessage({ type: 'sync-sites' });
    siteNote(has ? slT('everywhereOn') : '');
  };
  if ($('everywhere').checked) chrome.permissions.request(EVERYWHERE, done);
  else chrome.permissions.remove(EVERYWHERE, () => done(false));
});

// The sound of the film, louder: the tab's sound is captured and played through a gain. The
// browser gives an extension a tab's sound only when the person has opened its popup on it.
let boostTimer = 0;
const ask = (msg) => new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : res)));
async function boost(level) {
  const tab = await activeTab();
  if (!tab) return;
  const now = await ask({ type: 'boost-state', tabId: tab.id });
  let streamId;
  if (level > 100 && !(now.ok && now.result.level > 100)) {
    streamId = await new Promise((resolve) => chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id) => resolve(chrome.runtime.lastError ? null : id)));
    if (!streamId) return ($('boostNote').textContent = slT('boostFailed', slT('boostNoTab')));
  }
  const res = await ask({ type: 'boost', tabId: tab.id, level, streamId });
  $('boostNote').textContent = res.ok ? '' : slT('boostFailed', res.error);
}
$('boost').addEventListener('input', () => {
  $('boostValue').textContent = $('boost').value + '%';
  clearTimeout(boostTimer);
  boostTimer = setTimeout(() => boost(+$('boost').value), 120);
});
activeTab().then(async (tab) => {
  if (!tab) return;
  const res = await ask({ type: 'boost-state', tabId: tab.id });
  if (!res.ok) return;
  $('boost').value = res.result.level;
  $('boostValue').textContent = res.result.level + '%';
});

// A site can be switched off on its own: the page in this tab says which site it is.
activeTab().then(async (tab) => {
  const here = tab && (await toTab(tab, { type: 'where' }));
  if (!here || !here.host) return;
  $('siteRow').hidden = false;
  $('siteHost').textContent = here.host;
  $('siteOn').checked = !here.off;
  $('siteOn').addEventListener('change', () => {
    chrome.storage.sync.get({ offSites: [] }, ({ offSites }) => {
      const rest = offSites.filter((h) => h !== here.host);
      chrome.storage.sync.set({ offSites: $('siteOn').checked ? rest : rest.concat(here.host) });
    });
  });
});

// Brings the overlay up on the video in this tab even if it has no subtitles of its own.
$('activate').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  if (!(await toTab(tab, { type: 'activate' }))) {
    // The page was open before the extension could run on it: start there now, if allowed.
    const started = await new Promise((resolve) => chrome.runtime.sendMessage({ type: 'start-in-tab', tabId: tab.id }, (res) => resolve(!chrome.runtime.lastError && res && res.ok)));
    if (!started || !(await toTab(tab, { type: 'activate' }))) {
      siteNote(slT($('everywhere').checked ? 'cannotHere' : 'needEverywhere'));
      return;
    }
  }
  siteNote(slT('activated'));
});

// For reporting a problem: what the extension sees on the tab in front, whether or not its overlay is showing.
$('diagnose').addEventListener('click', () => {
  const say = (text) => {
    $('diagnose').textContent = text;
    setTimeout(() => ($('diagnose').textContent = slT('copyDiag')), 3000);
  };
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }, (report) => {
      if (chrome.runtime.lastError || !report) return say(slT('notRunning'));
      navigator.clipboard.writeText(report).then(() => say(slT('copied')), () => say(slT('notCopied')));
    });
  });
});

$('export').addEventListener('click', () => {
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [slT('csvHead').split(';').map(cell).join(';')];
  for (const w of words) {
    lines.push([w.word, w.translation, w.ipa, w.definition, w.context, w.lang, w.title, new Date(w.added).toISOString().slice(0, 10)].map(cell).join(';'));
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = slT('csvName');
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  $('volume').value = settings.speechVolume;
  $('volumeValue').textContent = settings.speechVolume + '%';
  $('enabled').checked = settings.enabled;
  $('preferHuman').checked = settings.preferHuman;
  chrome.storage.local.get({ words: [] }, (data) => {
    words = data.words;
    paint();
  });
});
