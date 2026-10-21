// Speaking practice. Everyday situations, played out with Gemini in the language being learnt,
// each turn of the learner's put right; and, in English, the IELTS Speaking test's three parts,
// each answer scored as an examiner would, with a better answer to learn from.
const PART1_QUESTIONS = 4;
const FULL_PART1 = 3;
const PREP_SECONDS = 60;
const TALK_SECONDS = 120;

let settings = { ...SL_DEFAULTS };
let geminiKey = '';
let words = [];
let level = 'B1';
const audio = new Audio();

const learnt = () => settings.learnLang;
const voice = () => (learnt() === 'en' ? settings.accent : learnt());
const sceneTitle = (scene) => scene.title[slUiLang] || scene.title.en;

function screen(id) {
  for (const s of ['home', 'exam', 'talk', 'end']) $(s).hidden = s !== id;
  $('toHome').hidden = id === 'home';
  scrollTo(0, 0);
}

// ---------- the voice ----------

function say(text, slow) {
  recorder.stop();
  ask({ type: 'tts', text, lang: voice(), slow: !!slow }).then((res) => {
    // On the phone the page speaks for itself.
    if (!res.ok) return;
    audio.src = 'data:audio/mpeg;base64,' + res.result;
    audio.volume = Math.min(1, settings.speechVolume / 100);
    audio.playbackRate = slow ? 0.8 : 1;
    audio.play().catch(() => {});
  });
}
const sayButton = (text) => {
  const b = btn(slIcon('speaker'), () => say(text), 'round small');
  b.title = slT('reviewListen');
  return b;
};

// ---------- the microphone ----------

// Speech written down into a box as it is said. The recogniser stops by itself after a pause, so
// while recording it is started again; what it had heard stays.
const recorder = (() => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  let on = false;
  let box = null;
  let mic = null;
  let status = null;
  let kept = '';
  let started = 0;
  let tick = null;
  let restarts = 0; // in quick succession: the recogniser cannot work here
  let lastStart = 0;
  const paint = () => {
    if (!mic) return;
    mic.classList.toggle('on', on);
    mic.textContent = '';
    mic.append(slIcon(on ? 'stop' : 'mic'));
    mic.title = slT(on ? 'speakStop' : 'speakStart') + ' (Ctrl+Space)';
    status.classList.toggle('rec', on);
    if (on) status.textContent = slT('speakListening') + ' · ' + clock(Math.round((Date.now() - started) / 1000));
  };
  function start(target) {
    if (!Recognition) {
      target.status.textContent = slT('speakNoMic');
      target.box.focus();
      return;
    }
    stop();
    ({ box, mic, status } = target);
    kept = box.value.trim() ? box.value.trim() + ' ' : '';
    on = true;
    started = Date.now();
    rec = new Recognition();
    rec.lang = voice();
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let heard = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) kept += r[0].transcript.trim() + ' ';
        else heard += r[0].transcript;
      }
      box.value = (kept + heard).replace(/\s+/g, ' ').trimStart();
      box.dispatchEvent(new Event('input'));
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture') {
        on = false;
        status.textContent = slT('speakMicBlocked');
        paint();
      }
    };
    rec.onend = () => {
      if (!on) return paint();
      restarts = Date.now() - lastStart < 1500 ? restarts + 1 : 0;
      if (restarts > 3) {
        on = false;
        status.textContent = slT('speakMicBlocked');
        return paint();
      }
      lastStart = Date.now();
      try {
        rec.start();
      } catch (e) {
        on = false;
        paint();
      }
    };
    restarts = 0;
    lastStart = Date.now();
    try {
      rec.start();
    } catch (e) {
      on = false;
    }
    clearInterval(tick);
    tick = setInterval(paint, 1000);
    paint();
  }
  function stop() {
    clearInterval(tick);
    if (!on) return;
    on = false;
    if (rec) rec.stop();
    if (status) status.textContent = '';
    paint();
  }
  return { start, stop, toggle: (target) => (on ? stop() : start(target)), get on() { return on; }, available: !!Recognition, paint };
})();

// ---------- choosing ----------

