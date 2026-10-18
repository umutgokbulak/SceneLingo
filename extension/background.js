// Translation, word lookup and speech requests come here from the pages.
//
// Sentences are translated inside the browser where it can do that (the Translator API): no
// network, no limits, and the subtitles do not leave the computer. Where it cannot — an older
// browser, a pair of languages it does not have, or a language pack that has not been fetched
// yet — and for what it does not know at all (a word's dictionary entry, its sound), the
// requests go to Google Translate's web endpoint; from here, so that they are not subject to
// the page's CORS rules.
const ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const MAX_Q = 1600; // encoded characters per request

function gLang(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return 'auto';
  if (c.startsWith('zh') || c.startsWith('cmn')) return /hant|tw|hk/.test(c) ? 'zh-TW' : 'zh-CN';
  const base = c.split(/[-_]/)[0];
  return { he: 'iw', nb: 'no', fil: 'tl' }[base] || base;
}

async function call(q, sl, tl, extra = '') {
  const url = `${ENDPOINT}?client=gtx&sl=${gLang(sl)}&tl=${gLang(tl)}&dt=t${extra}&q=${encodeURIComponent(q)}`;
  // A request that does not get through at all is tried once more after a moment.
  const res = await fetch(url).catch(() => new Promise((r) => setTimeout(r, 700)).then(() => fetch(url)));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const joined = (data) => ((data && data[0]) || []).map((s) => s[0] || '').join('');

async function translateGroup(texts, sl, tl) {
  if (texts.length === 1) return [texts[0] ? joined(await call(texts[0], sl, tl)).trim() : ''];
  const lines = joined(await call(texts.join('\n'), sl, tl)).split('\n').map((s) => s.trim());
  if (lines.length === texts.length) return lines;
  // The service merged or split lines; redo this group one cue at a time.
  const out = [];
  for (const t of texts) out.push((await translateGroup([t], sl, tl))[0]);
  return out;
}

// ---- inside the browser

const translators = new Map(); // 'en>tr' -> a translator that is ready

// The names a language may go by there: it knows Hebrew and Norwegian by their older codes.
function builtInNames(code) {
  const c = String(code || '').toLowerCase();
  if (!c) return [];
  if (c.startsWith('zh') || c.startsWith('cmn')) return [/hant|tw|hk/.test(c) ? 'zh-Hant' : 'zh'];
  const base = c.split(/[-_]/)[0];
  return { he: ['he', 'iw'], iw: ['he', 'iw'], no: ['no', 'nb'], nb: ['nb', 'no'] }[base] || [base];
}

// A translator for the pair, or why there is none: 'none' (no such thing in this browser),
// 'unavailable' (not for these languages), or 'downloadable' (its language pack has to be
// fetched first, which the browser only does when a person asks: see the toolbar popup).
async function builtIn(sl, tl) {
  if (typeof Translator !== 'function') return { state: 'none' };
  const key = sl + '>' + tl;
  if (translators.has(key)) return { state: 'available', key, translator: translators.get(key) };
  let state = 'unavailable';
  for (const sourceLanguage of builtInNames(sl)) {
    for (const targetLanguage of builtInNames(tl)) {
      if (sourceLanguage === targetLanguage) continue;
      const found = await Translator.availability({ sourceLanguage, targetLanguage }).catch(() => 'unavailable');
      if (found === 'available') {
        const translator = await Translator.create({ sourceLanguage, targetLanguage });
        translators.set(key, translator);
        return { state: 'available', key, translator };
      }
      if (found !== 'unavailable') state = 'downloadable';
    }
  }
  return { state };
}

async function translateMany(texts, sl, tl) {
  const flat = texts.map((t) => String(t).replace(/\s*\n\s*/g, ' ').trim());
  const own = await builtIn(sl, tl).catch(() => ({ state: 'none' }));
  if (own.translator) {
    try {
      const lines = [];
      for (const t of flat) lines.push(t ? String(await own.translator.translate(t)).trim() : '');
      return { lines, engine: 'browser' };
    } catch (e) {
      translators.delete(own.key); // it may have been closed with the worker's last sleep; the network answers this time
    }
  }
  return { lines: await translateOnline(flat, sl, tl), engine: 'online', canGet: own.state === 'downloadable' };
}

async function translateOnline(flat, sl, tl) {
  const out = [];
  let group = [];
  let size = 0;
  const flush = async () => {
    if (!group.length) return;
    out.push(...(await translateGroup(group, sl, tl)));
    group = [];
    size = 0;
  };
  for (const t of flat) {
    const n = encodeURIComponent(t).length + 3;
    if (size + n > MAX_Q) await flush();
    group.push(t);
    size += n;
  }
  await flush();
  return out;
}

// Translation plus what the service knows about the word in its own language:
// phonetic spelling, definitions and synonyms. Phrases usually get the translation only.
async function lookup(text, sl, tl) {
  let data;
  try {
    data = await call(text, sl, tl, '&dt=bd&dt=md&dt=ss&dt=rm');
  } catch (e) {
    // Without the service there is no dictionary entry, but the browser may still translate.
    const own = await builtIn(sl, tl).catch(() => ({}));
    if (!own.translator) throw e;
    return { translation: String(await own.translator.translate(text)).trim(), dict: [], ipa: '', defs: [], synonyms: [] };
  }
  const phonetic = (data[0] || []).find((s) => s && s[0] == null && typeof s[3] === 'string');
  const defs = [];
  for (const group of data[12] || []) {
    for (const d of (group[1] || []).slice(0, 2)) {
      // The dictionary numbers words that are spelt alike: "past of may1."
      if (defs.length < 3 && d[0]) defs.push({ pos: group[0] || '', text: d[0].replace(/(\p{L})\d+\b/gu, '$1'), example: d[2] || '' });
    }
  }
  const synonyms = [];
  // The synonyms of the same part of speech as the first definition: those of "might" the noun
  // ("strength") do not belong under "past of may".
  const groups = data[11] || [];
  const same = defs.length ? groups.filter((g) => g[0] === defs[0].pos) : [];
  for (const group of defs.length ? same : groups) {
    // Each set belongs to one sense; later sets drift to figurative meanings, so only the
    // first one that is not labelled informal, rare, archaic... is used.
    const set = (group[1] || []).find((s) => !s[2]);
    for (const s of (set && set[0]) || []) if (synonyms.length < 6 && !synonyms.includes(s)) synonyms.push(s);
  }
  // For a single word the service's one-line answer is sometimes an abbreviation ("it" -> "BT",
  // as in information technology) while its dictionary entries are right; then the first of those
  // is the better headline. Any other answer stands even when the dictionary does not list it:
  // "might" is "belki", though the dictionary starts with the noun, "güç".
  let translation = joined(data).trim();
  // Only entries for the word itself: "structured" is listed under "structure", whose terms are verbs.
  const own = (data[1] || []).filter((d) => !d[3] || String(d[3]).toLowerCase() === text.toLowerCase());
  const terms = own.flatMap((d) => d[1] || []);
  const abbreviation = /^\p{Lu}{2,}$/u.test(translation) && !/^\p{Lu}{2,}$/u.test(text);
  if (terms.length && abbreviation && !terms.some((t) => t.toLowerCase() === translation.toLowerCase())) {
    translation = terms[0];
  }
  return {
    translation,
    src: typeof data[2] === 'string' ? data[2] : '', // the language the service found the text in
    dict: (data[1] || []).slice(0, 4).map((d) => ({ pos: d[0] || '', terms: (d[1] || []).slice(0, 5) })),
    ipa: phonetic ? phonetic[3] : '',
    defs,
    synonyms,
  };
}

// What a word means in the sentence it is in. A dictionary gives every meaning of "ripped";
// in "you ripped off the wrong people" it is "soymak". With the user's own Gemini key, the model
// answers, and also says when the word is part of a phrase. Without one, or when its free quota
// is used up, the sentence is translated with the word marked, and the marked part of the
// translation is the word's meaning there.
const senses = new Map();
let geminiRestUntil = 0; // after "too many requests", Gemini is left alone for a while
let geminiModel = null; // the first of GEMINI_MODELS this key may use
const GEMINI_MODELS = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-flash-latest'];

async function sense(word, sentence, sl, tl, always) {
  word = String(word || '').trim();
  sentence = String(sentence || '').replace(/\s+/g, ' ').trim();
  if (!word || !sentence || sentence.toLowerCase() === word.toLowerCase()) return null;
  const { geminiKey } = await chrome.storage.local.get({ geminiKey: '' });
  const { useGemini } = await chrome.storage.sync.get({ useGemini: true });
  const gemini = !!geminiKey && (useGemini || !!always);
  // Answers are kept apart by who gave them: with Gemini switched off, none of its answers is shown.
  const key = [gemini ? 'g' : 'm', sl, tl, word, sentence].join('|').toLowerCase();
  if (senses.has(key)) return senses.get(key);
  let answer = null;
  if (gemini && Date.now() > geminiRestUntil) {
    answer = await askGemini(geminiKey, word, sentence, sl, tl).catch((e) => ({ error: e.message }));
  }
  if (!answer || answer.error) {
    const marked = await markedMeaning(word, sentence, sl, tl).catch(() => null);
    answer = marked ? { meaning: marked, engine: 'marked', ...(answer && answer.error ? { geminiError: answer.error } : {}) } : answer;
  }
  if (answer && answer.meaning) {
    if (senses.size > 500) senses.clear();
    senses.set(key, answer);
  }
  return answer;
}

async function markedMeaning(word, sentence, sl, tl) {
  const at = sentence.toLowerCase().indexOf(word.toLowerCase());
  if (at < 0) return '';
  const marked = sentence.slice(0, at) + '<b>' + sentence.slice(at, at + word.length) + '</b>' + sentence.slice(at + word.length);
  const out = joined(await call(marked, sl, tl));
  const m = /<\s*b\s*>([\s\S]*?)<\s*\/\s*b\s*>/i.exec(out);
  const meaning = m ? m[1].replace(/<[^>]*>/g, '').replace(/^[\s"'“”«»]+|[\s"'“”«».,!?;:]+$/g, '') : '';
  return meaning.length && meaning.length < 60 ? meaning : '';
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
  if (!text || !geminiKey || !(useGemini || always) || Date.now() < geminiRestUntil) return null;
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

// Back to the scene a word was saved in: the page is opened, and once its video plays, it is
// taken to that moment. YouTube is also told in its own address.
async function openScene(url, time) {
  let address = String(url || '');
  if (!/^https?:/.test(address)) throw new Error('no address');
  const t = Math.max(0, Math.floor((+time || 0) - 2));
  try {
    const u = new URL(address);
    if (/(^|\.)youtube\.com$/.test(u.hostname) && u.searchParams.has('v')) {
      u.searchParams.set('t', t + 's');
      address = u.href;
    }
  } catch (e) {}
  const tab = await chrome.tabs.create({ url: address });
  await chrome.storage.session.set({ ['seek-' + tab.id]: { time: t, until: Date.now() + 15 * 60000 } });
  return true;
}

async function pendingSeek(tab) {
  if (!tab) return null;
  const key = 'seek-' + tab.id;
  const { [key]: seek } = await chrome.storage.session.get(key);
  if (!seek) return null;
  await chrome.storage.session.remove(key);
  return seek.until < Date.now() ? null : seek;
}

// Spoken audio for a word or short phrase, returned as base64 MP3.
async function tts(text, lang, slow) {
  const url =
    `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}` +
    `${slow ? '&ttsspeed=0.24' : ''}&q=${encodeURIComponent(text.slice(0, 200))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 200) throw new Error('empty answer');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// Other sites. The extension comes with access to the sites it knows; the user can let it run
// everywhere, and takes that back the same way. The content script is then registered for all
// pages, except the ones the manifest already puts it on.
const EVERYWHERE = { origins: ['*://*/*'] };
const EVERYWHERE_ID = 'scenelingo-everywhere';

// `fresh` registers anew even if it is registered, for a version of the extension that lists
// other files than the one that registered it.
async function syncSites(fresh) {
  const allowed = await chrome.permissions.contains(EVERYWHERE);
  let registered = (await chrome.scripting.getRegisteredContentScripts({ ids: [EVERYWHERE_ID] })).length > 0;
  if (registered && (!allowed || fresh)) {
    await chrome.scripting.unregisterContentScripts({ ids: [EVERYWHERE_ID] });
    registered = false;
  }
  if (allowed && !registered) {
    const own = chrome.runtime.getManifest().content_scripts.find((c) => c.world !== 'MAIN');
    // From the start of the page, so that the addresses of what a player fetches are all seen.
    const script = { id: EVERYWHERE_ID, matches: EVERYWHERE.origins, excludeMatches: own.matches, js: own.js, css: own.css, allFrames: true, runAt: 'document_start' };
    try {
      // Players are sometimes put in a frame without an address of its own.
      await chrome.scripting.registerContentScripts([{ ...script, matchOriginAsFallback: true }]);
    } catch (e) {
      await chrome.scripting.registerContentScripts([script]); // a browser that does not know that option
    }
  }
  return allowed;
}

// Puts the content script into a tab that was already open when access was given.
async function startInTab(tabId) {
  const own = chrome.runtime.getManifest().content_scripts.find((c) => c.world !== 'MAIN');
  await chrome.scripting.insertCSS({ target: { tabId, allFrames: true }, files: own.css });
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: own.js });
  return true;
}

for (const event of [chrome.permissions.onAdded, chrome.permissions.onRemoved, chrome.runtime.onStartup]) {
  event.addListener(() => syncSites().catch(() => {}));
}
chrome.runtime.onInstalled.addListener(() => syncSites(true).catch(() => {}));

// The sound of a tab, louder: played by a page without a window (offscreen.html), which is
// opened the first time it is needed. The popup gets the tab's sound; it is passed on there.
async function toOffscreen(msg) {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (!open.length) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['USER_MEDIA'], justification: 'Plays the sound of a tab louder, as the user asked.' });
  }
  const res = await chrome.runtime.sendMessage({ ...msg, target: 'offscreen' });
  if (!res || !res.ok) throw new Error((res && res.error) || 'no answer');
  return res.result;
}

// Right-click on a selection: the card opens on any page, even one the extension was not let into
// (the click itself gives it the tab for the moment).
const SELECT_MENU = 'scenelingo-select';
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: SELECT_MENU, title: 'SceneLingo: “%s”', contexts: ['selection'] }, () => void chrome.runtime.lastError);
});
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== SELECT_MENU || !tab) return;
  const msg = { type: 'select-lookup', text: info.selectionText || '' };
  try {
    await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 });
  } catch (e) {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['messages.js', 'shared.js', 'select.js'] }).catch(() => {});
    await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 }).catch(() => {});
  }
});

// While a tab's sound is captured, the browser keeps a video's fullscreen inside the tab and the
// window stays as it was. So the page says when a video goes fullscreen, and the window follows.
async function boostTab(msg) {
  const result = await toOffscreen({ type: 'boost', tabId: msg.tabId, level: msg.level, streamId: msg.streamId });
  if (result.level > 100) {
    await chrome.scripting
      .executeScript({
        target: { tabId: msg.tabId },
        func: () => {
          if (window.__slFullscreen) return;
          window.__slFullscreen = true;
          document.addEventListener('fullscreenchange', () => chrome.runtime.sendMessage({ type: 'tab-fullscreen', on: !!document.fullscreenElement }).catch(() => {}));
        },
      })
      .catch(() => {}); // a page the extension may not touch keeps the fullscreen inside the tab
  }
  return result;
}

async function boostState(tabId) {
  const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return open.length && tabId != null ? toOffscreen({ type: 'boost-state', tabId }) : { level: 100 };
}

// The slider in the overlay's menu. The browser hands over a tab's sound only after the user has
// used the extension on that tab (its toolbar button, its menu); until then this is refused.
async function boostFromPage(tab, level) {
  if (!tab) throw new Error('no tab');
  const now = await boostState(tab.id);
  let streamId;
  if (level > 100 && now.level <= 100) {
    streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }).catch(() => null);
    if (!streamId) throw new Error('needToolbar');
  }
  return boostTab({ tabId: tab.id, level, streamId });
}

async function tabFullscreen(tab, on) {
  if (!tab) return false;
  const key = 'window-' + tab.windowId;
  if (on) {
    const open = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (!open.length || (await toOffscreen({ type: 'boost-state', tabId: tab.id })).level <= 100) return false;
    const win = await chrome.windows.get(tab.windowId);
    if (win.state === 'fullscreen') return false;
    await chrome.storage.session.set({ [key]: win.state });
    await chrome.windows.update(tab.windowId, { state: 'fullscreen' });
    return true;
  }
  const { [key]: before } = await chrome.storage.session.get(key);
  if (!before) return false;
  await chrome.storage.session.remove(key);
  await chrome.windows.update(tab.windowId, { state: before });
  return true;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.target === 'offscreen') return false; // for the offscreen page, not for here
  let job;
  if (msg && msg.type === 'translate') job = translateMany(msg.texts || [], msg.sl, msg.tl);
  else if (msg && msg.type === 'lookup') job = lookup(String(msg.text || ''), msg.sl, msg.tl);
  else if (msg && msg.type === 'sense') job = sense(msg.word, msg.sentence, msg.sl, msg.tl, msg.always);
  else if (msg && msg.type === 'enrich') job = enrich(msg);
  else if (msg && msg.type === 'explain') job = explain(msg.text, msg.sentence, msg.sl, msg.tl, msg.always);
  else if (msg && msg.type === 'check-sentence') job = checkSentence(msg);
  else if (msg && msg.type === 'open-scene') job = openScene(msg.url, msg.time);
  else if (msg && msg.type === 'pending-seek') job = pendingSeek(sender.tab);
  else if (msg && msg.type === 'gemini-test') job = chrome.storage.local.get({ geminiKey: '' }).then(({ geminiKey }) => askGemini(geminiKey, 'ripped', 'It is not my fault you ripped off the wrong people.', 'en', msg.tl || 'tr'));
  else if (msg && msg.type === 'tts') job = tts(String(msg.text || ''), String(msg.lang || 'en'), !!msg.slow);
  else if (msg && msg.type === 'boost') job = boostTab(msg);
  else if (msg && msg.type === 'gemini-key') job = geminiKeyShown();
  else if (msg && msg.type === 'boost-page') job = boostFromPage(sender.tab, msg.level);
  else if (msg && msg.type === 'boost-state-page') job = boostState(sender.tab && sender.tab.id);
  else if (msg && msg.type === 'boost-state') job = toOffscreen({ type: msg.type, tabId: msg.tabId });
  else if (msg && msg.type === 'tab-fullscreen') job = tabFullscreen(sender.tab, !!msg.on);
  else if (msg && msg.type === 'sync-sites') job = syncSites(false);
  else if (msg && msg.type === 'start-in-tab') job = startInTab(msg.tabId);
  else if (msg && msg.type === 'open-review') job = chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }).then(() => true);
  else return false;
  job.then(
    // A translation also says where it was made.
    (result) => sendResponse(result && result.lines ? { ok: true, result: result.lines, engine: result.engine, canGet: !!result.canGet } : { ok: true, result }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});

// The number on the toolbar icon: the cards today's review holds. Worked out again when the
// saved words or the day's record change, and every half hour, as cards come due.
if (typeof importScripts === 'function') importScripts('shared.js', 'study.js');
async function paintBadge() {
  if (typeof slDueCount !== 'function' || !chrome.action) return;
  const { words, reviewLog } = await chrome.storage.local.get({ words: [], reviewLog: {} });
  const { newPerDay } = await chrome.storage.sync.get({ newPerDay: 15 });
  const n = slDueCount(words, Date.now(), reviewLog, newPerDay);
  await chrome.action.setBadgeBackgroundColor({ color: '#1a6fd6' });
  await chrome.action.setBadgeText({ text: n ? String(Math.min(n, 999)) : '' });
}
if (chrome.alarms) {
  chrome.alarms.create('badge', { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener((a) => a.name === 'badge' && paintBadge().catch(() => {}));
}
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.words || changes.reviewLog || changes.newPerDay) paintBadge().catch(() => {});
  });
}
paintBadge().catch(() => {});
