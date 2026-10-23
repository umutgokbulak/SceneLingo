// Translation and a word's dictionary entry: inside the browser where it can (the Translator API),
// otherwise from Google Translate's web endpoint, which lets web pages ask it too. Shared by the
// extension's background and by its pages when they run on the phone, without it.
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

// Kept by name for the stand-in on the web (web.js): in the live demo the overlay's own scripts,
// loaded after this one, have a `lookup` of their own.
const SL_TRANSLATE = { translateMany, lookup };

if (typeof module !== 'undefined') {
  module.exports = { gLang, call, joined, translateMany, lookup };
}
