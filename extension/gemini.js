// Gemini, with the user's own key: what a word means in its sentence, a card's level, the words it
// goes with and more examples, a check of a sentence of one's own, the idioms in a line. Shared by
// the extension's background and by its pages when they run on the phone, without it.

let geminiRestUntil = 0; // after "too many requests", Gemini is left alone for a while
let geminiModel = null; // the first of GEMINI_MODELS this key may use
let geminiNoQuick = null; // the model refused to answer without thinking first (kept, once known)
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

// Resting after Gemini said "too many requests".
function slGeminiResting() {
  return Date.now() < geminiRestUntil;
}

// The saved key as it may be shown: its first and last letters only.
async function geminiKeyShown() {
  const { geminiKey } = await chrome.storage.local.get({ geminiKey: '' });
  return geminiKey ? geminiKey.slice(0, 4) + '…' + geminiKey.slice(-4) : '';
}

// How much Gemini was asked, day by day, for the user to see: requests, the tokens they took, and
// those Google turned down. Kept two weeks. One count at a time, so that none is lost when several
// questions are answered together.
let geminiCounting = Promise.resolve();
function countGemini(model, tokens, status) {
  geminiCounting = geminiCounting
    .then(async () => {
      const { geminiUsage } = await chrome.storage.local.get({ geminiUsage: {} });
      const days = { ...(geminiUsage.days || {}) };
      const t = new Date();
      const today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      const d = days[today] || { requests: 0, tokens: 0, refused: 0 };
      days[today] = { requests: d.requests + 1, tokens: d.tokens + (tokens || 0), refused: d.refused + (status >= 400 ? 1 : 0) };
      for (const k of Object.keys(days).sort().slice(0, -14)) delete days[k];
      const limited = status === 429 ? Date.now() : geminiUsage.limited || 0;
      await chrome.storage.local.set({ geminiUsage: { days, model: model || geminiUsage.model || '', limited } });
    })
    .catch(() => {});
  return geminiCounting;
}

const langName = (code) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;

// One question to Gemini, answered in JSON.
// The newer models think before they answer, and the thinking counts towards the output limit:
// with a tight limit the answer is cut off mid-way. So the limit is generous; the answer is short.
// Thinking also takes seconds: a look-up (what a word means, the words of a sentence) is asked to
// be answered without it; whatever puts the learner right (`think`) is thought through. A model
// that does not allow answering without thinking is asked again as it is.
async function geminiJSON(apiKey, prompt, maxOutputTokens = 4096, think = false) {
  const config = { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens };
  if (geminiNoQuick === null) geminiNoQuick = !!(await chrome.storage.local.get({ geminiNoQuick: false })).geminiNoQuick;
  const quick = !think && !geminiNoQuick;
  if (quick) config.thinkingConfig = { thinkingBudget: 0 };
  const body = JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: config });
  for (const model of geminiModel ? [geminiModel] : GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
    if (res.status === 404) continue; // a model name this key or this year does not know
    const data = await res.json().catch(() => ({}));
    countGemini(model, data.usageMetadata && data.usageMetadata.totalTokenCount, res.status);
    if (!res.ok) {
      // Not every model takes the setting, nor says so clearly ("Request contains an invalid
      // argument"): the same question is asked again without it. If that is answered, the setting
      // was the trouble, and it is left out from then on.
      if (quick && res.status === 400) {
        geminiNoQuick = true;
        try {
          const answer = await geminiJSON(apiKey, prompt, maxOutputTokens, think);
          Promise.resolve()
            .then(() => chrome.storage.local.set({ geminiNoQuick: true }))
            .catch(() => {});
          return answer;
        } catch (e) {
          geminiNoQuick = false;
          throw e;
        }
      }
      if (res.status === 429) geminiRestUntil = Date.now() + 60000;
      throw new Error('Gemini ' + res.status + ((data.error && ': ' + data.error.message) || ''));
    }
    geminiModel = model;
    const text = (((data.candidates || [])[0] || {}).content || { parts: [] }).parts.map((p) => p.text || '').join('');
    try {
      return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    } catch (e) {
      throw new Error('Gemini: the answer was cut off or not JSON');
    }
  }
  throw new Error('Gemini: no model available for this key');
}

