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
    console.log('Netflix (stood in for) works');
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
