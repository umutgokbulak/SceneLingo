const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SL_TEXTS, slSetUiLang, slT, slLangName } = require('../../extension/messages.js');
const { slGuessLanguages, SL_LANGS } = require('../../extension/shared.js');

const dir = path.join(__dirname, '..', '..', 'extension');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('every language of the interface has every text, with the same blanks to fill', () => {
  const blanks = (text) => (text.match(/\{\d\}/g) || []).sort().join('');
  const keys = Object.keys(SL_TEXTS.en).sort();
  for (const [lang, texts] of Object.entries(SL_TEXTS)) {
    assert.deepEqual(Object.keys(texts).sort(), keys, lang + ' has other texts than en');
    for (const key of keys) assert.equal(blanks(texts[key]), blanks(SL_TEXTS.en[key]), lang + '.' + key);
  }
});

test('every text the code asks for exists', () => {
  const asked = new Set();
  const named = new Set(); // every quoted word in the code: a key may be chosen between two, or kept in a table
  for (const file of ['content.js', 'subtitles.js', 'select.js', 'popup.js', 'review.js', 'words.js', 'welcome.js', 'listen.js', 'speak.js', 'ui.js', 'practice.js', 'write.js', 'progress.js', 'background.js']) {
    for (const m of read(file).matchAll(/slT\('([A-Za-z]+)'/g)) asked.add(m[1]);
    for (const m of read(file).matchAll(/'([A-Za-z]+)'/g)) named.add(m[1]);
  }
  for (const file of ['popup.html', 'review.html', 'words.html', 'welcome.html', 'listen.html', 'speak.html', 'write.html', 'progress.html']) {
    for (const m of read(file).matchAll(/data-t(?:-title|-placeholder)?="([A-Za-z]+)"/g)) asked.add(m[1]);
  }
  assert.deepEqual([...asked].filter((key) => !(key in SL_TEXTS.en)), []);
  // And nothing is kept that is not asked for. (Three are put together: slT(settings.mode + 'Note').)
  const built = ['watchNote', 'writeNote', 'speakNote'];
  assert.deepEqual(Object.keys(SL_TEXTS.en).filter((key) => !asked.has(key) && !named.has(key) && !built.includes(key)), []);
});

test('no interface text is left in the code itself', () => {
  for (const file of ['content.js', 'subtitles.js', 'select.js', 'popup.js', 'review.js', 'words.js', 'welcome.js', 'listen.js', 'speak.js', 'ui.js', 'practice.js', 'write.js', 'progress.js', 'background.js', 'popup.html', 'review.html', 'words.html', 'welcome.html', 'listen.html', 'speak.html', 'write.html', 'progress.html']) {
    const text = read(file).replace(/\/\/.*$/gm, '').replace(/<!--[\s\S]*?-->/g, '');
    assert.equal((text.match(/[çğışöüÇĞİŞÖÜ]/g) || []).length, 0, file + ' still has Turkish words in it');
  }
});

test('slT fills the blanks and falls back to English', () => {
  slSetUiLang('tr');
  assert.equal(slT('loadingPart', 40), 'Altyazı yükleniyor… %40');
  assert.equal(slT('scoreWrite', 3, 4, 75), '3/4 kelime doğru · bu oturum %75');
  slSetUiLang('en');
  assert.equal(slT('loadingPart', 40), 'Loading subtitles… 40%');
  assert.equal(slT('notAKey'), 'notAKey');
  assert.equal(slSetUiLang('de'), 'en'); // a language the interface has not been written in
});

test('languages are named in the language of the interface', () => {
  slSetUiLang('en');
  assert.equal(slLangName('de'), 'German');
  slSetUiLang('tr');
  assert.equal(slLangName('de'), 'Almanca');
  assert.equal(slLangName('en'), 'İngilizce');
  slSetUiLang('en');
});

test("a new user's languages are guessed from the browser's", () => {
  assert.deepEqual(slGuessLanguages('tr-TR'), { nativeLang: 'tr', learnLang: 'en' });
  assert.deepEqual(slGuessLanguages('de'), { nativeLang: 'de', learnLang: 'en' });
  assert.deepEqual(slGuessLanguages('en-GB'), { nativeLang: 'en', learnLang: 'es' });
  assert.deepEqual(slGuessLanguages('xx'), { nativeLang: 'en', learnLang: 'es' });
  assert.ok(SL_LANGS.includes('de') && SL_LANGS.includes('tr'));
});
