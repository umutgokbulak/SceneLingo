// Runs in YouTube's own JS world. Reports the caption tracks of the video in the player and the
// address the player itself uses to fetch them; reads nothing else.
(() => {
  'use strict';
  if (window.__scenelingoYouTube) return;
  window.__scenelingoYouTube = true;

  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  // A caption file is only served to a request that carries the player's own tokens. So the
  // address of a request the player made is kept for each video, and the other languages of
  // that video are asked for at the same address.
  const seen = new Map(); // video id -> address of a caption request the player made
  const tries = new Map(); // video id -> how often, and when, its captions were switched on to see such a request
  const TRACK_PARAMS = ['v', 'lang', 'kind', 'tlang', 'name', 'fmt'];
  let wanted = false; // the content script is showing subtitles and needs the files
  let lastSent = '';

  const post = (msg) => {
    try {
      window.postMessage(Object.assign({ source: PAGE }, msg), location.origin);
    } catch (e) { /* ignore */ }
  };

  function noteRequest(url) {
    try {
      const u = new URL(String(url), location.href);
      if (u.pathname !== '/api/timedtext' || !u.searchParams.get('pot')) return;
      seen.set(u.searchParams.get('v'), u.href);
      setTimeout(report, 0);
    } catch (e) { /* not an address */ }
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    noteRequest(url);
    return xhrOpen.apply(this, arguments);
  };
  const origFetch = window.fetch;
  window.fetch = function (input) {
    noteRequest(input && typeof input === 'object' && 'url' in input ? input.url : input);
    return origFetch.apply(this, arguments);
  };

  // The address of one track: the track's own, plus what the player added to the request it made.
  function address(baseUrl, from) {
    const u = new URL(baseUrl, location.href);
    for (const [k, v] of new URL(from).searchParams) {
      if (!TRACK_PARAMS.includes(k) && !u.searchParams.has(k)) u.searchParams.set(k, v);
    }
    u.searchParams.set('fmt', 'json3');
    return u.href;
  }

  const label = (name) => (name && (name.simpleText || (name.runs && name.runs[0] && name.runs[0].text))) || '';

  function report() {
    const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
    if (!player || typeof player.getPlayerResponse !== 'function') return;
    let response;
    try {
      response = player.getPlayerResponse();
    } catch (e) {
      return;
    }
    const id = response && response.videoDetails && response.videoDetails.videoId;
    if (!id) return;
    const list = (((response.captions || {}).playerCaptionsTracklistRenderer || {}).captionTracks || []).filter((t) => t && typeof t.baseUrl === 'string');
    const from = seen.get(id);
    const tracks = list.map((t) => ({
      id: id + ':' + t.languageCode + ':' + (t.kind || ''),
      url: from ? address(t.baseUrl, from) : '',
      languageCode: String(t.languageCode || ''),
      displayName: label(t.name),
      auto: t.kind === 'asr',
    }));
    const msg = { type: 'yt-tracks', videoId: id, ready: !!from || !tracks.length, tracks };
    const key = JSON.stringify(msg);
    if (key !== lastSent) {
      lastSent = key;
      post(msg);
    }
    // No such request seen for this video: its captions are off, or the player asked before it
    // had its tokens and got nothing. Switching the captions on (off and on, if they are on)
    // makes it ask again; a few tries, a few seconds apart, cover a player that is still starting.
    // Not during an advertisement, which has captions of its own.
    if (from || !tracks.length || !wanted || player.classList.contains('ad-showing') || typeof player.toggleSubtitlesOn !== 'function') return;
    const tried = tries.get(id) || { count: 0, at: 0 };
    if (tried.count >= 6 || Date.now() - tried.at < 4000) return;
    tries.set(id, { count: tried.count + 1, at: Date.now() });
    try {
      if (typeof player.isSubtitlesOn === 'function' && player.isSubtitlesOn()) player.toggleSubtitles();
      player.toggleSubtitlesOn();
    } catch (e) { /* the captions module is not ready yet; the next try is a few seconds away */ }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== EXT || e.data.type !== 'hello') return;
    wanted = !!e.data.captions;
    lastSent = '';
    report();
  });
  setInterval(report, 1000);
})();
