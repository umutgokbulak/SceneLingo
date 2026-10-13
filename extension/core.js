// Pure helpers used by the content script: no DOM and no extension APIs, so they can be
// unit-tested with Node (see test/unit).
const SubtitleCore = (() => {
  function parseTime(s, tickRate, frameRate) {
    if (!s) return NaN;
    s = s.trim();
    let m;
    if ((m = /^(\d+):(\d{2}):(\d{2})(?:[.,](\d+))?$/.exec(s))) {
      return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? parseFloat('0.' + m[4]) : 0);
    }
    if ((m = /^(\d+):(\d{2}):(\d{2}):(\d+)$/.exec(s))) {
      return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / frameRate;
    }
    if ((m = /^([\d.]+)(h|ms|m|s|f|t)$/.exec(s))) {
      const v = parseFloat(m[1]);
      return { h: v * 3600, m: v * 60, s: v, ms: v / 1000, f: v / frameRate, t: v / tickRate }[m[2]];
    }
    return NaN;
  }

  // Index of the last cue that has started at time t, or -1.
  function lastStarted(cues, t) {
    let lo = 0;
    let hi = cues.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cues[mid].start <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  function findCue(cues, t) {
    const i = lastStarted(cues, t);
    return i >= 0 && cues[i].end > t ? i : -1;
  }

  // Give every primary cue the text of the secondary cues that overlap it most (for the list panel).
  function alignTranslation(pri, sec) {
    let j = 0;
    for (const s of sec) {
      while (j < pri.length - 1 && pri[j].end <= s.start) j++;
      let best = -1;
      let bestOverlap = 0;
      const covered = [];
      for (let k = j; k < pri.length && pri[k].start < s.end; k++) {
        const overlap = Math.min(pri[k].end, s.end) - Math.max(pri[k].start, s.start);
        if (overlap >= Math.min(0.5, (pri[k].end - pri[k].start) * 0.3)) covered.push(pri[k]);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = k;
        }
      }
      // A translated cue that covers several lines says more than any one of them; those lines
      // are marked so the caller can give each a translation of its own.
      if (covered.length > 1) for (const p of covered) p.shared = true;
      if (best >= 0) pri[best].tr = pri[best].tr ? pri[best].tr + ' ' + s.text.replace(/\n/g, ' ') : s.text.replace(/\n/g, ' ');
    }
    // One translation cue can cover two lines of the original. The line it was not given to
    // borrows it, as long as the two really overlap.
    const given = pri.map((p) => !!p.tr);
    j = 0;
    pri.forEach((p, i) => {
      if (given[i]) return;
      while (j < sec.length - 1 && sec[j].end <= p.start) j++;
      let best = null;
      let bestOverlap = 0;
      for (let k = j; k < sec.length && sec[k].start < p.end; k++) {
        const overlap = Math.min(p.end, sec[k].end) - Math.max(p.start, sec[k].start);
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          best = sec[k];
        }
      }
      if (best && bestOverlap >= Math.min(0.5, (p.end - p.start) * 0.3)) {
        p.tr = best.text.replace(/\n/g, ' ');
        p.shared = true;
      }
    });
  }

  // The words a listener is expected to type: no sound descriptions, speaker labels or punctuation.
  function spokenWords(text) {
    return spokenTokens(text).map((token) => token.word);
  }

  // The same words with where each begins in the text, so they can be matched to what is on
  // screen. What is left out is blanked rather than removed, which keeps the positions true.
  function spokenTokens(text) {
    const blank = (m) => ' '.repeat(m.length);
    const kept = String(text)
      .replace(/\[[^\]]*\]|\([^)]*\)|[♪♫]/g, blank)
      .replace(/^\s*-?\s*[A-Z][A-Z .'-]{1,20}:\s*/gm, blank);
    return Array.from(kept.matchAll(/[\p{L}\p{N}'\u2019\u0060]+/gu), (m) => ({
      word: m[0].toLowerCase().replace(/[\u2019\u0060]/g, "'"),
      start: m.index,
    }));
  }

  // Which expected words appear, in order, in what was typed (longest common subsequence).
  function matchWords(expected, typed) {
    // "dont" for "don't" is a typing shortcut, not a listening mistake.
    expected = expected.map((w) => w.replace(/'/g, ''));
    typed = typed.map((w) => w.replace(/'/g, ''));
    const n = expected.length;
    const m = typed.length;
    const lcs = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        lcs[i][j] = expected[i] === typed[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    const hit = new Array(n).fill(false);
    for (let i = 0, j = 0; i < n && j < m; ) {
      if (expected[i] === typed[j]) {
        hit[i] = true;
        i++;
        j++;
      } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
      else j++;
    }
    return hit;
  }

  // Slows speech down without lowering its pitch (WSOLA): short windows are taken from the input
  // more densely than they are written, each one shifted a little to where it lines up best with
  // the audio that came before it, and overlap-added.
  function stretch(samples, sampleRate, rate) {
    const win = Math.round(sampleRate * 0.04) & ~1;
    const hopOut = win / 2;
    const hopIn = hopOut * rate;
    const seek = Math.round(sampleRate * 0.012);
    const input = new Float32Array(samples.length + win + 2 * seek);
    input.set(samples);
    const out = new Float32Array(Math.ceil(samples.length / rate) + win);
    const hann = new Float32Array(win);
    for (let i = 0; i < win; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
    let prev = 0;
    for (let k = 0; ; k++) {
      let pos = Math.round(k * hopIn);
      const outPos = k * hopOut;
      if (pos >= samples.length || outPos + win > out.length) break;
      if (k > 0) {
        // What would have followed the previous window had nothing been stretched.
        const follow = prev + hopOut;
        let best = 0;
        let bestScore = -Infinity;
        for (let d = -seek; d <= seek; d += 2) {
          const p = pos + d;
          if (p < 0) continue;
          let score = 0;
          for (let i = 0; i < hopOut; i += 4) score += input[follow + i] * input[p + i];
          if (score > bestScore) {
            bestScore = score;
            best = d;
          }
        }
        pos += best;
      }
      for (let i = 0; i < win; i++) out[outPos + i] += input[pos + i] * hann[i];
      prev = pos;
    }
    return out;
  }

  // Subtitles written in capitals throughout ("I'LL TAKE IT.") translate and read aloud badly:
  // services take "IT" for an abbreviation and spell it out.
  function isShouting(text) {
    return (text.match(/\p{Lu}/gu) || []).length > 3 && !/\p{Ll}/u.test(text);
  }

  // Lower-cases such text again. `sentence` restores the capital at the start of each sentence,
  // `english` the pronoun "I".
  function calm(text, sentence, english) {
    let out = text.toLowerCase();
    if (english) out = out.replace(/(^|[^\p{L}'\u2019])i(?=$|[^\p{L}])/gu, '$1I');
    if (sentence) out = out.replace(/(^[\s\-\u2013]*|[.!?\u2026]["']?\s+[\-\u2013]?\s*)(\p{Ll})/gu, (m, lead, letter) => lead + letter.toUpperCase());
    return out;
  }

  const SPOKEN_FORMS = {
    gonna: 'going to', wanna: 'want to', gotta: 'got to', gimme: 'give me', lemme: 'let me', kinda: 'kind of',
    sorta: 'sort of', dunno: 'do not know', outta: 'out of', "y'all": 'you all', "c'mon": 'come on', "'em": 'them',
    "'cause": 'because', "ain't": 'is not', "won't": 'will not', "can't": 'cannot', "shan't": 'shall not', "let's": 'let us',
  };
  const TAKES_IS = new Set(['it', 'that', 'this', 'there', 'here', 'what', 'who', 'where', 'when', 'how', 'he', 'she', 'everything', 'nothing', 'something']);

  // "I'll" -> "I will", "gonna" -> "going to"; null when the word is not a contraction this knows.
  // "'s" is only expanded after words where it can hardly be a possessive.
  function expandContraction(word) {
    const w = word.toLowerCase().replace(/[\u2019\u0060]/g, "'");
    const self = (s) => (s === 'i' ? 'I' : s);
    if (SPOKEN_FORMS[w]) return SPOKEN_FORMS[w];
    let m;
    if ((m = /^(\p{L}+)n't$/u.exec(w))) return m[1] + ' not';
    if ((m = /^(\p{L}+)'(ll|re|ve|m|d)$/u.exec(w))) return self(m[1]) + ' ' + { ll: 'will', re: 'are', ve: 'have', m: 'am', d: 'would' }[m[2]];
    if ((m = /^(\p{L}+)'s$/u.exec(w)) && TAKES_IS.has(m[1])) return m[1] + ' is';
    return null;
  }

  // The text of a WebVTT or SubRip cue without its markup: <i>, <c.name>, <00:01.000>, {\an8}.
  function cueText(s) {
    return String(s || '')
      .replace(/<[^>]*>/g, '')
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/&(amp|lt|gt|nbsp|lrm|rlm);/g, (m, name) => ({ amp: '&', lt: '<', gt: '>', nbsp: ' ', lrm: '', rlm: '' })[name])
      .split('\n')
      .map((l) => l.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join('\n');
  }

  // WebVTT and SubRip files: blocks separated by blank lines, each with a "start --> end" line.
  function parseVtt(text) {
    const time = (s) => {
      const m = /^(?:(\d+):)?(\d{1,2}):(\d{2})[.,](\d{1,3})$/.exec(s.trim());
      return m ? (+m[1] || 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : NaN;
    };
    const raw = [];
    for (const block of String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
      const lines = block.split('\n');
      const at = lines.findIndex((l) => l.includes('-->'));
      if (at < 0) continue;
      const [from, to] = lines[at].split('-->');
      const start = time(from);
      const end = time(to.trim().split(/\s+/)[0]);
      const body = cueText(lines.slice(at + 1).join('\n'));
      if (!isNaN(start) && end > start && body) raw.push({ start, end, text: body });
    }
    raw.sort((a, b) => a.start - b.start);
    const cues = [];
    for (const c of raw) {
      const prev = cues[cues.length - 1];
      if (prev && Math.abs(prev.start - c.start) < 0.01 && Math.abs(prev.end - c.end) < 0.01) prev.text += '\n' + c.text;
      else cues.push(c);
    }
    return cues;
  }

  // YouTube's caption format. Automatic captions come as a rolling window: every event lasts
  // into the next one, and the events in between only carry a line break.
  function parseJson3(data) {
    const cues = [];
    for (const e of (data && data.events) || []) {
      if (!e || !e.segs) continue;
      const text = cueText(e.segs.map((s) => s.utf8 || '').join(''));
      if (text) cues.push({ start: e.tStartMs / 1000, end: (e.tStartMs + (e.dDurationMs || 0)) / 1000, text });
    }
    cues.sort((a, b) => a.start - b.start);
    for (let i = 0; i < cues.length - 1; i++) {
      if (cues[i].end > cues[i + 1].start) cues[i].end = cues[i + 1].start;
    }
    return cues.filter((c) => c.end > c.start);
  }

  // The language a subtitle file or track is in, as far as its name says: a language name or a
  // three-letter code anywhere, a two-letter code as the last part ("film.en.srt"), or a folder
  // named after the language (".../subtitles/en/full.vtt").
  const LANG_CODES = /^(en|tr|de|fr|es|it|pt|ru|ja|ko|ar|nl|zh|pl|sv|da|no|nb|fi|el|he|iw|hi|id|uk|cs|ro|hu|vi|th|fa|bg|hr|sr|sk|sl|ca|ms|bn|ta|te|ur|et|lv|lt|az|ka|hy|kk|uz|mn|sq|mk|bs|is|gl|eu|af|sw|tl|my|km|ne|si|ml|mr|gu|kn|pa)$/;
  const LANG_NAMES = {
    en: ['eng', 'english', 'ingilizce'], tr: ['tur', 'turkish', 'turkce', 'türkçe'], de: ['ger', 'deu', 'german', 'deutsch'],
    fr: ['fre', 'fra', 'french', 'francais', 'français'], es: ['spa', 'spanish', 'espanol', 'español'], it: ['ita', 'italian', 'italiano'],
    pt: ['por', 'portuguese'], ru: ['rus', 'russian'], ja: ['jpn', 'japanese'], ko: ['kor', 'korean'], ar: ['ara', 'arabic'], nl: ['dut', 'nld', 'dutch'],
  };
  function guessLang(name) {
    const parts = String(name || '').split(/[?#]/)[0].toLowerCase().split('/');
    let file = parts.pop();
    try {
      file = decodeURIComponent(file);
    } catch (e) { /* keep it as it is */ }
    const words = file.replace(/\.(vtt|webvtt|srt|ttml2?|dfxp|ass|ssa|xml|txt|m3u8)$/, '').split(/[^a-zçğıöşüäéèñ]+/).filter(Boolean);
    for (const [code, names] of Object.entries(LANG_NAMES)) {
      if (words.some((w) => names.includes(w))) return code;
    }
    const last = words[words.length - 1] || '';
    if (LANG_CODES.test(last)) return last;
    for (const folder of parts.slice(-2).reverse()) {
      const m = /^([a-z]{2})(?:[-_][a-z]{2,4})?$/.exec(folder);
      if (m && LANG_CODES.test(m[1])) return m[1];
    }
    return '';
  }

  // Advanced SubStation files (.ass, .ssa): one "Dialogue:" line for each cue, its text last.
  function parseAss(text) {
    const time = (s) => {
      const m = /^(\d+):(\d{1,2}):(\d{1,2})[.:](\d{1,3})$/.exec(String(s).trim());
      return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000 : NaN;
    };
    let fields = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
    let events = false;
    const raw = [];
    for (const line of String(text).replace(/^\uFEFF/, '').split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) events = /^\s*\[events\]/i.test(line);
      else if (events && /^Format:/i.test(line)) fields = line.slice(7).split(',').map((f) => f.trim().toLowerCase());
      const m = /^Dialogue:\s*(.*)$/i.exec(line);
      if (!m) continue;
      const parts = m[1].split(',');
      const body = parts.slice(fields.length - 1).join(',');
      if (/\{[^}]*\\p[1-9]/.test(body)) continue; // a drawing, not words
      const start = time(parts[fields.indexOf('start')]);
      const end = time(parts[fields.indexOf('end')]);
      const words = cueText(body.replace(/\{[^}]*\}/g, '').replace(/\\N/gi, '\n').replace(/\\h/g, ' '));
      if (!isNaN(start) && end > start && words) raw.push({ start, end, text: words });
    }
    raw.sort((a, b) => a.start - b.start);
    const cues = [];
    for (const c of raw) {
      const prev = cues[cues.length - 1];
      if (prev && Math.abs(prev.start - c.start) < 0.01 && Math.abs(prev.end - c.end) < 0.01) prev.text += '\n' + c.text;
      else cues.push(c);
    }
    return cues;
  }

  // ---- streams (HLS) ----

  // The attributes of a playlist tag: KEY=value,KEY="value, with commas".
  function hlsAttributes(s) {
    const out = {};
    for (const m of String(s).matchAll(/([A-Z0-9-]+)=("([^"]*)"|[^,]*)/g)) out[m[1]] = m[3] !== undefined ? m[3] : m[2];
    return out;
  }

  const resolveUrl = (uri, base) => {
    try {
      return new URL(uri, base).href;
    } catch (e) {
      return '';
    }
  };

  // What a stream's master playlist says about subtitles: one entry for each subtitle track, with
  // the address of that track's own playlist. `children` are all the playlists it points at, and
  // `master` is false for a playlist that is not a master at all.
  function parseHlsMaster(text, base) {
    const tracks = [];
    const children = [];
    let master = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXT-X-STREAM-INF')) master = true;
      if (line.startsWith('#EXT-X-MEDIA:') || line.startsWith('#EXT-X-I-FRAME-STREAM-INF:')) {
        const a = hlsAttributes(line.slice(line.indexOf(':') + 1));
        const url = a.URI ? resolveUrl(a.URI, base) : '';
        if (url) children.push(url);
        if (a.TYPE !== 'SUBTITLES' || !url) continue;
        master = true;
        // The same track is often listed once for every quality of the picture.
        if (tracks.some((t) => t.url === url || (t.languageCode === (a.LANGUAGE || '') && t.displayName === (a.NAME || a.LANGUAGE || '') && t.forced === (a.FORCED === 'YES')))) continue;
        tracks.push({
          url,
          languageCode: a.LANGUAGE || '',
          displayName: a.NAME || a.LANGUAGE || '',
          forced: a.FORCED === 'YES',
          type: /transcribes-spoken-dialog|describes-music-and-sound/.test(a.CHARACTERISTICS || '') ? 'sdh' : '',
        });
      } else if (line && !line.startsWith('#')) {
        const url = resolveUrl(line, base);
        if (url) children.push(url);
      }
    }
    return { master, tracks, children };
  }

  // A track's own playlist: the addresses of its pieces, how long they run in all, whether the
  // list is complete (a live stream's is not) and whether the pieces are something other than text.
  function parseHlsMedia(text, base) {
    const segments = [];
    let total = 0;
    let ended = false;
    let binary = false;
    for (const raw of String(text).split(/\r?\n/)) {
      const line = raw.trim();
      if (line.startsWith('#EXTINF:')) total += parseFloat(line.slice(8)) || 0;
      else if (line.startsWith('#EXT-X-ENDLIST') || /^#EXT-X-PLAYLIST-TYPE:\s*VOD/.test(line)) ended = true;
      else if (line.startsWith('#EXT-X-MAP')) binary = true;
      else if (line && !line.startsWith('#')) {
        const url = resolveUrl(line, base);
        if (url) segments.push(url);
      }
    }
    if (segments.some((u) => /\.(mp4|m4s|m4v|cmf[tv]?|ts|aac)$/i.test(u.split(/[?#]/)[0]))) binary = true;
    return { segments, total, ended, binary };
  }

  // The X-TIMESTAMP-MAP header of a WebVTT piece of a stream says how far its clock stands from
  // the stream's, in seconds; null when the piece does not say.
  function vttOffset(text) {
    const m = /X-TIMESTAMP-MAP=([^\r\n]+)/.exec(String(text).slice(0, 600));
    const mpegts = m && /MPEGTS:(\d+)/.exec(m[1]);
    const local = m && /LOCAL:([\d:.]+)/.exec(m[1]);
    if (!mpegts || !local) return null;
    return +mpegts[1] / 90000 - local[1].split(':').reduce((sum, part) => sum * 60 + parseFloat(part), 0);
  }

  // Of the subtitle-like files a page has fetched, the ones that are whole subtitle tracks: not
  // the numbered pieces of a stream's track, and not the picture lists players keep for the
  // seek bar. The newest address is kept for a file fetched more than once.
  function standaloneFiles(urls) {
    const byPath = new Map();
    for (const url of urls) byPath.set(String(url).split(/[?#]/)[0], url);
    const groups = new Map();
    for (const [path, url] of byPath) {
      if (/(thumb|sprite|storyboard|preview|chapter|scrub)/i.test(path.split('/').slice(-2).join('/'))) continue;
      const shape = path.replace(/\d+/g, '#');
      if (!groups.has(shape)) groups.set(shape, []);
      groups.get(shape).push({ url, number: +((/(\d+)(?!.*\d)/.exec(path) || [])[1] || 0) });
    }
    const out = [];
    for (const group of groups.values()) {
      if (group.length > 3) {
        // Many addresses that differ only in a number: pieces if the numbers run on, files of
        // their own (one for each language, say) if they do not.
        const numbers = group.map((g) => g.number).sort((a, b) => a - b);
        const steps = numbers.slice(1).map((n, i) => n - numbers[i]);
        const regular = steps.filter((d) => d === steps[0]).length;
        if (group.length > 12 || regular >= steps.length * 0.6) continue;
      }
      out.push(...group.map((g) => g.url));
    }
    return out;
  }

  // Whether a box (left, top, width, height) takes up a window of the given size: it reaches all
  // four edges, give or take a little, without being much larger. A page that scrolls is larger;
  // a picture set into a page is smaller.
  function fillsWindow(box, width, height) {
    const dx = width * 0.03;
    const dy = height * 0.03;
    return (
      box.left <= dx && box.top <= dy && box.left + box.width >= width - dx && box.top + box.height >= height - dy &&
      box.width <= width * 1.3 && box.height <= height * 1.3
    );
  }

  return { parseTime, lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch, isShouting, calm, expandContraction, spokenTokens, fillsWindow, cueText, parseVtt, parseJson3, guessLang, parseAss, parseHlsMaster, parseHlsMedia, vttOffset, standaloneFiles };
})();

if (typeof module !== 'undefined') module.exports = SubtitleCore;
