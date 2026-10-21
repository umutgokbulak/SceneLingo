// Translation, word lookup and speech requests come here from the pages.
//
// Sentences are translated inside the browser where it can do that (the Translator API): no
// network, no limits, and the subtitles do not leave the computer. Where it cannot — an older
// browser, a pair of languages it does not have, or a language pack that has not been fetched
// yet — and for what it does not know at all (a word's dictionary entry, its sound), the
// requests go to Google Translate's web endpoint; from here, so that they are not subject to
// the page's CORS rules.
if (typeof importScripts === 'function') importScripts('translate.js');
else Object.assign(globalThis, require('./translate.js'));

// What a word means in the sentence it is in. A dictionary gives every meaning of "ripped";
// in "you ripped off the wrong people" it is "soymak". With the user's own Gemini key, the model
// answers, and also says when the word is part of a phrase. Without one, or when its free quota
// is used up, the sentence is translated with the word marked, and the marked part of the
// translation is the word's meaning there.
const senses = new Map();
// Gemini's part is shared with the pages when they run on the phone.
if (typeof importScripts === 'function') importScripts('gemini.js');
else Object.assign(globalThis, require('./gemini.js'));

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
  if (gemini && !slGeminiResting()) {
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

// ---------- the cloud ----------

// A token for the user's Drive: kept for its hour in the session, asked for again after it.
// Asked for without a window when the user has signed in before.
async function cloudToken(interactive) {
  const { cloudToken: kept } = await chrome.storage.session.get('cloudToken');
  if (kept && kept.expires > Date.now()) return kept.token;
  const { cloudEmail } = await chrome.storage.local.get({ cloudEmail: '' });
  if (!interactive && !cloudEmail) throw new Error('signed out');
  const url = await chrome.identity.launchWebAuthFlow({ url: slAuthUrl(chrome.identity.getRedirectURL(), interactive, cloudEmail), interactive });
  const t = slTokenFrom(url);
  await chrome.storage.session.set({ cloudToken: t });
  return t.token;
}

let syncing = null; // one sync at a time
function cloudSync(interactive) {
  if (!syncing) {
    syncing = (async () => {
      if (typeof SL_CLOUD === 'undefined' || !SL_CLOUD.clientId) throw new Error('noClient');
      let token = await cloudToken(interactive);
      const { cloudEmail } = await chrome.storage.local.get({ cloudEmail: '' });
      if (!cloudEmail) await chrome.storage.local.set({ cloudEmail: (await slWho(token)) || '?' });
      try {
        return await slCloudSync(token, chrome.storage.local, Date.now());
      } catch (e) {
        if (!e.auth) throw e;
        await chrome.storage.session.remove('cloudToken');
        token = await cloudToken(interactive);
        return slCloudSync(token, chrome.storage.local, Date.now());
      }
    })()
      .then(
        async (r) => {
          await chrome.storage.local.set({ cloudError: '' });
          return r;
        },
        async (e) => {
          // Kept for the page to say; a sync not asked for by the user, failing quietly, still says why.
          // Not being signed in at all is no error.
          const { cloudEmail } = await chrome.storage.local.get({ cloudEmail: '' });
          if (cloudEmail || interactive) await chrome.storage.local.set({ cloudError: e.message });
          throw e;
        }
      )
      .finally(() => (syncing = null));
  }
  return syncing;
}

async function cloudState() {
  const { cloudEmail, lastSync, cloudError } = await chrome.storage.local.get({ cloudEmail: '', lastSync: 0, cloudError: '' });
  return { configured: typeof SL_CLOUD !== 'undefined' && !!SL_CLOUD.clientId, email: cloudEmail, lastSync, error: cloudError, web: typeof SL_CLOUD !== 'undefined' ? SL_CLOUD.web : '' };
}

async function cloudSignOut() {
  await chrome.storage.session.remove('cloudToken');
  await chrome.storage.local.remove(['cloudEmail', 'lastSync']);
  return true;
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
chrome.runtime.onInstalled.addListener((details) => {
  syncSites(true).catch(() => {});
  // The first time: the page that sets it up, and shows how it is used.
  if (details && details.reason === 'install' && chrome.tabs) chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') }).catch(() => {});
});

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
  else if (msg && msg.type === 'gloss') job = gloss(msg);
  else if (msg && msg.type === 'speak-feedback') job = speakingFeedback(msg);
  else if (msg && msg.type === 'roleplay') job = roleplay(msg);
  else if (msg && msg.type === 'episode-words') job = episodeWords(msg);
  else if (msg && msg.type === 'episode-gloss') job = episodeGloss(msg);
  else if (msg && msg.type === 'episode-quiz') job = episodeQuiz(msg);
  else if (msg && msg.type === 'ielts-writing') job = ieltsWriting(msg);
  else if (msg && msg.type === 'everyday-writing') job = everydayWriting(msg);
  else if (msg && msg.type === 'explain') job = explain(msg.text, msg.sentence, msg.sl, msg.tl, msg.always);
  else if (msg && msg.type === 'check-sentence') job = checkSentence(msg);
  else if (msg && msg.type === 'open-scene') job = openScene(msg.url, msg.time);
  else if (msg && msg.type === 'cloud-sync') job = cloudSync(!!msg.interactive);
  else if (msg && msg.type === 'cloud-state') job = cloudState();
  else if (msg && msg.type === 'cloud-signout') job = cloudSignOut();
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
if (typeof importScripts === 'function') importScripts('shared.js', 'study.js', 'cloud.js');
else for (const file of ['./shared.js', './study.js', './cloud.js']) Object.assign(globalThis, require(file));
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
  chrome.alarms.create('cloud', { periodInMinutes: 30 });
  chrome.alarms.onAlarm.addListener((a) => {
    if (a.name === 'badge') paintBadge().catch(() => {});
    // Synced every half hour, and a minute after the cards change, once signed in.
    if (a.name === 'cloud' || a.name === 'cloud-soon') cloudSync(false).catch(() => {});
  });
}
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.words || changes.reviewLog || changes.newPerDay) paintBadge().catch(() => {});
    if ((changes.words || changes.deleted) && chrome.alarms) {
      chrome.storage.local.get({ cloudEmail: '' }).then(({ cloudEmail }) => cloudEmail && chrome.alarms.create('cloud-soon', { delayInMinutes: 1 }));
    }
  });
}
paintBadge().catch(() => {});

