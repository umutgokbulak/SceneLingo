// Runs in Netflix's own JS world. Netflix keeps its subtitles to itself: they are named only in the
// "manifest" its player asks for when a title starts, and only in the formats the player asks for.
// So the player's request is made to ask for WebVTT and TTML too (formats its own players on other
// devices use), and the tracks of the answer are handed to the content script. Seeking is done
// through the player as well: Netflix stops playback when the video's clock is set from outside.
(() => {
  'use strict';
  if (window.__scenelingoNetflix) return;
  window.__scenelingoNetflix = true;

  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  // Text formats, the most readable first. Netflix's own player on the web uses images for some
  // languages and a format of its own; these two are text it can always serve.
  const FORMATS = ['webvtt-lssdh-ios8', 'dfxp-ls-sdh', 'simplesdh', 'imsc1.1'];
  const byTitle = new Map(); // title id -> its tracks

  const post = (msg) => {
    try {
      window.postMessage(Object.assign({ source: PAGE }, msg), location.origin);
    } catch (e) { /* ignore */ }
  };

  // The title being watched: /watch/81234567.
  const watching = () => (/\/watch\/(\d+)/.exec(location.pathname) || [])[1] || '';

  function first(downloadable) {
    if (!downloadable) return '';
    if (downloadable.downloadUrls) return Object.values(downloadable.downloadUrls)[0] || '';
    if (Array.isArray(downloadable.urls) && downloadable.urls[0]) return downloadable.urls[0].url || downloadable.urls[0].cdn_url || '';
    return '';
  }

  // The subtitle tracks of a manifest, each with the address of its most readable file.
  function tracksOf(manifest) {
    const out = [];
    for (const t of manifest.timedtexttracks || []) {
      if (!t || t.isNoneTrack || !t.ttDownloadables) continue;
      const format = FORMATS.find((f) => first(t.ttDownloadables[f]));
      if (!format) continue;
      out.push({
        url: first(t.ttDownloadables[format]),
        languageCode: String(t.language || ''),
        displayName: String(t.languageDescription || t.language || ''),
        type: t.rawTrackType === 'closedcaptions' ? 'sdh' : '',
        subtype: '',
        forced: !!t.isForcedNarrative,
      });
    }
    return out;
  }

  function show() {
    const tracks = byTitle.get(watching());
    if (tracks) post({ type: 'tracks', tracks });
  }

  // Manifests come for the title being watched, and also, ahead of time, for the next episode:
  // they are kept by title, and the tracks of the one on screen are the ones handed on.
  function inspect(value) {
    const m = value && (value.result || value);
    if (!m || !Array.isArray(m.timedtexttracks)) return;
    const id = String(m.movieId || (m.result && m.result.movieId) || '');
    const tracks = tracksOf(m);
    if (!id || !tracks.length) return;
    byTitle.set(id, tracks);
    if (id === watching()) show();
  }

  // The answer is read as text and parsed, or read as JSON straight from the response: both ways
  // are watched.
  const origParse = JSON.parse;
  JSON.parse = function (text) {
    const value = origParse.apply(this, arguments);
    try {
      if (typeof text === 'string' && text.length > 500 && text.indexOf('timedtexttracks') !== -1) inspect(value);
    } catch (e) { /* ignore */ }
    return value;
  };
  const origJson = Response.prototype.json;
  Response.prototype.json = function () {
    return origJson.apply(this, arguments).then((value) => {
      try {
        inspect(value);
      } catch (e) { /* ignore */ }
      return value;
    });
  };
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === 'json') inspect(this.response);
      } catch (e) { /* ignore */ }
    });
    return xhrSend.apply(this, arguments);
  };

  // The player's request for a manifest: it asks for every subtitle and audio track, and for the
  // text formats above.
  const origStringify = JSON.stringify;
  JSON.stringify = function (value) {
    try {
      const params = value && value.params;
      if (params && Array.isArray(params.profiles) && (value.url === 'manifest' || /manifest|licensedManifest/i.test(String(value.url || '')) || params.viewableId)) {
        for (const f of FORMATS) if (!params.profiles.includes(f)) params.profiles.push(f);
        params.showAllSubDubTracks = true;
      }
    } catch (e) { /* ignore */ }
    return origStringify.apply(this, arguments);
  };

  // Netflix's player, for seeking: setting the video's clock from outside stops playback there.
  function player() {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = api.getAllPlayerSessionIds();
      return api.getVideoPlayerBySessionId(ids[ids.length - 1]);
    } catch (e) {
      return null;
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== EXT) return;
    // The content script may come up after the manifest has already passed.
    if (e.data.type === 'hello') show();
    else if (e.data.type === 'nf-seek' && typeof e.data.time === 'number') {
      const p = player();
      if (p) p.seek(Math.max(0, Math.round(e.data.time * 1000)));
      else post({ type: 'nf-noplayer' });
    }
  });

  // Netflix goes from title to title without loading a new page: the tracks follow.
  let last = location.pathname;
  setInterval(() => {
    if (location.pathname === last) return;
    last = location.pathname;
    if (byTitle.has(watching())) show();
    else post({ type: 'tracks', tracks: [], empty: true });
  }, 700);
})();