async function savedKey() {
  const { geminiKey } = await chrome.storage.local.get({ geminiKey: '' });
  if (!geminiKey) throw new Error('noKey');
  return geminiKey;
}

async function askGemini(apiKey, word, sentence, sl, tl) {
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} points at "${word}" in this sentence from a film or a page:\n` +
      `"${sentence}"\n\n` +
      `Answer in JSON with these keys:\n` +
      `"phrase": the phrase or idiom "${word}" belongs to in this sentence, in its dictionary form (for example "rip off", "make up one's mind"), or "" if it is used on its own;\n` +
      `"meaning": what "${word}" (or that phrase) means in this sentence, in ${langName(tl)}, as a dictionary would put it: a few words, in the base form;\n` +
      `"note": one short sentence in ${langName(tl)} that explains the use here, for example the tone or the grammar; "" if there is nothing worth saying.`
  );
  if (!json.meaning) throw new Error('Gemini: empty answer');
  return { meaning: String(json.meaning).trim(), phrase: String(json.phrase || '').trim(), note: String(json.note || '').trim(), engine: 'gemini' };
}

// Several words or a whole line: a translation that is not word for word, and the idioms in it.
// A machine translation reads "nach seiner Pfeife tanzen" as "dancing to his melody"; it means
// doing whatever he says. Only Gemini answers this; without it, there is nothing to add.
const explained = new Map();
async function explain(text, sentence, sl, tl, always) {
  text = String(text || '').replace(/\s+/g, ' ').trim();
  sentence = String(sentence || '').replace(/\s+/g, ' ').trim() || text;
  const { geminiKey } = await chrome.storage.local.get({ geminiKey: '' });
  const { useGemini } = await chrome.storage.sync.get({ useGemini: true });
  if (!text || !geminiKey || !(useGemini || always) || slGeminiResting()) return null;
  const key = [sl, tl, text, sentence].join('|').toLowerCase();
  if (explained.has(key)) return explained.get(key);
  const json = await geminiJSON(
    geminiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} selected this text` +
      (sentence !== text ? ` in the sentence "${sentence}"` : '') +
      `:\n"${text.slice(0, 600)}"\n\n` +
      `Answer in JSON with these keys:\n` +
      `"translation": a natural translation of the selected text into ${langName(tl)}, as a good subtitler would write it, not word for word;\n` +
      `"idioms": the idioms, fixed expressions and phrasal verbs in the selected text (an empty list if there are none), each {"text": in its dictionary form in ${langName(sl)}, "meaning": what it means, in ${langName(tl)}, "literal": its word-for-word meaning in ${langName(tl)}, or "" if that is the same};\n` +
      `"note": one short sentence in ${langName(tl)} on anything else worth knowing here (tone, slang, grammar), or "".`
  );
  const answer = {
    translation: String(json.translation || '').trim(),
    idioms: (Array.isArray(json.idioms) ? json.idioms : [])
      .slice(0, 4)
      .map((i) => ({ text: String(i.text || '').trim(), meaning: String(i.meaning || '').trim(), literal: String(i.literal || '').trim() }))
      .filter((i) => i.text && i.meaning),
    note: String(json.note || '').trim(),
    engine: 'gemini',
  };
  if (!answer.translation) throw new Error('Gemini: empty answer');
  if (explained.size > 300) explained.clear();
  explained.set(key, answer);
  return answer;
}

