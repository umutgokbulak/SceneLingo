// The overlay: an episode's own words, to learn before or while watching it, and questions on the
// part of it that has been watched. Both live in the list of lines, as its other two tabs.
'use strict';

const EPISODES_KEPT = 20; // episodes whose meanings from Gemini are kept, so that it is asked once
const QUIZ_QUESTIONS = 5;
const QUIZ_FROM = 10; // lines watched before there is enough to ask about
const LEVELS = ['A2', 'B1', 'B2', 'C1'];

let panelTab = 'lines'; // 'lines' | 'words' | 'quiz'
let episode = null; // what is known of the episode on screen: see episodeNow()

// The episode on screen, known by its lines: its words (found once), their meanings, and the quiz.
function episodeNow() {
  if (!primary || !primary.cues.length) return null;
  const lines = primary.cues.map((c) => c.text);
  const key = slEpisodeKey(lines);
  if (!episode || episode.key !== key) {
    episode = { key, lines, lang: langOf(primary.track.languageCode), words: null, level: '', meanings: new Map(), engine: '', phrases: [], gloss: 'none', quiz: null, hasKey: null };
  }
  return episode;
}

// After something has come back: drawn again, if the tab is still the one open, on the same episode.
function repaintTab(ep, tab) {
  if (ui && !ui.panel.hidden && panelTab === tab && episode === ep) buildPanel();
}

function paintTabs() {
  for (const b of ui.tabs.querySelectorAll('.sl-tab')) b.classList.toggle('sl-on', b.dataset.tab === panelTab);
}

function pnote(text) {
  ui.list.append(el('div', 'sl-pnote', text));
}

// The page and the moment of a line, so that a card saved from the list goes back to its scene.
function sceneAt(cue) {
  const here = sceneHere();
  return here && cue ? { url: here.url, time: Math.round(cue.start + offset) } : here;
}

// ---------- the words ----------

function buildWords() {
  const ep = episodeNow();
  if (!ep) return pnote(slT('episodeNoLines'));
  const level = LEVELS.includes(settings.wordLevel) ? settings.wordLevel : 'B1';
  if (ep.level !== level) {
    ep.level = level;
    ep.words = null;
    ep.meanings = new Map();
    ep.engine = '';
    ep.gloss = 'none';
    ep.phrases = [];
  }
  const head = el('div', 'sl-ehead');
  const sel = el('select');
  for (const l of LEVELS) sel.append(Object.assign(el('option', null, l), { value: l }));
  sel.value = level;
  sel.addEventListener('change', () => {
    setSetting('wordLevel', sel.value);
    buildPanel();
  });
  head.append(el('span', null, slT('episodeWordsFor')), sel);
  ui.list.append(head);
  if (!ep.words) {
    pnote(slT('lookingUp'));
    loadWords(ep);
    return;
  }
  if (ep.noList) pnote(slT('episodeNoList', langName(ep.lang)));
  else if (!ep.words.length) pnote(slT('episodeNoWords'));
  for (const w of ep.words) {
    const m = ep.meanings.get(w.word) || {};
    ui.list.append(episodeRow({ text: w.word, base: m.base, meaning: m.meaning, count: w.count, line: w.first, engine: ep.engine }));
  }
  if (ep.engine) ui.list.append(el('div', 'sl-esource', slT('episodeMeaningsBy', ep.engine === 'gemini' ? slT('episodeByGemini') : slT('episodeByMachine'))));
  // Gemini: the meanings in their lines, and the idioms of the episode, once asked for.
  if (ep.phrases.length) {
    ui.list.append(el('div', 'sl-esub', slT('episodePhrases')));
    for (const p of ep.phrases) ui.list.append(episodeRow({ text: p.text, base: p.base, meaning: p.meaning, line: p.line, engine: 'gemini' }));
  }
  if (ep.hasKey === null) {
    send({ type: 'gemini-key' }).then((res) => {
      ep.hasKey = !!(res.ok && res.result);
      repaintTab(ep, 'words');
    });
  } else if (ep.hasKey && ep.gloss !== 'done') {
    const b = el('button', 'sl-ebtn', ep.gloss === 'asking' ? slT('quizThinking') : slT('episodeGloss'));
    b.disabled = ep.gloss === 'asking';
    b.addEventListener('click', () => glossWords(ep));
    ui.list.append(b);
    if (ep.gloss === 'failed') pnote(slT('episodeFailed', ep.glossError || '?'));
  }
}

