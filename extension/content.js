// The overlay on a film, last of its files (see overlay-base.js): what the page's own script,
// the keyboard, the video and the browser say, and the start.
'use strict';

// ---------- events ----------

// A field where letters are typed: the keys there are the page's. Other controls a player may
// leave the focus on — its volume slider, the choices of its subtitle menu — are not such
// fields, and the shortcuts still work there (Prime Video opened its subtitle menu otherwise).
function typingInto(node) {
  if (!node) return false;
  if (node.isContentEditable || node.tagName === 'TEXTAREA') return true;
  return node.tagName === 'INPUT' && /^(text|search|email|url|password|number|tel)?$/i.test(node.getAttribute('type') || '');
}

function onKey(e) {
  const target = e.target && e.target.nodeType === 1 ? e.target : null;
  const combo = e.ctrlKey || e.metaKey || e.altKey;
  if (practice && ui) {
    const inBox = target === ui.answer;
    const otherField = !inBox && typingInto(target);
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
  if (typingInto(target)) return;
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
    toast(slT(settings.autoPause ? 'pauseEachOn' : 'pauseEachOff'));
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
    window.postMessage({ source: EXT, type: 'hello', captions: !!settings.enabled && !siteOff() }, location.origin);
  } catch (e) { /* a page without an origin of its own */ }
}

function onPageMessage(e) {
  if (e.source !== window || !e.data || e.data.source !== PAGE) return;
  // Each kind of message is taken only on the site whose page script sends it.
  if (SITE === 'other' || (SITE === 'youtube') !== String(e.data.type).startsWith('yt-')) return;
  if (e.data.type === 'tracks') setTracks(e.data.tracks, !!e.data.empty);
  else if (e.data.type === 'yt-notes') siteNotes = Array.isArray(e.data.notes) ? e.data.notes.map(String) : [];
  else if (e.data.type === 'yt-tracks') {
    // Until the player has fetched a caption file itself there is no address to fetch one from.
    emptyNote = e.data.ready ? slT('noCaptions') : '';
    setTracks(e.data.ready ? e.data.tracks : [], true);
    if (!primary && !tracks.length) setStatus(emptyNote || waiting());
  } else if (e.data.type === 'nf-noplayer') {
    // Netflix did not let its player be asked to seek: said, rather than nothing happening.
    toast(slT('nfNoSeek'), 3500);
  } else if (e.data.type === 'sub-seen' && !tracks.length && typeof e.data.url === 'string' && e.data.url !== seenUrl) {
    seenUrl = e.data.url;
    reload();
  }
}

// A video's own events (play, seeking…) do not leave the shadow tree a player may keep it in,
// so they are listened for on that tree as well as on the page.
const mediaListeners = [];
const mediaTrees = new WeakSet();
const onMedia = (type, fn) => {
  mediaListeners.push([type, fn]);
  document.addEventListener(type, fn, true);
};
function followVideo(v) {
  const tree = v.getRootNode();
  if (tree === document || mediaTrees.has(tree)) return;
  mediaTrees.add(tree);
  for (const [type, fn] of mediaListeners) tree.addEventListener(type, fn, true);
}
let sceneAsked = false;

// ---------- the start ----------

// From here the overlay listens: once a frame. A second copy of these scripts in the same frame
// (the popup's "open on this tab" on a page that had them already) does nothing.
function start() {
  window.addEventListener('message', onPageMessage);
  for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, onKey, true);
  onMedia('seeking', (e) => {
    if (e.target !== video) return;
    if (ownSeek) {
      ownSeek = false;
      return;
    }
    autoPausedFor = -1;
    lastIdx = -1;
  });
  onMedia('play', (e) => {
    if (e.target === video) hoverPaused = false;
  });
  onMedia('playing', (e) => {
    if (e.target !== video || sceneAsked || !connected()) return;
    sceneAsked = true;
    const v = video;
    send({ type: 'pending-seek' }).then((res) => {
      const seek = res.ok && res.result;
      if (!seek) return;
      const go = () => {
        if (!(v.duration > seek.time)) return false;
        setTime(v, seek.time);
        return true;
      };
      if (!go()) v.addEventListener('durationchange', function once() { if (go()) v.removeEventListener('durationchange', once); });
    });
  });
  for (const type of ['play', 'pause', 'seeking', 'seeked']) {
    onMedia(type, (e) => {
      if (e.target === video && settings.mode !== 'watch') trace('video', type + ' at ' + video.currentTime.toFixed(2));
    });
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
  document.addEventListener('mousemove', (e) => {
    wake();
    pointerOver(e);
  }, true);
  window.addEventListener('pagehide', releaseMic);

  chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
    settings = { ...SL_DEFAULTS, ...stored };
    settingsLoaded = true;
    slSetUiLang(settings.uiLang);
    if (!primary && !statusLine) setStatus(emptyNote || waiting());
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
    } else if (msg.type === 'boost-local') {
      // From the toolbar popup: answered by the frame whose film the page can make louder itself.
      if (!video || !((localBoost && localBoost.video === video) || pageCanHear(video))) return;
      setBoost(msg.level).then(reply);
      return true;
    } else if (msg.type === 'boost-get') {
      if (localBoost && localBoost.video === video) reply({ level: boostLevel });
    } else if (msg.type === 'where') {
      if (window.top === window) reply({ host: HOME, off: siteOff() });
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
    if (keys.includes('enabled') || keys.includes('offSites')) hello();
    if (keys.includes('offSites')) pickVideo();
  });

  document.addEventListener('fullscreenchange', () => ui && layout());
  // The overlay is pinned to the window, so it has to follow the picture when the page scrolls.
  window.addEventListener('scroll', () => ui && !ui.root.hidden && layout(), { capture: true, passive: true });
  if (SITE === 'other') Subtitles.watch();
  hello();
  setInterval(pickVideo, 1000);
}

if (!window.__scenelingoContent) {
  window.__scenelingoContent = true;
  start();
}
