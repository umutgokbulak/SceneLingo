// Gemini, with the user's own key: what a word means in its sentence, a card's level, the words it
// goes with and more examples, a check of a sentence of one's own, the idioms in a line. Shared by
// the extension's background and by its pages when they run on the phone, without it.

let geminiRestUntil = 0; // after "too many requests", Gemini is left alone for a while
let geminiModel = null; // the first of GEMINI_MODELS this key may use
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

const langName = (code) => new Intl.DisplayNames(['en'], { type: 'language' }).of(code) || code;

// One question to Gemini, answered in JSON.
// The newer models think before they answer, and the thinking counts towards the output limit:
// with a tight limit the answer is cut off mid-way. So the limit is generous; the answer is short.
async function geminiJSON(apiKey, prompt, maxOutputTokens = 4096) {
  const body = JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2, responseMimeType: 'application/json', maxOutputTokens },
  });
  for (const model of geminiModel ? [geminiModel] : GEMINI_MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    });
    if (res.status === 404) continue; // a model name this key or this year does not know
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
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

// A sentence of the learner's own, with the word in it: corrected, and said more naturally.
async function checkSentence({ word, sentence, sl, tl }) {
  const apiKey = await savedKey();
  const json = await geminiJSON(
    apiKey,
    `A learner of ${langName(sl)} whose own language is ${langName(tl)} wrote this sentence to practise "${word}":\n"${String(sentence).slice(0, 400)}"\n\n` +
      `Answer in JSON with these keys:\n` +
      `"correct": true if the sentence is correct and natural and uses "${word}" in a fitting way, else false;\n` +
      `"better": the sentence corrected and made natural, changing as little as possible ("" if it needs no change);\n` +
      `"note": one or two short sentences in ${langName(tl)} that say what was wrong and why, or praise what is good.`
  );
  return { correct: !!json.correct, better: String(json.better || '').trim(), note: String(json.note || '').trim() };
}

if (typeof module !== 'undefined') {
  module.exports = { slGeminiResting, geminiKeyShown, langName, geminiJSON, savedKey, askGemini, explain, enrich, checkSentence };
}
