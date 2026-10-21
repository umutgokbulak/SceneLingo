// The overlay's practice: a line typed from what was heard, or said aloud and recognised.
'use strict';

// ---------- practice: write what was heard, or say the line aloud ----------

const describe = (node) => {
  if (!node || node.nodeType !== 1) return String(node && node.nodeName);
  const cls = typeof node.className === 'string' && node.className ? '.' + node.className.trim().split(/\s+/)[0] : '';
  return node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + cls + (ui && ui.root.contains(node) ? ' (ours)' : '');
};

// What the page looks like to the extension: the videos on it, with the boxes they sit in.
function diagnostics() {
  const box = (r) => '[' + [r.left, r.top, r.width, r.height].map(Math.round).join(',') + ']';
  const name = (n) => n.tagName.toLowerCase() + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((c) => '.' + c).join('') : '');
  const lines = [
    'SceneLingo ' + (connected() ? chrome.runtime.getManifest().version : '(stale copy: the page needs a reload)') + ' — ' + location.hostname,
    'mode: ' + settings.mode + ', fullscreen: ' + !!document.fullscreenElement + ', focus: ' + describe(document.activeElement),
    'site: ' + SITE + (window.top === window ? '' : ' (in a frame of ' + HOME + ')') + ', forced: ' + forced + (siteOff() ? ', switched off for this site' : ''),
    'window: ' + document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight +
      ', overlay: ' + (!ui ? 'not built' : ui.root.hidden ? 'hidden' : 'shown') + ', tracks: ' + tracks.length + ', lines: ' + (primary ? primary.cues.length : 0),
  ];
  if (primary) lines.push('subtitles: ' + trackLabel(primary.track) + (primary.track.stream ? ' (stream)' : primary.live ? ' (text track)' : '') + ', under them: ' + secondary.kind + ', delay: ' + offset);
  lines.push('status: ' + (statusLine || '-') + ', frames on the page: ' + document.querySelectorAll('iframe').length);
  for (const v of Subtitles.videos()) {
    lines.push(
      'video' + (v === video ? ' (picked) ' : ' ') + box(v.getBoundingClientRect()) + ' ready ' + v.readyState + (v.paused ? ' paused' : ' playing') +
        ' at ' + Math.round(v.currentTime) + '/' + Math.round(v.duration) + ', in player: ' + inPlayer(v)
    );
    if (SITE === 'other') lines.push(...Subtitles.describe(v));
    for (let n = v.parentElement, i = 0; n && n !== document.body && i < 14; n = n.parentElement, i++) {
      const cs = getComputedStyle(n);
      lines.push('  ' + name(n) + ' ' + box(n.getBoundingClientRect()) + ' ' + cs.position + (cs.opacity !== '1' ? ' opacity ' + cs.opacity : '') + (cs.visibility !== 'visible' ? ' ' + cs.visibility : ''));
    }
  }
  return lines.concat(siteNotes.map((n) => 'page: ' + n), traceLog).join('\n');
}

function trace(what, detail) {
  traceLog.push(Math.round(performance.now()) + ' ' + what + (detail ? ' ' + detail : ''));
  if (traceLog.length > 200) traceLog.shift();
}

