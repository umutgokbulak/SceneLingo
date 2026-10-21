// The overlay: the subtitle tracks there are, the two that are shown, and the machine translation
// of a line that has no human one.
'use strict';

// ---------- subtitle tracks ----------

// A text track fills up while the video loads, so it is read again when it has grown.
function refreshLive() {
  const p = primary;
  if (!p || !p.live || !p.live.cues || p.live.cues.length === p.liveCount) return;
  const old = new Map(p.cues.map((c) => [c.start + '|' + c.text, c]));
  p.liveCount = p.live.cues.length;
  p.cues = Subtitles.readTextTrack(p.live).map((c) => old.get(c.start + '|' + c.text) || c);
  p.requested = new Set();
  if (secondary.kind === 'track' && secondary.track.textTrack) {
    for (const c of p.cues) {
      delete c.tr;
      delete c.shared;
    }
    secondary.cues = Subtitles.readTextTrack(secondary.track.textTrack);
    alignTranslation(p.cues, secondary.cues);
  }
  shown = { idx: -2, sec: null };
  lastIdx = -1;
  setStatus(p.cues.length ? '' : slT('loading'));
  if (ui && !ui.panel.hidden) buildPanel();
}

// ---------- track selection ----------

const trackScore = (t) =>
  (t.forced ? 4 : 0) + (/commentary|descri/i.test(t.subtype) ? 2 : 0) + (/sdh|cc/i.test(t.type) || t.auto ? 1 : 0);

const pickTrack = (lang) =>
  tracks.filter((t) => langOf(t.languageCode) === lang).sort((a, b) => trackScore(a) - trackScore(b))[0] || null;

function trackLabel(t) {
  let label = t.displayName || t.languageCode || slT('subtitle');
  if (label === t.languageCode) label = langName(langOf(label)); // a track that only gives its language's code
  if (t.auto) label = slT('trackAuto', label);
  if (t.forced) label = slT('trackForced', label);
  else if (/sdh|cc/i.test(t.type) && !/\[|\(/.test(label)) label += ' [CC]';
  return label;
}

function resolvePrimary() {
  if (!tracks.length) {
    return seenUrl ? { url: seenUrl, languageCode: '', displayName: slT('fromPlayer') } : null;
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
    return { kind: 'track', track: { url: u.href, languageCode: settings.nativeLang, displayName: slT('byYoutube', langName(settings.nativeLang)) } };
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
    setStatus(emptyNote || waiting());
    afterLoad();
    return;
  }
  // A file or track that does not say its language is taken to be in the one being learned.
  if (!pt.languageCode) pt = { ...pt, languageCode: settings.learnLang };
  setStatus(slT('loading'));
  try {
    const progress = (done) => gen === loadGen && setStatus(slT('loadingPart', Math.round(done * 100)));
    const cues = (await Subtitles.load(pt, progress)).map((c) => ({ ...c }));
    if (gen !== loadGen) return;
    // The stream these came from may not be the one in this video (an advertisement, or the
    // video before); the next look at the page then offers what else there is.
    if (pt.stream && !Subtitles.fits(video)) throw new Error(slT('notThisVideo'));
    // The lines are shown as soon as they are here. What goes under them is fetched after,
    // and for a long film in many pieces that can take as long again.
    const live = pt.textTrack && !pt.file && !pt.cues ? pt.textTrack : null;
    primary = { track: pt, cues, requested: new Set(), live, liveCount: live && live.cues ? live.cues.length : 0 };
    setStatus(cues.length ? '' : live ? slT('loading') : slT('emptyFile'));
    afterLoad();
    const sec = resolveSecondary(pt);
    if (sec.kind === 'track') {
      try {
        sec.cues = await Subtitles.load(sec.track);
        // An empty translation is no translation, unless it is a text track that is still filling up.
        if (!sec.cues.length && !(sec.track.textTrack && !sec.track.file)) throw new Error('empty');
        if (gen === loadGen) alignTranslation(primary.cues, sec.cues);
      } catch (e) {
        sec.kind = 'mt';
      }
    }
    if (gen !== loadGen) return;
    secondary = sec;
    shown = { idx: -2, sec: null };
  } catch (e) {
    if (gen !== loadGen) return;
    setStatus(slT('loadFailed', (e && e.message) || e));
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
      stream: !!t.stream,
      whole: !!t.whole,
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
  Subtitles.forget();
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
      if (primary === p) {
        translateFailing = res.error !== STALE;
        setStatus(res.error === STALE ? slT('stale') : slT('translateFailed', res.error));
      }
      setTimeout(() => p.requested.delete(c), 10000);
      return;
    }
    slice.forEach((cue, k) => {
      cue.mt = res.result[k] || '';
    });
    if (res.engine && (!engine || engine.name !== res.engine || engine.canGet !== !!res.canGet)) {
      engine = { name: res.engine, canGet: !!res.canGet };
      refreshMenu();
    }
    if (primary !== p) return;
    if (translateFailing) {
      translateFailing = false;
      setStatus('');
    }
    if (panelRows) slice.forEach((cue) => setRowTranslation(c * CHUNK + all.indexOf(cue)));
  });
}