// The words, from the background (which has the lists), then their meanings: kept from Gemini
// for this episode at this level, or else the plain translation of each.
function loadWords(ep) {
  if (ep.loading) return;
  ep.loading = true;
  const level = ep.level;
  send({ type: 'episode-words', lines: ep.lines, lang: ep.lang, level, known: [...savedWords] }).then((res) => {
    ep.loading = false;
    if (episode !== ep || ep.level !== level) return;
    ep.words = res.ok ? res.result.words : [];
    ep.noList = !!(res.ok && res.result.noList);
    chrome.storage.local.get({ episodes: {} }, (data) => {
      const kept = (data.episodes || {})[ep.key];
      if (kept && kept.level === level && kept.gloss) {
        useGloss(ep, kept.gloss);
        return repaintTab(ep, 'words');
      }
      repaintTab(ep, 'words');
      if (!ep.words.length) return;
      send({ type: 'translate', texts: ep.words.map((w) => w.word), sl: ep.lang, tl: settings.nativeLang }).then((tr) => {
        if (!tr.ok || ep.engine === 'gemini') return;
        ep.words.forEach((w, i) => tr.result[i] && ep.meanings.set(w.word, { meaning: String(tr.result[i]).trim() }));
        ep.engine = 'machine';
        repaintTab(ep, 'words');
      });
    });
  });
}

function useGloss(ep, gloss) {
  for (const w of gloss.words) ep.meanings.set(w.word, { meaning: w.meaning, base: w.base });
  ep.phrases = gloss.phrases;
  ep.engine = 'gemini';
  ep.gloss = 'done';
}

function glossWords(ep) {
  if (ep.gloss === 'asking') return;
  ep.gloss = 'asking';
  buildPanel();
  const level = ep.level;
  const lines = ep.lines.map((text, i) => ({ i, text }));
  send({ type: 'episode-gloss', words: ep.words, lines, sl: ep.lang, tl: settings.nativeLang, level }).then((res) => {
    if (episode !== ep || ep.level !== level) return;
    if (!res.ok) {
      ep.gloss = 'failed';
      ep.glossError = res.error;
      return repaintTab(ep, 'words');
    }
    useGloss(ep, res.result);
    repaintTab(ep, 'words');
    // Kept for this episode, so that coming back to it costs nothing.
    chrome.storage.local.get({ episodes: {} }, (data) => {
      const all = { ...(data.episodes || {}), [ep.key]: { at: Date.now(), level, gloss: res.result } };
      const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
      for (const k of keys.slice(EPISODES_KEPT)) delete all[k];
      chrome.storage.local.set({ episodes: all });
    });
  });
}

// A word or a phrase of the episode: what it means, the line it is in, and a star to save it with
// that line as its sentence.
function episodeRow({ text, base, meaning, count, line, engine }) {
  const row = el('div', 'sl-erow');
  const word = el('div', 'sl-eword');
  word.append(el('b', null, text));
  if (base && base.toLowerCase() !== text.toLowerCase()) word.append(el('small', null, base));
  if (count > 1) word.append(el('span', 'sl-ecount', '×' + count));
  const cue = line != null && primary ? primary.cues[line] : null;
  const tools = el('div', 'sl-etools');
  if (cue) tools.append(button('sl-ibtn sl-esmall', 'play', null, slT('episodeGo') + ' · ' + fmtTime(cue.start), () => seekTo(line)));
  const star = el('button', 'sl-ibtn sl-esmall');
  const paint = () => {
    const on = savedWords.has(text.toLowerCase());
    star.textContent = on ? '★' : '☆';
    star.classList.toggle('sl-on', on);
    star.title = slT(on ? 'saved' : 'save');
  };
  paint();
  star.addEventListener('click', () => {
    const lineText = cue ? cue.text.replace(/\s*\n\s*/g, ' ') : '';
    toggleSaved({
      word: text,
      kind: /\s/.test(text) ? 'phrase' : 'word',
      translation: meaning || '',
      context: lineText,
      contextTranslation: cue ? lineTranslation(cue) : '',
      contextMeaning: engine === 'gemini' ? meaning || '' : '',
      contextPhrase: base && base.toLowerCase() !== text.toLowerCase() ? base : '',
      senseEngine: engine === 'gemini' ? 'gemini' : undefined,
      sensed: engine === 'gemini' || undefined,
      lang: langOf(primary.track.languageCode),
      title: document.title,
      added: Date.now(),
      source: sceneAt(cue),
    }).then(paint);
  });
  tools.append(star);
  row.append(word, tools, el('div', 'sl-emean', meaning || '…'));
  return row;
}

