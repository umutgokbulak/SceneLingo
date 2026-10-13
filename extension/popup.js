const $ = (id) => document.getElementById(id);
let words = [];

for (const id of ['learnLang', 'nativeLang']) {
  for (const [code, name] of SL_LANGS) {
    const o = document.createElement('option');
    o.value = code;
    o.textContent = name;
    $(id).appendChild(o);
  }
  $(id).addEventListener('change', () => chrome.storage.sync.set({ [id]: $(id).value }));
}
for (const id of ['enabled', 'preferHuman']) {
  $(id).addEventListener('change', () => chrome.storage.sync.set({ [id]: $(id).checked }));
}

// The label follows the slider while it moves; the setting is saved once it is released.
$('volume').addEventListener('input', () => {
  $('volumeValue').textContent = $('volume').value + '%';
});
$('volume').addEventListener('change', () => chrome.storage.sync.set({ speechVolume: +$('volume').value }));

chrome.storage.sync.get(SL_DEFAULTS, (s) => {
  $('volume').value = s.speechVolume;
  $('volumeValue').textContent = s.speechVolume + '%';
  $('enabled').checked = s.enabled;
  $('preferHuman').checked = s.preferHuman;
  $('learnLang').value = s.learnLang;
  $('nativeLang').value = s.nativeLang;
});

function renderWords() {
  const box = $('words');
  box.textContent = '';
  $('count').textContent = words.length;
  const due = words.filter((w) => slIsDue(w, Date.now())).length;
  $('review').textContent = due ? 'Tekrar et (' + due + ' kart hazır)' : 'Tekrar sayfasını aç';
  if (!words.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Altyazıda bir kelimeye tıkla, açılan pencerede ☆ Kaydet de.';
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
    kind.textContent = w.kind === 'phrase' ? 'kalıp' : w.kind === 'sentence' ? 'cümle' : '';
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
    del.title = 'Sil';
    del.addEventListener('click', () => {
      words = words.filter((x) => x !== w);
      chrome.storage.local.set({ words });
      renderWords();
    });
    row.append(main, del);
    box.appendChild(row);
  }
}

chrome.storage.local.get({ words: [] }, (d) => {
  words = d.words;
  renderWords();
});

$('review').addEventListener('click', () => chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }));

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
    siteNote(has ? 'Açık. Zaten açık olan sekmelerde sayfayı yenile ya da aşağıdaki düğmeye bas.' : '');
  };
  if ($('everywhere').checked) chrome.permissions.request(EVERYWHERE, done);
  else chrome.permissions.remove(EVERYWHERE, () => done(false));
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
      siteNote($('everywhere').checked ? 'Bu sayfada çalışamıyor (tarayıcının kendi sayfası olabilir).' : 'Bu site için önce "Diğer sitelerde de çalış"ı aç.');
      return;
    }
  }
  siteNote('Açıldı. Videoda çubuk görünmüyorsa videoyu başlat; altyazı dosyası için çubuktaki ayar düğmesine bas.');
});

// For reporting a problem: what the extension sees on the tab in front, whether or not its overlay is showing.
$('diagnose').addEventListener('click', () => {
  const label = $('diagnose').textContent;
  const say = (text) => {
    $('diagnose').textContent = text;
    setTimeout(() => ($('diagnose').textContent = label), 3000);
  };
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    chrome.tabs.sendMessage(tab.id, { type: 'diagnose' }, (report) => {
      if (chrome.runtime.lastError || !report) return say('Bu sekmede çalışmıyor; sayfayı yenileyip tekrar dene');
      navigator.clipboard.writeText(report).then(() => say('Kopyalandı'), () => say('Kopyalanamadı'));
    });
  });
});

$('export').addEventListener('click', () => {
  const cell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const lines = [['Kelime', 'Çeviri', 'Okunuş', 'Tanım', 'Cümle', 'Dil', 'Kaynak', 'Tarih'].map(cell).join(';')];
  for (const w of words) {
    lines.push([w.word, w.translation, w.ipa, w.definition, w.context, w.lang, w.title, new Date(w.added).toISOString().slice(0, 10)].map(cell).join(';'));
  }
  const url = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'scenelingo-kelimeler.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
