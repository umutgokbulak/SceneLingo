// Stand-in for the extension APIs so the real extension files can run on a plain page.
// Lookups and speech go to the real background handler through the test server (/bg);
// subtitle translation is faked so tests do not depend on it.
(() => {
  // The preview pane does not composite frames while it is off screen; drive the loop with a timer.
  window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 16);

  const listeners = [];
  const area = (name, data) => ({
    get(defaults, cb) {
      cb(Object.assign({}, defaults, JSON.parse(JSON.stringify(data))));
    },
    set(obj, cb) {
      const changes = {};
      for (const k in obj) {
        changes[k] = { oldValue: data[k], newValue: obj[k] };
        data[k] = JSON.parse(JSON.stringify(obj[k]));
      }
      setTimeout(() => {
        listeners.forEach((f) => f(changes, name));
        if (cb) cb();
      }, 0);
    },
    _data: data,
  });

  // Screenshots (?shot=...) must not depend on the network: a recorded answer stands in for the lookup.
  const canned = new URLSearchParams(location.search).has('shot') && {
    lookup: { ok: true, result: { translation: 'şemsiye', ipa: 'ˌəmˈbrelə', dict: [{ pos: 'noun', terms: ['şemsiye', 'koruyucu', 'koruma'] }],
      defs: [{ pos: 'noun', text: 'a device consisting of a circular canopy of cloth on a folding metal frame supported by a central rod, used as protection against rain or sometimes sun.', example: '' }, { pos: 'noun', text: 'a protecting force or influence.', example: 'the American nuclear umbrella over the West' }],
      synonyms: ['parasol', 'sunshade'] } },
    tts: { ok: false, error: 'no audio in screenshots' },
  };
  const day = 86400000;
  const now = Date.now();
  const seed = new URLSearchParams(location.search).has('seed')
    ? [
        { word: 'umbrella', kind: 'word', translation: 'şemsiye', ipa: 'ˌəmˈbrelə', definition: 'a device used as protection against rain.', synonyms: ['parasol', 'sunshade'], context: "Don't forget your umbrella.", lang: 'en', title: 'The Old Theatre (demo)', added: now },
        { word: 'make up your mind', kind: 'phrase', translation: 'kararını ver', context: 'You need to make up your mind tonight.', lang: 'en', title: 'The Old Theatre (demo)', added: now },
        { word: 'It might rain later.', kind: 'sentence', translation: 'Sonra yağmur yağabilir.', context: '', lang: 'en', title: 'The Old Theatre (demo)', added: now },
        { word: 'theatre', kind: 'word', translation: 'tiyatro', context: "We're going to the old theatre.", lang: 'en', title: 'The Old Theatre (demo)', added: now - 5 * day, due: now + 3 * day, interval: 8, reps: 3, ease: 2.5 },
      ]
    : [];

  window.__sent = [];
  window.__tabs = [];
  window.chrome = {
    runtime: {
      lastError: null,
      getURL: (path) => '/extension/' + path + '?mock',
      getManifest: () => ({ version: 'test' }),
      sendMessage(msg, cb) {
        window.__sent.push(msg);
        if (msg.type === 'translate') {
          setTimeout(() => cb({ ok: true, result: msg.texts.map((t) => '[' + msg.tl + '] ' + t.replace(/\n/g, ' ')) }), 30);
        } else if (msg.type === 'open-review') {
          window.__tabs.push('review');
          if (cb) cb({ ok: true, result: true });
        } else if (canned && canned[msg.type]) {
          setTimeout(() => cb(canned[msg.type]), 30);
        } else {
          fetch('/bg?msg=' + encodeURIComponent(JSON.stringify(msg))).then((r) => r.json()).then(cb);
        }
      },
    },
    tabs: { create: (opts) => window.__tabs.push(opts.url) },
    storage: { sync: area('sync', {}), local: area('local', { words: seed }), onChanged: { addListener: (f) => listeners.push(f) } },
  };
})();