// For a review card, once: how common the word is, what it goes with, and two more sentences.
async function enrich({ word, phrase, sentence, sl, tl }) {
  const apiKey = await savedKey();
  const item = phrase || word;
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} is studying "${item}"` +
      (sentence ? `, met in this sentence: "${sentence}"` : '') +
      `.\nAnswer in JSON with these keys:\n` +
      `"ipa": the pronunciation of "${word}" in IPA between slashes` + (sl === 'en' ? ' (British English)' : '') + `;\n` +
      `"level": its CEFR level as used here (A1, A2, B1, B2, C1 or C2);\n` +
      `"academic": true if it is useful in academic or formal writing (for example in the IELTS Writing test), else false;\n` +
      `"collocations": up to 3 common word combinations with it, each {"text": the combination in ${langName(sl)}, "meaning": its meaning in ${langName(tl)}};\n` +
      `"examples": 2 short, natural everyday sentences in ${langName(sl)} that use it in the same sense, each {"text": the sentence, "translation": in ${langName(tl)}}.`
  );
  const list = (v) => (Array.isArray(v) ? v : []);
  const ipa = String(json.ipa || '').trim().replace(/^\/+|\/+$/g, '');
  return {
    ipa: ipa && ipa.length < 60 ? '/' + ipa + '/' : '',
    level: /^[ABC][12]$/.test(String(json.level || '').toUpperCase()) ? String(json.level).toUpperCase() : '',
    academic: !!json.academic,
    collocations: list(json.collocations).slice(0, 3).map((c) => ({ text: String(c.text || ''), meaning: String(c.meaning || '') })).filter((c) => c.text),
    examples: list(json.examples).slice(0, 2).map((e) => ({ text: String(e.text || ''), translation: String(e.translation || '') })).filter((e) => e.text),
  };
}

// A sentence heard in listening practice: its words and phrases, each with what it means there.
// The phrases are kept whole ("ripped off", not "ripped" and "off"); the plainest words are left out.
async function gloss({ sentence, sl, tl }) {
  const apiKey = await savedKey();
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} has just written down this sentence from listening:\n"${String(sentence).slice(0, 400)}"\n\n` +
      `Answer in JSON with the key "parts": the words and phrases of the sentence worth knowing, in the order they come, at most 10. ` +
      `Keep phrasal verbs, idioms and fixed expressions together as one part. Leave out names and the most basic words (articles, pronouns, "to be", "and"...). Each part is ` +
      `{"text": exactly as it is written in the sentence, "base": its dictionary form if that is different (for example "rip off" for "ripped off"), else "", ` +
      `"meaning": what it means in this sentence, in ${langName(tl)}, in a few words}.`
  );
  const parts = (Array.isArray(json.parts) ? json.parts : [])
    .slice(0, 10)
    .map((p) => ({ text: String(p.text || '').trim(), base: String(p.base || '').trim(), meaning: String(p.meaning || '').trim() }))
    .filter((p) => p.text && p.meaning);
  for (const p of parts) if (p.base.toLowerCase() === p.text.toLowerCase()) p.base = '';
  return parts;
}

