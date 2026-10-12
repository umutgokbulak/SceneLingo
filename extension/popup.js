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
