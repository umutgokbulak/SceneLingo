// The first page after installing: the few choices that make the extension work well, in order,
// and how it is used. Each step can be done here; it is also opened later from the popup.
const $ = (id) => document.getElementById(id);
let settings = { ...SL_DEFAULTS };
const ask = (msg) =>
  new Promise((resolve) => chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError || !res ? { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : '' } : res)));
const done = (id, yes) => $(id).classList.toggle('done', !!yes);

function option(value, label) {
  const o = document.createElement('option');
  o.value = value;
  o.textContent = label;
  return o;
}

// 1. The languages.
function paintLangs() {
  for (const id of ['learnLang', 'nativeLang']) {
    $(id).textContent = '';
    for (const code of SL_LANGS) $(id).append(option(code, slLangName(code)));
    $(id).value = settings[id];
  }
  done('s1', settings.learnLang !== settings.nativeLang);
}
for (const id of ['learnLang', 'nativeLang']) {
  $(id).addEventListener('change', () => {
    settings[id] = $(id).value;
    chrome.storage.sync.set({ [id]: settings[id] });
    paintLangs();
    paintPack();
  });
}

// 2. The language pack, for translating inside the browser.
async function paintPack() {
  const from = slLangName(settings.learnLang);
  const to = slLangName(settings.nativeLang);
  const state = await slPackState(settings.learnLang, settings.nativeLang);
  $('engineGet').hidden = state !== 'get';
  $('engineGet').disabled = false;
  $('engineGet').textContent = slT('engineGet', from, to);
  $('engineState').textContent = state === 'ready' ? '✓ ' + slT('engineReady', from, to) : state === 'none' ? slT('engineNone', from, to) : '';
  $('engineState').classList.toggle('ok', state === 'ready');
  done('s2', state === 'ready' || state === 'none');
}
$('engineGet').addEventListener('click', async () => {
  $('engineGet').disabled = true;
  try {
    await slPackGet(settings.learnLang, settings.nativeLang, (n) => ($('engineGet').textContent = slT('engineGetting', n)));
  } catch (e) {
    $('engineState').textContent = slT('engineFailed', (e && e.message) || e);
  }
  paintPack();
});

// 3. While watching: the keys.
function paintKeys() {
  const keys = $('keys');
  keys.textContent = '';
  const add = (caps, what) => {
    const k = document.createElement('span');
    for (const c of caps) {
      const kbd = document.createElement('kbd');
      kbd.textContent = c;
      k.append(kbd);
    }
    const w = document.createElement('span');
    w.textContent = what;
    keys.append(k, w);
  };
  add(['A', 'D'], slT('keyPrevNext'));
  add(['S', 'Z'], slT('keyRepeat'));
  add(['W'], slT('keyWrite'));
  add(['E'], slT('keySpeak'));
  add(['Q'], slT('keyPause'));
}

// 4. Gemini, with the user's own free key.
function paintGemini(note) {
  ask({ type: 'gemini-key' }).then((res) => {
    const shown = res.ok ? res.result : '';
    $('geminiState').textContent = note || (shown ? '✓ ' + slT('geminiKeyShown', shown) : '');
    $('geminiState').classList.toggle('ok', !!shown && !note);
    done('s4', !!shown);
  });
}
$('geminiSave').addEventListener('click', () => {
  const key = $('geminiKey').value.trim();
  $('geminiKey').value = '';
  if (!key) return $('geminiKey').focus();
  chrome.storage.local.set({ geminiKey: key }, async () => {
    paintGemini(slT('geminiTrying'));
    const res = await ask({ type: 'gemini-test', tl: settings.nativeLang });
    if (!res.ok) chrome.storage.local.set({ geminiKey: '' });
    paintGemini(res.ok ? '✓ ' + slT('geminiWorks', (res.result.phrase ? res.result.phrase + ' — ' : '') + res.result.meaning) : slT('geminiFailed', res.error));
  });
});

// 5. The cloud, and the phone.
async function paintCloud(note) {
  const res = await ask({ type: 'cloud-state' });
  const st = res.ok ? res.result : {};
  $('s5').hidden = !st.configured;
  $('connect').textContent = st.email ? slT('cloudSyncNow') : slT('cloudConnect');
  $('cloudState').textContent = note || (st.email ? '✓ ' + slT('cloudOn') + ' ' + st.email : '');
  $('cloudState').classList.toggle('ok', !!st.email && !note);
  $('phoneUrl').textContent = st.web || '';
  done('s5', !!st.email);
}
$('connect').addEventListener('click', async () => {
  paintCloud(slT('cloudSyncing'));
  const res = await ask({ type: 'cloud-sync', interactive: true });
  paintCloud(res.ok ? '' : slT('cloudFailed', res.error));
});

// 6. Every day.
$('review').addEventListener('click', () => (location.href = 'review.html'));
$('words').addEventListener('click', () => (location.href = 'words.html'));
$('done').addEventListener('click', () => window.close());

chrome.storage.sync.get(SL_DEFAULTS, (stored) => {
  settings = { ...SL_DEFAULTS, ...stored };
  document.documentElement.lang = slSetUiLang(settings.uiLang);
  slApply(document);
  document.title = slT('welcomeTitle');
  paintLangs();
  paintPack();
  paintKeys();
  paintGemini();
  paintCloud();
});