function caretToEnd() {
  const range = document.createRange();
  range.selectNodeContents(ui.answer);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function focusBox() {
  if (document.activeElement === ui.answer) return;
  ui.answer.focus({ preventScroll: true });
  caretToEnd();
}

// The answer box takes the focus back only when the page moved it, not when the user is
// selecting subtitle text or reading a word card.
const boxWantsFocus = () => !!practice && practice.mode === 'write' && !pointerHeld && ui.popup.hidden;

// The site's player moves the keyboard focus to its own controls when playback starts or stops.
function keepFocus(thief) {
  const now = performance.now();
  focusPulls = focusPulls.filter((t) => now - t < 1000);
  trace('focus-left', describe(thief) + (focusPulls.length >= 6 ? ' (gave up)' : ''));
  if (focusPulls.length >= 6) return;
  focusPulls.push(now);
  focusBox();
}

// A key pressed while the focus was elsewhere still belongs to the answer.
function typeIntoBox(e) {
  const box = ui.answer;
  if (e.key.length === 1) box.textContent += e.key;
  else if (e.code === 'Backspace') box.textContent = box.textContent.slice(0, -1);
  caretToEnd();
  if (practice.checked) scorePractice(box.textContent);
}

function openPractice(idx) {
  const mode = settings.mode;
  if (!practice || practice.idx !== idx || practice.mode !== mode) {
    if (practice) closePractice(false);
    practice = { idx, mode, checked: false, state: 'idle', heard: '', interim: '', note: '', segments: [], voice: null, attempt: 0, score: null };
    ui.root.classList.remove('sl-reveal');
    ui.answer.textContent = '';
    clearMarks();
    ui.stripWrap.hidden = false;
    trace('open', mode + ' line ' + idx);
  }
  if (mode === 'speak') {
    startListening();
    return;
  }
  paintPractice();
  focusBox();
  // The player reacts to the pause a moment later and may take the focus then; no focus event
  // is fired for that if the window itself is not focused, so check once more.
  setTimeout(() => {
    if (boxWantsFocus() && !ui.root.contains(document.activeElement)) focusBox();
  }, 250);
}

// Colours the words of the line on screen: got or missed. Each word element is matched to the
// spoken tokens that start inside it, by their position in the line's text.
function markWords(hit) {
  const tokens = spokenTokens(primary.cues[practice.idx].text);
  let pos = 0;
  for (const node of ui.pri.childNodes) {
    const length = node.nodeName === 'BR' ? 1 : node.textContent.length;
    if (node.nodeType === 1 && node.classList.contains('sl-word')) {
      const mine = [];
      tokens.forEach((token, i) => {
        if (token.start >= pos && token.start < pos + length) mine.push(i);
      });
      node.classList.toggle('sl-ok', mine.length > 0 && mine.every((i) => hit[i]));
      node.classList.toggle('sl-miss', mine.length > 0 && !mine.every((i) => hit[i]));
    }
    pos += length;
  }
}

function clearMarks() {
  for (const w of ui.pri.querySelectorAll('.sl-ok, .sl-miss')) w.classList.remove('sl-ok', 'sl-miss');
}

// Compares an answer (typed, or heard by the recogniser) with the line. Only the first check of
// a line counts towards the session score; after it the marks simply follow the answer.
function scorePractice(answer) {
  const expected = spokenWords(primary.cues[practice.idx].text);
  const hit = matchWords(expected, spokenWords(answer));
  const ok = hit.filter(Boolean).length;
  if (!practice.checked) {
    const stats = practiceStats[practice.mode];
    stats.ok += ok;
    stats.total += expected.length;
    trace('check', practice.mode + ' ' + ok + '/' + expected.length);
  }
  practice.checked = true;
  practice.score = [ok, expected.length];
  ui.root.classList.add('sl-reveal'); // in writing practice the line is hidden until now
  markWords(hit);
  paintPractice();
}

function paintPractice() {
  if (!practice) return;
  const speaking = practice.mode === 'speak';
  const listening = practice.state === 'listening';
  ui.answer.hidden = speaking;
  ui.heard.hidden = !speaking;
  if (speaking) {
    ui.heard.classList.toggle('sl-listening', listening);
    ui.heard.classList.toggle('sl-problem', practice.state === 'error');
    ui.heardText.textContent = listening
      ? practice.interim || segmentsText(practice) || slT('listening')
      : practice.state === 'error'
        ? practice.note
        : slT('heard', practice.heard);
  }
  ui.checkBtn.hidden = speaking;
  ui.checkBtn.textContent = practice.checked ? slT('goOn') : slT('check');
  ui.sayBtn.hidden = !speaking || listening;
  ui.doneBtn.hidden = !speaking || !listening;
  ui.voiceBtn.hidden = !speaking || listening || !practice.voice;
  ui.goBtn.hidden = !speaking || listening;
  // The score sits beside what was heard when speaking, and beside the buttons when writing.
  const scoreHome = speaking ? ui.heard : ui.actions;
  if (ui.score.parentNode !== scoreHome) scoreHome.appendChild(ui.score);
  const stats = practiceStats[practice.mode];
  ui.score.textContent = practice.score
    ? slT(speaking ? 'scoreSpeak' : 'scoreWrite', practice.score[0], practice.score[1], Math.round((100 * stats.ok) / stats.total))
    : '';
}

function closePractice(play) {
  if (!practice) return;
  practice = null;
  stopListening(false);
  trace('close', play ? 'and play' : '');
  ui.stripWrap.hidden = true;
  ui.root.classList.remove('sl-reveal');
  clearMarks();
  ui.answer.blur();
  if (play && video) video.play().catch(() => {});
}

function practiceEnter() {
  if (!practice) return;
  if (practice.mode === 'speak') {
    if (practice.state === 'listening') stopListening(true);
    else closePractice(true);
  } else if (practice.checked) closePractice(true);
  else scorePractice(ui.answer.textContent);
}

function practiceReplay() {
  if (!practice) return;
  trace('replay', 'line ' + practice.idx);
  stopListening(false);
  seekTo(practice.idx);
  if (practice.mode === 'write') focusBox();
}

// ---------- speaking practice: speech recognition and the learner's own recording ----------

// What went wrong with the speech recogniser, as the key of the text that says so.
const SPEECH_PROBLEMS = {
  'not-allowed': 'micDenied',
  'service-not-allowed': 'micDenied',
  'no-speech': 'noSpeech',
  'audio-capture': 'noMic',
  network: 'speechOffline',
  unsupported: 'speechMissing',
};

const segmentsText = (p) => p.segments.map((alternatives) => alternatives[0]).join(' ');

function startListening() {
  const p = practice;
  if (!p || p.mode !== 'speak') return;
  stopListening(false);
  stopSpeech();
  clearMarks();
  const attempt = ++p.attempt;
  Object.assign(p, { state: 'listening', heard: '', interim: '', note: '', segments: [], problem: '' });
  paintPractice();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const cue = primary.cues[p.idx];
  const wanted = spokenWords(cue.text).length;
  let r;
  try {
    r = new Recognition();
    r.lang = speechLang();
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 3;
  } catch (e) {
    failListening(p, 'unsupported');
    return;
  }
  r.onresult = (e) => {
    if (recog !== r) return;
    const finals = [];
    let interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const result = e.results[i];
      if (!result.isFinal) interim += result[0].transcript;
      else finals.push(Array.from({ length: result.length }, (_, k) => result[k].transcript));
    }
    p.segments = finals;
    p.interim = interim;
    paintPractice();
    // Stop soon after the whole line has been heard; otherwise wait out a pause in the speech.
    clearTimeout(quietTimer);
    quietTimer = setTimeout(() => stopListening(true), spokenWords(segmentsText(p)).length >= wanted ? 350 : 2200);
  };
  r.onerror = (e) => {
    if (recog !== r) return;
    p.problem = e.error;
    trace('speech-error', e.error);
  };
  r.onend = () => {
    if (recog !== r) return;
    recog = null;
    finishListening(p);
  };
  recog = r;
  try {
    r.start();
  } catch (e) {
    recog = null;
    failListening(p, 'unsupported');
    return;
  }
  trace('listen', r.lang);
  record(p, attempt);
  listenTimer = setTimeout(() => stopListening(true), Math.max(8000, (cue.end - cue.start) * 2500 + 5000));
}

