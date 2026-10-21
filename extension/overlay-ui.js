// The overlay: the list of lines, the settings, the bar and its menu, and the film's sound.
'use strict';

// ---------- subtitle list panel ----------

function buildPanel() {
  ui.list.textContent = '';
  panelRows = null;
  paintTabs();
  // The episode's words and the questions on it: see overlay-episode.js.
  if (panelTab === 'words') return buildWords();
  if (panelTab === 'quiz') return buildQuiz();
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

// Choosing the mode that is already on goes back to plain watching.
function setMode(mode) {
  setSetting('mode', settings.mode === mode ? 'watch' : mode);
  toast(slT(settings.mode + 'Note'), 2200);
}

// The interface in another language: it is built again, in that language, at the next look.
function rebuild() {
  slSetUiLang(settings.uiLang);
  if (!ui) return;
  if (practice) closePractice(false);
  ui.root.remove();
  ui = null;
  panelRows = null;
  raisedOver = null;
  shown = { idx: -2, sec: null };
  pickVideo();
}

// On YouTube a button of its own sits in the player's control bar, as other extensions put
// theirs: it switches the dual subtitles on and off, and says which they are.
function playerButton() {
  const bar = document.querySelector('#movie_player .ytp-right-controls') || document.querySelector('.html5-video-player .ytp-right-controls');
  if (!bar || !settingsLoaded) return;
  let b = bar.querySelector('.sl-yt-button');
  if (!b) {
    b = el('button', 'ytp-button sl-yt-button');
    b.append(el('span', 'sl-yt-mark', 'SL'), el('span', 'sl-yt-state'));
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      setSetting('enabled', !settings.enabled);
      toast(slT(settings.enabled ? 'dualOn' : 'dualOff'));
    });
    bar.prepend(b);
  }
  b.classList.toggle('sl-on', !!settings.enabled);
  b.lastChild.textContent = settings.enabled ? 'ON' : 'OFF';
  const tip = 'SceneLingo — ' + slT(settings.enabled ? 'dualOn' : 'dualOff');
  if (b.title !== tip) {
    b.title = tip;
    b.setAttribute('aria-label', tip);
  }
}

