// Shared by the content script and the toolbar popup.
const SL_DEFAULTS = {
  enabled: true,
  learnLang: 'en',
  nativeLang: 'tr',
  preferHuman: true, // use Prime's own track in the native language when there is one
  hideNative: true,
  hoverPause: true,
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
  if (grade === 'easy') {
    interval = reps === 1 ? 4 : Math.round(Math.max(interval, 1) * ease * 1.3);
    ease += 0.15;
  } else {
    interval = reps === 1 ? 1 : reps === 2 ? 3 : Math.round(interval * ease);
  }
  return { ...item, ease, interval, reps, lapses, due: now + interval * SL_DAY };
}

const SL_LANGS = [
  ['en', 'İngilizce'], ['tr', 'Türkçe'], ['de', 'Almanca'], ['fr', 'Fransızca'],
  ['es', 'İspanyolca'], ['it', 'İtalyanca'], ['pt', 'Portekizce'], ['nl', 'Felemenkçe'],
  ['ru', 'Rusça'], ['ja', 'Japonca'], ['ko', 'Korece'], ['zh', 'Çince'],
  ['ar', 'Arapça'], ['pl', 'Lehçe'], ['sv', 'İsveççe'], ['da', 'Danca'],
  ['no', 'Norveççe'], ['fi', 'Fince'], ['el', 'Yunanca'], ['hi', 'Hintçe'],
  ['id', 'Endonezce'], ['he', 'İbranice'], ['cs', 'Çekçe'], ['ro', 'Rumence'],
  ['hu', 'Macarca'], ['uk', 'Ukraynaca'],
];

if (typeof module !== 'undefined') module.exports = { SL_DEFAULTS, SL_LANGS, SL_DAY, slIsDue, slGrade };
