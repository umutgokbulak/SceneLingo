// German nouns: their gender (der, die, das) and plural, from the list in freq/de-nouns.txt. A noun
// not in it but ending in one that is ("Handyrechnung") takes that one's gender, as German compounds
// do. Pure, but for slNouns, which loads the list once.

const SL_ARTICLE = { m: 'der', f: 'die', n: 'das' };

// The list read: lemma -> { g, pl }, its forms (Häuser -> Haus), and each lemma by its lower case.
function slNounList(text) {
  const nouns = new Map();
  const forms = new Map();
  const lower = new Map();
  for (const line of String(text || '').split('\n')) {
    if (!line || line[0] === '#') continue;
    const [a, b, c] = line.split('\t');
    if (a[0] === '=') forms.set(a.slice(1), b);
    else {
      nouns.set(a, { g: b || '', pl: c || '' });
      if (!lower.has(a.toLowerCase())) lower.set(a.toLowerCase(), a);
    }
  }
  return { nouns, forms, lower };
}

const slCap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// What is known of a word as a German noun: { lemma, g ('f', or 'mf' for der/die), pl, compound },
// or null. The word may be the plural or another form of it, and in any case.
function slNoun(list, word) {
  if (!list) return null;
  const w = String(word || '')
    .trim()
    .replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
  if (w.length < 2 || /\s/.test(w)) return null;
  const found = (lemma) => (list.nouns.has(lemma) ? { lemma, ...list.nouns.get(lemma), compound: false } : null);
  const direct = found(w) || found(list.forms.get(w)) || found(list.lower.get(w.toLowerCase())) || found(list.forms.get(slCap(w.toLowerCase())));
  if (direct) return direct;
  // A compound: the longest known noun it ends in, with at least three letters before it.
  for (let i = 3; i <= w.length - 3; i++) {
    const tail = slCap(w.slice(i).toLowerCase());
    const head = slCap(w.slice(0, i));
    if (list.nouns.has(tail) && tail.length >= 4) {
      const n = list.nouns.get(tail);
      return { lemma: head + tail.toLowerCase(), g: n.g, pl: n.pl ? head + n.pl.toLowerCase() : '', compound: true };
    }
    const lemma = list.forms.get(tail);
    if (lemma && lemma.length >= 4 && list.nouns.has(lemma)) {
      const n = list.nouns.get(lemma);
      return { lemma: head + lemma.toLowerCase(), g: n.g, pl: n.pl ? head + n.pl.toLowerCase() : '', compound: true };
    }
  }
  return null;
}

// How a noun is said with its article: { article: 'der/die', lemma, plural: 'die Seen', g: first
// gender or '' }. A noun with no gender is used in the plural only ("die Leute").
function slNounText(info) {
  if (!info) return null;
  const genders = [...info.g].filter((g) => SL_ARTICLE[g]);
  return {
    article: genders.length ? genders.map((g) => SL_ARTICLE[g]).join('/') : 'die',
    lemma: info.lemma,
    plural: info.pl && info.pl !== '-' ? 'die ' + info.pl : '',
    pluralOnly: !genders.length,
    g: genders[0] || '',
  };
}

// The list, loaded once: on the extension's own pages (and the phone's) from the file next to
// them, in a content script from the background, which can read it.
let slNounsLoading = null;
function slNouns() {
  if (!slNounsLoading) {
    const own = typeof location !== 'undefined' && (location.protocol === 'chrome-extension:' || chrome.runtime.getManifest().version === 'web');
    slNounsLoading = (own
      ? fetch('freq/de-nouns.txt').then((r) => r.text())
      : new Promise((resolve) => chrome.runtime.sendMessage({ type: 'de-nouns' }, (res) => resolve(res && res.ok ? res.result : '')))
    )
      .then(slNounList)
      .catch(() => slNounList(''));
  }
  return slNounsLoading;
}

if (typeof module !== 'undefined') module.exports = { SL_ARTICLE, slNounList, slNoun, slNounText, slCap };
