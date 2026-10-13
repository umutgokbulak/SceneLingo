// Loads the unpacked extension into a real browser, with a throwaway profile, and watches what
// it does on YouTube. It needs the network and a browser that still takes --load-extension
// (Microsoft Edge does; Google Chrome no longer does), so it is a manual check, not part of
// `npm test`.
//
//   node test/real-browser.js [video address] [path to the browser]
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const url = process.argv[2] || 'https://www.youtube.com/watch?v=jNQXAC9IVRw';
const exe = process.argv[3] || process.env.BROWSER || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const extension = path.join(__dirname, '..', 'extension');
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'scenelingo-check-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  // A window, not headless: YouTube's player does not fetch captions in a headless browser.
  const browser = spawn(exe, [
    '--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--load-extension=' + extension,
    '--disable-features=DisableLoadExtensionCommandLineSwitch,CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--window-size=1280,800', 'about:blank',
  ], { stdio: 'ignore' });
  let socket;
  try {
    let version;
    for (let i = 0; i < 40 && !version; i++) {
      await wait(250);
      version = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json(), () => null);
    }
    if (!version) throw new Error('the browser did not open its debugging port');
    socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = reject;
    });
    let lastId = 0;
    const pending = new Map();
    socket.onmessage = (m) => {
      const msg = JSON.parse(m.data);
      if (!pending.has(msg.id)) return;
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message));
      else resolve(msg.result);
    };
    const send = (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        pending.set(++lastId, { resolve, reject });
        socket.send(JSON.stringify({ id: lastId, method, params, sessionId }));
      });
    await wait(1500);
    const targets = (await send('Target.getTargets')).targetInfos;
    if (!targets.some((t) => t.url.startsWith('chrome-extension://') && t.url.endsWith('background.js'))) throw new Error('the browser did not load the extension');
    const { targetId } = await send('Target.createTarget', { url });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const page = async (expression) => {
      const r = await send('Runtime.evaluate', { expression: `(() => { const root = document.getElementById('scenelingo-root'); const player = document.getElementById('movie_player'); const video = player && player.querySelector('video'); return ${expression}; })()`, returnByValue: true }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
      return r.result.value;
    };
    const press = async (code, key) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, sessionId);
      await wait(900);
    };
    const line = () => page(`root && JSON.stringify([root.querySelector('.sl-primary').innerText, root.querySelector('.sl-secondary').textContent])`);

    const started = Date.now();
    let shown = false;
    for (let i = 0; i < 120 && !shown; i++) {
      await wait(500);
      shown = await page(`!!root && !root.hidden && !!root.querySelector('.sl-primary').textContent`);
    }
    if (!shown) throw new Error('no subtitle line appeared: ' + (await page(`root ? root.querySelector('.sl-status').textContent : 'no overlay (an advertisement may be playing)'`)));
    console.log('first line after', ((Date.now() - started) / 1000).toFixed(1), 's:', await line());
    console.log("YouTube's own captions:", await page(`getComputedStyle(player.querySelector('.ytp-caption-window-container')).visibility`), '| overlay inside the player:', await page(`root.parentNode === player`));
    const before = await page(`video.currentTime`);
    await press('KeyD', 'd');
    console.log('D (next line):', before.toFixed(1), '->', (await page(`video.currentTime`)).toFixed(1), await line());
    await press('KeyW', 'w');
    for (let i = 0; i < 30 && (await page(`root.querySelector('.sl-strip-wrap').hidden`)); i++) await wait(500);
    console.log('W (writing practice): answer box open:', await page(`!root.querySelector('.sl-strip-wrap').hidden`), '| paused at the end of the line:', await page(`video.paused`));
    await press('KeyW', 'w');
    console.log('tracks offered:', await page(`JSON.stringify([...root.querySelectorAll('.sl-menu select')].slice(0, 2).map((s) => [...s.options].map((o) => o.textContent)))`));
  } catch (e) {
    console.log('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    try {
      socket.close();
    } catch (e) { /* never opened */ }
    browser.kill();
    await wait(1000);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  }
})();