// ---------- the questions ----------

// The last line that has begun: what has been watched.
function watchedUpTo() {
  if (!primary || !video) return -1;
  return lastStarted(primary.cues, video.currentTime - offset);
}

function buildQuiz() {
  const ep = episodeNow();
  if (!ep) return pnote(slT('episodeNoLines'));
  if (ep.hasKey === null) {
    pnote(slT('lookingUp'));
    send({ type: 'gemini-key' }).then((res) => {
      ep.hasKey = !!(res.ok && res.result);
      repaintTab(ep, 'quiz');
    });
    return;
  }
  if (!ep.hasKey) return pnote(slT('quizNeedsKey'));
  const quiz = ep.quiz;
  if (quiz && quiz.questions) return paintQuiz(ep, quiz);
  const upto = watchedUpTo();
  const box = el('div', 'sl-quiz');
  box.append(el('p', null, slT('quizAbout', upto + 1, fmtTime(upto >= 0 ? primary.cues[upto].end : 0))));
  if (quiz && quiz.error) box.append(el('p', 'sl-pnote', slT('episodeFailed', quiz.error)));
  if (upto + 1 < QUIZ_FROM) box.append(el('p', 'sl-pnote', slT('quizTooEarly')));
  else {
    const b = el('button', 'sl-ebtn', quiz && quiz.asking ? slT('quizThinking') : slT('quizMake', QUIZ_QUESTIONS));
    b.disabled = !!(quiz && quiz.asking);
    b.addEventListener('click', () => makeQuiz(ep, upto));
    box.append(b);
  }
  ui.list.append(box);
}

function makeQuiz(ep, upto) {
  ep.quiz = { asking: true };
  buildPanel();
  const lines = ep.lines.slice(0, upto + 1).map((text, i) => ({ i, text }));
  send({ type: 'episode-quiz', lines, sl: ep.lang, tl: settings.nativeLang, level: LEVELS.includes(settings.wordLevel) ? settings.wordLevel : 'B1', count: QUIZ_QUESTIONS }).then((res) => {
    if (episode !== ep) return;
    ep.quiz = res.ok ? { questions: res.result, chosen: [], upto, logged: false } : { error: res.error };
    repaintTab(ep, 'quiz');
  });
}

function paintQuiz(ep, quiz) {
  const box = el('div', 'sl-quiz');
  quiz.questions.forEach((q, n) => {
    const item = el('div', 'sl-qitem');
    item.append(el('div', 'sl-qtext', n + 1 + '. ' + q.q));
    const chosen = quiz.chosen[n];
    q.options.forEach((o, i) => {
      const b = el('button', 'sl-opt', o);
      if (chosen != null) {
        b.disabled = true;
        if (i === q.answer) b.classList.add('sl-right');
        else if (i === chosen) b.classList.add('sl-wrong');
      }
      b.addEventListener('click', () => {
        if (quiz.chosen[n] != null) return;
        quiz.chosen[n] = i;
        buildPanel();
      });
      item.append(b);
    });
    if (chosen != null) {
      const why = el('div', 'sl-why', (chosen === q.answer ? '✓ ' : '✗ ') + (q.why || ''));
      if (q.line != null && primary.cues[q.line]) {
        const go = el('button', 'sl-link', slT('episodeGo') + ' · ' + fmtTime(primary.cues[q.line].start));
        go.addEventListener('click', () => seekTo(q.line));
        why.append(' ', go);
      }
      item.append(why);
    }
    box.append(item);
  });
  const answered = quiz.chosen.filter((c) => c != null).length;
  if (answered === quiz.questions.length) {
    const right = quiz.questions.filter((q, n) => quiz.chosen[n] === q.answer).length;
    box.append(el('div', 'sl-qscore', slT('quizScore', right, quiz.questions.length)));
    if (!quiz.logged) {
      quiz.logged = true;
      // In the record of days, as understanding what was heard.
      chrome.storage.local.get({ reviewLog: {} }, (d) => chrome.storage.local.set({ reviewLog: slLogActivity(d.reviewLog || {}, Date.now(), 'quiz', Math.round((right / quiz.questions.length) * 100)) }));
    }
    const again = el('button', 'sl-ebtn', slT('quizAgain'));
    again.addEventListener('click', () => {
      ep.quiz = null;
      buildPanel();
    });
    box.append(again);
  }
  ui.list.append(box);
}
