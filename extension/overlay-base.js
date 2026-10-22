// The overlay on a film: what it knows, and the small things everything else uses.
// The overlay is a content script in several files, loaded in this order (see the manifest):
//   overlay-base.js      the site, the settings and the state of the film and its subtitles
//   overlay-tracks.js    which subtitle tracks there are, which are shown, and their translation
//   overlay-lines.js     the lines drawn over the picture, in step with it; playing and pausing
//   overlay-words.js     the card of a word, and what can be done with a whole line
//   overlay-practice.js  writing what was heard, and saying the line aloud
//   overlay-ui.js        the bar, its menu, the list of lines, and the film's sound
//   content.js           what the page and the browser say, and the start
// They share one world: what one declares at its top, the ones after it see.
'use strict';

const { lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch, isShouting, calm, expandContraction, spokenTokens, fillsWindow, cueText, guessLang } = SubtitleCore;
// What differs from site to site is where the player is, what counts as watching, and where
// the subtitles come from. Anything that is not a site named here is a plain HTML5 video.
// (The test harness names the site it stands in for.)
const SITE =
  document.documentElement.dataset.scenelingoSite ||
  (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname)
    ? 'youtube'
    : /(^|\.)(primevideo|amazon)\./.test(location.hostname)
      ? 'prime'
      : /(^|\.)netflix\.com$/.test(location.hostname)
        ? 'netflix'
        : 'other');
const PAGE = 'scenelingo:page';
const EXT = 'scenelingo:ext';
const CHUNK = 20; // cues per machine-translation request
const SLOW_RATE = 0.7; // speed of the slow synthetic voice, on top of the service's own slow reading
const SLOW_PLAY = 0.75; // speed of the film itself when a line is replayed slowly
// The site the page belongs to. A player in a frame belongs to the page the frame is on.
const HOME = (() => {
  try {
    const above = location.ancestorOrigins;
    return above && above.length ? new URL(above[above.length - 1]).hostname : location.hostname;
  } catch (e) {
    return location.hostname;
  }
})();
const NATIVE_SEL = { prime: '.atvwebplayersdk-captions-text', netflix: '.player-timedtext-text-container' }[SITE] || '';
// What is said while there are no subtitles yet (in the language of the interface, which is
// only known once the settings have been read).
const waiting = () => slT({ prime: 'waitPrime', youtube: 'waitYoutube', netflix: 'waitNetflix', other: 'waitOther' }[SITE]);

let settings = { ...SL_DEFAULTS };
let savedWords = new Set();
let deNouns = null; // German nouns with their gender, once loaded (nouns.js)
let tracks = [];
let fileTracks = []; // subtitle files the user opened; they stay when the page's own tracks change
let emptyNote = ''; // why there are no tracks, when the site has said so
let siteNotes = []; // what the script in the page's world has seen, for the diagnostics
let forced = false; // the user asked for the overlay on a video that came with no subtitles
let seenUrl = null; // subtitle file the player itself loaded, used when no track list was seen
let choice = { primary: 'auto', secondary: 'auto' };
let primary = null; // { track, cues, requested }
let secondary = { kind: 'off' }; // { kind: 'track' | 'mt' | 'off', track, cues }
let loadGen = 0;
let video = null;
let offset = 0; // seconds the subtitles are delayed relative to the video clock
let manualOffset = false;
let syncSamples = [];
let lastNative = '';
let shown = { idx: -2, sec: null };
let autoPausedFor = -1;
let lastIdx = -1; // cue shown on the previous frame; -1 after a seek
let ownSeek = false;
let playToken = 0; // changes whenever playback is started or paused on purpose
let hoverPaused = false;
let popupToken = 0;
let popupWord = null;
let popupPinned = false; // a click keeps the popup open; a hover popup closes when the mouse leaves
let hoverTimer = 0;
let closeTimer = 0;
let utterance = null;
let audioCtx = null;
let audioGain = null;
let audioSource = null;
let speakToken = 0;
let practice = null; // the line being practised: { idx, mode: 'write' | 'speak', checked, state, heard, voice, ... }
const practiceStats = { write: { ok: 0, total: 0 }, speak: { ok: 0, total: 0 } };
let slowFor = -1; // line being replayed at reduced speed
let normalRate = 1;
let recog = null; // the speech recogniser of the attempt in progress
let listenTimer = 0;
let quietTimer = 0;
let micStream = null;
let recorder = null;
let micIdle = 0;
let settingsLoaded = false;
let pointerHeld = false;
let warnedTwin = false;
let focusPulls = []; // times the answer box took the focus back, to avoid fighting the page in a loop
const ownKeys = new Set(); // shortcut keys that are down and were taken by us
const traceLog = []; // recent events of listening practice, for the "copy diagnostics" button
const audioCache = new Map();
const lookupCache = new Map();
let statusLine = '';
let translateFailing = false; // the status says a translation did not come
let engine = null; // where the last lines were translated: { name: 'browser' | 'online', canGet }
let ui = null;
let panelRows = null;
let lastLayout = 0;
let lastSync = 0;
let awakeTimer = 0;
let toastTimer = 0;
const segmenters = new Map();

// ---------- helpers ----------

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};

const langOf = (code) => {
  const base = String(code || '').toLowerCase().split(/[-_]/)[0];
  return { nb: 'no', nn: 'no', cmn: 'zh', yue: 'zh', iw: 'he' }[base] || base;
};

const langName = (code) => slLangName(code);

// When the extension is reloaded or updated, the copy of this script already running in an open
// tab loses its connection to it: the overlay stays, but nothing can be translated, spoken or
// saved until the page itself is reloaded.
const STALE = 'stale'; // what `send` answers with then; the user is told in their own words
let staleWarned = false;

const connected = () => {
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
};

function warnStale() {
  setStatus(slT('stale'));
  if (staleWarned) return;
  staleWarned = true;
  toast(slT('stale'), 7000);
}

const send = (msg) =>
  new Promise((resolve) => {
    if (!connected()) {
      warnStale();
      resolve({ ok: false, error: STALE });
      return;
    }
    try {
      chrome.runtime.sendMessage(msg, (res) => {
        const err = chrome.runtime.lastError;
        resolve(err || !res ? { ok: false, error: (err && err.message) || slT('noAnswer') } : res);
      });
    } catch (e) {
      resolve({ ok: false, error: String((e && e.message) || e) });
    }
  });

const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
};

const normText = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