// Speaking practice, the IELTS test: an answer, as a speaking examiner would score it, what to put
// right, and a better answer to learn from. The answer comes from speech recognition. Thought
// through: the score is worth the wait.
async function speakingFeedback({ part, question, points, answer, words, sl, tl }) {
  const apiKey = await savedKey();
  const length = { 1: 'three or four sentences', 2: 'about 180 words', 3: 'four or five sentences' }[part] || 'four or five sentences';
  const tries = (words || []).slice(0, 5);
  const json = await geminiJSON(
    apiKey,
    `You are an experienced IELTS Speaking examiner. The candidate's own language is ${langName(tl)}.\n` +
      `Part ${part}. ${part === 2 ? 'Card' : 'Question'}: "${String(question).slice(0, 300)}"` +
      ((points || []).length ? `\nYou should say: ${points.join('; ')}.` : '') +
      `\n\nThe candidate's answer, written down by speech recognition (so ignore punctuation and capital letters; a word that does not fit may have been misheard, which can point to its pronunciation):\n"${String(answer).slice(0, 3000)}"\n\n` +
      `Answer in JSON with these keys:\n` +
      `"bands": {"fluency": Fluency and Coherence, "lexical": Lexical Resource, "grammar": Grammatical Range and Accuracy, "pronunciation": Pronunciation}, each a band from 1 to 9 in steps of 0.5, as you would give for this answer alone; an answer much too short for Part ${part} scores lower;\n` +
      `"summary": two or three sentences in ${langName(tl)}: what was good, and the one thing that would raise the score most;\n` +
      `"corrections": up to 5 of the most important mistakes, each {"said": the words as the candidate said them, "better": the same put right, "note": the reason in a few words in ${langName(tl)}};\n` +
      `"better": a natural band 8 answer to the same ${part === 2 ? 'card' : 'question'}, ${length}, keeping the candidate's own ideas where they are good;\n` +
      `"phrases": up to 4 useful phrases or collocations from your better answer, each {"text": as in the answer, "meaning": in ${langName(tl)}}` +
      (tries.length
        ? `;\n"used": for each of these words the candidate was asked to try to use (${tries.map((w) => '"' + w + '"').join(', ')}), {"word": the word, "ok": true if the candidate used it, correctly, "sentence": the candidate's sentence with it, put right, or ""}.`
        : '.'),
    8192,
    true
  );
  const list = (v) => (Array.isArray(v) ? v : []);
  const band = (v) => {
    const n = Math.round(Number(v) * 2) / 2;
    return n >= 1 && n <= 9 ? n : null;
  };
  const b = json.bands || {};
  const bands = { fluency: band(b.fluency), lexical: band(b.lexical), grammar: band(b.grammar), pronunciation: band(b.pronunciation) };
  if (Object.values(bands).some((v) => v === null)) throw new Error('Gemini: no score in the answer');
  return {
    bands,
    summary: String(json.summary || '').trim(),
    corrections: list(json.corrections).slice(0, 5).map((c) => ({ said: String(c.said || '').trim(), better: String(c.better || '').trim(), note: String(c.note || '').trim() })).filter((c) => c.said && c.better),
    better: String(json.better || '').trim(),
    phrases: list(json.phrases).slice(0, 4).map((p) => ({ text: String(p.text || '').trim(), meaning: String(p.meaning || '').trim() })).filter((p) => p.text),
    used: list(json.used).map((u) => ({ word: String(u.word || '').trim(), ok: !!u.ok, sentence: String(u.sentence || '').trim() })).filter((u) => u.word),
  };
}

// Speaking practice, an everyday situation: Gemini plays the other person, and puts the learner's
// last turn right. `history` is [{ who: 'them' | 'me', text }].
async function roleplay({ scene, level, history, words, sl, tl }) {
  const apiKey = await savedKey();
  const turns = (history || []).slice(-16);
  const lines = turns.map((t) => (t.who === 'me' ? 'Learner: ' : 'You: ') + String(t.text).slice(0, 600)).join('\n');
  const last = turns.length && turns[turns.length - 1].who === 'me';
  const json = await geminiJSON(
    apiKey,
    `You are role-playing a conversation with a learner of ${langName(sl)} at level ${level || 'B1'}, whose own language is ${langName(tl)}.\n` +
      `You play: ${scene.role}. The situation: ${scene.situation}\n` +
      `Speak only ${langName(sl)}, naturally, as people really talk, at the learner's level. Keep your turns short (one to three sentences) and keep the conversation going, until the situation comes to its natural end (about eight turns each).` +
      ((words || []).length ? ` Where it fits naturally, give the learner a chance to use these words: ${words.join(', ')}.` : '') +
      `\n\nThe conversation so far:\n${lines || '(nothing yet: you open it)'}\n` +
      (last ? `\nThe learner's last turn was written down by speech recognition: ignore punctuation and capital letters.\n` : '') +
      `\nAnswer in JSON with these keys:\n` +
      `"reply": your next turn, in ${langName(sl)};\n` +
      `"translation": your reply in ${langName(tl)};\n` +
      `"correction": ` +
      (last
        ? `about the learner's last turn: {"ok": true if it was correct and natural, "better": the same put right and made natural (only if not ok, else ""), "meaning": what "better" means, in ${langName(tl)} (only if not ok, else ""), "note": one short sentence in ${langName(tl)} that says what changed and why, or what was good};\n`
        : `null;\n`) +
      `"done": true if, with your reply, the conversation has come to its natural end, else false.`,
    4096,
    true // what it puts right is learnt from: worth the wait
  );
  const reply = String(json.reply || '').trim();
  if (!reply) throw new Error('Gemini: empty answer');
  const c = json.correction;
  return {
    reply,
    translation: String(json.translation || '').trim(),
    correction: last && c ? { ok: !!c.ok, better: c.ok ? '' : String(c.better || '').trim(), meaning: c.ok ? '' : String(c.meaning || '').trim(), note: String(c.note || '').trim() } : null,
    done: !!json.done,
  };
}

