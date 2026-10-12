// Runs in the page's own JS world. Watches the player's network calls for the
// subtitle track list and hands it to the content script; reads nothing else.
(() => {
  'use strict';
  if (window.__scenelingoHooked) return;
  window.__scenelingoHooked = true;

  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  const SUB_RE = /\.(ttml2?|dfxp)(\?|#|$)/i;
  const API_RE = /PlaybackResources|playback\/prs/i;
  let lastTracks = null;
  let lastSeen = null;

  const post = (msg) => {
    try {
      window.postMessage(Object.assign({ source: PAGE }, msg), location.origin);
    } catch (e) { /* ignore */ }
  };

  function collect(node, out, depth) {
    if (!node || typeof node !== 'object' || depth > 12) return;
    if (Array.isArray(node)) {
      for (const v of node) collect(v, out, depth + 1);
      return;
    }
    for (const k of Object.keys(node)) {
      const v = node[k];
      if ((k === 'subtitleUrls' || k === 'forcedNarratives') && Array.isArray(v)) {
        for (const t of v) {
          if (!t || typeof t.url !== 'string') continue;
          out.push({
            url: t.url,
            languageCode: String(t.languageCode || ''),
            displayName: String(t.displayName || ''),
            type: String(t.type || ''),
            subtype: String(t.subtype || ''),
            forced: k === 'forcedNarratives',
          });
        }
      } else {
        collect(v, out, depth + 1);
      }
    }
  }

  function inspectObject(json) {
    const found = [];
    collect(json, found, 0);
    const seen = new Set();
    const tracks = found.filter((t) => !seen.has(t.url) && seen.add(t.url));
    if (!tracks.length) return;
    lastTracks = tracks;
    post({ type: 'tracks', tracks });
  }

  function inspectText(text) {
    if (typeof text !== 'string' || text.indexOf('subtitleUrls') === -1) return;
    try {
      inspectObject(origParse(text));
    } catch (e) { /* not JSON */ }
  }

  function sawSubtitle(url) {
    lastSeen = url;
    post({ type: 'sub-seen', url });
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    p.then((res) => {
      try {
        const url = res.url || '';
        if (SUB_RE.test(url)) return sawSubtitle(url);
        const ct = res.headers.get('content-type') || '';
        if (ct.includes('json') || API_RE.test(url)) res.clone().text().then(inspectText, () => {});
      } catch (e) { /* ignore */ }
    }, () => {});
    return p;
  };

  const xhrOpen = XMLHttpRequest.prototype.open;
  const xhrSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__slUrl = String(url);
    return xhrOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', () => {
      try {
        const url = this.responseURL || this.__slUrl || '';
        if (SUB_RE.test(url)) return sawSubtitle(url);
        const rt = this.responseType;
        if (rt === '' || rt === 'text') inspectText(this.responseText);
        else if (rt === 'json' && this.response) inspectObject(this.response);
        else if (rt === 'arraybuffer' && this.response && API_RE.test(url)) {
          inspectText(new TextDecoder().decode(this.response));
        }
      } catch (e) { /* ignore */ }
    });
    return xhrSend.apply(this, arguments);
  };

  // The player may read its responses in a way the hooks above do not see; the parsed
  // object still passes through here.
  const origParse = JSON.parse;
  JSON.parse = function (text) {
    const value = origParse.apply(this, arguments);
    try {
      if (typeof text === 'string' && text.length > 200 && text.indexOf('subtitleUrls') !== -1) inspectObject(value);
    } catch (e) { /* ignore */ }
    return value;
  };

  // The content script may come up after the first response has already passed.
  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.source !== EXT || e.data.type !== 'hello') return;
    if (lastTracks) post({ type: 'tracks', tracks: lastTracks });
    else if (lastSeen) post({ type: 'sub-seen', url: lastSeen });
  });
})();
