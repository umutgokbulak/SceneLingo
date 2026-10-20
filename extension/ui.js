// Icons the extension's own pages share: small line drawings that take the colour and size of the text.
const SL_ICONS = {
  speaker: '<path d="M4 9.5v5h3.5L12 18V6L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  edit: '<path d="M4 20h4L18.5 9.5a2.1 2.1 0 0 0-3-3L5 17v3z"/><path d="M13.5 7.5l3 3"/>',
  trash: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
  sliders: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.8 10.6c.8.7 1.3 1.5 1.3 2.4h5c0-.9.5-1.7 1.3-2.4A6 6 0 0 0 12 3z"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 14l5-5 5 5M5 4h14"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
  cards: '<rect x="3" y="6" width="14" height="14" rx="2"/><path d="M7 3h12a2 2 0 0 1 2 2v12"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  cloud: '<path d="M7 18a4.5 4.5 0 0 1-.6-9 6 6 0 0 1 11.5 1.5A3.8 3.8 0 0 1 17.5 18H7z"/>',
  sync: '<path d="M20 11a8 8 0 0 0-14.3-4.3L4 9"/><path d="M4 4v5h5"/><path d="M4 13a8 8 0 0 0 14.3 4.3L20 15"/><path d="M20 20v-5h-5"/>',
  headphones: '<path d="M4 15v-3a8 8 0 0 1 16 0v3"/><rect x="3.5" y="14" width="4.5" height="6.5" rx="1.5"/><rect x="16" y="14" width="4.5" height="6.5" rx="1.5"/>',
  stop: '<rect x="7" y="7" width="10" height="10" rx="2"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.6.3 1.6 1.1 2.6 2.1 3.1C11 9 11.2 5.8 12 3z"/>',
};
function slIcon(name) {
  const box = document.createElement('span');
  box.innerHTML = '<svg class="i" viewBox="0 0 24 24" aria-hidden="true">' + SL_ICONS[name] + '</svg>';
  return box.firstChild;
}

// "3 days ago", in the language of the page.
function slAgo(ts) {
  const rtf = new Intl.RelativeTimeFormat(document.documentElement.lang || 'en', { numeric: 'auto' });
  const mins = Math.round((ts - Date.now()) / 60000);
  if (Math.abs(mins) < 60) return rtf.format(mins, 'minute');
  const hours = Math.round(mins / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  return rtf.format(Math.round(hours / 24), 'day');
}

// "Prime Video: Spider-Noir" is shown as the film first: "Spider-Noir · Prime Video".
function slSourceName(title) {
  const m = /^([^:]{2,40}):\s+(.+)$/.exec(title || '');
  return m ? m[2] + ' · ' + m[1] : title || '';
}

// Gemini's use, from what gemini.js counts: today's requests and tokens, and the last seven days
// as small bars. Google's free limits are per day and per minute, and differ by model.
function slGeminiUsage(usage, now = Date.now()) {
  const box = document.createElement('div');
  box.className = 'sl-usage';
  const days = (usage && usage.days) || {};
  const keys = [];
  for (let i = 6; i >= 0; i--) keys.push(slDayKey(now - i * 86400000));
  const today = days[keys[6]] || { requests: 0, tokens: 0, refused: 0 };
  const week = keys.reduce((a, k) => a + ((days[k] && days[k].requests) || 0), 0);
  const most = Math.max(1, ...keys.map((k) => (days[k] && days[k].requests) || 0));
  const bars = document.createElement('span');
  bars.className = 'sl-bars';
  for (const k of keys) {
    const bar = document.createElement('i');
    const n = (days[k] && days[k].requests) || 0;
    bar.style.height = Math.max(2, Math.round((n / most) * 18)) + 'px';
    bar.title = k + ': ' + n;
    if (k === keys[6]) bar.className = 'now';
    bars.append(bar);
  }
  const text = document.createElement('span');
  const tokens = today.tokens >= 1000 ? Math.round(today.tokens / 1000) + slT('thousandShort') : String(today.tokens);
  text.textContent = slT('geminiUsage', today.requests, tokens, week);
  box.append(bars, text);
  if (usage && usage.limited && now - usage.limited < 10 * 60000) {
    const warn = document.createElement('b');
    warn.textContent = slT('geminiLimited');
    box.append(warn);
  }
  if (usage && usage.model) box.title = usage.model;
  return box;
}

// Translation inside the browser. The browser fetches a language pack the first time a pair of
// languages is used, and only when a person asks for it: so the asking is done on a page, with a
// button. After that the background translates with it, on every site.
function slPackPairs(learn, native) {
  const names = (code) => ({ he: ['he', 'iw'], no: ['no', 'nb'] })[code] || [code];
  const all = [];
  for (const sourceLanguage of names(learn)) for (const targetLanguage of names(native)) all.push({ sourceLanguage, targetLanguage });
  return all;
}

// 'same', 'none' (no translator in this browser, or not for these languages), 'ready', or 'get'.
async function slPackState(learn, native) {
  if (learn === native) return 'same';
  if (typeof Translator !== 'function') return 'none';
  let best = 'unavailable';
  for (const langs of slPackPairs(learn, native)) {
    const state = await Translator.availability(langs).catch(() => 'unavailable');
    if (state === 'available') return 'ready';
    if (state !== 'unavailable') best = state;
  }
  return best === 'unavailable' ? 'none' : 'get';
}

// Fetches the pack; `progress` hears how far, from 0 to 100.
async function slPackGet(learn, native, progress) {
  let failure = null;
  for (const langs of slPackPairs(learn, native)) {
    try {
      const translator = await Translator.create({
        ...langs,
        monitor(m) {
          m.addEventListener('downloadprogress', (e) => progress(Math.round(e.loaded * 100)));
        },
      });
      if (translator.destroy) translator.destroy();
      return;
    } catch (e) {
      failure = e;
    }
  }
  throw failure || new Error('?');
}