// What both kinds of writing feedback give back, made safe to show.
function writingParts(json) {
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    summary: String(json.summary || '').trim(),
    corrections: list(json.corrections).slice(0, 8).map((c) => ({ said: String(c.said || '').trim(), better: String(c.better || '').trim(), note: String(c.note || '').trim() })).filter((c) => c.said && c.better),
    better: String(json.better || '').trim(),
    phrases: list(json.phrases).slice(0, 6).map((p) => ({ text: String(p.text || '').trim(), meaning: String(p.meaning || '').trim() })).filter((p) => p.text),
    used: list(json.used).map((u) => ({ word: String(u.word || '').trim(), ok: !!u.ok, sentence: String(u.sentence || '').trim() })).filter((u) => u.word),
  };
}
const usedAsk = (words) =>
  (words || []).length
    ? `;\n"used": for each of these words the writer was asked to try to use (${words.slice(0, 5).map((w) => '"' + w + '"').join(', ')}), {"word": the word, "ok": true if it was used, correctly, "sentence": the writer's sentence with it, put right, or ""}.`
    : '.';

// Writing practice, the IELTS test: a Task 1 (a letter, or a report on a table) or a Task 2 essay,
// scored as an examiner would on the four criteria, with its mistakes and a better version.
async function ieltsWriting({ task, prompt, points, table, text, words, tl }) {
  const apiKey = await savedKey();
  const what = { task1g: 'General Training Task 1 (a letter, at least 150 words)', task1a: 'Academic Task 1 (a report on the table, at least 150 words)', task2: 'Task 2 (an essay, at least 250 words)' }[task] || 'Task 2';
  const figures = table ? `\nThe table: ${table.title}\n${[table.columns, ...table.rows].map((r) => r.join(' | ')).join('\n')}` : '';
  const json = await geminiJSON(
    apiKey,
    `You are an experienced IELTS Writing examiner. The candidate's own language is ${langName(tl)}.\n` +
      `IELTS Writing ${what}.\nThe task: "${String(prompt).slice(0, 600)}"` +
      ((points || []).length ? `\nIn the letter: ${points.join('; ')}.` : '') +
      figures +
      `\n\nThe candidate's text, between the lines:\n---\n${String(text).slice(0, 6000)}\n---\n\n` +
      `Answer in JSON with these keys:\n` +
      `"bands": {"task": ${task === 'task2' ? 'Task Response' : 'Task Achievement'}, "coherence": Coherence and Cohesion, "lexical": Lexical Resource, "grammar": Grammatical Range and Accuracy}, each a band from 1 to 9 in steps of 0.5, as you would give; a text under the word limit, or off the task, scores lower;\n` +
      `"summary": three or four sentences in ${langName(tl)}: what was good, how the text is organised, and the one or two things that would raise the score most;\n` +
      `"corrections": up to 8 of the most important mistakes, in the order they come, each {"said": the words as written, "better": the same put right, "note": the reason in a few words in ${langName(tl)}};\n` +
      `"better": the candidate's text rewritten as a band 8 answer, keeping their ideas and their order where they are good, in paragraphs separated by a blank line;\n` +
      `"phrases": up to 6 useful phrases or collocations from your version, each {"text": as in it, "meaning": in ${langName(tl)}}` +
      usedAsk(words),
    16384,
    true
  );
  const band = (v) => {
    const n = Math.round(Number(v) * 2) / 2;
    return n >= 1 && n <= 9 ? n : null;
  };
  const b = json.bands || {};
  const bands = { task: band(b.task), coherence: band(b.coherence), lexical: band(b.lexical), grammar: band(b.grammar) };
  if (Object.values(bands).some((v) => v === null)) throw new Error('Gemini: no score in the answer');
  return { bands, ...writingParts(json) };
}

