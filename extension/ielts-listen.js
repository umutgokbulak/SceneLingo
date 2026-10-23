// IELTS Listening practice: one part of the test, its recording written new by Gemini and read
// aloud in two or three voices, played once as in the test, with the questions to answer while it
// plays. Then the score, an estimated band, why each answer is right, and the place it is said, to
// hear again; and the recording written out.
let settings = { ...SL_DEFAULTS };
let geminiKey = '';
let test = null; // { ...the part, audio: [{ line, text, voice, data }] }
let answers = {};
let checked = null;
let making = 0;
const phone = () => chrome.runtime.getManifest().version === 'web';

const PART_TEXTS = { 1: 'ilsPartOne', 3: 'ilsPartThree', 4: 'ilsPartFour' };

function screen(id) {
  for (const s of ['home', 'making', 'test']) $(s).hidden = s !== id;
  scrollTo(0, 0);
}

// ---------- choosing ----------

function paintHome() {
  screen('home');
  making += 1;
  player.stop();
  $('noKey').hidden = !!geminiKey;
  $('noKey').textContent = slT('practiceNoKey');
  const parts = $('parts');
  parts.textContent = '';
  for (const p of [1, 3, 4]) {
    const tile = btn([el('b', null, 'Part ' + p), el('small', null, slT(PART_TEXTS[p]))], () => make(p), 'tile');
    tile.disabled = !geminiKey;
    parts.append(tile);
  }
  chrome.storage.local.get({ listenTestLog: [], geminiUsage: null }, (data) => {
    const recent = (data.listenTestLog || []).slice(-5);
    $('last').textContent = '';
    if (recent.length) $('last').append(slT('ilsLast', recent.length) + ' ', el('b', null, 'Band ' + (Math.round((recent.reduce((a, r) => a + r.band, 0) / recent.length) * 2) / 2).toFixed(1)));
    $('usage').textContent = '';
    if (geminiKey) $('usage').append(slGeminiUsage(data.geminiUsage));
  });
}