function paintHome() {
  screen('home');
  recorder.stop();
  $('noKey').hidden = !!geminiKey;
  $('noKey').textContent = slT('practiceNoKey');
  const lv = $('level');
  lv.textContent = '';
  for (const l of SL_LEVELS) lv.append(Object.assign(el('option', null, l), { value: l }));
  lv.value = level;
  const scenes = $('scenes');
  scenes.textContent = '';
  for (const scene of SL_SCENES) {
    const tile = btn([el('span', 'ic', scene.icon), el('span', null, sceneTitle(scene))], () => startTalk(scene), 'tile');
    tile.disabled = !geminiKey;
    scenes.append(tile);
  }
  $('ieltsBox').hidden = learnt() !== 'en';
  const parts = $('parts');
  parts.textContent = '';
  const part = (title, text, onClick) => {
    const tile = btn([el('b', null, title), el('small', null, text)], onClick, 'tile');
    tile.disabled = !geminiKey;
    parts.append(tile);
  };
  part('Part 1', slT('speakPartOne'), () => startExam(examPlan(1)));
  part('Part 2', slT('speakPartTwo'), () => startExam(examPlan(2)));
  part('Part 3', slT('speakPartThree'), () => startExam(examPlan(3)));
  part(slT('speakFull'), slT('speakFullSub'), () => startExam(examPlan(0)));
  chrome.storage.local.get({ geminiUsage: null }, (data) => {
    $('usage').textContent = '';
    if (geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
  });
  chrome.storage.local.get({ speakLog: [] }, (data) => {
    const recent = (data.speakLog || []).slice(-10);
    $('last').textContent = '';
    if (!recent.length) return;
    const mean = slIeltsOverall(['fluency', 'lexical', 'grammar', 'pronunciation'].reduce((o, k) => ({ ...o, [k]: recent.reduce((a, r) => a + r.bands[k], 0) / recent.length }), {}));
    $('last').append(slT('speakLast', recent.length) + ' ', el('b', null, 'Band ' + mean.toFixed(1)));
  });
}
$('level').addEventListener('change', () => {
  level = $('level').value;
  chrome.storage.local.set({ practiceLevel: level });
});

// ---------- the IELTS test ----------

// The questions of a part (1, 2, 3), or of the whole test (0): a shorter Part 1, then a card and
// the questions that go deeper into its subject.
function examPlan(part) {
  const plan = [];
  const card = pick(SL_IELTS.part2);
  if (part === 1 || part === 0) {
    const topic = pick(SL_IELTS.part1);
    for (const q of topic.questions.slice(0, part ? PART1_QUESTIONS : FULL_PART1)) plan.push({ part: 1, topic: topic.topic, question: q });
  }
  if (part === 2 || part === 0) plan.push({ part: 2, question: card.card, points: card.points });
  if (part === 3 || part === 0) for (const q of card.part3) plan.push({ part: 3, topic: card.card, question: q });
  return plan;
}

const exam = { plan: [], at: 0, results: [], phase: 'answer', timer: null, ends: 0, sent: false, tries: [], run: 0 };

function startExam(plan) {
  exam.run++;
  exam.plan = plan;
  exam.at = 0;
  exam.results = [];
  showQuestion();
}

function showQuestion() {
  const item = exam.plan[exam.at];
  if (!item) return showExamEnd();
  screen('exam');
  recorder.stop();
  clearInterval(exam.timer);
  exam.sent = false;
  const head = $('examHead');
  head.textContent = '';
  head.append(el('span', 'label', 'IELTS · Part ' + item.part), el('span', null, slT('speakQuestionOf', exam.at + 1, exam.plan.length)));
  if (item.topic && item.part === 1) head.append(el('span', null, '· ' + item.topic));
  $('question').textContent = item.question;
  $('points').hidden = !item.points;
  $('points').textContent = '';
  if (item.points) {
    $('points').append(el('li', 'lead', slT('practiceYouShouldSay')));
    for (const p of item.points) $('points').append(el('li', null, p));
  }
  exam.tries = item.part === 3 ? [] : slWordsToTry(words, 'en', 3);
  wordsToTry($('examTry'), exam.tries);
  $('examText').value = '';
  $('examText').disabled = false;
  $('examStatus').textContent = recorder.available ? '' : slT('speakNoMic');
  $('examMic').disabled = false;
  $('fb').hidden = true;
  $('fb').textContent = '';
  $('skip').hidden = false;
  paintExamGo();
  // Part 2: a minute to prepare, then two minutes to talk.
  if (item.part === 2) {
    exam.phase = 'prep';
    $('examMic').disabled = true;
    countdown(PREP_SECONDS, slT('speakPrep'), slT('speakReady'), startTalking);
  } else {
    exam.phase = 'answer';
    $('clock').hidden = true;
  }
  say(item.question);
}

// The clock is drawn once and only its time changes: a button drawn anew twice a second could
// lose the click made on it.
function countdown(seconds, label, skipLabel, then) {
  exam.ends = Date.now() + seconds * 1000;
  const box = $('clock');
  box.hidden = false;
  box.textContent = '';
  const time = el('b');
  box.append(el('span', null, label), time, el('span', 'spacer'));
  if (skipLabel) box.append(btn(skipLabel, then, 'btn small'));
  const paint = () => {
    const left = Math.max(0, Math.round((exam.ends - Date.now()) / 1000));
    time.textContent = clock(left);
    if (!left) {
      clearInterval(exam.timer);
      then();
    }
  };
  clearInterval(exam.timer);
  exam.timer = setInterval(paint, 500);
  paint();
}

function startTalking() {
  if (exam.phase !== 'prep') return;
  exam.phase = 'talk';
  $('examMic').disabled = false;
  recorder.start(examTarget());
  countdown(TALK_SECONDS, slT('speakTalk'), '', () => {
    recorder.stop();
    $('clock').hidden = true;
  });
}

const examTarget = () => ({ box: $('examText'), mic: $('examMic'), status: $('examStatus') });

function paintExamGo() {
  const last = exam.at + 1 >= exam.plan.length;
  if (exam.sent) withKey($('examGo'), slT(last ? 'speakResults' : 'speakNext'), 'Enter');
  else withKey($('examGo'), slT('speakCheck'), 'Ctrl+Enter');
  $('examGo').disabled = !exam.sent && !$('examText').value.trim();
}

async function sendAnswer() {
  const item = exam.plan[exam.at];
  const answer = $('examText').value.trim();
  if (!answer || exam.sent) return;
  recorder.stop();
  clearInterval(exam.timer);
  $('clock').hidden = true;
  exam.sent = true;
  $('examText').disabled = true;
  $('examMic').disabled = true;
  $('examGo').disabled = true;
  $('skip').hidden = true;
  const fb = $('fb');
  fb.hidden = false;
  fb.textContent = '';
  fb.append(el('div', 'muted', slT('speakScoring')));
  const run = exam.run;
  const res = await ask({ type: 'speak-feedback', part: item.part, question: item.question, points: item.points, answer, words: exam.tries, sl: 'en', tl: settings.nativeLang });
  if (res.ok) keepScore(item, res.result);
  // The test was left, or another begun, while the answer was being scored: the score is kept,
  // and nothing is drawn over what is on the page now.
  if (run !== exam.run || $('exam').hidden || exam.plan[exam.at] !== item) return;
  fb.textContent = '';
  if (!res.ok) {
    // Not lost: it can be sent again.
    exam.sent = false;
    $('examText').disabled = false;
    $('examMic').disabled = false;
    $('skip').hidden = false;
    fb.append(el('div', 'notice', failed(res.error)));
    paintExamGo();
    return;
  }
  const r = res.result;
  const overall = slIeltsOverall(r.bands);
  exam.results.push({ part: item.part, question: item.question, bands: r.bands, overall });
  paintFeedback(fb, r, overall, item);
  paintExamGo();
}

// A scored answer, in the record of days, the list of scores, and the cards of the words used.
function keepScore(item, r) {
  slLogPractice('speak');
  chrome.storage.local.get({ speakLog: [] }, (data) => {
    const log = [...(data.speakLog || []), { at: Date.now(), part: item.part, bands: r.bands }].slice(-SL_LOG_KEPT);
    chrome.storage.local.set({ speakLog: log });
  });
  rememberUsed(r.used, slT('speakTitle'));
}

const CRITERIA = [
  ['fluency', 'speakFluency'],
  ['lexical', 'practiceLexical'],
  ['grammar', 'practiceGrammar'],
  ['pronunciation', 'speakPronunciation'],
];

function paintFeedback(fb, r, overall, item) {
  const add = (...nodes) => fb.append(...nodes.filter(Boolean));
  add(bandsBox(r.bands, overall, CRITERIA), r.summary && el('div', 'summary', r.summary), fixesBlock(r.corrections));
  if (r.better) {
    const model = el('div', 'model');
    model.append(el('p', null, r.better), sayButton(r.better));
    add(block(slT('speakBetter'), model));
  }
  add(
    phrasesBlock(r.phrases, (p) => ({ word: p.text, kind: /\s/.test(p.text) ? 'phrase' : 'word', translation: p.meaning, context: sentenceWith(r.better, p.text), contextMeaning: p.meaning, senseEngine: 'gemini', sensed: true, lang: 'en', title: 'IELTS Speaking · Part ' + item.part })),
    usedBlock(r.used)
  );
  fb.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function showExamEnd() {
  screen('end');
  recorder.stop();
  const body = $('endBody');
  body.textContent = '';
  const done = exam.results;
  if (!done.length) return paintHome();
  const mean = {};
  for (const [k] of CRITERIA) mean[k] = Math.round((done.reduce((a, r) => a + r.bands[k], 0) / done.length) * 2) / 2;
  const overall = slIeltsOverall(mean);
  body.append(el('div', 'label', slT('speakEstimate')), el('div', 'big', 'Band ' + overall.toFixed(1)), el('p', 'muted', slT('speakEstimateNote')));
  const bands = bandsBox(mean, null, CRITERIA);
  body.append(bands);
  const list = el('div', 'list');
  for (const r of done) {
    const row = el('div');
    row.append(el('b', null, r.overall.toFixed(1)), el('span', null, 'Part ' + r.part + ' · ' + r.question));
    list.append(row);
  }
  body.append(list);
  const row = el('div', 'row');
  row.append(btn(slT('speakAgain'), paintHome, 'btn primary'));
  body.append(row);
}

$('examMic').addEventListener('click', () => {
  if (exam.phase === 'prep') return;
  recorder.toggle(examTarget());
});
$('examText').addEventListener('input', () => {
  paintExamGo();
  markUsed($('examTry'), $('examText').value);
});
$('examGo').addEventListener('click', () => {
  if (!exam.sent) return sendAnswer();
  exam.at++;
  showQuestion();
});
$('skip').addEventListener('click', () => {
  exam.at++;
  showQuestion();
});
$('askAgain').append(slIcon('speaker'));
$('askAgain').addEventListener('click', () => say($('question').textContent));

// ---------- a conversation ----------

const talk = { scene: null, history: [], busy: false, done: false, fixes: [], tries: [], id: 0 };

function startTalk(scene) {
  talk.id++;
  talk.scene = scene;
  talk.history = [];
  talk.done = false;
  talk.fixes = [];
  talk.logged = false;
  talk.tries = slWordsToTry(words, learnt(), 3);
  screen('talk');
  const head = $('talkHead');
  head.textContent = '';
  head.append(el('span', null, scene.icon), el('span', 'label', sceneTitle(scene)), el('span', null, '· ' + slLangName(learnt()) + ' · ' + level));
  wordsToTry($('talkTry'), talk.tries);
  $('chat').textContent = '';
  $('talkText').value = '';
  $('talkComposer').hidden = false;
  $('talkStatus').textContent = recorder.available ? '' : slT('speakNoMic');
  paintTalkGo();
  turn();
}

const talkTarget = () => ({ box: $('talkText'), mic: $('talkMic'), status: $('talkStatus') });

function paintTalkGo() {
  withKey($('talkGo'), slT(talk.done ? 'speakNew' : 'speakSend'), 'Enter');
  $('talkGo').disabled = !talk.done && (talk.busy || !$('talkText').value.trim());
  $('talkMic').disabled = talk.busy || talk.done;
  $('talkEnd').hidden = talk.done;
}

// The other person's turn: Gemini answers, and says what to put right in the learner's last one.
async function turn() {
  talk.busy = true;
  paintTalkGo();
  const typing = el('div', 'typing', slT('speakThinking'));
  $('chat').append(typing);
  const id = talk.id;
  const res = await ask({ type: 'roleplay', scene: talk.scene, level, history: talk.history, words: talk.tries, sl: learnt(), tl: settings.nativeLang });
  if (id !== talk.id) return; // another conversation began meanwhile
  typing.remove();
  talk.busy = false;
  if ($('talk').hidden) return; // left for the list of situations: nothing is said over it
  if (!res.ok) {
    const retry = el('div', 'notice', failed(res.error) + ' ');
    retry.append(btn(slT('speakRetry'), () => (retry.remove(), turn()), 'link'));
    $('chat').append(retry);
    paintTalkGo();
    return;
  }
  const r = res.result;
  if (r.correction) paintCorrection(r.correction, talk.history[talk.history.length - 1].text);
  talk.history.push({ who: 'them', text: r.reply });
  const msg = el('div', 'msg them');
  msg.append(el('div', null, r.reply));
  const tools = el('div', 'tools');
  const tr = el('div', 'tr', r.translation);
  tr.hidden = true;
  tools.append(sayButton(r.reply), btn(slT('speakShowMeaning'), (e) => ((tr.hidden = !tr.hidden), (e.currentTarget.textContent = slT(tr.hidden ? 'speakShowMeaning' : 'speakHideMeaning'))), 'link'));
  msg.append(tools, tr);
  $('chat').append(msg);
  say(r.reply);
  if (r.done || talk.history.length >= 24) finishTalk();
  paintTalkGo();
  msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (!talk.done) $('talkText').focus();
}

function paintCorrection(c, said) {
  if (c.ok) {
    $('chat').append(el('div', 'corr ok', '✓ ' + (c.note || slT('speakNatural'))));
    return;
  }
  if (!c.better) return;
  talk.fixes.push({ said, ...c });
  const box = el('div', 'corr fix');
  const text = el('div');
  text.append(el('b', null, c.better));
  if (c.note) text.append(el('small', null, c.note));
  box.append(text, starFor({ word: c.better, kind: 'sentence', translation: c.meaning || '', lang: learnt(), title: slT('speakTitle') + ' · ' + sceneTitle(talk.scene) }));
  $('chat').append(box);
}

function sendTurn() {
  if (talk.done) return startTalk(talk.scene);
  const text = $('talkText').value.trim();
  if (!text || talk.busy) return;
  recorder.stop();
  talk.history.push({ who: 'me', text });
  // Three turns of one's own make a conversation, for today's plan.
  if (!talk.logged && talk.history.filter((t) => t.who === 'me').length >= 3) {
    talk.logged = true;
    slLogPractice('speak');
  }
  $('chat').append(el('div', 'msg me', text));
  markUsed($('talkTry'), talk.history.filter((t) => t.who === 'me').map((t) => t.text).join(' '));
  $('talkText').value = '';
  turn();
}

function finishTalk() {
  talk.done = true;
  recorder.stop();
  $('talkComposer').hidden = true;
  const end = el('div', 'ended', slT('speakEnded', talk.history.filter((t) => t.who === 'me').length, talk.fixes.length));
  $('chat').append(end);
  paintTalkGo();
}

$('talkMic').addEventListener('click', () => recorder.toggle(talkTarget()));
$('talkText').addEventListener('input', paintTalkGo);
$('talkGo').addEventListener('click', sendTurn);
$('talkEnd').addEventListener('click', () => (talk.history.length > 1 ? finishTalk() : paintHome()));

// ---------- the keys ----------

document.addEventListener('keydown', (e) => {
  const inExam = !$('exam').hidden;
  const inTalk = !$('talk').hidden;
  if (!inExam && !inTalk) return;
  // Ctrl+Space: the microphone on or off, also while typing.
  if (e.ctrlKey && e.code === 'Space') {
    if (inExam && exam.phase !== 'prep' && !exam.sent) recorder.toggle(examTarget());
    if (inTalk && !talk.busy && !talk.done) recorder.toggle(talkTarget());
  } else if (e.key === 'Enter' && !e.shiftKey && !/^(BUTTON|A)$/.test(e.target.tagName)) {
    if (inTalk) sendTurn();
    else if (exam.sent) $('examGo').click();
    else if (e.ctrlKey || e.target.tagName !== 'TEXTAREA') sendAnswer();
    else return;
  } else return;
  e.preventDefault();
});

$('toHome').addEventListener('click', (e) => {
  e.preventDefault();
  paintHome();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('speakTitle') + ' — SceneLingo';
  $('toHome').append(slIcon('back'), el('span', 't', slT('practiceHome')));
  $('toReview').append(slIcon('cards'), el('span', 't', slT('reviewTitle')));
  $('toWords').append(slIcon('search'), el('span', 't', slT('wordsTitle')));
  for (const id of ['examMic', 'talkMic']) {
    $(id).append(slIcon('mic'));
    $(id).title = slT('speakStart') + ' (Ctrl+Space)';
  }
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    chrome.storage.local.get({ words: [], practiceLevel: 'B1' }, (data) => {
      words = data.words;
      level = SL_LEVELS.includes(data.practiceLevel) ? data.practiceLevel : 'B1';
      paintHome();
    });
  });
});