// Writing practice, every day: a message or a letter in the language being learnt, at a level. Its
// level as written, whether it says what the task asked, its mistakes and a better version.
async function everydayWriting({ task, points, level, text, words, sl, tl }) {
  const apiKey = await savedKey();
  const asked = points || [];
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} at level ${level || 'B1'}, whose own language is ${langName(tl)}, wrote this for the task: "${String(task).slice(0, 400)}"` +
      (asked.length ? `\nThe text should: ${asked.join('; ')}.` : '') +
      `\n\nThe text, between the lines:\n---\n${String(text).slice(0, 4000)}\n---\n\n` +
      `Answer in JSON with these keys:\n` +
      `"level": the CEFR level the text shows (A1, A2, B1, B2, C1 or C2);\n` +
      (asked.length ? `"points": for each thing the text should do, in order, true if it does it, else false;\n` : '') +
      `"summary": two or three sentences in ${langName(tl)}: what was good, and what to work on;\n` +
      `"corrections": up to 8 of the most important mistakes, in the order they come, each {"said": the words as written, "better": the same put right, "note": the reason in a few words in ${langName(tl)}};\n` +
      `"better": the text put right and made natural, at level ${level || 'B1'}, keeping the writer's ideas, in ${langName(sl)};\n` +
      `"phrases": up to 6 useful phrases from your version for this kind of text, each {"text": in ${langName(sl)}, "meaning": in ${langName(tl)}}` +
      usedAsk(words),
    8192,
    true
  );
  const shown = String(json.level || '').toUpperCase();
  return {
    level: /^[ABC][12]$/.test(shown) ? shown : '',
    points: asked.map((p, i) => ({ point: p, done: !!(Array.isArray(json.points) && json.points[i]) })),
    ...writingParts(json),
  };
}

