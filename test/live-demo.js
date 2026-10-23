// The live demo (demo/index.html), as GitHub Pages serves it: the extension's scripts on a plain
// page without the extension, with the phone's stand-in for its API. The film, both lines of its
// subtitles, and a word's card with its meaning and dictionary entry, from the real services.
//   node test/live-demo.js      (needs the network)
const assert = require('node:assert/strict');
const { launch, wait } = require('./real-browser');
require('./server.js');

(async () => {
  const b = await launch();
  const page = (expression) => b.page(`(() => { const $ = (s) => document.querySelector(s); return ${expression}; })()`);
  try {
    await b.size(1280, 720);
    await b.open('http://localhost:8765/demo/index.html');
    for (let i = 0; i < 40 && !(await page(`typeof primary !== 'undefined' && !!primary && !!secondary.cues`)); i++) await wait(500);
    await page(`($('video').muted = true, $('video').currentTime = 179.5, true)`);
    await wait(1500);
    assert.match(await page(`ui.pri.textContent`), /You have to learn to listen/);
    assert.ok((await page(`ui.sec.textContent`)).length > 5, 'and the line in the visitor’s language');
    await page(`([...document.querySelectorAll('#scenelingo-root .sl-word')].find((w) => w.textContent === 'listen').click(), true)`);
    await wait(3000);
    const card = await page(`ui.popup.querySelector('.sl-pop-body').textContent`);
    assert.ok(card.length > 20 && !/^[—…]$/.test(card), 'a meaning and a dictionary entry: ' + card);
    assert.equal(await page(`localStorage.getItem('scenelingo.local')`), null, 'the phone’s own cards are left alone');
    console.log('the live demo works: ' + card.slice(0, 80));
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
