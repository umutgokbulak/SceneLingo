// Netflix, stood in for (test/netflix.html): the tracks found in the player's manifest, both lines
// shown, the player's own subtitles hidden, and a jump to the next line done by the player.
//   node test/netflix-check.js
const assert = require('node:assert/strict');
const { launch, wait } = require('./real-browser');
require('./server.js'); // serves test/netflix.html

(async () => {
  const b = await launch();
  const page = (expression) => b.page(`(() => { const $ = (s) => document.querySelector(s); return ${expression}; })()`);
  try {
    await b.size(1280, 720);
    await b.open('http://localhost:8765/test/netflix.html');
    await wait(2500);
    assert.match(await page('window.__request'), /webvtt-lssdh-ios8/, 'the manifest is asked for in WebVTT too');
    await page(`($('video').currentTime = 3, true)`); // the harness's own clock, not a seek through the page
    await wait(800);
    const shown = await page(`($('#scenelingo-root .sl-subs') || {}).textContent || ''`);
    assert.match(shown, /Hello there/, 'the English line: ' + shown);
    assert.match(shown, /Merhaba/, 'and the Turkish one under it, from its own track');
    assert.ok(await page(`document.documentElement.classList.contains('sl-hide-native') && getComputedStyle($('.player-timedtext')).visibility === 'hidden'`), "Netflix's own subtitles hidden");
    // the next line: asked of Netflix's player, not set on the video
    await page(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', code: 'KeyD', bubbles: true })), true)`);
    await wait(600);
    const seeks = await page('window.__seeks');
    assert.equal(seeks.length, 1, 'one seek through the player');
    assert.ok(Math.abs(seeks[0] - 6010) < 50, 'to the start of the next line: ' + seeks[0]);
    // the list of lines, on its tab of the episode's words: the rare ones of these lines, each with
    // its meaning, the line it is in, and a star that saves it with that line
    await page(`(document.querySelector('#scenelingo-root .sl-ibtn[aria-label]') && [...document.querySelectorAll('#scenelingo-root button')].find((b) => b.querySelector('path[d^="M8 6h13"]')).click(), true)`);
    await wait(300);
    await page(`($('#scenelingo-root .sl-tab[data-tab="words"]').click(), true)`);
    await wait(1500);
    const rows = await page(`[...document.querySelectorAll('#scenelingo-root .sl-erow')].map((r) => r.querySelector('b').textContent + '=' + r.querySelector('.sl-emean').textContent)`);
    assert.deepEqual(rows, ['theatre=[tr] theatre', 'umbrella=[tr] umbrella'], 'the B1 words of the sample lines: ' + JSON.stringify(rows));
    await page(`([...document.querySelectorAll('#scenelingo-root .sl-erow')][1].querySelector('.sl-etools button:last-child').click(), true)`);
    await wait(400);
    const saved = await page(`JSON.stringify(chrome.storage.local._data.words.find((w) => w.word === 'umbrella'))`);
    assert.match(saved, /"context":"Don't forget your umbrella\."/, 'saved with its line: ' + saved);
    const before = (await page('window.__seeks')).length;
    await page(`([...document.querySelectorAll('#scenelingo-root .sl-erow')][0].querySelector('.sl-etools button').click(), true)`);
    await wait(400);
    const jumps = await page('window.__seeks');
    assert.equal(jumps.length, before + 1, 'a jump to the line of "theatre", through the player');
    assert.ok(Math.abs(jumps[jumps.length - 1] - 14010) < 50, 'to its line: ' + jumps[jumps.length - 1]);
    // the questions need a Gemini key, and say so
    await page(`($('#scenelingo-root .sl-tab[data-tab="quiz"]').click(), true)`);
    await wait(800);
    assert.match(await page(`$('#scenelingo-root .sl-list').textContent`), /Gemini/);
    // with a Gemini key (its answers stood in for): the meanings in their lines, the idioms, and questions
    await page(`(() => {
      const real = chrome.runtime.sendMessage;
      const canned = {
        'gemini-key': { ok: true, result: 'AIza…test' },
        'episode-gloss': { ok: true, result: { words: [{ word: 'theatre', base: '', meaning: 'tiyatro' }, { word: 'umbrella', base: '', meaning: 'şemsiye' }], phrases: [{ text: "let's go", base: "let's go", meaning: 'hadi gidelim', line: 9 }] } },
        'episode-quiz': { ok: true, result: [{ q: 'Where are they going tonight?', options: ['To the theatre', 'Home', 'To work', 'To the sea'], answer: 0, why: 'Dördüncü satırda söylüyor.', line: 3 }, { q: 'What might happen later?', options: ['It might snow', 'It might rain', 'They might sleep', 'Nothing'], answer: 1, why: 'Yağmur yağabilir.', line: 6 }] },
      };
      chrome.runtime.sendMessage = (msg, cb) => (canned[msg.type] ? setTimeout(() => cb(canned[msg.type]), 20) : real(msg, cb));
      episode = null;
      return true;
    })()`);
    await page(`($('#scenelingo-root .sl-tab[data-tab="lines"]').click(), $('#scenelingo-root .sl-tab[data-tab="words"]').click(), true)`);
    await wait(1200);
    await page(`($('#scenelingo-root .sl-ebtn').click(), true)`);
    await wait(800);
    const glossed = await page(`[...document.querySelectorAll('#scenelingo-root .sl-erow')].map((r) => r.querySelector('b').textContent + '=' + r.querySelector('.sl-emean').textContent)`);
    assert.deepEqual(glossed, ['theatre=tiyatro', "let's go=hadi gidelim"], 'the meanings in their lines, and the phrase; umbrella, saved above, is not offered again: ' + JSON.stringify(glossed));
    assert.ok(await page(`!document.querySelector('#scenelingo-root .sl-ebtn')`), 'Gemini is asked once');
    await page(`($('video').currentTime = 40, true)`);
    await wait(600);
    await page(`($('#scenelingo-root .sl-tab[data-tab="quiz"]').click(), true)`);
    await wait(500);
    await page(`($('#scenelingo-root .sl-quiz .sl-ebtn').click(), true)`);
    await wait(600);
    assert.equal(await page(`document.querySelectorAll('#scenelingo-root .sl-qitem').length`), 2);
    await page(`(document.querySelectorAll('#scenelingo-root .sl-qitem')[0].querySelectorAll('.sl-opt')[0].click(), true)`);
    await wait(200);
    await page(`(document.querySelectorAll('#scenelingo-root .sl-qitem')[1].querySelectorAll('.sl-opt')[0].click(), true)`);
    await wait(300);
    assert.match(await page(`$('#scenelingo-root .sl-qscore').textContent`), /1/);
    assert.ok(await page(`!!document.querySelectorAll('#scenelingo-root .sl-qitem')[1].querySelector('.sl-opt.sl-wrong') && !!document.querySelectorAll('#scenelingo-root .sl-qitem')[1].querySelector('.sl-opt.sl-right')`), 'the wrong answer and the right one, marked');
    const day = await page(`JSON.stringify(Object.values(chrome.storage.local._data.reviewLog || {})[0])`);
    assert.match(day, /"quiz":1,"quizScore":50/, 'the questions are in the record of the day: ' + day);
    // the settings: above the bar over their button, in tabs, closed with Escape
    await page(`(ui.gearBtn.click(), true)`);
    await wait(300);
    const placed = await page(`(() => { const m = ui.menu.getBoundingClientRect(); const g = ui.gearBtn.getBoundingClientRect(); const bar = ui.bar.getBoundingClientRect(); return { open: !ui.menu.hidden, on: ui.gearBtn.classList.contains('sl-on'), over: m.bottom <= bar.top, nearGear: Math.abs(m.right - (g.right + 8)) < 12 || m.right > g.left }; })()`);
    assert.deepEqual(placed, { open: true, on: true, over: true, nearGear: true }, 'the menu over its button: ' + JSON.stringify(placed));
    await page(`(ui.menu.querySelector('.sl-mtab[data-tab="sound"]').click(), true)`);
    assert.deepEqual(await page(`[...ui.menu.querySelectorAll('.sl-mpage')].filter((p) => !p.hidden).map((p) => p.dataset.tab)`), ['sound']);
    await page(`(document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })), true)`);
    await wait(200);
    assert.ok(await page(`ui.menu.hidden && !ui.gearBtn.classList.contains('sl-on')`), 'Escape closes it');
    // German: nouns in the middle of a sentence underlined in the colour of der, die or das; the
    // first word of a sentence and words that are not nouns left alone
    await page(`(fetch('/extension/freq/de-nouns.txt').then((r) => r.text()).then((t) => (deNouns = slNounList(t))), true)`);
    await wait(500);
    const marked = await page(`(() => { const d = document.createElement('div'); fillWords(d, 'Haus? Ich habe die Rechnung für das Kinderzimmer, und der Mann schläft.', 'de'); return [...d.querySelectorAll('.sl-word')].filter((w) => /sl-g/.test(w.className)).map((w) => w.textContent + ':' + w.className.match(/sl-g(.)/)[1]); })()`);
    assert.deepEqual(marked, ['Rechnung:f', 'Kinderzimmer:n', 'Mann:m'], 'German nouns by gender: ' + JSON.stringify(marked));
    assert.equal(await page(`(() => { settings.nounColors = false; const d = document.createElement('div'); fillWords(d, 'Ich habe die Rechnung.', 'de'); return d.querySelectorAll('[class*="sl-g"]').length; })()`), 0, 'not when switched off');
    // a saved word marked on the line in its other forms, and a saved phrase met in one
    const forms = await page(`(() => { savedWords = new Set(['negotiate', 'rip off']); const d = document.createElement('div'); fillWords(d, 'They negotiated, then ripped us off.', 'en'); return [...d.querySelectorAll('.sl-saved')].map((w) => w.textContent); })()`);
    assert.deepEqual(forms, ['negotiated'], 'negotiated is a form of negotiate: ' + JSON.stringify(forms));
    console.log('Netflix (stood in for) works, and so do the words of the episode, the settings and German nouns');
  } finally {
    await b.close();
  }
})().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
