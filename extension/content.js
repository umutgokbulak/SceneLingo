(() => {
  'use strict';
  if (window.top !== window || window.__scenelingoContent) return;
  window.__scenelingoContent = true;

  const { parseTime, lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch } = SubtitleCore;
  const PAGE = 'scenelingo:page';
  const EXT = 'scenelingo:ext';
  const CHUNK = 20; // cues per machine-translation request
  const SLOW_RATE = 0.7; // playback speed of the turtle buttons, on top of the service's slow voice
  const NATIVE_SEL = '.atvwebplayersdk-captions-text';
  const WAITING = 'Altyazı bekleniyor… Videoyu başlat; gelmezse Prime oynatıcısında altyazıyı bir kez aç.';

  let settings = { ...SL_DEFAULTS };
  let savedWords = new Set();
  let tracks = [];
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
  let dict = null; // listening practice for one cue: { idx, checked }
  const dictStats = { ok: 0, total: 0 };
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

  const send = (msg) =>
    new Promise((resolve) => {
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

  function loadCues(url) {
    if (!cueCache.has(url)) {
      const job = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error('HTTP ' + r.status);
          return r.text();
        })
        .then(parseTTML);
      job.catch(() => cueCache.delete(url));
      cueCache.set(url, job);
    }
    return cueCache.get(url);
  }

  // ---------- track selection ----------

  const trackScore = (t) =>
    (t.forced ? 4 : 0) + (/commentary|descri/i.test(t.subtype) ? 2 : 0) + (/sdh|cc/i.test(t.type) ? 1 : 0);

  const pickTrack = (lang) =>
    tracks.filter((t) => langOf(t.languageCode) === lang).sort((a, b) => trackScore(a) - trackScore(b))[0] || null;

  function trackLabel(t) {
    let label = t.displayName || t.languageCode || 'Altyazı';
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
    return { kind: 'mt' };
  }

  async function reload() {
    const gen = ++loadGen;
    primary = null;
    secondary = { kind: 'off' };
    shown = { idx: -2, sec: null };
    syncSamples = [];
    autoPausedFor = -1;
    const pt = resolvePrimary();
    if (!pt) {
      setStatus(WAITING);
      afterLoad();
      return;
    }
    setStatus('Altyazı yükleniyor…');
    try {
      const cues = (await loadCues(pt.url)).map((c) => ({ ...c }));
      const sec = resolveSecondary(pt);
      if (sec.kind === 'track') {
        try {
          sec.cues = await loadCues(sec.track.url);
          alignTranslation(cues, sec.cues);
        } catch (e) {
          sec.kind = 'mt';
        }
      }
      if (gen !== loadGen) return;
      primary = { track: pt, cues, requested: new Set() };
      secondary = sec;
      setStatus(cues.length ? '' : 'Bu altyazı dosyası boş.');
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

  function setTracks(list) {
    if (!Array.isArray(list)) return;
    const clean = [];
    for (const t of list) {
      if (!t || typeof t.url !== 'string') continue;
      let proto;
      try {
        proto = new URL(t.url, location.href).protocol;
      } catch (e) {
        continue;
      }
      if (proto !== 'https:' && proto !== location.protocol) continue;
      clean.push({
        url: t.url,
        languageCode: String(t.languageCode || ''),
        displayName: String(t.displayName || ''),
        type: String(t.type || ''),
        subtype: String(t.subtype || ''),
        forced: !!t.forced,
      });
    }
    if (!clean.length) return;
    const key = (l) => l.map((t) => t.url.split('?')[0]).sort().join('|');
    if (tracks.length && key(clean) === key(tracks)) return;
    tracks = clean;
    seenUrl = null;
    choice = { primary: 'auto', secondary: 'auto' };
    offset = 0;
    manualOffset = false;
    cueCache.clear();
    reload();
  }

  // ---------- machine translation ----------

  function ensureMT(idx) {
    if (!primary || secondary.kind !== 'mt') return;
    const c = Math.floor(Math.max(0, idx) / CHUNK);
    requestChunk(c);
    requestChunk(c + 1);
  }

  function requestChunk(c) {
    const p = primary;
    if (p.requested.has(c)) return;
    const slice = p.cues.slice(c * CHUNK, c * CHUNK + CHUNK);
    if (!slice.length) return;
    p.requested.add(c);
    send({ type: 'translate', texts: slice.map((x) => x.text), sl: p.track.languageCode, tl: settings.nativeLang }).then((res) => {
      if (!res.ok) {
        if (primary === p) setStatus('Çeviri alınamadı: ' + res.error);
        setTimeout(() => p.requested.delete(c), 10000);
        return;
      }
      slice.forEach((cue, k) => {
        cue.tr = res.result[k] || '';
      });
      if (primary !== p) return;
      if (status.startsWith('Çeviri alınamadı')) setStatus('');
      if (panelRows) slice.forEach((cue, k) => setRowTranslation(c * CHUNK + k));
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
      if (dict && idx !== dict.idx) closeDictation(false);
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
    if (!video || !settings.enabled || !primary) {
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
    const practise = due >= 0 && settings.dictation && spokenWords(cues[due].text).length > 0;
    if (due >= 0 && (settings.autoPause || practise) && !video.paused && autoPausedFor !== due) {
      autoPausedFor = due;
      video.pause();
      if (due !== idx) {
        // A late frame skipped the pause window: step back to just before the end of that line.
        t = cues[due].end - 0.05;
        idx = due;
        ownSeek = true;
        video.currentTime = t + offset;
      }
      if (practise) openDictation(due);
    }
    lastIdx = idx;

    let sec = '';
    if (secondary.kind === 'track') {
      const j = findCue(secondary.cues, t);
      if (j >= 0) sec = secondary.cues[j].text;
      // The two tracks are timed separately; keep a translation up for as long as the original line shows.
      else if (idx >= 0) sec = cues[idx].tr || '';
    } else if (secondary.kind === 'mt') {
      ensureMT(idx >= 0 ? idx : lastStarted(cues, t));
      if (idx >= 0) sec = cues[idx].tr || '';
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
    if (r.width < 300 || r.height < 150) {
      root.hidden = true;
      return;
    }
    const fs = document.fullscreenElement;
    const host = fs && fs !== video && fs.contains(video) ? fs : document.body;
    if (root.parentNode !== host) host.appendChild(root);
    root.hidden = false;
    ui.subs.hidden = !settings.enabled;
    root.classList.toggle('sl-dictation', !!settings.dictation);
    const css =
      `left:${Math.round(r.left)}px;top:${Math.round(r.top)}px;width:${Math.round(r.width)}px;height:${Math.round(r.height)}px;` +
      `--sl-fs:${Math.max(14, (r.height * 0.042 * settings.fontSize) / 100).toFixed(1)}px;--sl-bottom:${settings.bottomOffset}%;`;
    if (root.style.cssText !== css) root.style.cssText = css;
  }

  function applyNativeHiding() {
    document.documentElement.classList.toggle('sl-hide-native', !!(settings.enabled && settings.hideNative && primary));
  }

  function toast(text) {
    if (!ui) return;
    ui.toast.textContent = text;
    ui.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      ui.toast.hidden = true;
    }, 1600);
  }

  function setStatus(text) {
    status = text;
    if (ui) {
      ui.status.textContent = text;
      ui.status.hidden = !text;
    }
  }

  // ---------- sync with the player's own captions ----------

  // Prime's video clock can run ahead of the subtitle timeline (e.g. after ads). When the
  // player's own captions are on, their appearance tells us the real offset.
  function calibrate() {
    if (manualOffset || !primary || !video || video.paused) return;
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
    video.currentTime = primary.cues[i].start + offset + 0.01;
    autoPausedFor = -1;
    lastIdx = -1;
    hoverPaused = false;
    if (video.paused) video.play().catch(() => {});
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
    for (const v of document.querySelectorAll('video')) {
      if (!v.readyState && !v.currentSrc) continue;
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) {
        best = v;
        bestArea = area;
      }
    }
    video = best;
    if (video && !ui && document.body) buildUI();
  }

  // ---------- word popup ----------

  // `anchor` is the word element, or the selected range when `text` is a phrase.
  async function openPopup(anchor, pin, text) {
    const word = text || anchor.textContent;
    const cue = primary && primary.cues[shown.idx];
    const lang = primary ? primary.track.languageCode : '';
    if (video && !video.paused && (pin || settings.hoverPause)) {
      video.pause();
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
    const listen = el('button', 'sl-pop-listen', '🔊');
    listen.title = 'Dinle';
    listen.addEventListener('click', () => speak(word));
    const slow = el('button', 'sl-pop-listen', '🐢');
    slow.title = 'Yavaş dinle';
    slow.addEventListener('click', () => speak(word, true));
    const ipa = el('span', 'sl-pop-ipa');
    const save = el('button', 'sl-pop-save');
    const body = el('div', 'sl-pop-body', '…');
    const paintSave = () => {
      const on = savedWords.has(word.toLowerCase());
      save.textContent = on ? '★ Kaydedildi' : '☆ Kaydet';
      save.classList.toggle('sl-on', on);
    };
    paintSave();
    btns.append(listen, slow, save);
    const title = el('span', 'sl-pop-title');
    title.append(el('span', 'sl-pop-word', word), ipa);
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
        context: cue ? cue.text.replace(/\n/g, ' ') : '',
        lang: langOf(lang),
        title: document.title,
        added: Date.now(),
      }).then(paintSave);
    });

    const res = await lookup(word, lang);
    if (token !== popupToken) return;
    body.textContent = '';
    if (!res.ok) {
      body.textContent = 'Çeviri alınamadı: ' + res.error;
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
      for (const d of info.dict || []) labelled('sl-pop-dict', d.pos, d.terms.join(', '));
      (info.defs || []).slice(0, 2).forEach((d, i) => {
        labelled('sl-pop-def', d.pos, d.text);
        if (d.example && i === 0) body.append(el('div', 'sl-pop-ex', '“' + d.example + '”'));
      });
      if (info.synonyms && info.synonyms.length) labelled('sl-pop-syn', 'eş anlamlı', info.synonyms.join(', '));
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
    // Sit above the whole subtitle box so the other lines stay readable.
    ui.popup.style.bottom = rr.bottom - ui.box.getBoundingClientRect().top + 8 + 'px';
  }

  function closePopup(mayResume) {
    if (!ui || ui.popup.hidden) return false;
    popupToken++;
    popupWord = null;
    popupPinned = false;
    clearTimeout(closeTimer);
    ui.popup.hidden = true;
    if (mayResume && hoverPaused && !ui.box.matches(':hover')) resume();
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

  async function speak(text, slow) {
    if (!text) return;
    const token = ++speakToken;
    const lang = speechLang();
    stopSpeech();
    try {
      if (!audioCtx) {
        audioCtx = new AudioContext();
        audioGain = audioCtx.createGain();
        const limiter = audioCtx.createDynamicsCompressor();
        limiter.threshold.value = -6;
        limiter.knee.value = 0;
        limiter.ratio.value = 20;
        limiter.attack.value = 0.002;
        audioGain.connect(limiter).connect(audioCtx.destination);
      }
      const buffer = await recordedSpeech(text, lang, !!slow);
      if (token === speakToken) playBuffer(buffer);
    } catch (e) {
      if (token === speakToken) synthSpeech(text, lang, !!slow);
    }
  }

  function toggleSaved(entry) {
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

  function cueSentence() {
    const cue = primary && primary.cues[shown.idx];
    return cue ? cue.text.replace(/\s*\n\s*/g, ' ') : '';
  }

  function paintSentenceStar() {
    if (!ui) return;
    const on = savedWords.has(cueSentence().toLowerCase());
    ui.starBtn.textContent = on ? '★' : '☆';
    ui.starBtn.classList.toggle('sl-on', on);
  }

  function speakSentence(slow) {
    const text = cueSentence();
    if (!text) return;
    if (video && !video.paused) {
      video.pause();
      hoverPaused = true;
    }
    speak(text, slow);
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

  // ---------- listening practice ----------

  function openDictation(idx) {
    if (!dict || dict.idx !== idx) {
      dict = { idx, checked: false };
      ui.root.classList.remove('sl-reveal');
      ui.dictInput.value = '';
      ui.dictResult.textContent = '';
      ui.dictResult.hidden = true;
      ui.dictGo.textContent = 'Kontrol et (Enter)';
      ui.dict.hidden = false;
    }
    ui.dictInput.focus();
  }

  function checkDictation() {
    const expected = spokenWords(primary.cues[dict.idx].text);
    const hit = matchWords(expected, spokenWords(ui.dictInput.value));
    const ok = hit.filter(Boolean).length;
    dictStats.ok += ok;
    dictStats.total += expected.length;
    const line = el('div', 'sl-dict-words');
    expected.forEach((w, i) => line.append(el('span', hit[i] ? 'sl-ok' : 'sl-miss', w), ' '));
    const session = Math.round((100 * dictStats.ok) / dictStats.total);
    ui.dictResult.textContent = '';
    ui.dictResult.append(line, el('div', 'sl-dict-score', ok + '/' + expected.length + ' kelime doğru · bu oturum %' + session));
    ui.dictResult.hidden = false;
    ui.dictGo.textContent = 'Devam (Enter)';
    dict.checked = true;
    ui.root.classList.add('sl-reveal'); // show the real subtitle and its translation
  }

  function closeDictation(play) {
    if (!dict) return;
    dict = null;
    ui.dict.hidden = true;
    ui.root.classList.remove('sl-reveal');
    ui.dictInput.blur();
    if (play && video) video.play().catch(() => {});
  }

  function dictationEnter() {
    if (!dict) return;
    if (dict.checked) closeDictation(true);
    else checkDictation();
  }

  function dictationReplay() {
    if (!dict) return;
    seekTo(dict.idx);
    ui.dictInput.focus();
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
      const tr = el('div', 'sl-row-tr', c.tr || '');
      tr.hidden = !c.tr;
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
    r.tr.textContent = primary.cues[i].tr || '';
    r.tr.hidden = !primary.cues[i].tr;
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

  function applySettings(keys) {
    if (!settings.dictation || !settings.enabled) closeDictation(false);
    applyNativeHiding();
    refreshMenu();
    if (ui) layout();
    if (keys.some((k) => k === 'learnLang' || k === 'nativeLang' || k === 'preferHuman')) {
      choice = { primary: 'auto', secondary: 'auto' };
      reload();
    }
  }

  // ---------- UI ----------

  function buildUI() {
    const root = el('div');
    root.id = 'scenelingo-root';
    root.hidden = true;

    const subs = el('div', 'sl-subs');
    const box = el('div', 'sl-box');
    const pri = el('div', 'sl-primary');
    const sec = el('div', 'sl-secondary');
    box.hidden = true;
    const tools = el('div', 'sl-tools');
    const sayBtn = el('button', null, '🔊');
    sayBtn.title = 'Cümleyi oku';
    const slowBtn = el('button', null, '🐢');
    slowBtn.title = 'Cümleyi yavaş oku';
    const starBtn = el('button', null, '☆');
    starBtn.title = 'Cümleyi kaydet';
    tools.append(sayBtn, slowBtn, starBtn);
    box.append(pri, sec, tools);

    const dictEl = el('div', 'sl-dict');
    dictEl.hidden = true;
    const dictResult = el('div', 'sl-dict-result');
    dictResult.hidden = true;
    const dictInput = el('input', 'sl-dict-input');
    dictInput.type = 'text';
    dictInput.placeholder = 'Duyduğunu yaz…';
    dictInput.autocomplete = 'off';
    dictInput.spellcheck = false;
    const dictBtns = el('div', 'sl-dict-btns');
    const dictAgain = el('button', null, '↺ Tekrar dinle (Tab)');
    const dictGo = el('button', 'sl-main-btn', 'Kontrol et (Enter)');
    const dictSkip = el('button', null, 'Geç (Esc)');
    dictBtns.append(dictAgain, dictGo, dictSkip);
    dictEl.append(dictResult, dictInput, dictBtns);
    subs.append(dictEl, box);

    const popup = el('div', 'sl-popup');
    popup.hidden = true;
    const toastEl = el('div', 'sl-toast');
    toastEl.hidden = true;
    const fab = el('button', 'sl-fab', 'SL');
    fab.title = 'SceneLingo ayarları';
    const menu = el('div', 'sl-menu');
    menu.hidden = true;

    const panel = el('div', 'sl-panel');
    panel.hidden = true;
    const panelHead = el('div', 'sl-panel-head');
    const panelClose = el('button', 'sl-icon-btn', '✕');
    panelHead.append(el('span', null, 'Altyazılar'), panelClose);
    const list = el('div', 'sl-list');
    panel.append(panelHead, list);

    // menu
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
    const listBtn = el('button', 'sl-wide-btn', 'Altyazı listesini aç / kapat (L)');
    const reviewBtn = el('button', 'sl-wide-btn', 'Kelime tekrarını aç');
    const statusEl = el('div', 'sl-status');
    statusEl.hidden = true;
    menu.append(
      el('div', 'sl-menu-title', 'SceneLingo'),
      statusEl,
      row('Çift altyazı', check('enabled'), 'label'),
      row('Üst altyazı', priSel),
      row('Alt altyazı', secSel),
      row('Her cümlede duraklat (Q)', check('autoPause'), 'label'),
      row('Dinleme alıştırması (W)', check('dictation'), 'label'),
      row('Üzerine gelince duraklat', check('hoverPause'), 'label'),
      row('Kelimenin üzerine gelince çevir', check('hoverLookup'), 'label'),
      row('Kelimeyi sesli oku', check('autoSpeak'), 'label'),
      accentRow,
      row('Okuma sesi', vol),
      row('Prime altyazısını gizle', check('hideNative'), 'label'),
      row('Yazı boyutu', size.wrap),
      row('Konum', pos.wrap),
      row('Gecikme', sync.wrap),
      listBtn,
      reviewBtn,
      el('div', 'sl-hint', 'A önceki · S tekrar · D sonraki · Q duraklatma · W dinleme alıştırması · L liste')
    );

    root.append(subs, popup, toastEl, fab, menu, panel);
    ui = { root, subs, box, pri, sec, starBtn, dict: dictEl, dictInput, dictResult, dictGo, popup, toast: toastEl, fab, menu, panel, list, checks, priSel, secSel, accentSel, accentRow, volRange, volVal, size, pos, sync, status: statusEl };

    // Keep clicks on our controls from reaching the player underneath.
    for (const type of ['click', 'dblclick', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'wheel', 'contextmenu']) {
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
    sayBtn.addEventListener('click', () => speakSentence(false));
    slowBtn.addEventListener('click', () => speakSentence(true));
    starBtn.addEventListener('click', saveSentence);
    dictAgain.addEventListener('click', dictationReplay);
    dictGo.addEventListener('click', () => {
      dictationEnter();
      if (dict) dictInput.focus();
    });
    dictSkip.addEventListener('click', () => closeDictation(true));
    reviewBtn.addEventListener('click', () => send({ type: 'open-review' }));
    fab.addEventListener('click', () => {
      menu.hidden = !menu.hidden;
      if (!menu.hidden) refreshMenu();
    });
    listBtn.addEventListener('click', togglePanel);
    panelClose.addEventListener('click', togglePanel);
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
    box.addEventListener('mouseenter', () => {
      if (settings.hoverPause && video && !video.paused) {
        video.pause();
        hoverPaused = true;
      }
    });
    box.addEventListener('mouseleave', () => {
      clearTimeout(hoverTimer);
      if (!popup.hidden) scheduleClose();
      else if (hoverPaused) resume();
    });

    setStatus(status);
    refreshMenu();
    layout();
  }

  function refreshMenu() {
    if (!ui) return;
    for (const key of Object.keys(ui.checks)) ui.checks[key].checked = !!settings[key];
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
    if (ui && e.target === ui.dictInput) {
      // Typing an answer must not trigger the player's own shortcuts (space, arrows, letters).
      e.stopImmediatePropagation();
      if (e.type !== 'keydown') return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter') dictationEnter();
      else if (e.code === 'Tab') dictationReplay();
      else if (e.code === 'Escape') closeDictation(true);
      else return;
      e.preventDefault();
      return;
    }
    if (e.type !== 'keydown' || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target;
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
    else if (e.code === 'KeyQ') {
      setSetting('autoPause', !settings.autoPause);
      toast('Her cümlede duraklat: ' + (settings.autoPause ? 'açık' : 'kapalı'));
    } else if (e.code === 'KeyW') {
      setSetting('dictation', !settings.dictation);
      toast('Dinleme alıştırması: ' + (settings.dictation ? 'açık — altyazı gizli, cümle bitince yaz' : 'kapalı'));
    } else if (e.code === 'KeyL') togglePanel();
    else handled = false;
    if (handled) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onPageMessage(e) {
    if (e.source !== window || !e.data || e.data.source !== PAGE) return;
    if (e.data.type === 'tracks') setTracks(e.data.tracks);
    else if (e.data.type === 'sub-seen' && !tracks.length && typeof e.data.url === 'string' && e.data.url !== seenUrl) {
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
  document.addEventListener('mousedown', (e) => {
    if (!ui) return;
    if (!ui.popup.hidden && !ui.popup.contains(e.target) && !e.target.closest('.sl-word')) closePopup(true);
    if (!ui.menu.hidden && !ui.menu.contains(e.target) && e.target !== ui.fab) ui.menu.hidden = true;
  }, true);
  document.addEventListener('mousemove', () => {
    if (!ui) return;
    ui.root.classList.add('sl-awake');
    clearTimeout(awakeTimer);
    awakeTimer = setTimeout(() => ui.root.classList.remove('sl-awake'), 2500);
  }, true);

  chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
    settings = { ...SL_DEFAULTS, ...stored };
    applySettings([]);
  });
  chrome.storage.local.get({ words: [] }, (data) => setSavedWords(data.words));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.words) setSavedWords(changes.words.newValue || []);
    if (area !== 'sync') return;
    const keys = Object.keys(changes).filter((k) => k in SL_DEFAULTS && settings[k] !== changes[k].newValue);
    if (!keys.length) return;
    for (const k of keys) settings[k] = changes[k].newValue === undefined ? SL_DEFAULTS[k] : changes[k].newValue;
    applySettings(keys);
  });

  window.postMessage({ source: EXT, type: 'hello' }, location.origin);
  setInterval(pickVideo, 1000);
  requestAnimationFrame(frame);
})();
