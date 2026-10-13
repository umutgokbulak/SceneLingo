(() => {
  'use strict';
  if (window.__scenelingoContent) return;
  window.__scenelingoContent = true;

  const { parseTime, lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch, isShouting, calm, expandContraction, spokenTokens, fillsWindow, cueText, parseVtt, parseJson3, guessLang } = SubtitleCore;
  // What differs from site to site is where the player is, what counts as watching, and where
  // the subtitles come from. Anything that is not a site named here is a plain HTML5 video.
  // (The test harness names the site it stands in for.)
  const SITE =
    document.documentElement.dataset.scenelingoSite ||
    (/(^|\.)youtube(-nocookie)?\.com$/.test(location.hostname) ? 'youtube' : /(^|\.)(primevideo|amazon)\./.test(location.hostname) ? 'prime' : 'other');
  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  const CHUNK = 20; // cues per machine-translation request
  const SLOW_RATE = 0.7; // speed of the slow synthetic voice, on top of the service's own slow reading
  const SLOW_PLAY = 0.75; // speed of the film itself when a line is replayed slowly
  const NATIVE_SEL = SITE === 'prime' ? '.atvwebplayersdk-captions-text' : '';
  const WAITING = {
    prime: 'Altyazı bekleniyor… Videoyu başlat; gelmezse Prime oynatıcısında altyazıyı bir kez aç.',
    youtube: 'Altyazı bekleniyor… Gelmezse YouTube oynatıcısında altyazıyı (CC) bir kez aç.',
    other: 'Bu videoda altyazı bulunamadı. Aşağıdan bir altyazı dosyası (.srt, .vtt) açabilirsin.',
  }[SITE];
  const NO_CAPTIONS = 'Bu videonun altyazısı yok. Aşağıdan bir altyazı dosyası (.srt, .vtt) açabilirsin.';
  const SUB_FILE = /\.(vtt|srt|ttml2?|dfxp)(\?|#|$)/i;

  let settings = { ...SL_DEFAULTS };
  let savedWords = new Set();
  let tracks = [];
  let fileTracks = []; // subtitle files the user opened; they stay when the page's own tracks change
  let emptyNote = ''; // why there are no tracks, when the site has said so
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
  let status = WAITING;
  let ui = null;
  let panelRows = null;
  let lastLayout = 0;
  let lastSync = 0;
  let awakeTimer = 0;
  let toastTimer = 0;
  const cueCache = new Map();
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

  const langName = (code) => (SL_LANGS.find((l) => l[0] === code) || [code, code.toUpperCase()])[1];

  // When the extension is reloaded or updated, the copy of this script already running in an open
  // tab loses its connection to it: the overlay stays, but nothing can be translated, spoken or
  // saved until the page itself is reloaded.
  const STALE = 'Eklenti güncellendi. Çeviri, ses ve kaydetme için bu sayfayı yenile (F5).';
  let staleWarned = false;

  const connected = () => {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  };

  function warnStale() {
    setStatus(STALE);
    if (staleWarned) return;
    staleWarned = true;
    toast(STALE, 7000);
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
          resolve(err || !res ? { ok: false, error: (err && err.message) || 'yanıt yok' } : res);
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

  // ---------- TTML ----------

  function nodeText(node) {
    let out = '';
    for (const n of node.childNodes) {
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) out += n.localName === 'br' ? '\n' : nodeText(n);
    }
    return out;
  }

  function parseTTML(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('Altyazı dosyası okunamadı');
    const root = doc.documentElement;
    const tickRate = parseFloat(root.getAttribute('ttp:tickRate')) || 10000000;
    const frameRate = parseFloat(root.getAttribute('ttp:frameRate')) || 30;
    const raw = [];
    for (const p of doc.getElementsByTagNameNS('*', 'p')) {
      const start = parseTime(p.getAttribute('begin'), tickRate, frameRate);
      let end = parseTime(p.getAttribute('end'), tickRate, frameRate);
      if (isNaN(end)) end = start + parseTime(p.getAttribute('dur'), tickRate, frameRate);
      const body = nodeText(p)
        .split('\n')
        .map((l) => l.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n');
      if (!isNaN(start) && !isNaN(end) && end > start && body) raw.push({ start, end, text: body });
    }
    raw.sort((a, b) => a.start - b.start);
    // Lines positioned separately on screen share the same timing; show them as one cue.
    const cues = [];
    for (const c of raw) {
      const prev = cues[cues.length - 1];
      if (prev && Math.abs(prev.start - c.start) < 0.01 && Math.abs(prev.end - c.end) < 0.01) prev.text += '\n' + c.text;
      else cues.push(c);
    }
    return cues;
  }

  // A subtitle file in any of the formats met so far, told apart by how it begins.
  function parseAny(text) {
    const head = text.slice(0, 200).replace(/^\uFEFF/, '').trimStart()[0];
    if (head === '{') return parseJson3(JSON.parse(text));
    if (head === '<') return parseTTML(text);
    return parseVtt(text);
  }

  // The lines of a text track the page gave its video. They are only loaded for a track that is
  // switched on, so a track that is off is switched to "hidden": loaded, but not drawn.
  function readTextTrack(tt) {
    if (tt.mode === 'disabled') tt.mode = 'hidden';
    const cues = [];
    for (const c of tt.cues || []) {
      const text = cueText(c.text);
      if (text && c.endTime > c.startTime) cues.push({ start: c.startTime, end: c.endTime, text });
    }
    return cues.sort((a, b) => a.start - b.start);
  }

  function loadCues(track) {
    if (track.cues) return Promise.resolve(track.cues);
    if (track.textTrack && !track.file) return Promise.resolve(readTextTrack(track.textTrack));
    if (!cueCache.has(track.url)) {
      const job = fetch(track.url)
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(parseAny);
      job.catch(() => cueCache.delete(track.url));
      cueCache.set(track.url, job);
    }
    if (!track.textTrack) return cueCache.get(track.url);
    // The file behind a <track> may not be ours to fetch; what the video has loaded of it is.
    return cueCache.get(track.url).catch(() => {
      track.file = false;
      return readTextTrack(track.textTrack);
    });
  }

  // A text track fills up while the video loads, so it is read again when it has grown.
  function refreshLive() {
    const p = primary;
    if (!p || !p.live || !p.live.cues || p.live.cues.length === p.liveCount) return;
    const old = new Map(p.cues.map((c) => [c.start + '|' + c.text, c]));
    p.liveCount = p.live.cues.length;
    p.cues = readTextTrack(p.live).map((c) => old.get(c.start + '|' + c.text) || c);
    p.requested = new Set();
    if (secondary.kind === 'track' && secondary.track.textTrack) {
      for (const c of p.cues) {
        delete c.tr;
        delete c.shared;
      }
      secondary.cues = readTextTrack(secondary.track.textTrack);
      alignTranslation(p.cues, secondary.cues);
    }
    shown = { idx: -2, sec: null };
    lastIdx = -1;
    setStatus(p.cues.length ? '' : 'Altyazı yükleniyor…');
    if (ui && !ui.panel.hidden) buildPanel();
  }

  // ---------- track selection ----------

  const trackScore = (t) =>
    (t.forced ? 4 : 0) + (/commentary|descri/i.test(t.subtype) ? 2 : 0) + (/sdh|cc/i.test(t.type) || t.auto ? 1 : 0);

  const pickTrack = (lang) =>
    tracks.filter((t) => langOf(t.languageCode) === lang).sort((a, b) => trackScore(a) - trackScore(b))[0] || null;

  function trackLabel(t) {
    let label = t.displayName || t.languageCode || 'Altyazı';
    if (t.auto) label += ' (otomatik)';
    if (t.forced) label += ' (zorunlu)';
    else if (/sdh|cc/i.test(t.type) && !/\[|\(/.test(label)) label += ' [CC]';
    return label;
  }

  function resolvePrimary() {
    if (!tracks.length) {
      return seenUrl ? { url: seenUrl, languageCode: '', displayName: 'Oynatıcıdaki altyazı' } : null;
    }
    if (choice.primary !== 'auto') {
      const t = tracks.find((x) => x.url === choice.primary);
      if (t) return t;
    }
    return (
      pickTrack(settings.learnLang) ||
      tracks.filter((t) => langOf(t.languageCode) !== settings.nativeLang).sort((a, b) => trackScore(a) - trackScore(b))[0] ||
      tracks[0]
    );
  }

  function resolveSecondary(pri) {
    const c = choice.secondary;
    if (c === 'off' || c === 'mt') return { kind: c };
    if (c !== 'auto') {
      const t = tracks.find((x) => x.url === c);
      if (t) return { kind: 'track', track: t };
    }
    if (langOf(pri.languageCode) === settings.nativeLang) return { kind: 'off' };
    if (settings.preferHuman) {
      const t = pickTrack(settings.nativeLang);
      if (t && t.url !== pri.url) return { kind: 'track', track: t };
    }
    // YouTube translates a caption track itself, as one file cut at the same places.
    if (SITE === 'youtube' && /^https:/.test(pri.url)) {
      const u = new URL(pri.url);
      u.searchParams.set('tlang', settings.nativeLang);
      return { kind: 'track', track: { url: u.href, languageCode: settings.nativeLang, displayName: langName(settings.nativeLang) + ' (YouTube çevirisi)' } };
    }
    return { kind: 'mt' };
  }

  async function reload() {
    const gen = ++loadGen;
    primary = null;
    secondary = { kind: 'off' };
    shown = { idx: -2, sec: null };
    syncSamples = [];
    autoPausedFor = -1;
    let pt = resolvePrimary();
    if (!pt) {
      setStatus(emptyNote || WAITING);
      afterLoad();
      return;
    }
    // A file or track that does not say its language is taken to be in the one being learned.
    if (!pt.languageCode) pt = { ...pt, languageCode: settings.learnLang };
    setStatus('Altyazı yükleniyor…');
    try {
      const cues = (await loadCues(pt)).map((c) => ({ ...c }));
      const sec = resolveSecondary(pt);
      if (sec.kind === 'track') {
        try {
          sec.cues = await loadCues(sec.track);
          // An empty translation is no translation, unless it is a text track that is still filling up.
          if (!sec.cues.length && !(sec.track.textTrack && !sec.track.file)) throw new Error('empty');
          alignTranslation(cues, sec.cues);
        } catch (e) {
          sec.kind = 'mt';
        }
      }
      if (gen !== loadGen) return;
      const live = pt.textTrack && !pt.file && !pt.cues ? pt.textTrack : null;
      primary = { track: pt, cues, requested: new Set(), live, liveCount: live && live.cues ? live.cues.length : 0 };
      secondary = sec;
      setStatus(cues.length ? '' : live ? 'Altyazı yükleniyor…' : 'Bu altyazı dosyası boş.');
    } catch (e) {
      if (gen !== loadGen) return;
      setStatus('Altyazı yüklenemedi: ' + ((e && e.message) || e));
    }
    afterLoad();
  }

  function afterLoad() {
    applyNativeHiding();
    refreshMenu();
    if (ui && !ui.panel.hidden) buildPanel();
  }

  // `empty` says an empty list is news too: the video has changed and the new one has no tracks.
  function setTracks(list, empty) {
    if (!Array.isArray(list)) return;
    const clean = [];
    for (const t of list) {
      if (!t || typeof t.url !== 'string' || !t.url) continue;
      if (!t.textTrack) {
        let proto;
        try {
          proto = new URL(t.url, location.href).protocol;
        } catch (e) {
          continue;
        }
        if (proto !== 'https:' && proto !== 'blob:' && proto !== location.protocol) continue;
      }
      clean.push({
        url: t.url,
        id: String(t.id || ''),
        languageCode: String(t.languageCode || ''),
        displayName: String(t.displayName || ''),
        type: String(t.type || ''),
        subtype: String(t.subtype || ''),
        forced: !!t.forced,
        auto: !!t.auto,
        textTrack: t.textTrack || null,
        file: !!t.file,
      });
    }
    if (!clean.length && !empty) return;
    const key = (l) => l.filter((t) => !t.cues).map((t) => t.id || t.url.split('?')[0]).sort().join('|');
    if (key(clean) === key(tracks)) return;
    tracks = clean.concat(fileTracks);
    seenUrl = null;
    choice = { primary: 'auto', secondary: 'auto' };
    offset = 0;
    manualOffset = false;
    cueCache.clear();
    reload();
  }

  // ---------- machine translation ----------

  // What is shown under a line. The two tracks are cut and timed separately, so the translated
  // cue on screen at a given instant can belong to the neighbouring line: a line shows the cue
  // that overlaps it most. Where one translated cue covers several lines, each line gets a
  // machine translation of its own instead, so that it says what that line says and no more.
  function lineTranslation(cue) {
    if (secondary.kind === 'mt') return cue.mt || '';
    if (secondary.kind === 'track') return (cue.shared && cue.mt) || cue.tr || '';
    return '';
  }

  function ensureMT(idx) {
    if (!primary || secondary.kind === 'off') return;
    const c = Math.floor(Math.max(0, idx) / CHUNK);
    requestChunk(c);
    requestChunk(c + 1);
  }

  function requestChunk(c) {
    const p = primary;
    if (p.requested.has(c)) return;
    const all = p.cues.slice(c * CHUNK, c * CHUNK + CHUNK);
    if (!all.length) return;
    p.requested.add(c);
    const slice = (secondary.kind === 'mt' ? all : all.filter((cue) => cue.shared)).filter((cue) => cue.mt === undefined);
    if (!slice.length) return;
    // Text in capitals comes back in capitals, and reads worse; translate it in ordinary case.
    const english = speaksEnglish();
    const texts = slice.map((x) => (isShouting(x.text) ? calm(x.text, true, english) : x.text));
    send({ type: 'translate', texts, sl: p.track.languageCode, tl: settings.nativeLang }).then((res) => {
      if (!res.ok) {
        if (primary === p) setStatus(res.error === STALE ? STALE : 'Çeviri alınamadı: ' + res.error);
        setTimeout(() => p.requested.delete(c), 10000);
        return;
      }
      slice.forEach((cue, k) => {
        cue.mt = res.result[k] || '';
      });
      if (primary !== p) return;
      if (status.startsWith('Çeviri alınamadı')) setStatus('');
      if (panelRows) slice.forEach((cue) => setRowTranslation(c * CHUNK + all.indexOf(cue)));
    });
  }

  // ---------- rendering ----------

  function segmenter(lang) {
    if (!segmenters.has(lang)) {
      let seg = null;
      try {
        seg = new Intl.Segmenter(lang || undefined, { granularity: 'word' });
      } catch (e) {
        try {
          seg = new Intl.Segmenter(undefined, { granularity: 'word' });
        } catch (e2) { /* no Intl.Segmenter */ }
      }
      segmenters.set(lang, seg);
    }
    return segmenters.get(lang);
  }

  function fillWords(line, text, lang) {
    line.textContent = '';
    const seg = segmenter(lang);
    text.split('\n').forEach((row, r) => {
      if (r) line.appendChild(document.createElement('br'));
      const parts = seg
        ? Array.from(seg.segment(row), (s) => [s.segment, s.isWordLike])
        : row.split(/([\p{L}\p{M}\p{N}'’]+)/u).map((s, i) => [s, i % 2 === 1]);
      for (const [str, isWord] of parts) {
        if (!str) continue;
        if (!isWord) {
          line.appendChild(document.createTextNode(str));
          continue;
        }
        const w = el('span', 'sl-word', str);
        if (savedWords.has(str.toLowerCase())) w.classList.add('sl-saved');
        line.appendChild(w);
      }
    });
  }

  function showCue(idx, sec) {
    if (idx === shown.idx && sec === shown.sec) return;
    if (idx !== shown.idx) {
      closePopup(false);
      if (practice && idx !== practice.idx) closePractice(false);
      if (idx >= 0) fillWords(ui.pri, primary.cues[idx].text, langOf(primary.track.languageCode));
      else ui.pri.textContent = '';
      ui.pri.hidden = idx < 0;
      highlightRow(idx);
    }
    if (sec !== shown.sec) {
      ui.sec.textContent = sec;
      ui.sec.hidden = !sec;
    }
    ui.box.hidden = idx < 0 && !sec;
    shown = { idx, sec };
    paintSentenceStar();
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!ui) return;
    if (now - lastLayout > 250) {
      lastLayout = now;
      layout();
    }
    if (!video || !settings.enabled || !primary || ui.root.hidden) {
      showCue(-1, '');
      return;
    }
    let t = video.currentTime - offset;
    const cues = primary.cues;
    let idx = findCue(cues, t);

    // Pause at the end of a line (auto-pause, or listening practice for lines with speech).
    let due = -1;
    if (idx >= 0 && cues[idx].end - t < 0.1) due = idx;
    else if (lastIdx >= 0 && lastIdx !== idx && !video.seeking && t >= cues[lastIdx].end && t - cues[lastIdx].end < 1) due = lastIdx;
    if (slowFor >= 0 && idx !== slowFor && !video.seeking) restoreRate();
    const practise = due >= 0 && settings.mode !== 'watch' && spokenWords(cues[due].text).length > 0;
    if (due >= 0 && (settings.autoPause || practise) && !video.paused && autoPausedFor !== due) {
      autoPausedFor = due;
      pauseVideo();
      if (due !== idx) {
        // A late frame skipped the pause window: step back to just before the end of that line.
        t = cues[due].end - 0.05;
        idx = due;
        ownSeek = true;
        video.currentTime = t + offset;
      }
      if (practise) openPractice(due);
    }
    lastIdx = idx;

    let sec = '';
    if (secondary.kind !== 'off') ensureMT(idx >= 0 ? idx : lastStarted(cues, t));
    if (idx >= 0) sec = lineTranslation(cues[idx]);
    else if (secondary.kind === 'track') {
      // Between lines the translated track is followed by its own clock (signs, on-screen text).
      const j = findCue(secondary.cues, t);
      if (j >= 0) sec = secondary.cues[j].text;
    }
    showCue(idx, sec);
    if (now - lastSync > 120) {
      lastSync = now;
      calibrate();
    }
  }

  function layout() {
    const root = ui.root;
    if (!video || !video.isConnected) {
      root.hidden = true;
      return;
    }
    const r = video.getBoundingClientRect();
    if (r.width < 300 || r.height < 150 || !inPlayer(video)) {
      root.hidden = true;
      applyNativeHiding();
      return;
    }
    const fs = document.fullscreenElement;
    // YouTube's player is a box in a page that scrolls: the overlay goes inside it and moves with
    // it. Elsewhere it is pinned to the window, over the picture.
    const own = SITE === 'youtube' ? video.closest('.html5-video-player') : null;
    const host = own || (fs && fs !== video && fs.contains(video) ? fs : document.body);
    if (root.parentNode !== host) host.appendChild(root);
    root.hidden = false;
    ui.subs.hidden = !settings.enabled;
    root.classList.toggle('sl-mode-write', settings.mode === 'write');
    root.classList.toggle('sl-paused', video.paused);
    const hr = own ? own.getBoundingClientRect() : { left: 0, top: 0 };
    const css =
      (own ? 'position:absolute;' : '') +
      `left:${Math.round(r.left - hr.left)}px;top:${Math.round(r.top - hr.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px;` +
      `--sl-fs:${Math.max(14, (r.height * 0.042 * settings.fontSize) / 100).toFixed(1)}px;--sl-bottom:${settings.bottomOffset}%;`;
    if (root.style.cssText !== css) root.style.cssText = css;
    applyNativeHiding();
  }

  // Whether the video is the thing being watched. Nothing is drawn over a video that is not, and
  // it is not paused or practised on.
  function inPlayer(v) {
    if (v.checkVisibility && !v.checkVisibility({ opacityProperty: true, visibilityProperty: true, checkOpacity: true, checkVisibilityCSS: true })) return false;
    if (SITE === 'youtube') {
      // Not an advertisement, the corner player, a short or the preview of a video on a list.
      const player = v.closest('.html5-video-player');
      return !!player && !player.classList.contains('ad-showing') && !v.closest('ytd-miniplayer, ytd-video-preview, #shorts-player, #inline-preview-player');
    }
    if (SITE === 'other') return true;
    // On Prime the film plays in a player that takes the whole window, or the whole screen. A
    // video that does not is something else, such as the trailer on a title's page.
    const fs = document.fullscreenElement;
    if (fs) return fs === v || fs.contains(v);
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    // The picture itself may be letterboxed inside the player, so its containers count too.
    for (let n = v; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      if (fillsWindow(n.getBoundingClientRect(), width, height)) return true;
    }
    return false;
  }

  function applyNativeHiding() {
    const ours = settings.enabled && settings.hideNative && primary && ui && !ui.root.hidden;
    document.documentElement.classList.toggle('sl-hide-native', !!ours);
  }

  function toast(text, ms = 1600) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
    }, ms);
  }

  function setStatus(text) {
    status = text;
    if (ui) {
      ui.status.textContent = text;
      ui.status.hidden = !text;
      ui.gearBtn.classList.toggle('sl-attn', !!text);
    }
  }

  // ---------- sync with the player's own captions ----------

  // Prime's video clock can run ahead of the subtitle timeline (e.g. after ads). When the
  // player's own captions are on, their appearance tells us the real offset.
  function calibrate() {
    if (!NATIVE_SEL || manualOffset || !primary || !video || video.paused) return;
    const nodes = document.querySelectorAll(NATIVE_SEL);
    let text = '';
    for (const n of nodes) text += n.textContent;
    const norm = normText(text);
    if (norm === lastNative) return;
    lastNative = norm;
    if (!norm) return;
    const vt = video.currentTime;
    const hit = uniqueMatch(primary.cues, norm, vt - offset) || (secondary.kind === 'track' && uniqueMatch(secondary.cues, norm, vt - offset));
    if (!hit) return;
    syncSamples.push(vt - hit.start);
    if (syncSamples.length > 3) syncSamples.shift();
    if (syncSamples.length < 3) return;
    const sorted = [...syncSamples].sort((a, b) => a - b);
    if (sorted[2] - sorted[0] > 0.35) return;
    const measured = Math.abs(sorted[1]) < 0.4 ? 0 : sorted[1] - 0.06;
    if (Math.abs(measured - offset) > 0.4) {
      offset = measured;
      refreshMenu();
    }
  }

  function uniqueMatch(cues, norm, t) {
    let hit = null;
    for (const c of cues) {
      if (c.start < t - 300) continue;
      if (c.start > t + 300) break;
      if (c.norm === undefined) c.norm = normText(c.text);
      if (c.norm !== norm) continue;
      if (hit) return null;
      hit = c;
    }
    return hit;
  }

  // ---------- playback control ----------

  function seekTo(i) {
    if (!primary || !video || !primary.cues.length) return;
    i = Math.max(0, Math.min(primary.cues.length - 1, i));
    restoreRate();
    video.currentTime = primary.cues[i].start + offset + 0.01;
    autoPausedFor = -1;
    lastIdx = -1;
    hoverPaused = false;
    playAfterSeek();
  }

  function pauseVideo() {
    playToken++;
    video.pause();
  }

  // Seeking while paused does not reliably leave the site's player playing: it can put the video
  // back on pause when the seek completes. So playback is asked for again once the seek is done.
  function playAfterSeek() {
    const v = video;
    const token = ++playToken;
    const play = () => {
      if (token === playToken && v === video && v.paused) v.play().catch(() => {});
    };
    play();
    v.addEventListener('seeked', () => {
      play();
      setTimeout(play, 200);
      setTimeout(play, 600);
    }, { once: true });
  }

  function nav(dir) {
    const t = video.currentTime - offset;
    const last = lastStarted(primary.cues, t);
    const active = findCue(primary.cues, t);
    if (dir === 0) seekTo(active >= 0 ? active : last);
    else if (dir < 0) seekTo(active >= 0 ? active - 1 : last);
    else seekTo(last + 1);
  }

  function resume() {
    hoverPaused = false;
    if (video && video.paused) video.play().catch(() => {});
  }

  function pickVideo() {
    let best = null;
    let bestArea = 0;
    if (SITE === 'youtube') best = document.querySelector('#movie_player video') || document.querySelector('.html5-video-player video');
    else {
      for (const v of document.querySelectorAll('video')) {
        if (!v.readyState && !v.currentSrc) continue;
        const r = v.getBoundingClientRect();
        const area = r.width * r.height;
        if (area > bestArea) {
          best = v;
          bestArea = area;
        }
      }
    }
    video = best;
    if (SITE === 'other' && video) {
      setTracks(pageTracks(video), true);
      refreshLive();
    }
    // On a site that is not known, a video is left alone unless it comes with subtitles or the
    // user has asked for the overlay.
    if (video && !ui && document.body && (SITE !== 'other' || tracks.length || forced)) buildUI();
    // An older copy of the extension loaded from another folder draws its own overlay on top of
    // this one and takes the same keys.
    if (ui && !warnedTwin && [...document.querySelectorAll('#scenelingo-root, #primelingo-root')].some((n) => n !== ui.root)) {
      warnedTwin = true;
      setStatus('Eklentinin iki kopyası birlikte çalışıyor. chrome://extensions sayfasında eski kopyayı (PrimeLingo ya da ikinci SceneLingo) kaldır ve sayfayı yenile.');
      openMenu();
    }
  }

  // The subtitles of a plain HTML5 video: the text tracks the page gave it, or else subtitle
  // files the page has fetched (a player that draws its own subtitles still has to load them).
  function pageTracks(v) {
    const list = [];
    const elements = [...v.querySelectorAll('track')];
    [...(v.textTracks || [])].forEach((tt, i) => {
      if (tt.kind !== 'subtitles' && tt.kind !== 'captions') return;
      const element = elements.find((t) => t.track === tt);
      const src = element && element.src;
      list.push({
        url: src || 'texttrack:' + i,
        id: 'texttrack:' + i + ':' + tt.language + ':' + tt.label,
        languageCode: tt.language || guessLang(tt.label),
        displayName: tt.label || tt.language,
        textTrack: tt,
        file: !!src,
      });
    });
    if (list.length) return list;
    const urls = [...new Set(performance.getEntriesByType('resource').map((e) => e.name).filter((u) => SUB_FILE.test(u)))];
    // A long list is one subtitle track cut into pieces for streaming, not a choice of files.
    if (urls.length > 8) return [];
    return urls.map((url) => ({ url, languageCode: guessLang(url), displayName: url.split(/[?#]/)[0].split('/').pop() }));
  }

  // A subtitle file from the user's own disk, for a video that has none or not the right one.
  async function openSubtitleFile(file) {
    try {
      const bytes = await file.arrayBuffer();
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) {
        // Older subtitle files are in the encoding of their language's version of Windows.
        text = new TextDecoder(settings.nativeLang === 'tr' || settings.learnLang === 'tr' ? 'windows-1254' : 'windows-1252').decode(bytes);
      }
      const cues = parseAny(text);
      if (!cues.length) throw new Error('içinde altyazı satırı bulunamadı');
      const t = { url: 'file:' + file.name + ':' + file.size, id: '', languageCode: guessLang(file.name), displayName: file.name, type: '', subtype: '', forced: false, auto: false, textTrack: null, file: false, cues };
      // A file in the user's own language goes under the line; so does a second file.
      const under = langOf(t.languageCode) === settings.nativeLang || (!t.languageCode && primary && primary.track.cues && primary.track.url !== t.url);
      fileTracks = fileTracks.filter((x) => x.url !== t.url).concat(t);
      tracks = tracks.filter((x) => !x.cues).concat(fileTracks);
      choice[under ? 'secondary' : 'primary'] = t.url;
      toast((under ? 'Alt satır: ' : 'Üst satır: ') + file.name, 2500);
      reload();
    } catch (e) {
      toast('Altyazı dosyası açılamadı: ' + ((e && e.message) || e), 4000);
    }
  }

  // ---------- word popup ----------

  // `anchor` is the word element, or the selected range when `text` is a phrase.
  async function openPopup(anchor, pin, text) {
    const cue = primary && primary.cues[shown.idx];
    const lang = primary ? primary.track.languageCode : '';
    const english = speaksEnglish();
    const shouting = !!cue && isShouting(cue.text);
    const word = shouting ? calm(text || anchor.textContent, false, english) : text || anchor.textContent;
    // "I'll" is looked up as "I will": on its own the service reads it as "ill". Spoken forms
    // such as "gonna" it knows, so they are looked up as they are and only explained.
    const expansion = english ? expandContraction(word) : null;
    const query = expansion && /['\u2019]/.test(word) ? expansion : word;
    if (video && !video.paused && (pin || settings.hoverPause)) {
      pauseVideo();
      hoverPaused = true;
    }
    const token = ++popupToken;
    popupWord = anchor;
    popupPinned = pin;
    ui.popup.classList.toggle('sl-pinned', pin);
    clearTimeout(closeTimer);
    if (settings.autoSpeak || pin) speak(word);
    const head = el('div', 'sl-pop-head');
    const btns = el('span', 'sl-pop-btns');
    const listen = button('sl-pop-btn', 'volume', null, 'Dinle', () => speak(word));
    const slow = button('sl-pop-btn', null, 'yavaş', 'Yavaş dinle', () => speak(word, true));
    const ipa = el('span', 'sl-pop-ipa');
    const save = button('sl-pop-btn sl-pop-save', 'star', 'Kaydet', null, null);
    const body = el('div', 'sl-pop-body', '…');
    const paintSave = () => {
      const on = savedWords.has(word.toLowerCase());
      save.lastChild.textContent = on ? 'Kaydedildi' : 'Kaydet';
      save.classList.toggle('sl-on', on);
    };
    paintSave();
    btns.append(listen, slow, save);
    const title = el('span', 'sl-pop-title');
    title.append(el('span', 'sl-pop-word', word), ipa);
    if (expansion) title.append(el('span', 'sl-pop-expand', '= ' + expansion));
    head.append(title, btns);
    ui.popup.textContent = '';
    ui.popup.append(head, body);
    ui.popup.hidden = false;
    placePopup(anchor);

    let translation = '';
    let info = {};
    save.addEventListener('click', () => {
      toggleSaved({
        word,
        kind: /\s/.test(word) ? 'phrase' : 'word',
        translation,
        ipa: info.ipa || '',
        definition: info.defs && info.defs[0] ? info.defs[0].text : '',
        synonyms: info.synonyms || [],
        context: cue ? cueSentence() : '',
        lang: langOf(lang),
        title: document.title,
        added: Date.now(),
      }).then(paintSave);
    });

    const res = await lookup(query, lang);
    if (token !== popupToken) return;
    body.textContent = '';
    if (!res.ok) {
      body.textContent = res.error === STALE ? STALE : 'Çeviri alınamadı: ' + res.error;
    } else {
      info = res.result;
      translation = info.translation;
      if (info.ipa) ipa.textContent = '/' + info.ipa + '/';
      body.append(el('div', 'sl-pop-main', translation || '—'));
      const labelled = (cls, label, text) => {
        const line = el('div', cls);
        line.append(el('span', 'sl-pop-pos', label), document.createTextNode(' ' + text));
        body.append(line);
      };
      // Pointing at a word gives the short card; clicking it pins the card and opens the rest.
      const entries = info.dict || [];
      const defs = info.defs || [];
      const synonyms = info.synonyms || [];
      for (const d of entries.slice(0, pin ? 4 : 1)) labelled('sl-pop-dict', d.pos, d.terms.join(', '));
      if (pin) {
        defs.slice(0, 2).forEach((d, i) => {
          labelled('sl-pop-def', d.pos, d.text);
          if (d.example && i === 0) body.append(el('div', 'sl-pop-ex', '“' + d.example + '”'));
        });
        if (synonyms.length) labelled('sl-pop-syn', 'eş anlamlı', synonyms.join(', '));
      } else if (defs.length || synonyms.length || entries.length > 1) {
        body.append(el('div', 'sl-pop-more', 'Tanım ve eş anlamlılar için kelimeye tıkla'));
      }
    }
    if (ui.pri.contains(anchor.commonAncestorContainer || anchor)) placePopup(anchor);
  }

  // The same word comes up again and again in one film; ask the service only once.
  async function lookup(text, lang) {
    const key = lang + '|' + settings.nativeLang + '|' + text.toLowerCase();
    if (lookupCache.has(key)) return lookupCache.get(key);
    const res = await send({ type: 'lookup', text, sl: lang, tl: settings.nativeLang });
    if (res.ok) {
      if (lookupCache.size > 500) lookupCache.clear();
      lookupCache.set(key, res);
    }
    return res;
  }

  function placePopup(anchor) {
    const rr = ui.root.getBoundingClientRect();
    const wr = anchor.getBoundingClientRect();
    const half = ui.popup.offsetWidth / 2;
    const x = Math.max(half + 8, Math.min(rr.width - half - 8, wr.left + wr.width / 2 - rr.left));
    ui.popup.style.left = x + 'px';
    // Sit above the whole stack, so the line, the practice strip and the bar stay in view.
    ui.popup.style.bottom = rr.bottom - ui.barWrap.getBoundingClientRect().top + 'px';
  }

  function closePopup(mayResume) {
    if (!ui || ui.popup.hidden) return false;
    popupToken++;
    popupWord = null;
    popupPinned = false;
    clearTimeout(closeTimer);
    ui.popup.hidden = true;
    if (mayResume && hoverPaused && !ui.subs.matches(':hover')) resume();
    if (practice && practice.mode === 'write' && !pointerHeld) focusBox();
    return true;
  }

  function scheduleClose() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!popupPinned && !ui.box.matches(':hover') && !ui.popup.matches(':hover')) closePopup(true);
    }, 300);
  }

  const speaksEnglish = () => langOf((primary && primary.track.languageCode) || settings.learnLang) === 'en';

  function speechLang() {
    if (speaksEnglish()) return settings.accent;
    const [base, region] = String((primary && primary.track.languageCode) || settings.learnLang).split(/[-_]/);
    return region && region.length === 2 ? base.toLowerCase() + '-' + region.toUpperCase() : base.toLowerCase();
  }

  function stopSpeech() {
    if (audioSource) {
      try {
        audioSource.stop();
      } catch (e) { /* already ended */ }
      audioSource = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  function recordedSpeech(text, lang, slow) {
    const key = lang + '|' + (slow ? 'slow|' : '') + text.toLowerCase();
    if (!audioCache.has(key)) {
      if (audioCache.size > 300) audioCache.clear();
      const job = send({ type: 'tts', text, lang, slow }).then((res) => {
        if (!res.ok) throw new Error(res.error);
        const bin = atob(res.result);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return audioCtx.decodeAudioData(bytes.buffer);
      }).then((buffer) => (slow ? slowDown(buffer) : buffer));
      job.catch(() => audioCache.delete(key));
      audioCache.set(key, job);
    }
    return audioCache.get(key);
  }

  // The service's own slow voice is only slightly slower, so it is stretched further.
  function slowDown(buffer) {
    const out = stretch(buffer.getChannelData(0), buffer.sampleRate, SLOW_RATE);
    const slowed = audioCtx.createBuffer(1, out.length, buffer.sampleRate);
    slowed.copyToChannel(out, 0);
    return slowed;
  }

  // Recorded audio goes through a gain stage so it can be louder than the source file;
  // the limiter keeps the boosted signal from clipping.
  function playBuffer(buffer) {
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioGain.gain.value = settings.speechVolume / 100;
    audioSource = audioCtx.createBufferSource();
    audioSource.buffer = buffer;
    audioSource.connect(audioGain);
    audioSource.start();
  }

  // Used when the recorded voice cannot be fetched: the browser's own synthesizer.
  function synthSpeech(text, lang, slow) {
    const synth = window.speechSynthesis;
    if (!synth) return;
    const score = (v) =>
      (v.lang.replace('_', '-').toLowerCase() === lang.toLowerCase() ? 4 : 0) +
      (/female|zira|hazel|susan|aria|jenny|sonia|libby|michelle|samantha|karen|emel|google us english/i.test(v.name) ? 3 : 0) -
      (/\bmale\b|david|mark|george|ryan|guy/i.test(v.name) ? 3 : 0) +
      (/natural|online|google/i.test(v.name) ? 1 : 0);
    const voice = synth
      .getVoices()
      .filter((v) => langOf(v.lang) === langOf(lang))
      .sort((a, b) => score(b) - score(a))[0];
    utterance = new SpeechSynthesisUtterance(text);
    if (voice) utterance.voice = voice;
    utterance.lang = voice ? voice.lang : lang;
    utterance.rate = slow ? 0.6 : 0.9;
    utterance.volume = Math.min(1, settings.speechVolume / 100);
    synth.speak(utterance);
  }

  function ensureAudio() {
    if (audioCtx) return;
    audioCtx = new AudioContext();
    audioGain = audioCtx.createGain();
    const limiter = audioCtx.createDynamicsCompressor();
    limiter.threshold.value = -6;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.002;
    audioGain.connect(limiter).connect(audioCtx.destination);
  }

  async function speak(text, slow) {
    if (!text) return;
    const token = ++speakToken;
    const lang = speechLang();
    stopSpeech();
    try {
      ensureAudio();
      const buffer = await recordedSpeech(text, lang, !!slow);
      if (token === speakToken) playBuffer(buffer);
    } catch (e) {
      if (token === speakToken) synthSpeech(text, lang, !!slow);
    }
  }

  function toggleSaved(entry) {
    if (!connected()) {
      warnStale();
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      chrome.storage.local.get({ words: [] }, (data) => {
        const key = entry.word.toLowerCase();
        const had = data.words.some((w) => w.word.toLowerCase() === key);
        const words = had ? data.words.filter((w) => w.word.toLowerCase() !== key) : [entry, ...data.words];
        chrome.storage.local.set({ words }, () => {
          setSavedWords(words);
          resolve();
        });
      });
    });
  }

  function setSavedWords(words) {
    savedWords = new Set(words.map((w) => w.word.toLowerCase()));
    if (!ui) return;
    paintSentenceStar();
    for (const w of ui.pri.querySelectorAll('.sl-word')) {
      w.classList.toggle('sl-saved', savedWords.has(w.textContent.toLowerCase()));
    }
  }

  // ---------- whole-sentence tools ----------

  // The current line as one sentence, in ordinary capitalisation.
  function cueSentence() {
    const cue = primary && primary.cues[shown.idx];
    if (!cue) return '';
    const text = cue.text.replace(/\s*\n\s*/g, ' ');
    return isShouting(text) ? calm(text, true, speaksEnglish()) : text;
  }

  function paintSentenceStar() {
    if (!ui) return;
    const text = cueSentence();
    ui.starBtn.classList.toggle('sl-on', !!text && savedWords.has(text.toLowerCase()));
  }

  function speakSentence() {
    const text = cueSentence();
    if (!text) return;
    if (video && !video.paused) {
      pauseVideo();
      hoverPaused = true;
    }
    speak(text);
  }

  async function saveSentence() {
    const text = cueSentence();
    if (!text) return;
    const lang = primary.track.languageCode;
    let translation = (shown.sec || '').replace(/\s*\n\s*/g, ' ');
    if (!translation && !savedWords.has(text.toLowerCase())) {
      const res = await lookup(text, lang);
      if (res.ok) translation = res.result.translation;
    }
    await toggleSaved({ word: text, kind: 'sentence', translation, context: '', lang: langOf(lang), title: document.title, added: Date.now() });
    toast(savedWords.has(text.toLowerCase()) ? 'Cümle kaydedildi' : 'Cümle listeden çıkarıldı');
  }

  // The words of the current line between the first and last word the selection touches.
  function selectedPhrase(range) {
    const words = [...ui.pri.querySelectorAll('.sl-word')].filter((w) => range.intersectsNode(w));
    if (words.length < 2) return null;
    let text = '';
    for (let n = words[0]; n; n = n.nextSibling) {
      text += n.nodeName === 'BR' ? ' ' : n.textContent;
      if (n === words[words.length - 1]) break;
    }
    const span = document.createRange();
    span.setStartBefore(words[0]);
    span.setEndAfter(words[words.length - 1]);
    return { text: text.replace(/\s+/g, ' ').trim(), range: span };
  }

  // Plays the current line again at reduced speed: the film's own sound, not the synthetic voice.
  function replaySlow() {
    if (!primary || !video) return;
    const t = video.currentTime - offset;
    const active = findCue(primary.cues, t);
    const i = active >= 0 ? active : lastStarted(primary.cues, t);
    if (i < 0) return;
    const rate = slowFor >= 0 ? normalRate : video.playbackRate;
    seekTo(i);
    normalRate = rate;
    slowFor = i;
    video.playbackRate = SLOW_PLAY;
  }

  function restoreRate() {
    if (slowFor < 0) return;
    slowFor = -1;
    if (video) video.playbackRate = normalRate;
  }

  // ---------- practice: write what was heard, or say the line aloud ----------

  const describe = (node) => {
    if (!node || node.nodeType !== 1) return String(node && node.nodeName);
    const cls = typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\s+/)[0] : '';
    return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + cls + (ui && ui.root.contains(node) ? ' (ours)' : '');
  };

  // What the page looks like to the extension: the videos on it, with the boxes they sit in.
  function diagnostics() {
    const box = (r) => '[' + [r.left, r.top, r.width, r.height].map(Math.round).join(',') + ']';
    const name = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => '.' + c).join('') : '');
    const lines = [
      'SceneLingo ' + (connected() ? chrome.runtime.getManifest().version : '(stale copy: the page needs a reload)') + ' — ' + location.hostname,
      'mode: ' + settings.mode + ', fullscreen: ' + !!document.fullscreenElement + ', focus: ' + describe(document.activeElement),
      'site: ' + SITE + (window.top === window ? '' : ' (in a frame)') + ', forced: ' + forced,
      'window: ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
        ', overlay: ' + (!ui ? 'not built' : ui.root.hidden ? 'hidden' : 'shown') + ', tracks: ' + tracks.length + ', lines: ' + (primary ? primary.cues.length : 0),
    ];
    for (const v of document.querySelectorAll('video')) {
      lines.push(
        'video' + (v === video ? ' (picked) ' : ' ') + box(v.getBoundingClientRect()) + ' ready ' + v.readyState + (v.paused ? ' paused' : ' playing') +
          ' at ' + Math.round(v.currentTime) + '/' + Math.round(v.duration) + ', in player: ' + inPlayer(v)
      );
      for (let n = v.parentElement, i = 0; n && n !== document.body && i < 14; n = n.parentElement, i++) {
        const cs = getComputedStyle(n);
        lines.push('  ' + name(n) + ' ' + box(n.getBoundingClientRect()) + ' ' + cs.position + (cs.opacity !== '1' ? ' opacity ' + cs.opacity : '') + (cs.visibility !== 'visible' ? ' ' + cs.visibility : ''));
      }
    }
    return lines.concat(traceLog).join('\n');
  }

  function trace(what, detail) {
    traceLog.push(Math.round(performance.now()) + ' ' + what + (detail ? ' ' + detail : ''));
    if (traceLog.length > 200) traceLog.shift();
  }

  function caretToEnd() {
    const range = document.createRange();
    range.selectNodeContents(ui.answer);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function focusBox() {
    if (document.activeElement === ui.answer) return;
    ui.answer.focus({ preventScroll: true });
    caretToEnd();
  }

  // The answer box takes the focus back only when the page moved it, not when the user is
  // selecting subtitle text or reading a word card.
  const boxWantsFocus = () => !!practice && practice.mode === 'write' && !pointerHeld && ui.popup.hidden;

  // The site's player moves the keyboard focus to its own controls when playback starts or stops.
  function keepFocus(thief) {
    const now = performance.now();
    focusPulls = focusPulls.filter((t) => now - t < 1000);
    trace('focus-left', describe(thief) + (focusPulls.length >= 6 ? ' (gave up)' : ''));
    if (focusPulls.length >= 6) return;
    focusPulls.push(now);
    focusBox();
  }

  // A key pressed while the focus was elsewhere still belongs to the answer.
  function typeIntoBox(e) {
    const box = ui.answer;
    if (e.key.length === 1) box.textContent += e.key;
    else if (e.code === 'Backspace') box.textContent = box.textContent.slice(0, -1);
    caretToEnd();
    if (practice.checked) scorePractice(box.textContent);
  }

  function openPractice(idx) {
    const mode = settings.mode;
    if (!practice || practice.idx !== idx || practice.mode !== mode) {
      if (practice) closePractice(false);
      practice = { idx, mode, checked: false, state: 'idle', heard: '', interim: '', note: '', segments: [], voice: null, attempt: 0, score: null };
      ui.root.classList.remove('sl-reveal');
      ui.answer.textContent = '';
      clearMarks();
      ui.stripWrap.hidden = false;
      trace('open', mode + ' line ' + idx);
    }
    if (mode === 'speak') {
      startListening();
      return;
    }
    paintPractice();
    focusBox();
    // The player reacts to the pause a moment later and may take the focus then; no focus event
    // is fired for that if the window itself is not focused, so check once more.
    setTimeout(() => {
      if (boxWantsFocus() && !ui.root.contains(document.activeElement)) focusBox();
    }, 250);
  }

  // Colours the words of the line on screen: got or missed. Each word element is matched to the
  // spoken tokens that start inside it, by their position in the line's text.
  function markWords(hit) {
    const tokens = spokenTokens(primary.cues[practice.idx].text);
    let pos = 0;
    for (const node of ui.pri.childNodes) {
      const length = node.nodeName === 'BR' ? 1 : node.textContent.length;
      if (node.nodeType === 1 && node.classList.contains('sl-word')) {
        const mine = [];
        tokens.forEach((token, i) => {
          if (token.start >= pos && token.start < pos + length) mine.push(i);
        });
        node.classList.toggle('sl-ok', mine.length > 0 && mine.every((i) => hit[i]));
        node.classList.toggle('sl-miss', mine.length > 0 && !mine.every((i) => hit[i]));
      }
      pos += length;
    }
  }

  function clearMarks() {
    for (const w of ui.pri.querySelectorAll('.sl-ok, .sl-miss')) w.classList.remove('sl-ok', 'sl-miss');
  }

  // Compares an answer (typed, or heard by the recogniser) with the line. Only the first check of
  // a line counts towards the session score; after it the marks simply follow the answer.
  function scorePractice(answer) {
    const expected = spokenWords(primary.cues[practice.idx].text);
    const hit = matchWords(expected, spokenWords(answer));
    const ok = hit.filter(Boolean).length;
    if (!practice.checked) {
      const stats = practiceStats[practice.mode];
      stats.ok += ok;
      stats.total += expected.length;
      trace('check', practice.mode + ' ' + ok + '/' + expected.length);
    }
    practice.checked = true;
    practice.score = [ok, expected.length];
    ui.root.classList.add('sl-reveal'); // in writing practice the line is hidden until now
    markWords(hit);
    paintPractice();
  }

  function paintPractice() {
    if (!practice) return;
    const speaking = practice.mode === 'speak';
    const listening = practice.state === 'listening';
    ui.answer.hidden = speaking;
    ui.heard.hidden = !speaking;
    if (speaking) {
      ui.heard.classList.toggle('sl-listening', listening);
      ui.heard.classList.toggle('sl-problem', practice.state === 'error');
      ui.heardText.textContent = listening
        ? practice.interim || segmentsText(practice) || 'Dinliyorum… cümleyi sesli söyle'
        : practice.state === 'error'
          ? practice.note
          : 'Duyulan: ' + practice.heard;
    }
    ui.checkBtn.hidden = speaking;
    ui.checkBtn.textContent = practice.checked ? 'Devam (Enter)' : 'Kontrol et (Enter)';
    ui.sayBtn.hidden = !speaking || listening;
    ui.doneBtn.hidden = !speaking || !listening;
    ui.voiceBtn.hidden = !speaking || listening || !practice.voice;
    ui.goBtn.hidden = !speaking || listening;
    // The score sits beside what was heard when speaking, and beside the buttons when writing.
    const scoreHome = speaking ? ui.heard : ui.actions;
    if (ui.score.parentNode !== scoreHome) scoreHome.appendChild(ui.score);
    const stats = practiceStats[practice.mode];
    ui.score.textContent = practice.score
      ? practice.score[0] + '/' + practice.score[1] + (speaking ? ' kelime anlaşıldı' : ' kelime doğru') + ' · bu oturum %' + Math.round((100 * stats.ok) / stats.total)
      : '';
  }

  function closePractice(play) {
    if (!practice) return;
    practice = null;
    stopListening(false);
    trace('close', play ? 'and play' : '');
    ui.stripWrap.hidden = true;
    ui.root.classList.remove('sl-reveal');
    clearMarks();
    ui.answer.blur();
    if (play && video) video.play().catch(() => {});
  }

  function practiceEnter() {
    if (!practice) return;
    if (practice.mode === 'speak') {
      if (practice.state === 'listening') stopListening(true);
      else closePractice(true);
    } else if (practice.checked) closePractice(true);
    else scorePractice(ui.answer.textContent);
  }

  function practiceReplay() {
    if (!practice) return;
    trace('replay', 'line ' + practice.idx);
    stopListening(false);
    seekTo(practice.idx);
    if (practice.mode === 'write') focusBox();
  }

  // ---------- speaking practice: speech recognition and the learner's own recording ----------

  const SPEECH_PROBLEMS = {
    'not-allowed': 'Mikrofona izin verilmedi. Adres çubuğundaki mikrofon simgesinden izin ver, sonra Boşluk ile tekrar dene.',
    'service-not-allowed': 'Mikrofona izin verilmedi. Adres çubuğundaki mikrofon simgesinden izin ver, sonra Boşluk ile tekrar dene.',
    'no-speech': 'Ses duyulmadı. Boşluk ile tekrar dene.',
    'audio-capture': 'Mikrofon bulunamadı.',
    network: 'Konuşma tanıma servisine ulaşılamadı; internet bağlantısı gerekiyor.',
    unsupported: 'Bu tarayıcıda konuşma tanıma kullanılamıyor.',
  };

  const segmentsText = (p) => p.segments.map((alternatives) => alternatives[0]).join(' ');

  function startListening() {
    const p = practice;
    if (!p || p.mode !== 'speak') return;
    stopListening(false);
    stopSpeech();
    clearMarks();
    const attempt = ++p.attempt;
    Object.assign(p, { state: 'listening', heard: '', interim: '', note: '', segments: [], problem: '' });
    paintPractice();
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const cue = primary.cues[p.idx];
    const wanted = spokenWords(cue.text).length;
    let r;
    try {
      r = new Recognition();
      r.lang = speechLang();
      r.interimResults = true;
      r.continuous = true;
      r.maxAlternatives = 3;
    } catch (e) {
      failListening(p, 'unsupported');
      return;
    }
    r.onresult = (e) => {
      if (recog !== r) return;
      const finals = [];
      let interim = '';
      for (let i = 0; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result.isFinal) interim += result[0].transcript;
        else finals.push(Array.from({ length: result.length }, (_, k) => result[k].transcript));
      }
      p.segments = finals;
      p.interim = interim;
      paintPractice();
      // Stop soon after the whole line has been heard; otherwise wait out a pause in the speech.
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => stopListening(true), spokenWords(segmentsText(p)).length >= wanted ? 350 : 2200);
    };
    r.onerror = (e) => {
      if (recog !== r) return;
      p.problem = e.error;
      trace('speech-error', e.error);
    };
    r.onend = () => {
      if (recog !== r) return;
      recog = null;
      finishListening(p);
    };
    recog = r;
    try {
      r.start();
    } catch (e) {
      recog = null;
      failListening(p, 'unsupported');
      return;
    }
    trace('listen', r.lang);
    record(p, attempt);
    listenTimer = setTimeout(() => stopListening(true), Math.max(8000, (cue.end - cue.start) * 2500 + 5000));
  }

  // `evaluate`: let the recogniser finish and score what it heard. Otherwise the attempt is dropped.
  function stopListening(evaluate) {
    clearTimeout(listenTimer);
    clearTimeout(quietTimer);
    const r = recog;
    if (!r) return;
    if (evaluate) {
      try {
        r.stop();
      } catch (e) { /* already stopping */ }
      return;
    }
    recog = null;
    try {
      r.abort();
    } catch (e) { /* already stopped */ }
    stopRecording();
  }

  function finishListening(p) {
    clearTimeout(listenTimer);
    clearTimeout(quietTimer);
    stopRecording();
    if (practice !== p) return;
    const heard = bestTranscript(p);
    if (!heard) {
      failListening(p, p.problem || 'no-speech');
      return;
    }
    p.heard = heard;
    p.state = 'result';
    trace('heard', spokenWords(heard).length + ' words');
    scorePractice(heard);
  }

  function failListening(p, code) {
    stopRecording();
    if (practice !== p) return;
    p.state = 'error';
    p.note = SPEECH_PROBLEMS[code] || 'Konuşma tanıma çalışmadı (' + code + '). Boşluk ile tekrar dene.';
    trace('speech-failed', code);
    paintPractice();
  }

  // The recogniser offers a few readings of each stretch of speech. The learner was understood if
  // any of them is the line, so for each stretch the reading that matches the line best is kept.
  function bestTranscript(p) {
    const expected = spokenWords(primary.cues[p.idx].text);
    const matches = (parts) => matchWords(expected, spokenWords(parts.join(' '))).filter(Boolean).length;
    const chosen = p.segments.map((alternatives) => alternatives[0]);
    p.segments.forEach((alternatives, s) => {
      for (const alternative of alternatives.slice(1)) {
        const trial = chosen.slice();
        trial[s] = alternative;
        if (matches(trial) > matches(chosen)) chosen[s] = alternative;
      }
    });
    return (chosen.join(' ') || p.interim).replace(/\s+/g, ' ').trim();
  }

  // Records the attempt so the learner can hear themselves next to the original.
  async function record(p, attempt) {
    if (!navigator.mediaDevices || !window.MediaRecorder) return;
    try {
      if (!micStream || !micStream.active) micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      trace('mic', String((e && e.name) || e));
      return;
    }
    if (practice !== p || p.attempt !== attempt || p.state !== 'listening') return;
    const rec = new MediaRecorder(micStream);
    const chunks = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    rec.onstop = async () => {
      try {
        ensureAudio();
        const voice = await audioCtx.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
        if (practice !== p || p.attempt !== attempt) return;
        p.voice = voice;
        paintPractice();
      } catch (e) {
        trace('voice', 'could not be decoded');
      }
    };
    recorder = rec;
    rec.start();
  }

  function stopRecording() {
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (e) { /* already stopped */ }
    }
    recorder = null;
    // The microphone stays open between attempts so the first word is not clipped, and is
    // released once practice has been idle for a while.
    clearTimeout(micIdle);
    micIdle = setTimeout(releaseMic, 90000);
  }

  function releaseMic() {
    clearTimeout(micIdle);
    if (!micStream) return;
    for (const track of micStream.getTracks()) track.stop();
    micStream = null;
  }

  function playVoice() {
    if (!practice || !practice.voice) return;
    stopSpeech();
    playBuffer(practice.voice);
  }

  // ---------- subtitle list panel ----------

  function buildPanel() {
    ui.list.textContent = '';
    panelRows = [];
    if (!primary) return;
    const frag = document.createDocumentFragment();
    primary.cues.forEach((c, i) => {
      const row = el('div', 'sl-row');
      row.dataset.i = i;
      const texts = el('div', 'sl-row-texts');
      const tr = el('div', 'sl-row-tr', lineTranslation(c));
      tr.hidden = !lineTranslation(c);
      texts.append(el('div', 'sl-row-text', c.text.replace(/\n/g, ' ')), tr);
      row.append(el('span', 'sl-row-time', fmtTime(c.start)), texts);
      frag.appendChild(row);
      panelRows.push({ row, tr });
    });
    ui.list.appendChild(frag);
    highlightRow(shown.idx);
  }

  function setRowTranslation(i) {
    const r = panelRows && panelRows[i];
    if (!r || !primary) return;
    r.tr.textContent = lineTranslation(primary.cues[i]);
    r.tr.hidden = !lineTranslation(primary.cues[i]);
  }

  function highlightRow(idx) {
    if (!panelRows || ui.panel.hidden) return;
    const old = ui.list.querySelector('.sl-row.sl-current');
    if (old) old.classList.remove('sl-current');
    const r = panelRows[idx];
    if (!r) return;
    r.row.classList.add('sl-current');
    if (!ui.panel.matches(':hover')) {
      ui.list.scrollTop = r.row.offsetTop - ui.list.clientHeight / 2 + r.row.offsetHeight / 2;
    }
  }

  function togglePanel() {
    const open = ui.panel.hidden;
    ui.panel.hidden = !open;
    ui.root.classList.toggle('sl-panel-open', open);
    ui.listBtn.classList.toggle('sl-on', open);
    if (open) buildPanel();
    else {
      ui.list.textContent = '';
      panelRows = null;
    }
  }

  // ---------- settings ----------

  function setSetting(key, value) {
    settings[key] = value;
    applySettings([key]);
    try {
      chrome.storage.sync.set({ [key]: value });
    } catch (e) { /* extension was reloaded */ }
  }

  const MODE_NOTES = {
    watch: 'İzleme: altyazılarla izle',
    write: 'Yazma: altyazı gizli, cümle bitince duyduğunu yaz',
    speak: 'Söyleme: cümle bitince sesli tekrar et',
  };

  // Choosing the mode that is already on goes back to plain watching.
  function setMode(mode) {
    setSetting('mode', settings.mode === mode ? 'watch' : mode);
    toast(MODE_NOTES[settings.mode], 2200);
  }

  function applySettings(keys) {
    if (practice && (practice.mode !== settings.mode || !settings.enabled)) closePractice(false);
    if (settings.mode !== 'speak') releaseMic();
    applyNativeHiding();
    refreshMenu();
    if (ui) layout();
    if (keys.some((k) => k === 'learnLang' || k === 'nativeLang' || k === 'preferHuman')) {
      choice = { primary: 'auto', secondary: 'auto' };
      reload();
    }
    showIntro();
  }

  // Shown once: the controls are out of sight until the mouse moves, so say where they are.
  function showIntro() {
    if (!ui || !settingsLoaded || settings.introSeen) return;
    setSetting('introSeen', true);
    wake(9000);
    toast('Çalışma çubuğu altyazının üstünde; fareyi oynatınca görünür. W: duyduğunu yaz · E: sesli söyle · Z: yavaş tekrar', 9000);
  }

  function wake(ms = 2500) {
    if (!ui) return;
    ui.root.classList.add('sl-awake');
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => ui.root.classList.remove('sl-awake'), ms);
  }

  // ---------- UI ----------

  // Outline icons, one path each (shapes adapted from Feather, MIT).
  const ICONS = {
    prev: 'M19 20L9 12l10-8v16z M5 19V5',
    next: 'M5 4l10 8-10 8V4z M19 5v14',
    repeat: 'M17 1l4 4-4 4 M3 11V9a4 4 0 0 1 4-4h14 M7 23l-4-4 4-4 M21 13v2a4 4 0 0 1-4 4H3',
    eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    pen: 'M12 20h9 M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z',
    mic: 'M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z M19 10v2a7 7 0 0 1-14 0v-2 M12 19v4 M8 23h8',
    pause: 'M6 4h4v16H6z M14 4h4v16h-4z',
    volume: 'M11 5L6 9H2v6h4l5 4V5z M19.07 4.93a10 10 0 0 1 0 14.14 M15.54 8.46a5 5 0 0 1 0 7.07',
    star: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
    list: 'M8 6h13 M8 12h13 M8 18h13 M3 6h.01 M3 12h.01 M3 18h.01',
    sliders: 'M4 21v-7 M4 10V3 M12 21v-9 M12 8V3 M20 21v-5 M20 12V3 M1 14h6 M9 8h6 M17 16h6',
    play: 'M5 3l14 9-14 9V3z',
    close: 'M18 6L6 18 M6 6l12 12',
  };

  function icon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'sl-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  }

  // A button showing an icon, a label, or both. `title` is the tooltip and the accessible name.
  function button(cls, iconName, label, title, onClick) {
    const b = el('button', cls);
    if (iconName) b.appendChild(icon(iconName));
    if (label) b.appendChild(el('span', null, label));
    if (title) {
      b.title = title;
      b.setAttribute('aria-label', title);
    }
    if (onClick) b.addEventListener('click', onClick);
    return b;
  }

  function buildUI() {
    const root = el('div');
    root.id = 'scenelingo-root';
    root.hidden = true;

    // The stack over the picture, bottom up: the subtitle, the practice strip, the study bar.
    const subs = el('div', 'sl-subs');
    const box = el('div', 'sl-box');
    const pri = el('div', 'sl-primary');
    const sec = el('div', 'sl-secondary');
    box.hidden = true;
    box.append(pri, sec);

    // study bar
    const bar = el('div', 'sl-bar');
    const modeBtns = {
      watch: button('sl-seg-btn', 'eye', 'İzle', 'İzle: altyazılarla izle', () => setSetting('mode', 'watch')),
      write: button('sl-seg-btn', 'pen', 'Yaz', 'Yaz: cümle bitince duyduğunu yaz (W)', () => setMode('write')),
      speak: button('sl-seg-btn', 'mic', 'Söyle', 'Söyle: cümle bitince sesli tekrar et (E)', () => setMode('speak')),
    };
    const seg = el('div', 'sl-seg');
    seg.append(modeBtns.watch, modeBtns.write, modeBtns.speak);
    const pauseBtn = button('sl-ibtn', 'pause', null, 'Her cümlede duraklat (Q)', () => setSetting('autoPause', !settings.autoPause));
    const starBtn = button('sl-ibtn', 'star', null, 'Cümleyi kaydet', saveSentence);
    const listBtn = button('sl-ibtn', 'list', null, 'Altyazı listesi (L)', togglePanel);
    const gearBtn = button('sl-ibtn', 'sliders', null, 'Ayarlar', () => (ui.menu.hidden ? openMenu() : (ui.menu.hidden = true)));
    bar.append(
      button('sl-ibtn', 'prev', null, 'Önceki cümle (A)', () => primary && nav(-1)),
      button('sl-ibtn', 'repeat', null, 'Cümleyi tekrar oynat (S)', () => primary && nav(0)),
      button('sl-ibtn sl-text-btn', null, '0.75×', 'Cümleyi yavaş tekrar oynat (Z)', replaySlow),
      button('sl-ibtn', 'next', null, 'Sonraki cümle (D)', () => primary && nav(1)),
      el('span', 'sl-sep'),
      seg,
      el('span', 'sl-sep'),
      pauseBtn,
      button('sl-ibtn', 'volume', null, 'Cümleyi sesli oku', speakSentence),
      starBtn,
      listBtn,
      gearBtn
    );
    const barWrap = el('div', 'sl-bar-wrap');
    barWrap.appendChild(bar);

    // practice strip
    const strip = el('div', 'sl-strip');
    // An editable box rather than an <input>: the browser offers saved cards and addresses in
    // form fields, and while that list is open it takes Tab and Enter for itself.
    const answer = el('div', 'sl-answer');
    answer.contentEditable = 'plaintext-only';
    answer.setAttribute('role', 'textbox');
    answer.setAttribute('aria-label', 'Duyduğunu yaz');
    answer.dataset.placeholder = 'Duyduğunu yaz…';
    answer.spellcheck = false;
    const heard = el('div', 'sl-heard');
    const heardText = el('span', 'sl-heard-text');
    heard.append(el('span', 'sl-mic-dot'), heardText);
    const actions = el('div', 'sl-strip-row');
    const btns = el('div', 'sl-strip-btns');
    const checkBtn = button('sl-main-btn', null, 'Kontrol et (Enter)', null, () => {
      practiceEnter();
      if (practice) focusBox();
    });
    const doneBtn = button('sl-main-btn', null, 'Bitir (Enter)', null, practiceEnter);
    const sayBtn = button(null, 'mic', 'Tekrar söyle (Boşluk)', null, startListening);
    const voiceBtn = button(null, 'play', 'Kendi sesim (→)', null, playVoice);
    const goBtn = button('sl-main-btn', null, 'Devam (Enter)', null, practiceEnter);
    btns.append(
      button(null, 'repeat', 'Tekrar dinle (↑)', null, practiceReplay),
      checkBtn,
      doneBtn,
      sayBtn,
      voiceBtn,
      goBtn,
      button(null, null, 'Geç (↓)', null, () => closePractice(true))
    );
    const score = el('span', 'sl-score');
    actions.append(btns, score);
    strip.append(answer, heard, actions);
    const stripWrap = el('div', 'sl-strip-wrap');
    stripWrap.hidden = true;
    stripWrap.appendChild(strip);

    subs.append(barWrap, stripWrap, box);

    const popup = el('div', 'sl-popup');
    popup.hidden = true;
    const toastEl = el('div', 'sl-toast');
    toastEl.hidden = true;
    const menu = el('div', 'sl-menu');
    menu.hidden = true;

    const panel = el('div', 'sl-panel');
    panel.hidden = true;
    const panelHead = el('div', 'sl-panel-head');
    panelHead.append(el('span', null, 'Altyazılar'), button('sl-ibtn', 'close', null, 'Kapat', togglePanel));
    const list = el('div', 'sl-list');
    panel.append(panelHead, list);

    // settings menu
    const checks = {};
    const row = (label, control, tag = 'div') => {
      const r = el(tag, 'sl-mrow');
      r.append(el('span', 'sl-mlabel', label), control);
      return r;
    };
    const check = (key) => {
      const c = el('input');
      c.type = 'checkbox';
      c.addEventListener('change', () => setSetting(key, c.checked));
      checks[key] = c;
      return c;
    };
    const stepper = (onStep) => {
      const wrap = el('span', 'sl-step');
      const minus = el('button', null, '−');
      const val = el('span', 'sl-step-val');
      const plus = el('button', null, '+');
      minus.addEventListener('click', (e) => (e.preventDefault(), onStep(-1)));
      plus.addEventListener('click', (e) => (e.preventDefault(), onStep(1)));
      wrap.append(minus, val, plus);
      return { wrap, val };
    };
    const priSel = el('select');
    const secSel = el('select');
    priSel.addEventListener('change', () => {
      choice.primary = priSel.value;
      reload();
    });
    secSel.addEventListener('change', () => {
      choice.secondary = secSel.value;
      reload();
    });
    const size = stepper((d) => setSetting('fontSize', Math.max(50, Math.min(220, settings.fontSize + d * 10))));
    const pos = stepper((d) => setSetting('bottomOffset', Math.max(2, Math.min(80, settings.bottomOffset + d * 2))));
    const sync = stepper((d) => {
      offset = Math.round((offset + d * 0.25) * 100) / 100;
      manualOffset = true;
      refreshMenu();
    });
    // Let the user hear a change to the voice settings, using words from the current title.
    const speakSample = () => {
      const sample = primary && primary.cues[Math.max(0, shown.idx)];
      if (sample) speak(sample.text.split(/\s+/).slice(0, 3).join(' '));
    };
    const accentSel = el('select');
    for (const [code, label] of [['en-GB', 'İngiliz'], ['en-US', 'Amerikan'], ['en-AU', 'Avustralya']]) {
      const o = el('option', null, label);
      o.value = code;
      accentSel.appendChild(o);
    }
    accentSel.addEventListener('change', () => {
      setSetting('accent', accentSel.value);
      speakSample();
    });
    const accentRow = row('Aksan', accentSel);
    const vol = el('span', 'sl-range');
    const volRange = el('input');
    volRange.type = 'range';
    volRange.min = 0;
    volRange.max = 300;
    volRange.step = 10;
    const volVal = el('span', 'sl-step-val');
    vol.append(volRange, volVal);
    volRange.addEventListener('input', () => {
      settings.speechVolume = +volRange.value;
      volVal.textContent = volRange.value + '%';
    });
    volRange.addEventListener('change', () => {
      setSetting('speechVolume', +volRange.value);
      volRange.blur();
      speakSample();
    });
    const reviewBtn = el('button', 'sl-wide-btn', 'Kelime tekrarını aç');
    const fileBtn = el('button', 'sl-wide-btn sl-file-btn', 'Altyazı dosyası aç (.srt, .vtt)…');
    fileBtn.title = 'Bilgisayarındaki bir altyazı dosyasını bu videoda kullan. İkinci dosya alt satıra gelir.';
    fileBtn.addEventListener('click', () => {
      const input = el('input');
      input.type = 'file';
      input.accept = '.srt,.vtt,.ttml,.dfxp,.xml,.txt';
      input.addEventListener('change', () => input.files[0] && openSubtitleFile(input.files[0]));
      input.click();
    });
    const traceBtn = el('button', 'sl-wide-btn sl-quiet-btn', 'Tanılama kaydını kopyala');
    traceBtn.title = 'Alıştırmalarda bir şey ters giderse, son olayların kaydını panoya kopyalar';
    const statusEl = el('div', 'sl-status');
    statusEl.hidden = true;
    const advanced = el('details', 'sl-more');
    advanced.append(el('summary', null, 'Gelişmiş'), row('Altyazı gecikmesi', sync.wrap), traceBtn);
    menu.append(
      statusEl,
      el('div', 'sl-mhead', 'Altyazı'),
      row('Çift altyazı', check('enabled'), 'label'),
      row('Üst satır', priSel),
      row('Alt satır', secSel),
      row('Sitenin kendi altyazısını gizle', check('hideNative'), 'label'),
      fileBtn,
      el('div', 'sl-mhead', 'Kelime kartı ve ses'),
      row('Üzerine gelince duraklat', check('hoverPause'), 'label'),
      row('Kelimenin üzerine gelince çevir', check('hoverLookup'), 'label'),
      row('Kelimeyi sesli oku', check('autoSpeak'), 'label'),
      accentRow,
      row('Okuma sesi', vol),
      el('div', 'sl-mhead', 'Görünüm'),
      row('Yazı boyutu', size.wrap),
      row('Konum', pos.wrap),
      reviewBtn,
      advanced,
      el('div', 'sl-hint', 'A önceki · S tekrar · Z yavaş tekrar · D sonraki · Q her cümlede dur · W yaz · E söyle · L liste')
    );

    root.append(subs, popup, toastEl, menu, panel);
    ui = {
      root, subs, box, pri, sec, bar, barWrap, strip, stripWrap, answer, heard, heardText, score, actions,
      checkBtn, doneBtn, sayBtn, voiceBtn, goBtn, modeBtns, pauseBtn, starBtn, listBtn, gearBtn,
      popup, toast: toastEl, menu, panel, list, checks, priSel, secSel, accentSel, accentRow,
      volRange, volVal, size, pos, sync, status: statusEl,
    };

    // Keep clicks on our controls from reaching the player underneath.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu', 'selectstart', 'dragstart']) {
      root.addEventListener(type, (e) => e.stopPropagation());
    }
    // Give keyboard focus back to the page so the shortcuts keep working after a click on our controls.
    root.addEventListener('click', (e) => {
      const control = e.target.closest('button, input[type="checkbox"]');
      if (control) control.blur();
    });
    root.addEventListener('change', (e) => {
      if (e.target.tagName === 'SELECT') e.target.blur();
    });
    reviewBtn.addEventListener('click', () => send({ type: 'open-review' }));
    traceBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(diagnostics()).then(() => toast('Tanılama kaydı kopyalandı'), () => toast('Kopyalanamadı'));
    });
    // Fallback for the case where something keeps key events from reaching the window listener.
    answer.addEventListener('keydown', onKey);
    answer.addEventListener('input', () => {
      if (practice && practice.checked) scorePractice(answer.textContent);
    });
    list.addEventListener('click', (e) => {
      const r = e.target.closest('.sl-row');
      if (r) seekTo(+r.dataset.i);
    });
    pri.addEventListener('click', (e) => {
      const w = e.target.closest('.sl-word');
      if (!w) return;
      clearTimeout(hoverTimer);
      openPopup(w, true);
    });
    // Dragging across several words looks up the whole phrase.
    pri.addEventListener('mouseup', () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount || !pri.contains(sel.anchorNode) || !pri.contains(sel.focusNode)) return;
      const phrase = selectedPhrase(sel.getRangeAt(0));
      if (!phrase) return;
      clearTimeout(hoverTimer);
      openPopup(phrase.range, true, phrase.text);
    });
    pri.addEventListener('mouseover', (e) => {
      const w = e.target.closest('.sl-word');
      clearTimeout(hoverTimer);
      if (!w || e.buttons || !settings.hoverLookup || popupPinned || (w === popupWord && !popup.hidden)) return;
      hoverTimer = setTimeout(() => openPopup(w, false), 180);
    });
    popup.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    popup.addEventListener('mouseleave', scheduleClose);
    // Pointing at the subtitle pauses the film. It stays paused while the mouse is on the strip or
    // the bar above it, and goes on when the mouse leaves the whole stack.
    box.addEventListener('mouseenter', () => {
      if (settings.hoverPause && video && !video.paused) {
        pauseVideo();
        hoverPaused = true;
      }
    });
    box.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      if (!popup.hidden) scheduleClose();
    });
    subs.addEventListener('mouseleave', () => {
      if (hoverPaused && popup.hidden) resume();
    });

    setStatus(status);
    refreshMenu();
    layout();
    showIntro();
    requestAnimationFrame(frame);
  }

  function openMenu() {
    refreshMenu();
    ui.menu.hidden = false;
    const rr = ui.root.getBoundingClientRect();
    const top = ui.barWrap.getBoundingClientRect().top;
    ui.menu.style.bottom = Math.max(8, rr.bottom - top + 4) + 'px';
    ui.menu.style.maxHeight = Math.max(160, top - rr.top - 16) + 'px';
  }

  function refreshMenu() {
    if (!ui) return;
    for (const key of Object.keys(ui.checks)) ui.checks[key].checked = !!settings[key];
    for (const mode of Object.keys(ui.modeBtns)) ui.modeBtns[mode].classList.toggle('sl-on', settings.mode === mode);
    ui.pauseBtn.classList.toggle('sl-on', !!settings.autoPause);
    const fill = (sel, options, value) => {
      sel.textContent = '';
      for (const [v, label] of options) {
        const o = el('option', null, label);
        o.value = v;
        sel.appendChild(o);
      }
      sel.value = value;
    };
    const trackOpts = tracks.map((t) => [t.url, trackLabel(t)]);
    const priName = primary ? trackLabel(primary.track) : '—';
    fill(ui.priSel, [['auto', `Otomatik (${priName})`], ...trackOpts], choice.primary);
    const secName =
      secondary.kind === 'track' ? trackLabel(secondary.track) : secondary.kind === 'mt' ? 'makine çevirisi' : 'kapalı';
    fill(
      ui.secSel,
      [['auto', `Otomatik (${secName})`], ['mt', `Makine çevirisi (${langName(settings.nativeLang)})`], ...trackOpts, ['off', 'Kapalı']],
      choice.secondary
    );
    ui.accentSel.value = settings.accent;
    ui.accentRow.hidden = !speaksEnglish();
    ui.volRange.value = settings.speechVolume;
    ui.volVal.textContent = settings.speechVolume + '%';
    ui.size.val.textContent = settings.fontSize + '%';
    ui.pos.val.textContent = settings.bottomOffset + '%';
    ui.sync.val.textContent = (offset > 0 ? '+' : '') + offset.toFixed(2) + ' sn';
  }

  // ---------- events ----------

  function onKey(e) {
    const target = e.target && e.target.nodeType === 1 ? e.target : null;
    const combo = e.ctrlKey || e.metaKey || e.altKey;
    if (practice && ui) {
      const inBox = target === ui.answer;
      const otherField = !inBox && target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const skip = () => closePractice(true);
      if (practice.mode === 'write' && !otherField) {
        // While the answer box is open the keyboard belongs to it, wherever the page has put the
        // focus, and none of it may reach the player's own shortcuts (space, arrows, letters).
        e.stopImmediatePropagation();
        // Escape is left alone: in fullscreen the browser takes it to leave fullscreen. Tab replays
        // too, so that it cannot carry the focus out of the box.
        const command = { Enter: practiceEnter, NumpadEnter: practiceEnter, ArrowUp: practiceReplay, Tab: practiceReplay, ArrowDown: skip }[e.code];
        if (command || !inBox) e.preventDefault();
        if (e.type !== 'keydown') return;
        trace('key', (command ? e.code : 'char') + ' on ' + describe(target));
        if (command && !combo) {
          try {
            command();
          } catch (err) {
            trace('error', String(err && err.stack ? err.stack : err));
          }
        } else if (!inBox && !combo) {
          focusBox();
          typeIntoBox(e);
        } else if (!combo) {
          // The box can have the focus while the selection is on subtitle words; what is typed
          // goes where the selection is, so bring it back first.
          const sel = window.getSelection();
          if (!sel.anchorNode || !ui.answer.contains(sel.anchorNode)) caretToEnd();
        }
        return;
      }
      if (practice.mode === 'speak' && !otherField && !combo) {
        // Nothing is typed here, so only the practice keys are taken; the rest work as usual.
        const command = { Enter: practiceEnter, NumpadEnter: practiceEnter, Space: startListening, ArrowUp: practiceReplay, ArrowDown: skip, ArrowRight: playVoice }[e.code];
        if (command) {
          e.stopImmediatePropagation();
          e.preventDefault();
          if (e.type !== 'keydown') return;
          trace('key', e.code);
          try {
            command();
          } catch (err) {
            trace('error', String(err && err.stack ? err.stack : err));
          }
          return;
        }
      }
    }
    if (e.type !== 'keydown') {
      // A shortcut of ours is ours from press to release: a player that acts on the release (or on
      // the key press event) would otherwise answer the same key with a shortcut of its own.
      if (ownKeys.has(e.code)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.type === 'keyup') ownKeys.delete(e.code);
      }
      return;
    }
    if (combo) return;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    let handled = true;
    if (e.code === 'Escape') {
      handled = !!ui && (closePopup(true) || !ui.menu.hidden);
      if (handled) ui.menu.hidden = true;
    } else if (!settings.enabled || !video || !primary || !ui || ui.root.hidden) {
      handled = false;
    } else if (e.code === 'KeyA') nav(-1);
    else if (e.code === 'KeyS') nav(0);
    else if (e.code === 'KeyD') nav(1);
    else if (e.code === 'KeyZ') replaySlow();
    else if (e.code === 'KeyQ') {
      setSetting('autoPause', !settings.autoPause);
      toast('Her cümlede duraklat: ' + (settings.autoPause ? 'açık' : 'kapalı'));
    } else if (e.code === 'KeyW') setMode('write');
    else if (e.code === 'KeyE') setMode('speak');
    else if (e.code === 'KeyL' && SITE !== 'youtube') togglePanel(); // on YouTube, L skips ahead
    else handled = false;
    if (handled) {
      ownKeys.add(e.code);
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  // Tells the script in the page's world that this one is up, and whether subtitles are wanted.
  function hello() {
    if (SITE === 'other') return;
    try {
      window.postMessage({ source: EXT, type: 'hello', captions: !!settings.enabled }, location.origin);
    } catch (e) { /* a page without an origin of its own */ }
  }

  function onPageMessage(e) {
    if (e.source !== window || !e.data || e.data.source !== PAGE) return;
    if (e.data.type === 'tracks') setTracks(e.data.tracks);
    else if (e.data.type === 'yt-tracks') {
      // Until the player has fetched a caption file itself there is no address to fetch one from.
      emptyNote = e.data.ready ? NO_CAPTIONS : '';
      setTracks(e.data.ready ? e.data.tracks : [], true);
      if (!primary && !tracks.length) setStatus(emptyNote || WAITING);
    } else if (e.data.type === 'sub-seen' && !tracks.length && typeof e.data.url === 'string' && e.data.url !== seenUrl) {
      seenUrl = e.data.url;
      reload();
    }
  }

  window.addEventListener('message', onPageMessage);
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, onKey, true);
  document.addEventListener('seeking', (e) => {
    if (e.target !== video) return;
    if (ownSeek) {
      ownSeek = false;
      return;
    }
    autoPausedFor = -1;
    lastIdx = -1;
  }, true);
  document.addEventListener('play', (e) => {
    if (e.target === video) hoverPaused = false;
  }, true);
  for (const type of ['play', 'pause', 'seeking', 'seeked']) {
    document.addEventListener(type, (e) => {
      if (e.target === video && settings.mode !== 'watch') trace('video', type + ' at ' + video.currentTime.toFixed(2));
    }, true);
  }
  document.addEventListener('focusin', (e) => {
    if (ui && boxWantsFocus() && !ui.root.contains(e.target)) keepFocus(e.target);
  }, true);
  document.addEventListener('focusout', (e) => {
    if (!practice || !ui || e.target !== ui.answer || e.relatedTarget) return;
    // Focus went nowhere in particular (a click on the picture, or the page blurring the box).
    setTimeout(() => {
      if (boxWantsFocus() && document.hasFocus() && !ui.root.contains(document.activeElement)) keepFocus(document.activeElement);
    }, 0);
  }, true);
  window.addEventListener('mousedown', (e) => {
    pointerHeld = true;
    if (!ui) return;
    const target = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    if (!ui.popup.hidden && !ui.popup.contains(target) && !(target && target.closest('.sl-word'))) closePopup(true);
    if (!ui.menu.hidden && !ui.menu.contains(target) && !ui.gearBtn.contains(target)) ui.menu.hidden = true;
    // A press on our own controls is ours alone. A player that cancels mouse presses to keep its
    // picture from being selected would otherwise also stop subtitle words from being selected.
    if (ui.root.contains(target)) e.stopImmediatePropagation();
  }, true);
  for (const type of ['pointerdown', 'selectstart']) {
    window.addEventListener(type, (e) => {
      if (ui && ui.root.contains(e.target)) e.stopImmediatePropagation();
    }, true);
  }
  for (const type of ['mouseup', 'blur']) {
    window.addEventListener(type, (e) => {
      // Only the window losing focus counts: an element's blur passes through here as well.
      if (type === 'blur' && e.target !== window) return;
      setTimeout(() => (pointerHeld = false), 0);
    }, true);
  }
  document.addEventListener('mousemove', () => wake(), true);
  window.addEventListener('pagehide', releaseMic);

  chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
    settings = { ...SL_DEFAULTS, ...stored };
    settingsLoaded = true;
    applySettings([]);
    hello();
  });
  chrome.storage.local.get({ words: [] }, (data) => setSavedWords(data.words));
  // The toolbar popup can ask for the diagnostics, for when the overlay is not there to ask.
  // Every frame of the tab hears these; the one that holds the video is the one to act.
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg) return;
    if (msg.type === 'activate') {
      forced = true;
      pickVideo();
      if (window.top === window) reply({ ok: true });
    } else if (msg.type === 'diagnose') {
      if (video) reply(diagnostics());
      else if (window.top === window) {
        setTimeout(() => reply(diagnostics()), 300);
        return true;
      }
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.words) setSavedWords(changes.words.newValue || []);
    if (area !== 'sync') return;
    const keys = Object.keys(changes).filter((k) => k in SL_DEFAULTS && settings[k] !== changes[k].newValue);
    if (!keys.length) return;
    for (const k of keys) settings[k] = changes[k].newValue === undefined ? SL_DEFAULTS[k] : changes[k].newValue;
    applySettings(keys);
    if (keys.includes('enabled')) hello();
  });

  // The overlay is pinned to the window, so it has to follow the picture when the page scrolls.
  window.addEventListener('scroll', () => ui && !ui.root.hidden && layout(), { capture: true, passive: true });
  hello();
  setInterval(pickVideo, 1000);
})();
