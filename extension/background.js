// Translation requests go through the service worker so they are not subject
// to the page's CORS rules.
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
  const res = await fetch(url);
  if (!res.ok) throw new Error('Çeviri servisi yanıt vermedi (HTTP ' + res.status + ')');
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

async function translateMany(texts, sl, tl) {
  const flat = texts.map((t) => String(t).replace(/\s*\n\s*/g, ' ').trim());
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
  const data = await call(text, sl, tl, '&dt=bd&dt=md&dt=ss&dt=rm');
  const phonetic = (data[0] || []).find((s) => s && s[0] == null && typeof s[3] === 'string');
  const defs = [];
  for (const group of data[12] || []) {
    for (const d of (group[1] || []).slice(0, 2)) {
      if (defs.length < 3 && d[0]) defs.push({ pos: group[0] || '', text: d[0], example: d[2] || '' });
    }
  }
  const synonyms = [];
  for (const group of data[11] || []) {
    // Each set belongs to one sense; later sets drift to figurative meanings, so only the
    // first one that is not labelled informal, rare, archaic... is used.
    const set = (group[1] || []).find((s) => !s[2]);
    for (const s of (set && set[0]) || []) if (synonyms.length < 6 && !synonyms.includes(s)) synonyms.push(s);
  }
  // For a single word the service's one-line answer is sometimes a different word altogether
  // ("it" -> "BT", as in information technology) while its dictionary entries are right. When
  // the answer is not among the dictionary's own terms, the first of those is the better headline.
  let translation = joined(data).trim();
  const terms = (data[1] || []).flatMap((d) => d[1] || []);
  if (terms.length && text.length > 1 && !/\s/.test(text) && !terms.some((t) => t.toLowerCase() === translation.toLowerCase())) {
    translation = terms[0];
  }
  return {
    translation,
    dict: (data[1] || []).slice(0, 4).map((d) => ({ pos: d[0] || '', terms: (d[1] || []).slice(0, 5) })),
    ipa: phonetic ? phonetic[3] : '',
    defs,
    synonyms,
  };
}

// Spoken audio for a word or short phrase, returned as base64 MP3.
async function tts(text, lang, slow) {
  const url =
    `https://translate.googleapis.com/translate_tts?client=gtx&ie=UTF-8&tl=${encodeURIComponent(lang)}` +
    `${slow ? '&ttsspeed=0.24' : ''}&q=${encodeURIComponent(text.slice(0, 200))}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Ses servisi yanıt vermedi (HTTP ' + res.status + ')');
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (bytes.length < 200) throw new Error('Ses servisi boş yanıt verdi');
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  let job;
  if (msg && msg.type === 'translate') job = translateMany(msg.texts || [], msg.sl, msg.tl);
  else if (msg && msg.type === 'lookup') job = lookup(String(msg.text || ''), msg.sl, msg.tl);
  else if (msg && msg.type === 'tts') job = tts(String(msg.text || ''), String(msg.lang || 'en'), !!msg.slow);
  else if (msg && msg.type === 'sync-sites') job = syncSites(false);
  else if (msg && msg.type === 'start-in-tab') job = startInTab(msg.tabId);
  else if (msg && msg.type === 'open-review') job = chrome.tabs.create({ url: chrome.runtime.getURL('review.html') }).then(() => true);
  else return false;
  job.then(
    (result) => sendResponse({ ok: true, result }),
    (err) => sendResponse({ ok: false, error: String((err && err.message) || err) })
  );
  return true;
});
