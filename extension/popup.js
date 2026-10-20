const $ = (id) => document.getElementById(id);
let settings = { ...SL_DEFAULTS };
let words = [];
let reviewLog = {};

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
  renderToday();
  renderCloud();
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
for (const id of ['enabled', 'preferHuman', 'selectLookup', 'useGemini']) {
  $(id).addEventListener('change', () => chrome.storage.sync.set({ [id]: $(id).checked }));
}

// The label follows the slider while it moves; the setting is saved once it is released.
$('volume').addEventListener('input', () => {
  $('volumeValue').textContent = $('volume').value + '%';
});
$('volume').addEventListener('change', () => chrome.storage.sync.set({ speechVolume: +$('volume').value }));

// Today: how many cards wait, the way to them, and whether the cards are safe in the cloud.
function renderToday() {
  // As many as the review page will show today: what is due, and new cards up to the day's limit.
  const due = slDueCount(words, Date.now(), reviewLog, settings.newPerDay);
  $('dueCount').textContent = String(due);
  $('dueText').textContent = due ? slT('todayDue') : words.length ? slT('todayDone') : slT('noWordsYet');
  $('dueCount').hidden = !words.length;
  $('review').textContent = slT(due ? 'studyNow' : 'reviewOpen');
  $('allWords').textContent = slT('wordsTitle') + (words.length ? ' · ' + words.length : '');
}

function renderCloud() {
  chrome.runtime.sendMessage({ type: 'cloud-state' }, (res) => {
    const line = $('cloudLine');
    line.textContent = '';
    const st = !chrome.runtime.lastError && res && res.ok ? res.result : null;
    if (!st || !st.configured) return;
    line.append(slIcon('cloud'));
    if (st.email) line.append(st.email + (st.lastSync ? ' · ' + slT('cloudSynced', slAgo(st.lastSync)) : ''));
    else line.append(slT('cloudOffLine'));
  });
}

$('review').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }));
$('allWords').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('words.html') }));
$('listen').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('listen.html') }));
$('speak').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('speak.html') }));
$('backupDue').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('words.html') }));
// The words live only in this browser: once a week, a word that a copy should be kept.
chrome.storage.local.get({ lastBackup: 0, words: [] }, ({ lastBackup, words: saved }) => {
  const due = saved.length && Date.now() - lastBackup > 7 * 86400000;
  $('backupDue').hidden = !due;
  $('backupDue').textContent = slT('backupDue');
});

// Translation inside the browser: its language pack, fetched from here (see ui.js).
async function showEngine() {
  const from = slLangName(settings.learnLang);
  const to = slLangName(settings.nativeLang);
  const say = (text, button) => {
    $('engineState').textContent = text;
    $('engineGet').hidden = !button;
    $('engineGet').textContent = button || '';
    $('engineGet').disabled = false;
  };
  const state = await slPackState(settings.learnLang, settings.nativeLang);
  if (state === 'same') say('');
  else if (state === 'ready') say(slT('engineReady', from, to));
  else if (state === 'get') say(slT('engineNote'), slT('engineGet', from, to));
  else say(slT('engineNone', from, to));
}

$('engineGet').addEventListener('click', async () => {
  $('engineGet').disabled = true;
  try {
    await slPackGet(settings.learnLang, settings.nativeLang, (n) => ($('engineGet').textContent = slT('engineGetting', n)));
    showEngine();
  } catch (e) {
    $('engineGet').disabled = false;
    $('engineState').textContent = slT('engineFailed', (e && e.message) || e);
  }
});

// The user's own Gemini key: kept in this browser only (local storage, not synced), and sent
// nowhere but to Google's Gemini API. Saving it also tries it once.
function showGeminiKey() {
  chrome.runtime.sendMessage({ type: 'gemini-key' }, (res) => {
    const shown = !chrome.runtime.lastError && res && res.ok ? res.result : '';
    $('geminiState').textContent = shown ? slT('geminiKeyShown', shown) : slT('geminiNone');
    $('geminiRemove').hidden = !shown;
    $('useGemini').disabled = !shown;
  });
}
showGeminiKey();
$('geminiRemove').addEventListener('click', () => chrome.storage.local.set({ geminiKey: '' }, showGeminiKey));
$('geminiSave').addEventListener('click', () => {
  const key = $('geminiKey').value.trim();
  $('geminiKey').value = '';
  if (!key) return;
  chrome.storage.local.set({ geminiKey: key }, () => {
    showGeminiKey();
    $('geminiState').textContent = slT('geminiTrying');
    chrome.runtime.sendMessage({ type: 'gemini-test', tl: settings.nativeLang }, (res) => {
      if (chrome.runtime.lastError || !res) return ($('geminiState').textContent = slT('geminiFailed', chrome.runtime.lastError ? chrome.runtime.lastError.message : '?'));
      $('geminiState').textContent = res.ok ? slT('geminiWorks', (res.result.phrase ? res.result.phrase + ' — ' : '') + res.result.meaning) : slT('geminiFailed', res.error);
    });
  });
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
  const here = await toTab(tab, { type: 'boost-local', level });
  if (here && here.ok) return ($('boostNote').textContent = '');
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
  const here = await toTab(tab, { type: 'boost-get' });
  const res = here ? { ok: true, result: here } : await ask({ type: 'boost-state', tabId: tab.id });
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

$('welcome').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }));

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  $('volume').value = settings.speechVolume;
  $('volumeValue').textContent = settings.speechVolume + '%';
  $('enabled').checked = settings.enabled;
  $('preferHuman').checked = settings.preferHuman;
  $('selectLookup').checked = settings.selectLookup;
  $('useGemini').checked = settings.useGemini;
  chrome.storage.local.get({ words: [], reviewLog: {} }, (data) => {
    reviewLog = data.reviewLog;
    words = data.words;
    paint();
  });
});