// Gemini writes the part; then its voices are fetched, all before it plays, so that it does not
// stop half-way.
async function make(part) {
  const mine = ++making;
  screen('making');
  $('makingText').textContent = slT('ilsMaking');
  const { listenTestLog } = await chrome.storage.local.get({ listenTestLog: [] });
  const avoid = (listenTestLog || []).slice(-10).map((r) => r.title).filter(Boolean);
  const res = await ask({ type: 'listening-test', part, avoid, tl: settings.nativeLang });
  if (mine !== making) return;
  if (!res.ok) {
    $('makingText').textContent = failed(res.error);
    return;
  }
  const t = res.result;
  const audio = [];
  t.script.forEach((l, i) => slSpeechChunks(l.text).forEach((text) => audio.push({ line: i, text, voice: SL_LISTEN_VOICES[l.speaker % SL_LISTEN_VOICES.length] })));
  // On the phone the page speaks for itself, with the system's voices, when it plays.
  if (!phone()) {
    let done = 0;
    const paint = () => ($('makingText').textContent = slT('ilsVoices', done, audio.length));
    paint();
    const queue = [...audio];
    const worker = async () => {
      while (queue.length) {
        const a = queue.shift();
        const r = await ask({ type: 'tts', text: a.text, lang: a.voice });
        a.data = r.ok ? r.result : null;
        done += 1;
        if (mine === making) paint();
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (mine !== making) return;
    if (audio.some((a) => !a.data)) {
      $('makingText').textContent = slT('ilsNoVoice');
      return;
    }
  }
  test = { ...t, audio };
  answers = {};
  checked = null;
  openTest();
}
$('stopMaking').addEventListener('click', paintHome);

// ---------- the recording ----------

// Plays pieces of the recording one after the other: the whole of it (once, during the test), or
// the pieces of one line (afterwards). A short pause where one speaker hands over to another.
const player = (() => {
  const sound = new Audio();
  let pieces = [];
  let at = 0;
  let on = false;
  let token = 0;
  let onEnd = null;
  const next = (mine) => {
    if (mine !== token || !on) return;
    if (at >= pieces.length) {
      on = false;
      paintPlay();
      if (onEnd) onEnd();
      return;
    }
    const p = pieces[at];
    paintNow(p);
    const go = () => {
      at += 1;
      const gap = pieces[at] && pieces[at].line !== p.line ? 450 : 120;
      setTimeout(() => next(mine), gap);
    };
    if (p.data) {
      sound.src = 'data:audio/mpeg;base64,' + p.data;
      sound.playbackRate = 1;
      sound.onended = go;
      sound.play().catch(go);
    } else if (window.speechSynthesis) {
      const u = new SpeechSynthesisUtterance(p.text);
      u.lang = p.voice;
      u.onend = go;
      u.onerror = go;
      speechSynthesis.speak(u);
    } else go();
  };
  return {
    play(list, then) {
      this.stop();
      pieces = list;
      at = 0;
      on = true;
      onEnd = then || null;
      next(++token);
      paintPlay();
    },
    pause() {
      on = false;
      sound.pause();
      if (window.speechSynthesis) speechSynthesis.cancel();
      paintPlay();
    },
    resume() {
      if (at >= pieces.length) return;
      on = true;
      next(++token);
      paintPlay();
    },
    stop() {
      token += 1;
      on = false;
      sound.pause();
      if (window.speechSynthesis) speechSynthesis.cancel();
      pieces = [];
      at = 0;
    },
    get on() {
      return on;
    },
    get started() {
      return pieces.length > 0;
    },
    get at() {
      return at;
    },
  };
})();

let finished = false; // the whole recording has been played

function paintPlay() {
  const b = $('play');
  b.textContent = '';
  b.append(slIcon(player.on ? 'stop' : 'play'));
  b.title = slT(player.on ? 'ilsPause' : 'ilsPlay');
  b.disabled = finished && !checked;
}

function paintNow(p) {
  if (!test) return;
  const i = test.audio.indexOf(p);
  if (i >= 0) $('progress').style.width = Math.round(((i + 1) / test.audio.length) * 100) + '%';
  $('now').textContent = slT('ilsSpeaking', test.speakers[test.script[p.line].speaker] || '');
}

$('play').addEventListener('click', () => {
  if (player.on) return player.pause();
  if (checked) return player.play(test.audio);
  if (player.started) return player.resume();
  player.play(test.audio, () => {
    finished = true;
    $('now').textContent = slT('ilsEnded');
    paintPlay();
  });
});

// ---------- the test ----------

function openTest() {
  screen('test');
  finished = false;
  const head = $('testHead');
  head.textContent = '';
  head.append(el('span', 'label', 'IELTS Listening · Part ' + test.part), el('span', null, '· ' + test.title));
  $('context').textContent = test.context;
  $('progress').style.width = '0';
  $('now').textContent = '';
  $('result').hidden = true;
  $('script').textContent = '';
  $('leave').hidden = false;
  paintPlay();
  paintQuestions();
  paintGo();
}

const numberOf = (item) => item.id.slice(1);

function paintQuestions() {
  const qs = $('qs');
  qs.textContent = '';
  for (const g of test.groups) {
    const box = el('div', 'qgroup');
    const first = numberOf(g.items[0]);
    const last = numberOf(g.items[g.items.length - 1]);
    box.append(el('h3', null, first === last ? slT('ilsQuestion', first) : slT('ilsQuestions', first, last)), el('p', 'how', slT(g.type === 'choice' ? 'ilsChoice' : 'ilsGaps')));
    if (g.type === 'gaps') {
      const notes = el('div', 'notes');
      if (g.title) notes.append(el('div', 'ntitle', g.title));
      for (const item of g.items) notes.append(question(g, item));
      box.append(notes);
    } else for (const item of g.items) box.append(question(g, item));
    qs.append(box);
  }
}

function question(g, item) {
  const done = !!checked;
  const given = answers[item.id];
  const q = el('div', 'q' + (done ? (checked.right[item.id] ? ' right' : ' wrong') : ''));
  const stem = el('div', 'stem');
  const set = (v) => {
    if (checked) return;
    answers[item.id] = v;
    paintGo();
  };
  if (g.type === 'choice') {
    stem.append(el('span', 'no', numberOf(item)), el('span', null, item.q));
    q.append(stem);
    const opts = el('div', 'opts');
    item.options.forEach((o, i) => {
      const b = btn([el('b', null, 'ABC'[i]), el('span', null, o)], () => {
        set(i);
        for (const x of opts.children) x.classList.toggle('on', x === b);
      });
      b.classList.toggle('on', given === i);
      if (done) {
        b.disabled = true;
        b.classList.toggle('is', i === item.answer);
        b.classList.toggle('not', given === i && i !== item.answer);
      }
      opts.append(b);
    });
    const body = el('div', 'body');
    body.append(opts);
    q.append(body);
  } else {
    const [before, after] = item.q.split('____');
    const input = el('input', 'gap');
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.value = given || '';
    input.disabled = done;
    input.addEventListener('input', () => set(input.value.trim() || undefined));
    const line = el('span');
    line.append(before, input, after || '');
    stem.append(el('span', 'no', numberOf(item)), line);
    q.append(stem);
  }
  if (done) q.append(explanation(g, item));
  return q;
}

// Why, and where it is said: the line, to read and to hear.
function explanation(g, item) {
  const box = el('div', 'why');
  const answer = g.type === 'choice' ? 'ABC'[item.answer] + ' · ' + item.options[item.answer] : item.answers.join(' / ');
  box.append(el('span', 'ans', slT('readAnswer', answer)));
  if (item.why) box.append(el('span', null, item.why));
  if (item.line != null) {
    const l = test.script[item.line];
    box.append(el('span', 'heard', '“' + l.text + '”'));
    box.append(btn([slIcon('speaker'), el('span', null, slT('ilsHear'))], () => player.play(test.audio.filter((a) => a.line === item.line)), 'link'));
  }
  return box;
}

const answered = () => Object.values(answers).filter((v) => v != null).length;

function paintGo() {
  if (checked) withKey($('go'), slT('ilsNew'), '');
  else withKey($('go'), slT('readCheck') + ' · ' + slT('readAnswered', answered(), test.total), 'Ctrl+Enter');
  $('go').disabled = !checked && !answered();
}

function check() {
  if (checked || !answered()) return;
  player.stop();
  checked = slReadingMark(test, answers);
  const band = slListenBand(checked.score, checked.total);
  slLogPractice('listen', Math.round((checked.score / checked.total) * 100));
  chrome.storage.local.get({ listenTestLog: [] }, (data) => {
    const entry = { at: Date.now(), task: 'part' + test.part, score: checked.score, total: checked.total, band, title: test.title };
    chrome.storage.local.set({ listenTestLog: [...(data.listenTestLog || []), entry].slice(-SL_LOG_KEPT) });
  });
  const box = $('result');
  box.textContent = '';
  box.hidden = false;
  box.className = 'result';
  const big = el('div', 'big', String(checked.score));
  big.append(el('small', null, ' / ' + checked.total));
  const b = el('div', 'band all');
  b.append(el('small', null, 'Band'), el('b', null, '≈ ' + band.toFixed(1)));
  box.append(big, b, el('p', 'note', slT('ilsBandNote')));
  $('leave').hidden = true;
  paintPlay();
  paintQuestions();
  paintScript();
  paintGo();
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

// The recording written out, the lines that answer a question marked; each line to hear again.
function paintScript() {
  const keys = new Set(test.groups.flatMap((g) => g.items.map((i) => i.line)).filter((l) => l != null));
  const box = el('details', 'script');
  box.append(el('summary', null, slT('ilsScript')));
  test.script.forEach((l, i) => {
    const row = el('div', 'ln' + (keys.has(i) ? ' key' : ''));
    const play = btn(slIcon('speaker'), () => player.play(test.audio.filter((a) => a.line === i)), 'round small');
    row.append(el('b', null, test.speakers[l.speaker] || ''), el('span', null, l.text), play);
    box.append(row);
  });
  $('script').textContent = '';
  $('script').append(box);
}

$('go').addEventListener('click', () => (checked ? paintHome() : check()));
$('leave').addEventListener('click', paintHome);
document.addEventListener('keydown', (e) => {
  if ($('test').hidden || !(e.ctrlKey || e.metaKey) || e.key !== 'Enter') return;
  e.preventDefault();
  check();
});

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  slNav('listen');
  document.title = 'IELTS Listening — SceneLingo';
  $('toDictation').append(slIcon('back'), el('span', 't', slT('ilsDictation')));
  ask({ type: 'gemini-key' }).then((res) => {
    geminiKey = res.ok ? res.result : '';
    paintHome();
  });
});