// `evaluate`: let the recogniser finish and score what it heard. Otherwise the attempt is dropped.
function stopListening(evaluate) {
  clearTimeout(listenTimer);
  clearTimeout(quietTimer);
  const r = recog;
  if (!r) return;
  if (evaluate) {
    try {
      r.stop();
    } catch (e) { /* already stopping */ }
    return;
  }
  recog = null;
  try {
    r.abort();
  } catch (e) { /* already stopped */ }
  stopRecording();
}

function finishListening(p) {
  clearTimeout(listenTimer);
  clearTimeout(quietTimer);
  stopRecording();
  if (practice !== p) return;
  const heard = bestTranscript(p);
  if (!heard) {
    failListening(p, p.problem || 'no-speech');
    return;
  }
  p.heard = heard;
  p.state = 'result';
  trace('heard', spokenWords(heard).length + ' words');
  scorePractice(heard);
}

function failListening(p, code) {
  stopRecording();
  if (practice !== p) return;
  p.state = 'error';
  p.note = SPEECH_PROBLEMS[code] ? slT(SPEECH_PROBLEMS[code]) : slT('speechFailed', code);
  trace('speech-failed', code);
  paintPractice();
}

// The recogniser offers a few readings of each stretch of speech. The learner was understood if
// any of them is the line, so for each stretch the reading that matches the line best is kept.
function bestTranscript(p) {
  const expected = spokenWords(primary.cues[p.idx].text);
  const matches = (parts) => matchWords(expected, spokenWords(parts.join(' '))).filter(Boolean).length;
  const chosen = p.segments.map((alternatives) => alternatives[0]);
  p.segments.forEach((alternatives, s) => {
    for (const alternative of alternatives.slice(1)) {
      const trial = chosen.slice();
      trial[s] = alternative;
      if (matches(trial) > matches(chosen)) chosen[s] = alternative;
    }
  });
  return (chosen.join(' ') || p.interim).replace(/\s+/g, ' ').trim();
}

// Records the attempt so the learner can hear themselves next to the original.
async function record(p, attempt) {
  if (!navigator.mediaDevices || !window.MediaRecorder) return;
  try {
    if (!micStream || !micStream.active) micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (e) {
    trace('mic', String((e && e.name) || e));
    return;
  }
  if (practice !== p || p.attempt !== attempt || p.state !== 'listening') return;
  const rec = new MediaRecorder(micStream);
  const chunks = [];
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.onstop = async () => {
    try {
      ensureAudio();
      const voice = await audioCtx.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
      if (practice !== p || p.attempt !== attempt) return;
      p.voice = voice;
      paintPractice();
    } catch (e) {
      trace('voice', 'could not be decoded');
    }
  };
  recorder = rec;
  rec.start();
}

function stopRecording() {
  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
    } catch (e) { /* already stopped */ }
  }
  recorder = null;
  // The microphone stays open between attempts so the first word is not clipped, and is
  // released once practice has been idle for a while.
  clearTimeout(micIdle);
  micIdle = setTimeout(releaseMic, 90000);
}

function releaseMic() {
  clearTimeout(micIdle);
  if (!micStream) return;
  for (const track of micStream.getTracks()) track.stop();
  micStream = null;
}

function playVoice() {
  if (!practice || !practice.voice) return;
  stopSpeech();
  playBuffer(practice.voice);
}
