// Reads subtitle files, and finds the subtitles of a video on a page that is not known by name.
// Runs with the content script; the parsing that needs neither a page nor the network is in core.js.
const Subtitles = (() => {
  'use strict';
  const { parseTime, parseVtt, parseAss, parseJson3, cueText, guessLang, parseHlsMaster, parseHlsMedia, vttOffset, standaloneFiles } = SubtitleCore;
  const SUB_FILE = /\.(vtt|webvtt|srt|ttml2?|dfxp|ass|ssa)(\?|#|$)/i;
  const MANIFEST = /\.(m3u8|mpd)(\?|#|$)/i;
  const MAX_PIECES = 1500; // of one subtitle track of a stream
  const cache = new Map(); // address -> promise of cues

  // ---------- formats ----------

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
    if (doc.getElementsByTagName('parsererror').length) throw new Error(slT('errFile'));
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
  function parse(text) {
    const head = text.slice(0, 400).replace(/^﻿/, '').trimStart();
    if (head[0] === '{') return parseJson3(JSON.parse(text));
    if (head[0] === '<') return parseTTML(text);
    if (/^\[script info\]/i.test(head) || /^Dialogue:/m.test(text.slice(0, 6000))) return parseAss(text);
    return parseVtt(text);
  }

  // What a DASH manifest says about subtitles: the tracks that are one whole file each (the
  // ones cut into pieces are packed in a way that is not read here), and how long the film is.
  function parseDash(text, base) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    const mpd = doc.documentElement;
    if (!mpd || mpd.localName !== 'MPD' || doc.getElementsByTagName('parsererror').length) return null;
    const children = (node, name) => [...node.children].filter((c) => c.localName === name);
    const under = (node, from) => {
      const own = children(node, 'BaseURL')[0];
      try {
        return own && own.textContent.trim() ? new URL(own.textContent.trim(), from).href : from;
      } catch (e) {
        return from;
      }
    };
    const tracks = [];
    for (const period of children(mpd, 'Period')) {
      for (const set of children(period, 'AdaptationSet')) {
        for (const rep of children(set, 'Representation')) {
          const mime = rep.getAttribute('mimeType') || set.getAttribute('mimeType') || '';
          const isText = /^text\/|ttml/.test(mime) || set.getAttribute('contentType') === 'text';
          const whole = children(rep, 'BaseURL').length && !/mp4/.test(mime) && ![rep, set].some((n) => children(n, 'SegmentTemplate').length || children(n, 'SegmentList').length);
          if (!isText || !whole) continue;
          const roles = children(set, 'Role').map((r) => r.getAttribute('value')).join(' ');
          const lang = set.getAttribute('lang') || rep.getAttribute('lang') || '';
          const label = children(set, 'Label')[0];
          tracks.push({
            url: under(rep, under(set, under(period, under(mpd, base)))),
            languageCode: lang,
            displayName: (label && label.textContent.trim()) || lang,
            forced: /forced/.test(roles),
            type: /caption/.test(roles) ? 'cc' : '',
            whole: true,
          });
        }
      }
    }
    const d = /^PT(?:([\d.]+)H)?(?:([\d.]+)M)?(?:([\d.]+)S)?$/.exec(mpd.getAttribute('mediaPresentationDuration') || '');
    return { tracks, total: d ? (+d[1] || 0) * 3600 + (+d[2] || 0) * 60 + (+d[3] || 0) : 0 };
  }

  // ---------- loading ----------

  const fetchText = (url) =>
    fetch(url).then((r) => {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });

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

  // A file that holds pictures for the seek bar rather than words.
  const isPictureList = (cues) => cues.length > 0 && cues.filter((c) => /#xywh=|\.(jpe?g|png|webp)\b/i.test(c.text)).length > cues.length / 2;

  // One subtitle track of a stream: a playlist of WebVTT pieces, fetched a few at a time and put
  // together. A piece carries the lines on screen during its stretch of the film, so a line that
  // runs over the join is in both pieces.
  async function loadStream(url, progress) {
    const list = parseHlsMedia(await fetchText(url), url);
    if (!list.ended) throw new Error(slT('errLive'));
    if (list.binary || !list.segments.length || list.segments.length > MAX_PIECES) throw new Error(slT('errStream'));
    const texts = new Array(list.segments.length);
    let next = 0;
    let done = 0;
    let lost = 0;
    const worker = async () => {
      while (next < texts.length) {
        const i = next++;
        // A piece that does not come is asked for once more, then done without: a gap of a few
        // lines is better than no subtitles.
        texts[i] = await fetchText(list.segments[i]).catch(() => fetchText(list.segments[i])).catch(() => (lost++, ''));
        if (progress) progress(++done / texts.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, texts.length) }, worker));
    if (lost > texts.length / 5) throw new Error(slT('errPieces'));
    // Each piece may keep a clock of its own; they are all brought to the first one's.
    const clocks = texts.map(vttOffset);
    const first = clocks.find((c) => c !== null) || 0;
    const all = [];
    texts.forEach((text, i) => {
      const shift = clocks[i] === null ? 0 : clocks[i] - first;
      for (const c of parseVtt(text)) all.push({ start: c.start + shift, end: c.end + shift, text: c.text });
    });
    all.sort((a, b) => a.start - b.start);
    const cues = [];
    for (const c of all) {
      // The same words again while they are still on screen: the other half of a line cut at a join.
      const same = cues.slice(-3).find((k) => k.text === c.text && c.start <= k.end + 0.05);
      if (same) same.end = Math.max(same.end, c.end);
      else cues.push(c);
    }
    if (stream && stream.tracks.some((t) => t.url === url)) stream.total = list.total;
    return cues;
  }

  // The cues of a track. `progress` is told how far a track that comes in pieces has got.
  function load(track, progress) {
    if (track.cues) return Promise.resolve(track.cues);
    if (track.textTrack && !track.file) return Promise.resolve(readTextTrack(track.textTrack));
    if (!cache.has(track.url)) {
      const job = track.stream && !track.whole
        ? loadStream(track.url, progress)
        : fetchText(track.url).then((text) => {
            const cues = parse(text);
            if (!isPictureList(cues)) return cues;
            rejected.add(track.url);
            return [];
          });
      job.catch(() => cache.delete(track.url));
      cache.set(track.url, job);
    }
    if (!track.textTrack) return cache.get(track.url);
    // The file may not be ours to fetch, or not in a form that can be read; what the video
    // itself has loaded of the track is.
    return cache.get(track.url).catch(() => {
      track.file = false;
      return readTextTrack(track.textTrack);
    });
  }

  // ---------- what a page has loaded ----------

  const files = []; // subtitle files this frame has fetched, oldest first
  const manifests = []; // stream playlists it has fetched and that have not been looked at
  const looked = new Set(); // playlists that need no look: read already, or part of a stream that was
  const rejected = new Set(); // files that turned out not to be subtitles
  let stream = null; // the latest stream that lists subtitle tracks: { url, tracks, total }
  let budget = 12; // playlists that may still be fetched to look for one
  let busy = false;

  const bare = (url) => String(url).split(/[?#]/)[0];

  function note(url) {
    if (MANIFEST.test(url)) {
      // A live stream fetches its playlists again and again; each is kept once, and not many.
      if (!looked.has(bare(url)) && manifests.length < 40 && !manifests.some((m) => bare(m) === bare(url))) manifests.push(url);
    } else if (SUB_FILE.test(url) && !files.includes(url)) {
      files.push(url);
      if (files.length > 400) files.shift();
    }
  }

  // A player has to fetch its subtitles, and the browser keeps the addresses of what a page
  // fetches. Watching that list finds them without touching the page's own scripts.
  function watch() {
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) note(entry.name);
      }).observe({ type: 'resource', buffered: true });
    } catch (e) { /* no such list on this page */ }
  }

  // Looks at one playlist the page has fetched, to see whether it is a stream's manifest (an HLS
  // master playlist or a DASH description) that lists subtitle tracks. Resolves to true when the
  // subtitles on offer have changed.
  async function look() {
    if (busy || budget <= 0) return false;
    let url;
    do {
      url = manifests.shift();
    } while (url && looked.has(bare(url)));
    if (!url) return false;
    looked.add(bare(url));
    busy = true;
    budget--;
    try {
      const text = await fetchText(url);
      if (text.trimStart()[0] === '<') {
        const dash = parseDash(text, url);
        if (!dash || !dash.tracks.length) return false;
        stream = { url, tracks: dash.tracks, total: dash.total };
        return true;
      }
      const found = parseHlsMaster(text, url);
      if (!found.master) return false;
      // Its other playlists hold pictures and sound, or are read when a track is loaded.
      for (const child of found.children) looked.add(bare(child));
      if (!found.tracks.length) return false;
      stream = { url, tracks: found.tracks, total: 0 };
      return true;
    } catch (e) {
      return false;
    } finally {
      busy = false;
    }
  }

  // Whether the stream whose subtitles are known is the one playing in this video: an
  // advertisement, or the video before this one, has a different length.
  function fits(video) {
    if (!stream || !stream.total || !video || !isFinite(video.duration) || !video.duration) return true;
    return Math.abs(stream.total - video.duration) <= Math.max(8, video.duration * 0.05);
  }

  // All the videos of the page. Players built as custom elements keep theirs in a shadow tree,
  // which an ordinary search does not enter.
  let shadowTurn = 0;
  let inShadow = [];
  function videos() {
    const found = [...document.querySelectorAll('video')];
    if (found.length) return found;
    // That search walks the whole page, so it is made on every third call only.
    if (shadowTurn++ % 3 === 0) {
      inShadow = [];
      const enter = (host, depth) => {
        let root = host.shadowRoot;
        try {
          if (!root && typeof chrome !== 'undefined' && chrome.dom && chrome.dom.openOrClosedShadowRoot) root = chrome.dom.openOrClosedShadowRoot(host);
        } catch (e) { /* not an element that can have one */ }
        if (!root || depth > 4) return;
        inShadow.push(...root.querySelectorAll('video'));
        for (const n of root.querySelectorAll('*')) if (n.localName.includes('-')) enter(n, depth + 1);
      };
      for (const n of document.querySelectorAll('*')) if (n.localName.includes('-')) enter(n, 0);
    }
    return inShadow.filter((v) => v.isConnected);
  }

  const captionTracks = (video) => [...(video.textTracks || [])].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
  const sameLanguage = (a, b) => !!a && !!b && String(a).toLowerCase().split(/[-_]/)[0] === String(b).toLowerCase().split(/[-_]/)[0];

  // The subtitles of a plain video, from the most complete source there is:
  // the stream's own list of subtitle tracks, the files its <track> elements point at, subtitle
  // files the page has fetched (a player that draws its own subtitles still has to load them),
  // and last the text tracks as the video has them, which fill up only as it plays.
  function pageTracks(video) {
    const own = captionTracks(video);
    if (stream && stream.tracks.length && fits(video)) {
      return stream.tracks.map((t) => ({ ...t, id: 'stream:' + bare(t.url), stream: true, file: true, textTrack: own.find((tt) => sameLanguage(tt.language, t.languageCode)) || null }));
    }
    const elements = [...video.querySelectorAll('track')];
    const list = own.map((tt, i) => {
      const element = elements.find((t) => t.track === tt);
      const src = element && /^(https?|blob):/.test(element.src) && !rejected.has(element.src) ? element.src : '';
      return {
        url: src || 'texttrack:' + i,
        id: 'texttrack:' + i + ':' + tt.language + ':' + tt.label,
        languageCode: tt.language || guessLang(tt.label),
        displayName: tt.label || tt.language,
        textTrack: tt,
        file: !!src,
      };
    });
    if (list.some((t) => t.file)) return list;
    const loose = standaloneFiles(files.filter((url) => !rejected.has(url)));
    if (loose.length) {
      return loose.map((url) => ({ url, id: 'file:' + bare(url), languageCode: guessLang(url), displayName: decodeName(bare(url).split('/').slice(-2).join('/')) }));
    }
    return list;
  }

  function decodeName(name) {
    try {
      return decodeURIComponent(name);
    } catch (e) {
      return name;
    }
  }

  // For the diagnostics: what was found on the page, without the tokens addresses carry.
  function describe(video) {
    const short = (url) => {
      try {
        const u = new URL(url, location.href);
        return u.protocol === 'data:' || u.protocol === 'blob:' ? u.protocol : u.host + (u.pathname.length > 70 ? '/…' + u.pathname.slice(-70) : u.pathname);
      } catch (e) {
        return String(url).slice(0, 60);
      }
    };
    const lines = [];
    const tts = [...(video.textTracks || [])];
    if (tts.length) lines.push('  text tracks: ' + tts.map((t) => [t.kind, t.language, t.label, t.mode, t.cues ? t.cues.length : '-'].join(':')).join(' | ').slice(0, 600));
    const sources = [...video.querySelectorAll('track')].map((t) => t.src).filter(Boolean);
    if (sources.length) lines.push('  <track> files: ' + sources.slice(0, 6).map(short).join(' | '));
    lines.push('  stream: ' + (stream ? short(stream.url) + ' with ' + stream.tracks.length + ' subtitle tracks' + (fits(video) ? '' : ' (not this video: ' + Math.round(stream.total) + ' s)') : 'none') + ', playlists waiting: ' + manifests.length + ', looks left: ' + budget);
    lines.push('  subtitle files seen: ' + files.length + (files.length ? ' — ' + files.slice(-5).map(short).join(' | ') : ''));
    lines.push('  video source: ' + short(video.currentSrc || ''));
    return lines;
  }

  return {
    parse,
    load,
    forget: () => cache.clear(),
    readTextTrack,
    watch,
    look,
    fits,
    // A new video on the same page may bring a new stream; allow as many looks again.
    renew: () => (budget = 12),
    videos,
    hasCaptions: (video) => captionTracks(video).length > 0,
    pageTracks,
    describe,
  };
})();
