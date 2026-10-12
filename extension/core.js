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

  return { parseTime, lastStarted, findCue, alignTranslation, spokenWords, matchWords, stretch, isShouting, calm, expandContraction, spokenTokens };
})();

if (typeof module !== 'undefined') module.exports = SubtitleCore;