// Reading practice: a text and its questions. For IELTS (`academic`, `general`) one passage of
// the test with the kinds of questions it asks, in English; every day (`daily`), a text of the
// kind chosen in the language being learnt, at a level. The questions are put in order by
// slReadingParts (reading.js).
async function readingTest({ kind, topic, level, sl, tl, avoid }, shuffle = Math.random) {
  const apiKey = await savedKey();
  const k = SL_READ_KINDS[kind] ? kind : 'daily';
  const shape = SL_READ_KINDS[k];
  const lv = level || 'B1';
  const ielts = k !== 'daily';
  const lang = ielts ? 'English' : langName(sl);
  const why = `"why": one or two sentences in ${langName(tl)} that say why, pointing to the place in the text`;
  const quote = `"quote": the words of the text that show the answer, copied exactly (a sentence or a part of one)`;
  const easy = !ielts && /^A/.test(lv);
  const json = await geminiJSON(
    apiKey,
    (ielts
      ? `Write one passage of an IELTS ${k === 'academic' ? 'Academic' : 'General Training'} Reading test, about ${topic}, with its questions, as hard as in the real test. ` +
        (k === 'academic'
          ? `The passage is written like an article in a serious magazine for a general reader: facts, and claims and views of named researchers, so that some statements can be checked and some cannot.`
          : `The passage is the kind of text the General Training test uses: practical and factual, as at work or in daily life.`) +
        ` About ${SL_READ_WORDS[k]} words, in ${shape.paragraphs} paragraphs.`
      : `Write a reading text for a learner of ${lang} at level ${lv} (CEFR), whose own language is ${langName(tl)}: ${topic}. ` +
        `About ${SL_READ_WORDS[lv] || 280} words, in ${shape.paragraphs} paragraphs, in ${lang}, with the words and the grammar of level ${lv}: natural, not childish, and interesting to read. Then questions on it, in simple ${lang}.`) +
      ((avoid || []).length ? `\nDo not write about the same things as these earlier texts: ${avoid.slice(0, 10).map((t) => '"' + String(t).slice(0, 80) + '"').join(', ')}.` : '') +
      `\n\nAnswer in JSON with these keys:\n` +
      `"title": a title in ${lang};\n` +
      `"paragraphs": the ${shape.paragraphs} paragraphs, each a string, without letters or numbers;\n` +
      (ielts
        ? `"headings": ${shape.paragraphs + 2} headings in English, one that fits each paragraph and two more that fit none though they seem to, in a mixed order; they say what a paragraph is mainly about in other words than its own;\n` +
          `"headingAnswers": for each paragraph, in order, {"heading": the index (0 to ${shape.paragraphs + 1}) of its heading, ${why}};\n`
        : '') +
      `"tfng": ${shape.tfng} statements about the text, in ${lang}, in the order of the text, ${easy ? 'each TRUE or FALSE' : 'at least one TRUE, one FALSE and one NOT GIVEN'}; a statement says it in other words than the text; NOT GIVEN only when the text truly does not say; each {"statement", "answer": "TRUE", "FALSE" or "NOT GIVEN", ${why}, ${quote} ("" for NOT GIVEN)};\n` +
      `"choice": ${shape.choice} questions with four options, of which one is right and the others are plausible to someone who read carelessly, in ${lang}, each {"q", "options": the four, "answer": the index (0 to 3) of the right one, ${why}, ${quote}}` +
      (shape.gaps
        ? `;\n"gaps": ${shape.gaps} sentences that say a point of the text in other words, each with "____" where words are missing, which the candidate fills with NO MORE THAN TWO WORDS taken from the text; each {"sentence", "answers": the words from the text that fill it, and any other form that would be marked right, ${why}, ${quote}}.`
        : '.'),
    16384,
    true // a test with a wrong answer in it teaches the wrong thing: worth the wait
  );
  return { ...slReadingParts(json, k, shuffle), lang: ielts ? 'en' : sl, level: ielts ? '' : lv, topic: String(topic || '') };
}

// An episode's lines for Gemini: numbered, so that it can say where something is, and no longer
// than `max` characters (the first lines kept, or with `last`, the last ones).
function numbered(lines, max, last) {
  const all = lines.map((l) => l.i + '| ' + String(l.text).replace(/\s+/g, ' ').trim());
  const out = [];
  let size = 0;
  for (const line of last ? [...all].reverse() : all) {
    if (size + line.length > max) break;
    out.push(line);
    size += line.length + 1;
  }
  return (last ? out.reverse() : out).join('\n');
}
const lineNo = (v) => (Number.isInteger(+v) && +v >= 0 ? +v : null);

