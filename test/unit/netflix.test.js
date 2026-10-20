// The script that runs in Netflix's own world, in a world of its own here: its JSON, its window.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const code = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'netflix.js'), 'utf8');

function netflixPage(pathname) {
  const posted = [];
  const listeners = {};
  const ticks = [];
  const seeks = [];
  const world = {
    location: { pathname, origin: 'https://www.netflix.com' },
    setInterval: (fn) => ticks.push(fn),
    Response: function Response() {},
    XMLHttpRequest: function XMLHttpRequest() {},
  };
  world.Response.prototype.json = async function () {
    return this.body;
  };
  world.XMLHttpRequest.prototype.send = function () {};
  world.XMLHttpRequest.prototype.addEventListener = function () {};
  world.window = world;
  world.postMessage = (msg) => posted.push(msg);
  world.addEventListener = (type, fn) => (listeners[type] = fn);
  world.netflix = {
    appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ['s1'], getVideoPlayerBySessionId: () => ({ seek: (ms) => seeks.push(ms) }) } }) } } },
  };
  vm.createContext(world);
  vm.runInContext(code, world);
  // The page's window as the page sees it (a message from the content script comes from it).
  const self = vm.runInContext('window', world);
  const fromExtension = (data) => listeners.message({ source: self, data: { source: 'scenelingo:ext', ...data } });
  // What the page posted, as plain values of this world.
  const sent = () => JSON.parse(JSON.stringify(posted));
  return { world, posted, sent, ticks, seeks, fromExtension, json: vm.runInContext('JSON', world) };
}

const manifest = (movieId, extra = []) => ({
  result: {
    movieId,
    timedtexttracks: [
      { language: 'en', languageDescription: 'English', rawTrackType: 'subtitles', ttDownloadables: { 'webvtt-lssdh-ios8': { downloadUrls: { 1: 'https://nflx.test/en.vtt' } }, 'nflx-cmisc': { downloadUrls: { 1: 'https://nflx.test/en.img' } } } },
      { language: 'tr', languageDescription: 'Türkçe', rawTrackType: 'closedcaptions', ttDownloadables: { 'dfxp-ls-sdh': { urls: [{ url: 'https://nflx.test/tr.xml' }] } } },
      { language: 'ja', languageDescription: '日本語', rawTrackType: 'subtitles', ttDownloadables: { 'nflx-cmisc': { downloadUrls: { 1: 'https://nflx.test/ja.img' } } } },
      { isNoneTrack: true, language: 'none', ttDownloadables: {} },
      ...extra,
    ],
  },
});

test("the player's manifest request asks for the text formats, and for every track", () => {
  const { json } = netflixPage('/watch/81234567');
  const sent = JSON.parse(json.stringify({ url: 'manifest', params: { viewableId: 81234567, profiles: ['playready-h264mpl30-dash', 'imsc1.1'] } }));
  assert.deepEqual(sent.params.profiles, ['playready-h264mpl30-dash', 'imsc1.1', 'webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh']);
  assert.equal(sent.params.showAllSubDubTracks, true);
  assert.equal(json.stringify({ a: 1 }), '{"a":1}', 'anything else is left as it is');
});

test('the tracks of the title on screen are handed on, each with its most readable file', () => {
  const page = netflixPage('/watch/81234567');
  page.json.parse(JSON.stringify(manifest(81234567, [{ language: 'en', languageDescription: 'English (forced)', isForcedNarrative: true, ttDownloadables: { 'imsc1.1': { downloadUrls: { 1: 'https://nflx.test/en-forced.xml' } } } }])));
  const [msg] = page.sent();
  assert.equal(msg.type, 'tracks');
  assert.deepEqual(
    msg.tracks.map((t) => [t.languageCode, t.url, t.type, t.forced]),
    [
      ['en', 'https://nflx.test/en.vtt', '', false],
      ['tr', 'https://nflx.test/tr.xml', 'sdh', false],
      ['en', 'https://nflx.test/en-forced.xml', '', true],
    ],
    'Japanese comes only as pictures, and "none" is no track'
  );
});

test("the next episode's manifest waits until that episode is on screen", async () => {
  const page = netflixPage('/watch/81234567');
  // read straight from a response, as JSON
  const res = new page.world.Response();
  res.body = manifest(81234568);
  await res.json();
  assert.equal(page.sent().length, 0);
  page.world.location.pathname = '/watch/81234568';
  page.ticks[0]();
  assert.deepEqual(page.sent().map((m) => m.tracks.length), [2]);
  // a title with no manifest seen: the old tracks are taken away
  page.world.location.pathname = '/watch/99999999';
  page.ticks[0]();
  assert.deepEqual(page.sent()[1], { source: 'scenelingo:page', type: 'tracks', tracks: [], empty: true });
});

test('a seek asked for by the content script is done by the player, in milliseconds', () => {
  const page = netflixPage('/watch/81234567');
  page.fromExtension({ type: 'nf-seek', time: 83.4567 });
  assert.deepEqual(page.seeks, [83457]);
  page.json.parse(JSON.stringify(manifest(81234567)));
  page.posted.length = 0;
  page.fromExtension({ type: 'hello' });
  assert.equal(page.sent()[0].tracks.length, 2, 'a content script that comes late still gets the tracks');
});
