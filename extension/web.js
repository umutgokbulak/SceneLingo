// On the web (the phone), the extension's own pages run without the extension. This stands in
// for the parts of its API they use: the cards are kept in this browser's storage, words are
// spoken by the system's voices, and the cards are synced with the same copy in the user's
// Google Drive. In the extension it does nothing.
(() => {
  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) return;

  const listeners = [];
  const area = (name) => {
    const read = () => {
      try {
        return JSON.parse(localStorage.getItem('scenelingo.' + name) || '{}');
      } catch (e) {
        return {};
      }
    };
    const write = (all) => localStorage.setItem('scenelingo.' + name, JSON.stringify(all));
    const done = (value, cb) => {
      const p = Promise.resolve(value);
      if (cb) p.then(cb);
      return p;
    };
    const tell = (changes) => setTimeout(() => listeners.forEach((l) => l(changes, name)), 0);
    return {
      get(keys, cb) {
        const all = read();
        let out;
        if (keys == null) out = all;
        else if (typeof keys === 'string') out = keys in all ? { [keys]: all[keys] } : {};
        else if (Array.isArray(keys)) out = Object.fromEntries(keys.filter((k) => k in all).map((k) => [k, all[k]]));
        else out = Object.fromEntries(Object.keys(keys).map((k) => [k, k in all ? all[k] : keys[k]]));
        return done(out, cb);
      },
      set(items, cb) {
        const all = read();
        const changes = {};
        for (const [k, v] of Object.entries(items)) {
          changes[k] = { oldValue: all[k], newValue: v };
          all[k] = v;
        }
        write(all);
        tell(changes);
        return done(undefined, cb);
      },
      remove(keys, cb) {
        const all = read();
        const changes = {};
        for (const k of [].concat(keys)) {
          changes[k] = { oldValue: all[k] };
          delete all[k];
        }
        write(all);
        tell(changes);
        return done(undefined, cb);
      },
    };
  };
  const local = area('local');

  // The system's own voices: no network, and good ones on a phone.
  function speak(text, lang, slow) {
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang || 'en-GB';
    u.rate = slow ? 0.7 : 1;
    speechSynthesis.speak(u);
  }

  // ---- the cloud, with the token kept here for its hour ----
  const here = () => location.origin + location.pathname;
  const kept = () => {
    try {
      const t = JSON.parse(localStorage.getItem('scenelingo.token') || 'null');
      return t && t.expires > Date.now() ? t.token : '';
    } catch (e) {
      return '';
    }
  };
  // Off to Google's sign-in page; it comes back here with the token, and the sync goes on then.
  function signIn(interactive, email) {
    sessionStorage.setItem('scenelingo.after', 'sync');
    location.assign(slAuthUrl(here(), interactive, email));
    return new Promise(() => {});
  }
  let syncing = null;
  function sync(interactive) {
    if (!syncing) syncing = syncOnce(interactive).finally(() => (syncing = null));
    return syncing;
  }
  async function syncOnce(interactive) {
    if (!SL_CLOUD.clientId) throw new Error('noClient');
    const { cloudEmail } = await local.get({ cloudEmail: '' });
    const token = kept();
    if (!token) {
      if (!interactive && !cloudEmail) throw new Error('signed out');
      return signIn(interactive, cloudEmail);
    }
    if (!cloudEmail) await local.set({ cloudEmail: (await slWho(token)) || '?' });
    try {
      return await slCloudSync(token, local, Date.now());
    } catch (e) {
      if (!e.auth) throw e;
      localStorage.removeItem('scenelingo.token');
      return signIn(interactive, cloudEmail);
    }
  }

  async function handle(msg) {
    switch (msg && msg.type) {
      case 'tts':
        speak(msg.text, msg.lang, msg.slow);
        return { ok: false, error: 'spoken here' };
      case 'gemini-key':
        return { ok: true, result: '' };
      case 'open-scene':
        window.open(msg.url, '_blank');
        return { ok: true, result: true };
      case 'cloud-state': {
        const { cloudEmail, lastSync, cloudError } = await local.get({ cloudEmail: '', lastSync: 0, cloudError: '' });
        return { ok: true, result: { configured: !!SL_CLOUD.clientId, email: cloudEmail, lastSync, error: cloudError, web: '' } };
      }
      case 'cloud-sync':
        return sync(!!msg.interactive).then(
          async (result) => {
            await local.set({ cloudError: '' });
            return { ok: true, result };
          },
          async (e) => {
            const { cloudEmail } = await local.get({ cloudEmail: '' });
            if (cloudEmail || msg.interactive) await local.set({ cloudError: e.message });
            return { ok: false, error: e.message };
          }
        );
      case 'cloud-signout':
        localStorage.removeItem('scenelingo.token');
        await local.remove(['cloudEmail', 'lastSync']);
        return { ok: true, result: true };
      default:
        return { ok: false, error: 'not on the web' };
    }
  }

  window.chrome = {
    storage: { local, sync: area('sync'), onChanged: { addListener: (fn) => listeners.push(fn) } },
    runtime: {
      id: undefined,
      lastError: undefined,
      getURL: (path) => path,
      getManifest: () => ({ version: 'web' }),
      sendMessage: (msg, cb) => {
        const p = handle(msg);
        if (cb) p.then(cb);
        return p;
      },
      onMessage: { addListener() {} },
    },
  };

  // Back from Google's sign-in: the token is kept, the address cleaned, and the sync done; the
  // page is drawn again if the cloud brought anything. Read here, before the other scripts: on a
  // phone the note left before going to Google may not be there when the page comes back.
  let fresh = false;
  let refused = '';
  const back = new URLSearchParams(location.hash.slice(1));
  if (back.get('access_token')) {
    // Google lets the user untick the Drive permission; without it there is nothing to sync with.
    if (!/drive\.appdata/.test(back.get('scope') || '')) refused = 'noDrive';
    else {
      const expires = Date.now() + (+back.get('expires_in') || 3600) * 1000 - 60000;
      localStorage.setItem('scenelingo.token', JSON.stringify({ token: back.get('access_token'), expires }));
      fresh = true;
    }
    history.replaceState(null, '', here());
  } else if (back.get('error')) {
    refused = back.get('error');
    history.replaceState(null, '', here());
  }
  window.addEventListener('load', async () => {
    const after = sessionStorage.getItem('scenelingo.after') || fresh;
    sessionStorage.removeItem('scenelingo.after');
    if (refused) return local.set({ cloudError: refused });
    const { cloudEmail } = await local.get({ cloudEmail: '' });
    if (!after && !cloudEmail) return;
    // Signed in before, but the hour is over: a quick trip to Google, once a visit, with no window.
    if (!after && !kept()) {
      if (sessionStorage.getItem('scenelingo.bounced')) return;
      sessionStorage.setItem('scenelingo.bounced', '1');
    }
    const res = await handle({ type: 'cloud-sync', interactive: false });
    if (res.ok && res.result && res.result.changed) location.reload();
  });
})();
