// Loads the unpacked extension into a real browser (Google Chrome, or Microsoft Edge where
// there is no Chrome), with a throwaway profile, and watches what it does on real sites. It
// needs the network, so it is a check to run by hand, not a part of `npm test`.
//
//   node test/real-browser.js            YouTube: first line, next line, writing practice
//   node test/real-browser.js sites      other sites: what is found and shown on each
//   node test/real-browser.js <address>  one page of your choice, as an "other site"
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const EXE =
  process.env.BROWSER ||
  ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'].find((exe) => fs.existsSync(exe));
const SOURCE = path.join(__dirname, '..', 'extension');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// `everywhere` gives the browser a copy of the extension that already has the permission for
// other sites: a person gives it through a browser prompt, which cannot be answered from here.
// A window is opened rather than a headless browser when `window` is set: YouTube's player
// does not fetch captions in a headless one. `language` is the browser's own (its interface and
// what pages are told), for seeing the extension as a user of that language would.
//
// Chrome no longer takes --load-extension. The extension is loaded over the DevTools protocol
// instead, which the browser offers for that only on a pipe, not on a network port.
async function launch({ everywhere = false, window = false, language = '' } = {}) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'scenelingo-check-'));
  let extension = SOURCE;
  if (everywhere) {
    extension = path.join(work, 'extension');
    const copy = (from, to) => {
      fs.mkdirSync(to, { recursive: true });
      for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        if (entry.isDirectory()) copy(path.join(from, entry.name), path.join(to, entry.name));
        else fs.copyFileSync(path.join(from, entry.name), path.join(to, entry.name));
      }
    };
    copy(SOURCE, extension);
    const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions.push('*://*/*');
    fs.writeFileSync(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
  }
  const browser = spawn(EXE, [
    '--user-data-dir=' + path.join(work, 'profile'), '--remote-debugging-pipe', '--enable-unsafe-extension-debugging',
    '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows',
    '--no-first-run', '--no-default-browser-check', '--disable-sync', '--autoplay-policy=no-user-gesture-required', '--mute-audio',
    '--window-size=1280,800', ...(language ? ['--lang=' + language, '--accept-lang=' + language] : []), ...(window ? [] : ['--headless=new']), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const [, , , toBrowser, fromBrowser] = browser.stdio;
  let lastId = 0;
  const pending = new Map();
  const frames = new Map(); // session -> the contexts of its frames: true for the page's own world, false for the extension's
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      pending.set(++lastId, { resolve, reject });
      toBrowser.write(JSON.stringify({ id: lastId, method, params, sessionId }) + '\0');
    });
  // A frame from another site is a target of its own; all of them are followed.
  const follow = (sessionId) => {
    frames.set(sessionId, new Map());
    send('Runtime.enable', {}, sessionId).catch(() => {});
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId).catch(() => {});
  };
  const receive = (msg) => {
    if (pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      return msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    }
    const own = frames.get(msg.sessionId);
    if (msg.method === 'Target.attachedToTarget') follow(msg.params.sessionId);
    else if (msg.method === 'Runtime.executionContextCreated' && own) {
      const kind = msg.params.context.auxData || {};
      if (kind.isDefault || kind.type === 'isolated') own.set(msg.params.context.id, !!kind.isDefault);
    }
    else if (msg.method === 'Runtime.executionContextDestroyed' && own) own.delete(msg.params.executionContextId);
    else if (msg.method === 'Runtime.executionContextsCleared' && own) own.clear();
  };
  // On the pipe, messages are JSON texts with a zero byte after each.
  let unread = '';
  fromBrowser.setEncoding('utf8');
  fromBrowser.on('data', (chunk) => {
    unread += chunk;
    for (let end = unread.indexOf('\0'); end >= 0; end = unread.indexOf('\0')) {
      const text = unread.slice(0, end);
      unread = unread.slice(end + 1);
      receive(JSON.parse(text));
    }
  });
  const { id } = await send('Extensions.loadUnpacked', { path: extension });
  await wait(1500);
  const isWorker = (t) => t.url === 'chrome-extension://' + id + '/background.js';
  if (!(await send('Target.getTargets')).targetInfos.some(isWorker)) throw new Error('the browser did not load the extension');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  follow(sessionId);
  await send('Page.enable', {}, sessionId);
  const value = (r) => {
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return {
    extensionPage: (file) => 'chrome-extension://' + id + '/' + file,
    open: (url) => send('Page.navigate', { url }, sessionId),
    // In the top frame.
    page: async (expression) => value(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId)),
    // In every frame; one answer for each.
    everyFrame: async (expression) => {
      const out = [];
      for (const [session, contexts] of frames) {
        for (const [contextId, pageWorld] of contexts) {
          if (pageWorld) out.push(await send('Runtime.evaluate', { expression, contextId, returnByValue: true, userGesture: true }, session).then(value, () => null));
        }
      }
      return out;
    },
    // In the extension's own world of every frame: the content script's side of the page.
    extensionWorld: async (expression) => {
      for (const [session, contexts] of frames) {
        for (const [contextId, pageWorld] of contexts) {
          if (!pageWorld) await send('Runtime.evaluate', { expression, contextId }, session).catch(() => {});
        }
      }
    },
    // In the extension's service worker.
    worker: async (expression) => {
      const target = (await send('Target.getTargets')).targetInfos.find(isWorker);
      const session = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true })).sessionId;
      return value(await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session));
    },
    // A window of a given size, for pictures.
    size: (width, height) => send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height }, sessionId),
    picture: async (quality = 90) => Buffer.from((await send('Page.captureScreenshot', { format: 'jpeg', quality }, sessionId)).data, 'base64'),
    move: (x, y) => send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y }, sessionId),
    // Text as a keyboard gives it: each key press also produces its character.
    type: async (text) => {
      for (const ch of text) {
        const code = ch === ' ' ? 'Space' : 'Key' + ch.toUpperCase();
        const vk = ch.toUpperCase().charCodeAt(0);
        await send('Input.dispatchKeyEvent', { type: 'keyDown', code, key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk }, sessionId);
        await send('Input.dispatchKeyEvent', { type: 'keyUp', code, key: ch, windowsVirtualKeyCode: vk }, sessionId);
      }
    },
    // `modifiers`: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift, added together.
    named: async (key, vk, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code: key, key, windowsVirtualKeyCode: vk, modifiers }, sessionId);
    },
    press: async (code, key) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key, windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0) }, sessionId);
      await wait(900);
    },
    click: async (x, y) => {
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 }, sessionId);
    },
    close: async () => {
      try {
        execFileSync('taskkill', ['/PID', String(browser.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (e) {
        browser.kill();
      }
      await wait(1200);
      fs.rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
    },
  };
}

// What the overlay shows in a frame, if the frame has one.
const OVERLAY = `(() => {
  const root = document.getElementById('scenelingo-root');
  if (!root) return null;
  const text = (s) => root.querySelector(s).innerText.replace(/\\s+/g, ' ').trim();
  const offered = root.querySelector('.sl-menu select');
  return { shown: !root.hidden, line: text('.sl-primary'), under: text('.sl-secondary'), status: text('.sl-status'), tracks: offered ? offered.options.length - 1 : 0, frame: window.top === window ? '' : location.hostname };
})()`;

async function youtube(url) {
  const browser = await launch({ window: true });
  try {
    await browser.open(url);
    const page = (expression) => browser.page(`(() => { const root = document.getElementById('scenelingo-root'); const player = document.getElementById('movie_player'); const video = player && player.querySelector('video'); return ${expression}; })()`);
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
    await browser.press('KeyD', 'd');
    console.log('D (next line):', before.toFixed(1), '->', (await page(`video.currentTime`)).toFixed(1), await line());
    await browser.press('KeyW', 'w');
    for (let i = 0; i < 30 && (await page(`root.querySelector('.sl-strip-wrap').hidden`)); i++) await wait(500);
    console.log('W (writing practice): answer box open:', await page(`!root.querySelector('.sl-strip-wrap').hidden`), '| paused at the end of the line:', await page(`video.paused`));
    await browser.press('KeyW', 'w');
    console.log('tracks offered:', await page(`JSON.stringify([...root.querySelectorAll('.sl-menu select')].slice(0, 2).map((s) => [...s.options].map((o) => o.textContent)))`));
  } finally {
    await browser.close();
  }
}

// Pages chosen for the different ways a site can carry subtitles. `click` starts a player
// that waits for one; `seconds` is how long an advertisement before the video may take.
const SITES = [
  { name: 'TED (a stream with 49 subtitle tracks, an advertisement first)', url: 'https://www.ted.com/talks/tim_urban_inside_the_mind_of_a_master_procrastinator', seconds: 60 },
  { name: 'plyr.io (a stream, played by hls.js)', url: 'https://plyr.io/', seconds: 20 },
  { name: "Vimeo's player (a stream described the DASH way; it starts on a click)", url: 'https://player.vimeo.com/video/76979871', seconds: 20, click: true },
  { name: 'Wikimedia Commons (video.js, <track> files, the player opens on a click)', url: 'https://commons.wikimedia.org/wiki/File:Elephants_Dream_(2006).webm', seconds: 20, click: true },
];

async function sites(list) {
  const browser = await launch({ everywhere: true });
  try {
    for (const site of list) {
      await browser.open(site.url);
      await wait(6000);
      if (site.click) {
        const at = await browser.page(`(() => { const r = [...document.querySelectorAll('video')].map((v) => v.getBoundingClientRect()).sort((a, b) => b.width - a.width)[0]; return r ? [r.left + r.width / 2, r.top + r.height / 2] : null; })()`);
        if (at) await browser.click(at[0], at[1]);
      }
      let found = null;
      for (let waited = 0; waited < site.seconds && !(found && found.line); waited += 3) {
        await wait(3000);
        await browser.everyFrame(`(() => { for (const v of document.querySelectorAll('video')) if (v.paused && v.readyState > 1) { v.muted = true; v.play().catch(() => {}); } })()`);
        found = (await browser.everyFrame(OVERLAY)).filter(Boolean).sort((a, b) => b.shown - a.shown)[0] || null;
      }
      console.log(site.name + '\n  ' + (found ? JSON.stringify(found) : 'no overlay'));
    }
  } finally {
    await browser.close();
  }
}

module.exports = { launch, wait };

if (require.main === module) {
  const what = process.argv[2] || 'youtube';
  const run = what === 'sites' ? sites(SITES) : /^https?:/.test(what) && !/youtube\.com/.test(what) ? sites([{ name: what, url: what, seconds: 30, click: true }]) : youtube(/^https?:/.test(what) ? what : 'https://www.youtube.com/watch?v=jNQXAC9IVRw');
  run.catch((e) => {
    console.log('FAILED:', e.message);
    process.exitCode = 1;
  });
}
