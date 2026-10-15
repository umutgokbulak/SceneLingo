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
  else if (msg && msg.type === 'tts') job = tts(String(msg.text || ''), String(msg.lang || 'en'), !!msg.slow);
  else if (msg && msg.type === 'boost') job = boostTab(msg);
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