// An episode's words, with what they mean in it (the words were found by how rare they are, each
// with the line it is first in), and the idioms, phrasal verbs and fixed expressions of its lines
// worth learning at the learner's level.
async function episodeGloss({ words, lines, sl, tl, level }) {
  const apiKey = await savedKey();
  const asked = (words || []).slice(0, 40).map((w) => ({ word: String(w.word), line: w.first }));
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} at level ${level || 'B1'}, whose own language is ${langName(tl)}, is watching an episode whose subtitles are below, one line each, numbered.\n\n` +
      numbered(lines || [], 40000) +
      `\n\nAnswer in JSON with these keys:\n` +
      `"words": for each of these words, in the same order, ${JSON.stringify(asked)}: {"word": the word, "base": its dictionary form if that is different, else "", "meaning": what it means in that line, in ${langName(tl)}, in a few words};\n` +
      `"phrases": up to 12 idioms, phrasal verbs and fixed expressions from the subtitles that a learner at ${level || 'B1'} would likely not know and should learn, the most useful first; each {"text": exactly as it is in the line, "base": its dictionary form, "meaning": what it means there, in ${langName(tl)}, "line": the number of the line}.`,
    8192,
    true
  );
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    words: list(json.words).map((w) => ({ word: String(w.word || '').trim().toLowerCase(), base: String(w.base || '').trim(), meaning: String(w.meaning || '').trim() })).filter((w) => w.word && w.meaning),
    phrases: list(json.phrases).slice(0, 12).map((p) => ({ text: String(p.text || '').trim(), base: String(p.base || '').trim(), meaning: String(p.meaning || '').trim(), line: lineNo(p.line) })).filter((p) => p.text && p.meaning),
  };
}

// Questions on the part of an episode just watched: whether it was understood, asked in simple
// words of the language being learnt, about those lines only (nothing that comes later is given
// away). The right answer is put in a place of its own, so that it is not always the first.
async function episodeQuiz({ lines, sl, tl, level, count }, shuffle = Math.random) {
  const apiKey = await savedKey();
  const n = Math.min(8, Math.max(3, +count || 5));
  const json = await geminiJSON(
    apiKey,
    `Here are the subtitles of the part of an episode that a learner of ${langName(sl)} (level ${level || 'B1'}, own language ${langName(tl)}) has just watched, one line each, numbered:\n\n` +
      numbered(lines || [], 30000, true) +
      `\n\nWrite ${n} questions that check whether they understood what happened and what was said: the story, what people want, feel or decide, and what they mean by what they say; not names, numbers or details nobody would remember. Ask only about these lines. Write the questions and the answers in simple ${langName(sl)}, at level ${level || 'B1'}.\n` +
      `Answer in JSON with the key "questions": a list of {"q": the question, "options": four short answers of which one is right, "answer": the index (0 to 3) of the right one, "why": one sentence in ${langName(tl)} that says where in the story the answer comes from, "line": the number of the line that answers it}.`,
    8192,
    true
  );
  const out = [];
  for (const q of Array.isArray(json.questions) ? json.questions : []) {
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean);
    const right = +q.answer;
    if (!q.q || options.length < 2 || !(right >= 0 && right < options.length)) continue;
    const order = options.map((o, i) => ({ o, i, k: shuffle() })).sort((a, b) => a.k - b.k);
    out.push({ q: String(q.q).trim(), options: order.map((x) => x.o), answer: order.findIndex((x) => x.i === right), why: String(q.why || '').trim(), line: lineNo(q.line) });
  }
  if (!out.length) throw new Error('Gemini: no questions in the answer');
  return out.slice(0, n);
}

// A sentence of the learner's own, with the word in it: corrected, and said more naturally.
async function checkSentence({ word, sentence, sl, tl }) {
  const apiKey = await savedKey();
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} wrote this sentence to practise "${word}":\n"${String(sentence).slice(0, 400)}"\n\n` +
      `Answer in JSON with these keys:\n` +
      `"correct": true if the sentence is correct and natural and uses "${word}" in a fitting way, else false;\n` +
      `"better": the sentence corrected and made natural, changing as little as possible ("" if it needs no change);\n` +
      `"note": one or two short sentences in ${langName(tl)} that say what was wrong and why, or praise what is good.`,
    4096,
    true // a correction is learnt from: worth the wait
  );
  return { correct: !!json.correct, better: String(json.better || '').trim(), note: String(json.note || '').trim() };
}

if (typeof module !== 'undefined') {
  module.exports = { countGemini, slGeminiResting, geminiKeyShown, langName, geminiJSON, savedKey, askGemini, explain, enrich, gloss, speakingFeedback, roleplay, ieltsWriting, everydayWriting, readingTest, episodeGloss, episodeQuiz, checkSentence };
}
