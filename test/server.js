// Static server for the local test harness only.
//   /                              mock player page that loads the content scripts
//   /extension/<page>.html?mock    an extension page with the mock APIs injected (&seed adds sample saved items)
//   /bg?msg=<json>                 the real background message handler
//   ...?shot=<name>                puts the page into a fixed state for a screenshot (see demo.js)
const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.ttml2': 'application/ttml+xml', '.vtt': 'text/vtt; charset=utf-8', '.m3u8': 'application/vnd.apple.mpegurl', '.mpd': 'application/dash+xml' };

// Two minutes of silence, so the mock player has a clock it can play and seek.
const silence = (() => {
  const n = 8000 * 120;
  const b = Buffer.alloc(44 + n, 128);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(8000, 28);
  b.writeUInt16LE(1, 32);
  b.writeUInt16LE(8, 34);
  b.write('data', 36);
  b.writeUInt32LE(n, 40);
  return b;
})();

let handler;
const noEvent = { addListener() {} };
globalThis.chrome = {
  runtime: { onMessage: { addListener(fn) { handler = fn; } }, getURL: (p) => '/extension/' + p, onInstalled: noEvent, onStartup: noEvent },
  tabs: { create: async () => ({}) },
  contextMenus: { create() {}, onClicked: noEvent },
  storage: { local: { get: async (defaults) => ({ ...defaults }) }, sync: { get: async (defaults) => ({ ...defaults }) } },
  permissions: { onAdded: noEvent, onRemoved: noEvent },
};
require('../extension/background.js');

function sendBytes(req, res, head, size, read) {
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  if (!range) {
    res.writeHead(200, { ...head, 'Content-Length': size });
    return read(0, size - 1);
  }
  const start = +range[1];
  const end = range[2] ? +range[2] : size - 1;
  res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
  return read(start, end);
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/bg') {
    const msg = JSON.parse(url.searchParams.get('msg'));
    return handler(msg, {}, (out) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  }
  const head = { 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (url.pathname === '/test/silence.wav') {
    return sendBytes(req, res, { ...head, 'Content-Type': 'audio/wav' }, silence.length, (a, b) => res.end(silence.subarray(a, b + 1)));
  }
  const rel = decodeURIComponent(url.pathname);
  const file = path.join(root, rel === '/' ? '/test/harness.html' : rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  head['Content-Type'] = types[path.extname(file)] || 'application/octet-stream';
  if (url.searchParams.has('mock') && file.endsWith('.html')) {
    let html = fs.readFileSync(file, 'utf8').replace('<script', '<script src="/test/mock-chrome.js"></script>\n<script');
    if (url.searchParams.has('shot')) html = html.replace('</body>', '<script src="/test/demo.js"></script>\n</body>');
    res.writeHead(200, head);
    return res.end(html);
  }
  sendBytes(req, res, head, fs.statSync(file).size, (a, b) => fs.createReadStream(file, { start: a, end: b }).pipe(res));
}).listen(8765, () => console.log('harness on http://localhost:8765'));
