// The overlay: the card a word opens (its meaning here, its voice, its dictionary entry, saving it),
// and what can be done with a whole line.
'use strict';

// ---------- word popup ----------

// `anchor` is the word element, or the selected range when `text` is a phrase.
async function openPopup(anchor, pin, text) {
  const cue = primary && primary.cues[shown.idx];
  const lang = primary ? primary.track.languageCode : '';
  const english = speaksEnglish();
  const shouting = !!cue && isShouting(cue.text);
  const word = shouting ? calm(text || anchor.textContent, false, english) : text || anchor.textContent;
  // "I'll" is looked up as "I will": on its own the service reads it as "ill". Spoken forms
  // such as "gonna" it knows, so they are looked up as they are and only explained.
  const expansion = english ? expandContraction(word) : null;
  const query = expansion && /['\u2019]/.test(word) ? expansion : word;
  if (video && !video.paused && (pin || settings.hoverPause)) {
    pauseVideo();
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
  const listen = button('sl-pop-btn', 'volume', null, slT('listen'), () => speak(word));
  const slow = button('sl-pop-btn', null, slT('slow'), slT('listenSlow'), () => speak(word, true));
  const ipa = el('span', 'sl-pop-ipa');
  const save = button('sl-pop-btn sl-pop-save', 'star', slT('save'), null, null);
  const body = el('div', 'sl-pop-body', '…');
  const paintSave = () => {
    const on = savedWords.has(word.toLowerCase());
    save.lastChild.textContent = on ? slT('saved') : slT('save');
    save.classList.toggle('sl-on', on);
  };
  paintSave();
  btns.append(listen, slow, save);
  const title = el('span', 'sl-pop-title');
  // A German noun with its article in the colour of its gender, and its plural.
  // Another form of it ("Häusern") says which noun it is.
  const nouns = langOf(lang) === 'de' ? germanNouns() : null;
  const noun = nouns && !/\s/.test(word.trim()) ? slNounText(slNoun(nouns, word)) : null;
  const isLemma = !!noun && noun.lemma.toLowerCase() === word.trim().toLowerCase();
  if (isLemma) title.append(el('span', 'sl-pop-art sl-g' + noun.g, noun.article));
  title.append(el('span', 'sl-pop-word', isLemma ? noun.lemma : word), ipa);
  if (noun && !isLemma) title.append(el('span', 'sl-pop-expand', '→ ' + noun.article + ' ' + noun.lemma));
  if (noun && noun.plural && !noun.pluralOnly) title.append(el('span', 'sl-pop-plural', slT('plural') + ' ' + noun.plural));
  if (expansion) title.append(el('span', 'sl-pop-expand', '= ' + expansion));
  head.append(title, btns);
  ui.popup.textContent = '';
  ui.popup.append(head, body);
  ui.popup.hidden = false;
  placePopup(anchor);

  let translation = '';
  let info = {};
  let sensed = null; // what the word means in this sentence, when that is known
  save.addEventListener('click', () => {
    toggleSaved({
      word,
      kind: /\s/.test(word) ? 'phrase' : 'word',
      translation,
      ipa: info.ipa || '',
      definition: info.defs && info.defs[0] ? info.defs[0].text : '',
      synonyms: info.synonyms || [],
      context: cue ? cueSentence() : '',
      // The line under the subtitle: the sentence in one's own language, where the word means what it means.
      contextTranslation: cue && shown.sec ? shown.sec.replace(/\s*\n\s*/g, ' ') : '',
      contextMeaning: sensed ? sensed.meaning : '',
      contextPhrase: sensed ? sensed.phrase || '' : '',
      contextNote: sensed ? sensed.note || '' : '',
      lang: langOf(lang),
      title: document.title,
      added: Date.now(),
      looked: 2,
      source: sceneHere(),
    }).then(paintSave);
  });

  // Asked for once the card has stayed open a moment, so that a mouse passing over words does
  // not spend the free quota of the user's key.
  const sentence = cue ? cueSentence() : '';
  // Several words are explained (a translation that is not word for word, the idioms in them);
  // one word or two get their meaning in the sentence. A selection of the whole line has no
  // other sentence to be read in.
  const many = word.trim().split(/\s+/).length >= 3;
  const whole = !!sentence && slNormalize(sentence) === slNormalize(word);
  const question = many ? { type: 'explain', text: word, sentence } : !whole && sentence ? { type: 'sense', word, sentence } : null;
  const senseJob = question
    ? new Promise((r) => setTimeout(r, 350)).then(() => (token === popupToken ? send({ ...question, sl: lang, tl: settings.nativeLang }) : null))
    : Promise.resolve(null);
  const res = await lookup(query, lang);
  if (token !== popupToken) return;
  body.textContent = '';
  if (!res.ok) {
    body.textContent = res.error === STALE ? slT('stale') : slT('translateFailed', res.error);
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
    // Pointing at a word gives the short card; clicking it pins the card and opens the rest.
    const entries = info.dict || [];
    const defs = info.defs || [];
    const synonyms = info.synonyms || [];
    for (const d of entries.slice(0, pin ? 4 : 1)) labelled('sl-pop-dict', d.pos, d.terms.join(', '));
    if (pin) {
      defs.slice(0, 2).forEach((d, i) => {
        labelled('sl-pop-def', d.pos, d.text);
        if (d.example && i === 0) body.append(el('div', 'sl-pop-ex', '“' + d.example + '”'));
      });
      if (synonyms.length) labelled('sl-pop-syn', slT('synonyms'), synonyms.join(', '));
    } else if (defs.length || synonyms.length || entries.length > 1) {
      body.append(el('div', 'sl-pop-more', slT('clickForMore')));
    }
    senseJob.then((r) => {
      if (token !== popupToken) return;
      if (many) {
        const x = r && r.ok && r.result;
        if (x && x.translation) {
          // What is saved is the good translation, with the idioms as its note.
          translation = x.translation;
          sensed = { meaning: x.translation, phrase: '', note: x.idioms.map((i) => i.text + ' — ' + i.meaning).join(' · '), engine: 'gemini' };
          body.insertBefore(explainBox(x), body.children[1] || null);
        } else {
          // No Gemini: the machine's reading is word for word, and the line on screen may be a person's.
          const human = secondary.kind === 'track';
          body.append(el('div', 'sl-pop-more', slT('mtNote') + (human ? ' ' + slT('mtNoteHuman') : '')));
        }
        if (ui.pri.contains(anchor.commonAncestorContainer || anchor)) placePopup(anchor);
        return;
      }
      if (!r || !r.ok || !r.result || !r.result.meaning) return;
      sensed = r.result;
      // Said only when it adds something to the headline above it.
      if (!sensed.phrase && !sensed.note && sensed.meaning.toLowerCase() === String(translation).toLowerCase()) return;
      body.insertBefore(senseBox(sensed), body.children[1] || null);
      if (ui.pri.contains(anchor.commonAncestorContainer || anchor)) placePopup(anchor);
    });
  }
  if (ui.pri.contains(anchor.commonAncestorContainer || anchor)) placePopup(anchor);
}

// "Natural translation: …", and each idiom with what it means and what it says word for word.
function explainBox(x) {
  const box = el('div', 'sl-pop-sense');
  const line = el('div', 'sl-pop-sense-line');
  line.append(el('span', 'sl-pop-pos', slT('naturalTr')), document.createTextNode(' ' + x.translation));
  line.append(el('span', 'sl-pop-engine', 'Gemini'));
  box.append(line);
  for (const i of x.idioms) {
    const row = el('div', 'sl-pop-sense-note');
    row.append(el('b', null, i.text), document.createTextNode(' — ' + i.meaning + (i.literal ? ' (' + slT('literally', i.literal) + ')' : '')));
    box.append(row);
  }
  if (x.note) box.append(el('div', 'sl-pop-sense-note', x.note));
  return box;
}

// "In this sentence: rip off — soymak", and a note on the use when the model gave one.
function senseBox(s) {
  const box = el('div', 'sl-pop-sense');
  const line = el('div', 'sl-pop-sense-line');
  line.append(el('span', 'sl-pop-pos', slT('inSentence')), document.createTextNode(' ' + (s.phrase ? s.phrase + ' — ' : '') + s.meaning));
  // Who answered: so that it is plain whether Gemini is in use.
  line.append(el('span', 'sl-pop-engine', s.engine === 'gemini' ? 'Gemini' : slT('engineMarked')));
  box.append(line);
  if (s.note) box.append(el('div', 'sl-pop-sense-note', s.note));
  return box;
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
  // Sit above the whole stack, so the line, the practice strip and the bar stay in view.
  ui.popup.style.bottom = rr.bottom - ui.barWrap.getBoundingClientRect().top + 'px';
}

function closePopup(mayResume) {
  if (!ui || ui.popup.hidden) return false;
  popupToken++;
  popupWord = null;
  popupPinned = false;
  clearTimeout(closeTimer);
  ui.popup.hidden = true;
  if (mayResume && hoverPaused && !ui.subs.matches(':hover')) resume();
  if (practice && practice.mode === 'write' && !pointerHeld) focusBox();
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

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  audioGain = audioCtx.createGain();
  const limiter = audioCtx.createDynamicsCompressor();
  limiter.threshold.value = -6;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  audioGain.connect(limiter).connect(audioCtx.destination);
}

async function speak(text, slow) {
  if (!text) return;
  const token = ++speakToken;
  const lang = speechLang();
  stopSpeech();
  try {
    ensureAudio();
    const buffer = await recordedSpeech(text, lang, !!slow);
    if (token === speakToken) playBuffer(buffer);
  } catch (e) {
    if (token === speakToken) synthSpeech(text, lang, !!slow);
  }
}

// The page and the moment of the film, so that a card can take one back to its scene.
function sceneHere() {
  if (!video) return null;
  const url = window.top === window ? location.href : document.referrer || location.href;
  return /^https?:/.test(url) ? { url, time: Math.round(video.currentTime) } : null;
}

// A saved word met again in another line becomes another example on its card. Collected while
// watching and written now and then, not at every line.
const metLines = new Set();
let metQueue = [];
let metTimer = 0;
function noticeSaved(cue) {
  if (!savedWords.size || !cue || !connected()) return;
  const text = cue.text.replace(/\s*\n\s*/g, ' ').trim();
  const flat = ' ' + text.toLowerCase().replace(/[^\p{L}\p{N}']+/gu, ' ') + ' ';
  for (const key of savedWords) {
    if (key.split(' ').length > 4 || !flat.includes(' ' + key + ' ')) continue;
    const id = key + '|' + text;
    if (metLines.has(id)) continue;
    metLines.add(id);
    metQueue.push({ key, example: { text, title: document.title, source: sceneHere() } });
  }
  if (metQueue.length && !metTimer) metTimer = setTimeout(writeMet, 4000);
}
function writeMet() {
  metTimer = 0;
  const met = metQueue;
  metQueue = [];
  if (!connected()) return;
  chrome.storage.local.get({ words: [] }, (data) => {
    let changed = false;
    const words = data.words.map((w) => {
      let out = w;
      for (const m of met) if (m.key === w.word.toLowerCase()) out = slAddExample(out, m.example);
      if (out !== w) changed = true;
      return out;
    });
    if (changed) chrome.storage.local.set({ words });
  });
}

function toggleSaved(entry) {
  if (!connected()) {
    warnStale();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    chrome.storage.local.get({ words: [] }, (data) => {
      const key = entry.word.toLowerCase();
      const had = data.words.some((w) => w.word.toLowerCase() === key);
      if (had) slForget(key);
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

// The current line as one sentence, in ordinary capitalisation.
function cueSentence() {
  const cue = primary && primary.cues[shown.idx];
  if (!cue) return '';
  const text = cue.text.replace(/\s*\n\s*/g, ' ');
  return isShouting(text) ? calm(text, true, speaksEnglish()) : text;
}

function paintSentenceStar() {
  if (!ui) return;
  const text = cueSentence();
  ui.starBtn.classList.toggle('sl-on', !!text && savedWords.has(text.toLowerCase()));
}

function speakSentence() {
  const text = cueSentence();
  if (!text) return;
  if (video && !video.paused) {
    pauseVideo();
    hoverPaused = true;
  }
  speak(text);
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
  await toggleSaved({ word: text, kind: 'sentence', translation, context: '', lang: langOf(lang), title: document.title, added: Date.now(), source: sceneHere() });
  toast(savedWords.has(text.toLowerCase()) ? slT('sentenceSaved') : slT('sentenceRemoved'));
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

// Plays the current line again at reduced speed: the film's own sound, not the synthetic voice.
function replaySlow() {
  if (!primary || !video) return;
  const t = video.currentTime - offset;
  const active = findCue(primary.cues, t);
  const i = active >= 0 ? active : lastStarted(primary.cues, t);
  if (i < 0) return;
  const rate = slowFor >= 0 ? normalRate : video.playbackRate;
  seekTo(i);
  normalRate = rate;
  slowFor = i;
  video.playbackRate = SLOW_PLAY;
}

function restoreRate() {
  if (slowFor < 0) return;
  slowFor = -1;
  if (video) video.playbackRate = normalRate;
}
