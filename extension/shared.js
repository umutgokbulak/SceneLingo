// Shared by the content script and the toolbar popup.

// The languages that can be chosen; their names come from the browser, in the interface's language.
const SL_LANGS = [
  'en', 'tr', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh', 'ar',
  'pl', 'sv', 'da', 'no', 'fi', 'el', 'hi', 'id', 'he', 'cs', 'ro', 'hu', 'uk',
];

// A new user's languages are guessed from the browser's: their own language is the browser's,
// and what they learn is English — or Spanish, if English is their own.
function slGuessLanguages(browserLanguage) {
  const own = String(browserLanguage || 'en').toLowerCase().split('-')[0];
  const nativeLang = SL_LANGS.includes(own) ? own : 'en';
  return { nativeLang, learnLang: nativeLang === 'en' ? 'es' : 'en' };
}

const SL_DEFAULTS = {
  enabled: true,
  ...slGuessLanguages(typeof navigator !== 'undefined' ? navigator.language : 'en'),
  uiLang: 'auto', // the language of the interface: 'auto' follows the browser
  preferHuman: true, // use Prime's own track in the native language when there is one
  hideNative: true,
  hoverPause: true,
  newPerDay: 15, // new cards a day in review
  useGemini: true, // ask Gemini for a word's meaning in its sentence, when a key has been saved
  selectLookup: true, // a button beside text selected on any page, for its translation
  hoverLookup: true, // show the word popup on hover, without a click
  autoSpeak: true, // read the word aloud when its popup opens
  accent: 'en-GB', // which English the word is read in
  speechVolume: 200, // percent; above 100 the audio is amplified
  autoPause: false,
  mode: 'watch', // 'watch', 'write' (type what was heard) or 'speak' (say the line aloud)
  introSeen: false,
  offSites: [], // host names of sites where the extension has been switched off
  fontSize: 100, // percent
  bottomOffset: 14, // percent of the video height
};

// A card deleted here is remembered as deleted, with the time, so that a copy of the cards kept
// elsewhere (in the cloud, in a backup file) does not bring it back.
function slForget(keys) {
  const list = [].concat(keys).map((k) => String(k).toLowerCase());
  if (!list.length || typeof chrome === 'undefined' || !chrome.storage) return;
  chrome.storage.local.get({ deleted: {} }, ({ deleted }) => {
    for (const k of list) deleted[k] = Date.now();
    chrome.storage.local.set({ deleted });
  });
}

// Review scheduling for saved items (a small SM-2 variant). `due` is a timestamp in ms;
// an item that has never been reviewed is due at once.
const SL_DAY = 86400000;

function slIsDue(item, now) {
  return !item.due || item.due <= now;
}

function slGrade(item, grade, now) {
  let { ease = 2.5, interval = 0, reps = 0, lapses = 0 } = item;
  if (grade === 'again') {
    return { ...item, ease: Math.max(1.3, ease - 0.2), interval: 0, reps: 0, lapses: lapses + 1, due: now + 10 * 60000 };
  }
  reps += 1;
  const good = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease);
  if (grade === 'easy') {
    // Always further than "got it" would have put it.
    interval = Math.max(reps === 1 ? 4 : Math.round(Math.max(interval, 1) * ease * 1.3), good + 1);
    ease += 0.15;
  } else {
    interval = good;
  }
  return { ...item, ease, interval, reps, lapses, due: now + interval * SL_DAY };
}

if (typeof module !== 'undefined') module.exports = { SL_DEFAULTS, SL_LANGS, SL_DAY, slIsDue, slGrade, slGuessLanguages };