// An episode's own words: those of its lines a learner at a level is not likely to know yet, by
// how common each is in film subtitles (freq/, read once). A language without a list has none.
if (typeof importScripts === 'function') importScripts('episode.js');
else Object.assign(globalThis, require('./episode.js'));
const rankLists = new Map(); // language -> its list, as word -> rank
function ranksFor(lang) {
  if (!rankLists.has(lang)) {
    const text =
      typeof importScripts === 'function'
        ? fetch(chrome.runtime.getURL('freq/' + lang + '.txt')).then((r) => (r.ok ? r.text() : ''), () => '')
        : Promise.resolve().then(() => {
            try {
              return require('fs').readFileSync(require('path').join(__dirname, 'freq', lang + '.txt'), 'utf8');
            } catch (e) {
              return '';
            }
          });
    rankLists.set(lang, text.then(slRanks));
  }
  return rankLists.get(lang);
}
async function episodeWords({ lines, lang, level, known }) {
  const code = String(lang || '').toLowerCase().split(/[-_]/)[0];
  const ranks = await ranksFor(code);
  if (!ranks.size) return { words: [], noList: true };
  return { words: slEpisodeWords({ lines: (lines || []).map(String), ranks, lang: code, level, known: new Set(known || []) }) };
}

// A reminder once a day, at the hour the user chose, when today's plan is not done yet: what is
// left of it, and a click to the next step.
if (typeof importScripts === 'function') importScripts('messages.js');
const PLAN_PAGES = { review: 'review.html', listen: 'listen.html', speak: 'speak.html', write: 'write.html' };
const PLAN_NAMES = { review: 'planReview', listen: 'planListen', speak: 'planSpeak', write: 'planWrite' };

async function planReminder() {
  if (!chrome.alarms || typeof slNextAt !== 'function') return;
  const { remindOn, remindAt } = await chrome.storage.sync.get({ remindOn: false, remindAt: '20:00' });
  await chrome.alarms.clear('remind');
  if (remindOn) chrome.alarms.create('remind', { when: slNextAt(Date.now(), remindAt), periodInMinutes: 24 * 60 });
}

async function todaysPlan() {
  const settings = await chrome.storage.sync.get(SL_DEFAULTS);
  const { words, reviewLog } = await chrome.storage.local.get({ words: [], reviewLog: {} });
  return { settings, words, plan: slTodayPlan(words, reviewLog, Date.now(), settings.newPerDay, slGoals(settings)) };
}

async function remind() {
  if (!chrome.notifications || typeof slTodayPlan !== 'function') return;
  const { settings, words, plan } = await todaysPlan();
  if (!settings.remindOn || !words.length || plan.done) return;
  slSetUiLang(settings.uiLang);
  const left = plan.steps
    .filter((s) => !s.done)
    .map((s) => (s.id === 'review' ? slT('planCards', s.left) : slT(PLAN_NAMES[s.id]) + ' ' + slT('planOf', s.have, s.goal)));
  await chrome.notifications.create('remind', {
    type: 'basic',
    iconUrl: 'icons/128.png',
    title: slT('remindTitle'),
    message: slT('remindLeft', left.join(' · ')),
    contextMessage: slT('planNext', slT(PLAN_NAMES[plan.next])),
    priority: 1,
  });
}

if (chrome.notifications) {
  chrome.notifications.onClicked.addListener(async (id) => {
    if (id !== 'remind') return;
    chrome.notifications.clear(id);
    const { plan } = await todaysPlan();
    chrome.tabs.create({ url: chrome.runtime.getURL(PLAN_PAGES[plan.next] || 'progress.html') });
  });
}
if (chrome.alarms) chrome.alarms.onAlarm.addListener((a) => a.name === 'remind' && remind().catch(() => {}));
if (chrome.storage && chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && (changes.remindOn || changes.remindAt)) planReminder().catch(() => {});
  });
}
// The alarm is set again whenever the browser starts or the extension is updated: its time follows
// the clock, not the moment it was first set.
chrome.runtime.onInstalled.addListener(() => planReminder().catch(() => {}));
if (chrome.runtime.onStartup) chrome.runtime.onStartup.addListener(() => planReminder().catch(() => {}));
