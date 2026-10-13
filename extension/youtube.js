// Runs in YouTube's own JS world. Reports the caption tracks of the video in the player and the
// address the player itself uses to fetch them; reads nothing else.
(() => {
  'use strict';
  if (window.__scenelingoYouTube) return;
  window.__scenelingoYouTube = true;

  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  // A caption file is only served to a request that carries the player's own tokens; the address
  // in the page's data comes back empty. So the address of a request the player made, and that
  // came back with captions, is kept for each video, and the other languages of that video are
  // asked for at the same address.
  const seen = new Map(); // video id -> address of a caption request that was answered with captions
  const tries = new Map(); // video id -> how often, and when, its captions were switched on to see such a request
  const TRACK_PARAMS = ['v', 'lang', 'kind', 'tlang', 'name', 'fmt'];
  const MAX_TRIES = 8;
  const notes = []; // what has happened, for the diagnostics
  let wanted = false; // the content script is showing subtitles and needs the files
  let lastSent = '';

  const post = (msg) => {
    try {
      window.postMessage(Object.assign({ source: PAGE }, msg), location.origin);
    } catch (e) { /* ignore */ }
  };

  function note(text) {
    notes.push(Math.round(performance.now() / 1000) + 's ' + text);
    if (notes.length > 30) notes.shift();
    post({ type: 'yt-notes', notes });
  }

  const captionUrl = (url) => {
    try {
      const u = new URL(String(url), location.href);
      return u.pathname === '/api/timedtext' ? u : null;
    } catch (e) {
      return null;
    }
  };

  // The player's caption request has been answered with `size` characters.
  function answered(u, size) {
    const id = u.searchParams.get('v');
    note('caption request ' + id + ' ' + u.searchParams.get('lang') + (u.searchParams.get('pot') ? ' with' : ' without') + ' token: ' + size);
    if (!(size > 0)) return;
    seen.set(id, u.href);
    setTimeout(report, 0);
  }

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__slCaptions = captionUrl(url);
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const u = this.__slCaptions;
    if (u) {
      this.addEventListener('loadend', () => {
        let size = 0;
        try {
          const text = this.responseType === '' || this.responseType === 'text';
          size = text ? this.responseText.length : this.response ? this.response.byteLength || this.response.size || 1 : 0;
        } catch (e) { /* nothing to read */ }
        answered(u, this.status === 200 ? size : 0);
      });
    }
    return xhrSend.apply(this, arguments);
  };
  const origFetch = window.fetch;
  window.fetch = function (input) {
    const result = origFetch.apply(this, arguments);
    const u = captionUrl(input && typeof input === 'object' && 'url' in input ? input.url : input);
    if (u) {
      result.then((res) => res.clone().text().then((text) => answered(u, res.ok ? text.length : 0)), () => answered(u, 0)).catch(() => {});
    }
    return result;
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
      note('video ' + id + ': ' + tracks.length + ' caption tracks, ' + (from ? 'address known' : 'no address yet'));
      post(msg);
    }
    // No such request seen for this video: its captions are off, or the player asked before it
    // had its tokens and got nothing. Switching the captions on (off and on, if they are on)
    // makes it ask again; a few tries, a few seconds apart, cover a player that is still starting.
    // Only while the video is playing: a player that has not started does not fetch captions, and
    // an advertisement has captions of its own.
    if (from || !tracks.length || !wanted || player.classList.contains('ad-showing') || typeof player.toggleSubtitlesOn !== 'function') return;
    const video = player.querySelector('video');
    if (!video || video.paused || video.readyState < 2) return;
    const tried = tries.get(id) || { count: 0, at: 0 };
    if (tried.count >= MAX_TRIES || Date.now() - tried.at < 4000) return;
    tries.set(id, { count: tried.count + 1, at: Date.now() });
    try {
      const on = typeof player.isSubtitlesOn === 'function' && player.isSubtitlesOn();
      note('try ' + (tried.count + 1) + ': captions were ' + (on ? 'on' : 'off') + ', switching them on');
      if (on) player.toggleSubtitles();
      player.toggleSubtitlesOn();
    } catch (e) {
      note('could not switch the captions on: ' + e); // the captions module is not ready yet; the next try is a few seconds away
    }
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== EXT || e.data.type !== 'hello') return;
    wanted = !!e.data.captions;
    lastSent = '';
    note('content script is up, subtitles ' + (wanted ? 'wanted' : 'not wanted'));
    report();
  });
  setInterval(report, 1000);
})();