function applySettings(keys) {
  if (keys.includes('uiLang')) rebuild();
  if (SITE === 'youtube') playerButton();
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
  toast(slT('intro'), 9000);
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
  pauseLine: 'M9 3v8 M15 3v8 M4 16h16 M7 20h10',
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
    watch: button('sl-seg-btn', 'eye', slT('watch'), slT('watchTip'), () => setSetting('mode', 'watch')),
    write: button('sl-seg-btn', 'pen', slT('write'), slT('writeTip'), () => setMode('write')),
    speak: button('sl-seg-btn', 'mic', slT('speak'), slT('speakTip'), () => setMode('speak')),
  };
  const seg = el('div', 'sl-seg');
  seg.append(modeBtns.watch, modeBtns.write, modeBtns.speak);
  const pauseBtn = button('sl-ibtn', 'pauseLine', null, slT('pauseEach'), () => setSetting('autoPause', !settings.autoPause));
  const starBtn = button('sl-ibtn', 'star', null, slT('saveSentence'), saveSentence);
  const listBtn = button('sl-ibtn', 'list', null, slT('list'), togglePanel);
  const gearBtn = button('sl-ibtn', 'sliders', null, slT('settings'), () => (ui.menu.hidden ? openMenu() : closeMenu()));
  bar.append(
    button('sl-ibtn', 'prev', null, slT('prev'), () => primary && nav(-1)),
    button('sl-ibtn', 'repeat', null, slT('repeat'), () => primary && nav(0)),
    button('sl-ibtn sl-text-btn', null, '0.75×', slT('repeatSlow'), replaySlow),
    button('sl-ibtn', 'next', null, slT('next'), () => primary && nav(1)),
    el('span', 'sl-sep'),
    seg,
    el('span', 'sl-sep'),
    pauseBtn,
    button('sl-ibtn', 'volume', null, slT('readAloud'), speakSentence),
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
  answer.setAttribute('aria-label', slT('typeHere'));
  answer.dataset.placeholder = slT('typeHere') + '…';
  answer.spellcheck = false;
  const heard = el('div', 'sl-heard');
  const heardText = el('span', 'sl-heard-text');
  heard.append(el('span', 'sl-mic-dot'), heardText);
  const actions = el('div', 'sl-strip-row');
  const btns = el('div', 'sl-strip-btns');
  const checkBtn = button('sl-main-btn', null, slT('check'), null, () => {
    practiceEnter();
    if (practice) focusBox();
  });
  const doneBtn = button('sl-main-btn', null, slT('done'), null, practiceEnter);
  const sayBtn = button(null, 'mic', slT('sayAgain'), null, startListening);
  const voiceBtn = button(null, 'play', slT('myVoice'), null, playVoice);
  const goBtn = button('sl-main-btn', null, slT('goOn'), null, practiceEnter);
  btns.append(
    button(null, 'repeat', slT('hearAgain'), null, practiceReplay),
    checkBtn,
    doneBtn,
    sayBtn,
    voiceBtn,
    goBtn,
    button(null, null, slT('skip'), null, () => closePractice(true))
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
  const tabs = el('div', 'sl-tabs');
  for (const [tab, label] of [['lines', 'tabLines'], ['words', 'tabWords'], ['quiz', 'tabQuiz']]) {
    const t = el('button', 'sl-tab', slT(label));
    t.dataset.tab = tab;
    t.addEventListener('click', () => {
      panelTab = tab;
      buildPanel();
    });
    tabs.append(t);
  }
  panelHead.append(tabs, button('sl-ibtn', 'close', null, slT('close'), togglePanel));
  const list = el('div', 'sl-list');
  panel.append(panelHead, list);

  // settings menu
  const checks = {};
  const row = (label, control, tag = 'div') => {
    const r = el(tag, 'sl-mrow');
    r.append(el('span', 'sl-mlabel', label), control);
    return r;
  };
  // A list with an arrow of its own, drawn by the style sheet: a picture there could be refused by
  // the site.
  const selectBox = (s) => {
    const w = el('span', 'sl-select');
    w.append(s);
    return w;
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
  for (const [code, label] of [['en-GB', slT('accentGB')], ['en-US', slT('accentUS')], ['en-AU', slT('accentAU')]]) {
    const o = el('option', null, label);
    o.value = code;
    accentSel.appendChild(o);
  }
  accentSel.addEventListener('change', () => {
    setSetting('accent', accentSel.value);
    speakSample();
  });
  const accentRow = row(slT('accent'), selectBox(accentSel));
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
    paintRange(volRange);
  });
  volRange.addEventListener('change', () => {
    setSetting('speechVolume', +volRange.value);
    volRange.blur();
    speakSample();
  });
  // The film's own sound, louder.
  const boostBox = el('span', 'sl-range');
  const boostRange = el('input');
  boostRange.type = 'range';
  boostRange.min = 100;
  boostRange.max = 600;
  boostRange.step = 10;
  const boostVal = el('span', 'sl-step-val');
  boostBox.append(boostRange, boostVal);
  const boostNote = el('div', 'sl-hint');
  boostNote.hidden = true;
  let boostTimer = 0;
  boostRange.addEventListener('input', () => {
    boostVal.textContent = boostRange.value + '%';
    paintRange(boostRange);
    clearTimeout(boostTimer);
    boostTimer = setTimeout(async () => {
      const res = await setBoost(+boostRange.value);
      boostNote.hidden = res.ok;
      if (!res.ok) boostNote.textContent = res.error === 'needToolbar' ? slT('boostNeedToolbar') : slT('boostFailed', res.error);
    }, 120);
  });
  boostRange.addEventListener('change', () => boostRange.blur());
  const boostRow = row(slT('boost'), boostBox);
  boostRow.title = slT('boostTip');
  // Gemini, on and off; and which key is saved.
  const geminiRow = row(slT('useGemini'), check('useGemini'), 'label');
  const geminiNote = el('div', 'sl-hint');
  const engineNote = el('div', 'sl-hint sl-engine');
  engineNote.hidden = true;
  const reviewBtn = el('button', 'sl-wide-btn', slT('openReview'));
  const fileBtn = el('button', 'sl-small-btn', slT('openFileShort'));
  fileBtn.title = slT('openFileTip');
  fileBtn.addEventListener('click', () => {
    const input = el('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.ttml,.dfxp,.xml,.txt';
    input.addEventListener('change', () => input.files[0] && openSubtitleFile(input.files[0]));
    input.click();
  });
  const traceBtn = el('button', 'sl-wide-btn sl-quiet-btn', slT('copyDiag'));
  traceBtn.title = slT('copyDiagTip');
  const statusEl = el('div', 'sl-status');
  statusEl.hidden = true;
  // The menu: its title, four tabs (each short enough to need no scrolling), and a foot with the
  // review page and the diagnostics.
  const menuTop = el('div', 'sl-mtop');
  menuTop.append(el('span', 'sl-mtitle', slT('settings')), button('sl-ibtn sl-mclose', 'close', null, slT('close'), closeMenu));
  const menuTabs = el('div', 'sl-mtabs');
  const pages = {};
  for (const [tab, label] of [['subs', 'tabSubs'], ['card', 'tabWord'], ['sound', 'tabSound'], ['look', 'tabLook']]) {
    const t = el('button', 'sl-mtab', slT(label));
    t.dataset.tab = tab;
    t.addEventListener('click', () => showMenuTab(tab));
    menuTabs.append(t);
    pages[tab] = el('div', 'sl-mpage');
    pages[tab].dataset.tab = tab;
  }
  // The keys as keys: "A previous" with the A on a key cap.
  const keys = el('div', 'sl-keys');
  for (const part of slT('keysHint').split(' · ')) {
    const [cap, ...what] = part.split(' ');
    const k = el('span');
    k.append(el('kbd', null, cap), ' ' + what.join(' '));
    keys.append(k);
  }
  pages.subs.append(
    row(slT('dual'), check('enabled'), 'label'),
    row(slT('upper'), selectBox(priSel)),
    row(slT('lower'), selectBox(secSel)),
    engineNote,
    row(slT('hideNative'), check('hideNative'), 'label'),
    row(slT('delay'), sync.wrap),
    row(slT('ownFile'), fileBtn)
  );
  pages.card.append(row(slT('hoverPause'), check('hoverPause'), 'label'), row(slT('hoverLookup'), check('hoverLookup'), 'label'), row(slT('autoSpeak'), check('autoSpeak'), 'label'), geminiRow, geminiNote);
  pages.sound.append(accentRow, row(slT('volume'), vol), boostRow, boostNote);
  pages.look.append(row(slT('fontSize'), size.wrap), row(slT('position'), pos.wrap), el('div', 'sl-mhead', slT('keysTitle')), keys);
  const menuFoot = el('div', 'sl-mfoot');
  menuFoot.append(reviewBtn, traceBtn);
  menu.append(menuTop, statusEl, menuTabs, ...Object.values(pages), menuFoot);

  root.append(subs, popup, toastEl, menu, panel);
  ui = {
    root, subs, box, pri, sec, bar, barWrap, strip, stripWrap, answer, heard, heardText, score, actions,
    checkBtn, doneBtn, sayBtn, voiceBtn, goBtn, modeBtns, pauseBtn, starBtn, listBtn, gearBtn,
    popup, toast: toastEl, menu, panel, tabs, list, checks, priSel, secSel, accentSel, accentRow,
    volRange, volVal, size, pos, sync, status: statusEl, engineNote,
    boostRange, boostVal, geminiNote,
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
    navigator.clipboard.writeText(diagnostics()).then(() => toast(slT('diagCopied')), () => toast(slT('notCopied')));
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

  setStatus(statusLine);
  refreshMenu();
  layout();
  showIntro();
  requestAnimationFrame(frame);
}

// The menu opens above the bar, over the settings button rather than over the middle of the
// picture, with a point to the button; on the tab it was left on.
let menuTab = 'subs';
function openMenu() {
  refreshMenu();
  showMenuTab(menuTab);
  ui.menu.hidden = false;
  const rr = ui.root.getBoundingClientRect();
  const bar = ui.bar.getBoundingClientRect();
  const gear = ui.gearBtn.getBoundingClientRect();
  const width = ui.menu.offsetWidth;
  const left = Math.max(8, Math.min(gear.right + 8 - width, rr.right - 8 - width) - rr.left);
  ui.menu.style.left = left + 'px';
  ui.menu.style.bottom = Math.max(8, rr.bottom - bar.top + 10) + 'px';
  ui.menu.style.maxHeight = Math.max(160, bar.top - rr.top - 18) + 'px';
  ui.menu.style.setProperty('--sl-point', Math.max(16, Math.min(width - 16, gear.left + gear.width / 2 - rr.left - left)) + 'px');
  ui.gearBtn.classList.add('sl-on');
}

function closeMenu() {
  if (!ui) return;
  ui.menu.hidden = true;
  ui.gearBtn.classList.remove('sl-on');
}

function showMenuTab(tab) {
  menuTab = tab;
  for (const t of ui.menu.querySelectorAll('.sl-mtab')) t.classList.toggle('sl-on', t.dataset.tab === tab);
  for (const p of ui.menu.querySelectorAll('.sl-mpage')) p.hidden = p.dataset.tab !== tab;
}

// A slider filled up to its value, in the colour of what is on.
function paintRange(range) {
  const min = +range.min || 0;
  const max = +range.max || 100;
  range.style.setProperty('--sl-fill', Math.round(((+range.value - min) / (max - min)) * 100) + '%');
}

// ---------- the film's sound ----------

// A film the page can hear is made louder right here: no capture of the tab, so its fullscreen
// stays as it is. A protected film (Prime's) gives a page silence instead of its sound; that
// one goes through the background, which captures the tab.
let boostLevel = 100;
let localBoost = null; // { video, audio, gain }

function pageCanHear(v) {
  if (!v || v.mediaKeys) return false;
  const src = v.currentSrc || '';
  if (!src || /^(blob|data):/.test(src)) return true;
  try {
    return new URL(src).origin === location.origin || !!v.crossOrigin;
  } catch (e) {
    return false;
  }
}

async function setBoost(level) {
  const here = localBoost && localBoost.video === video;
  if (!here && level > 100 && pageCanHear(video)) {
    const now = await send({ type: 'boost-state-page' });
    if (!(now.ok && now.result.level > 100)) {
      const audio = new AudioContext();
      const gain = audio.createGain();
      const limiter = audio.createDynamicsCompressor();
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.25;
      audio.createMediaElementSource(video).connect(gain).connect(limiter).connect(audio.destination);
      localBoost = { video, audio, gain };
    }
  }
  if (localBoost && localBoost.video === video) {
    if (localBoost.audio.state === 'suspended') localBoost.audio.resume();
    localBoost.gain.gain.setTargetAtTime(level / 100, localBoost.audio.currentTime, 0.05);
    boostLevel = level;
    return { ok: true };
  }
  const res = await send({ type: 'boost-page', level });
  if (res.ok) boostLevel = res.result.level;
  return res;
}

function showGeminiState() {
  if (!ui) return;
  send({ type: 'gemini-key' }).then((res) => {
    if (!ui) return;
    const shown = res.ok ? res.result : '';
    ui.checks.useGemini.disabled = !shown;
    ui.geminiNote.textContent = shown ? slT('geminiKeyShown', shown) : slT('geminiNoKeyHere');
  });
}

function refreshMenu() {
  showGeminiState();
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
  fill(ui.priSel, [['auto', slT('optAuto', priName)], ...trackOpts], choice.primary);
  const secName =
    secondary.kind === 'track' ? trackLabel(secondary.track) : secondary.kind === 'mt' ? slT('machine') : slT('off');
  fill(
    ui.secSel,
    [['auto', slT('optAuto', secName)], ['mt', slT('optMachine', langName(settings.nativeLang))], ...trackOpts, ['off', slT('optOff')]],
    choice.secondary
  );
  // Where the machine-translated lines come from, once some have come.
  ui.engineNote.hidden = !engine;
  if (engine) ui.engineNote.textContent = slT('translatedBy', slT(engine.name === 'browser' ? 'engineBrowser' : 'engineOnline')) + (engine.canGet ? slT('engineHint') : '');
  ui.accentSel.value = settings.accent;
  ui.accentRow.hidden = !speaksEnglish();
  ui.volRange.value = settings.speechVolume;
  ui.volVal.textContent = settings.speechVolume + '%';
  ui.boostRange.value = boostLevel;
  ui.boostVal.textContent = boostLevel + '%';
  paintRange(ui.volRange);
  paintRange(ui.boostRange);
  ui.size.val.textContent = settings.fontSize + '%';
  ui.pos.val.textContent = settings.bottomOffset + '%';
  ui.sync.val.textContent = slT('seconds', (offset > 0 ? '+' : '') + offset.toFixed(2));
}
