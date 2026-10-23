// The overlay: the lines drawn over the picture and kept in step with it, the player's own captions
// as a clock, and playing, pausing and going from line to line.
'use strict';

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
  const nouns = lang === 'de' && settings.nounColors ? germanNouns() : null;
  text.split('\n').forEach((row, r) => {
    if (r) line.appendChild(document.createElement('br'));
    const parts = seg
      ? Array.from(seg.segment(row), (s) => [s.segment, s.isWordLike])
      : row.split(/([\p{L}\p{M}\p{N}'’]+)/u).map((s, i) => [s, i % 2 === 1]);
    let starts = true; // a sentence begins here: its first word has a capital whatever it is
    for (const [str, isWord] of parts) {
      if (!str) continue;
      if (!isWord) {
        line.appendChild(document.createTextNode(str));
        if (/[.!?…:"„“»«–—-]/.test(str)) starts = true;
        continue;
      }
      const w = el('span', 'sl-word', str);
      if (slSavedForm(str, savedWords, lang)) w.classList.add('sl-saved');
      // German nouns, written with a capital in the middle of a sentence, in the colour of their gender.
      if (nouns && !starts && /^\p{Lu}\p{Ll}/u.test(str)) {
        const n = slNounText(slNoun(nouns, str));
        if (n && n.g) w.classList.add('sl-g' + n.g);
      }
      starts = false;
      line.appendChild(w);
    }
  });
}

// The German nouns, asked for when they are first wanted; the line on screen is drawn again once
// they are there.
function germanNouns() {
  if (deNouns) return deNouns;
  slNouns().then((list) => {
    deNouns = list;
    shown = { idx: -2, sec: null };
  });
  return null;
}

function showCue(idx, sec) {
  if (idx === shown.idx && sec === shown.sec) return;
  if (idx !== shown.idx) {
    closePopup(false);
    if (practice && idx !== practice.idx) closePractice(false);
    if (idx >= 0) {
      fillWords(ui.pri, primary.cues[idx].text, langOf(primary.track.languageCode));
      noticeSaved(primary.cues[idx]);
    }
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
      setTime(video, t + offset);
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
  const r = video && video.isConnected ? video.getBoundingClientRect() : null;
  if (!r || r.width < 300 || r.height < 150 || !inPlayer(video)) {
    root.hidden = true;
    topLayer(false);
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
  topLayer(fs === video);
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

// A player that puts the video element itself in fullscreen leaves no room in the page for
// anything else: only the browser's top layer is drawn over it. A popover is in that layer
// too, and one shown after the video went fullscreen is above it. It is drawn there, but the
// mouse is not let through to it: everything outside the fullscreen element is out of reach.
// So the study bar is put away, the shortcuts stay, and words are found by where the pointer is.
let raisedOver = null; // the fullscreen video the overlay has been raised over
let raisedNote = false;
function topLayer(wanted) {
  const root = ui.root;
  const target = wanted ? video : null;
  if (!root.showPopover || target === raisedOver) return;
  raisedOver = target;
  pointed = { box: false, word: null };
  root.classList.toggle('sl-raised', !!target);
  try {
    if (root.matches(':popover-open')) root.hidePopover();
    if (target) {
      root.popover = 'manual';
      root.showPopover();
      if (!raisedNote) toast(slT('raised'), 6000);
      raisedNote = true;
    } else root.removeAttribute('popover');
  } catch (e) { /* the overlay stays in the page, behind the video */ }
}

// While the overlay is raised over a fullscreen video, the mouse's events go to the video. Where
// the pointer is over the subtitle is worked out from the boxes, and the line and its words
// are told as if the mouse had come to them or left.
let pointed = { box: false, word: null };
function pointerOver(e) {
  if (!raisedOver || !ui || ui.root.hidden) return;
  const inside = (n) => {
    const r = n.getBoundingClientRect();
    return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  };
  const box = !ui.box.hidden && inside(ui.box);
  const word = box ? [...ui.pri.querySelectorAll('.sl-word')].find(inside) || null : null;
  if (box !== pointed.box) {
    if (box) ui.box.dispatchEvent(new MouseEvent('mouseenter'));
    else for (const n of [ui.box, ui.subs]) n.dispatchEvent(new MouseEvent('mouseleave'));
  }
  if (word !== pointed.word) (word || ui.pri).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  pointed = { box, word };
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
  if (SITE === 'other') return !coveredByAnother(v);
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

// An advertisement usually plays in a video of its own, laid over the film while the film waits.
function coveredByAnother(v) {
  if (!v.paused) return false;
  const r = v.getBoundingClientRect();
  return Subtitles.videos().some((other) => {
    if (other === v || other.paused || other.ended) return false;
    const o = other.getBoundingClientRect();
    const width = Math.min(r.right, o.right) - Math.max(r.left, o.left);
    const height = Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top);
    return width > 0 && height > 0 && width * height > r.width * r.height * 0.5;
  });
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
  statusLine = text;
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
  if (SITE === 'other') return calibrateFromTracks();
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

// On a plain video the subtitles of a stream are put together from its files, on the clock
// those files keep. A line the video's own text track is showing says where that clock
// stands against the video's.
function calibrateFromTracks() {
  if (manualOffset || !primary || !primary.track.stream || !video) return;
  for (const tt of video.textTracks || []) {
    if (tt.mode === 'disabled' || !tt.activeCues || (tt.kind !== 'subtitles' && tt.kind !== 'captions')) continue;
    for (const cue of tt.activeCues) {
      const norm = normText(cueText(cue.text));
      if (norm === lastNative) return;
      const hit = uniqueMatch(primary.cues, norm, cue.startTime - offset) || (secondary.kind === 'track' && secondary.cues && uniqueMatch(secondary.cues, norm, cue.startTime - offset));
      if (!hit) continue;
      lastNative = norm;
      syncSamples.push(cue.startTime - hit.start);
      if (syncSamples.length > 2) syncSamples.shift();
      // Two lines in a row that agree, and differ from what is in use.
      if (syncSamples.length === 2 && Math.abs(syncSamples[0] - syncSamples[1]) < 0.15 && Math.abs(syncSamples[1] - offset) > 0.25) {
        offset = Math.round(syncSamples[1] * 100) / 100;
        refreshMenu();
      }
      return;
    }
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

// Netflix stops playback when the video's clock is set from outside: its own player is asked to
// seek, by the script in the page's world.
function setTime(v, t) {
  if (SITE !== 'netflix') {
    v.currentTime = t;
    return;
  }
  try {
    window.postMessage({ source: EXT, type: 'nf-seek', time: t }, location.origin);
  } catch (e) { /* ignore */ }
}

function seekTo(i) {
  if (!primary || !video || !primary.cues.length) return;
  i = Math.max(0, Math.min(primary.cues.length - 1, i));
  restoreRate();
  setTime(video, primary.cues[i].start + offset + 0.01);
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

// Switched off for this site, from the toolbar popup.
const siteOff = () => (settings.offSites || []).includes(HOME);

function pickVideo() {
  if (siteOff()) {
    video = null;
    if (ui) layout();
    return;
  }
  let best = null;
  if (SITE === 'youtube') best = document.querySelector('#movie_player video') || document.querySelector('.html5-video-player video');
  else {
    // The largest video; on a page that is not known, one that has subtitles before one that
    // has none (an advertisement is as large as the film it plays over).
    let bestScore = 0;
    for (const v of SITE === 'other' ? Subtitles.videos() : document.querySelectorAll('video')) {
      if (!v.readyState && !v.currentSrc) continue;
      const r = v.getBoundingClientRect();
      const score = r.width * r.height * (SITE === 'other' && Subtitles.hasCaptions(v) ? 4 : 1);
      if (score > bestScore) {
        best = v;
        bestScore = score;
      }
    }
  }
  video = best;
  if (video) followVideo(video);
  if (SITE === 'youtube') playerButton();
  if (SITE === 'other') scanPage();
  // On a site that is not known, a video is left alone unless it comes with subtitles or the
  // user has asked for the overlay.
  if (video && !ui && document.body && settingsLoaded && (SITE !== 'other' || tracks.length || forced)) buildUI();
  // An older copy of the extension loaded from another folder draws its own overlay on top of
  // this one and takes the same keys.
  if (ui && !warnedTwin && [...document.querySelectorAll('#scenelingo-root, #primelingo-root')].some((n) => n !== ui.root)) {
    warnedTwin = true;
    setStatus(slT('twoCopies'));
    openMenu();
  }
}

// A plain video: what subtitles the page has for it now. A stream's playlist is read in the
// background, and the tracks are looked at again when it has been.
let lastSource = '';
function scanPage() {
  Subtitles.look().then((changed) => changed && video && setTracks(Subtitles.pageTracks(video), true));
  if (!video) return;
  if (video.currentSrc !== lastSource) {
    lastSource = video.currentSrc;
    Subtitles.renew();
  }
  setTracks(Subtitles.pageTracks(video), true);
  refreshLive();
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
    const cues = Subtitles.parse(text);
    if (!cues.length) throw new Error(slT('noLines'));
    const t = { url: 'file:' + file.name + ':' + file.size, id: '', languageCode: guessLang(file.name), displayName: file.name, type: '', subtype: '', forced: false, auto: false, textTrack: null, file: false, cues };
    // A file in the user's own language goes under the line; so does a second file.
    const under = langOf(t.languageCode) === settings.nativeLang || (!t.languageCode && primary && primary.track.cues && primary.track.url !== t.url);
    fileTracks = fileTracks.filter((x) => x.url !== t.url).concat(t);
    tracks = tracks.filter((x) => !x.cues).concat(fileTracks);
    choice[under ? 'secondary' : 'primary'] = t.url;
    toast(slT(under ? 'fileUnder' : 'fileOver', file.name), 2500);
    reload();
  } catch (e) {
    toast(slT('fileFailed', (e && e.message) || e), 4000);
  }
}
