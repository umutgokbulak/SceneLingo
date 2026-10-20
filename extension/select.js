// Text selected anywhere on a page, not only in a subtitle: a small button appears beside it, and
// it opens a card with the translation, the voice, the dictionary entry and a way to save it for
// review. Text in one's own language is shown in the language being learnt instead.
(() => {
  if (window.__slSelect) return;
  window.__slSelect = true;

  let settings = { ...SL_DEFAULTS };
  let host = null; // the element that carries the shadow root
  let shadow = null;
  let button = null;
  let card = null;
  let picked = null; // { text, context, rect }
  let token = 0;
  const cache = new Map();

  const alive = () => {
    try {
      return !!chrome.runtime.id;
    } catch (e) {
      return false;
    }
  };
  const send = (msg) =>
    new Promise((resolve) => {
      if (!alive()) return resolve({ ok: false, error: 'stale' });
      chrome.runtime.sendMessage(msg, (res) => resolve(chrome.runtime.lastError ? { ok: false, error: chrome.runtime.lastError.message } : res || { ok: false }));
    });
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  function load(stored) {
    settings = { ...SL_DEFAULTS, ...stored };
    slSetUiLang(settings.uiLang);
  }
  chrome.storage.sync.get(SL_DEFAULTS, load);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !alive()) return;
    chrome.storage.sync.get(SL_DEFAULTS, load);
  });

  const off = () => !settings.selectLookup || (settings.offSites || []).includes(location.hostname);

  // SceneLingo's own subtitle has a selection of its own (a phrase); and text being typed is not read.
  function ignored(node) {
    const e = node && (node.nodeType === 1 ? node : node.parentElement);
    if (!e) return true;
    if (e.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')) return true;
    return !!e.closest('[class^="sl-"], [class*=" sl-"]');
  }

  // The sentence around the selection, from the text of the block it is in.
  function sentenceAround(range, text) {
    let block = range.commonAncestorContainer;
    if (block.nodeType !== 1) block = block.parentElement;
    while (block && block !== document.body && getComputedStyle(block).display === 'inline') block = block.parentElement;
    const all = ((block && block.innerText) || '').replace(/\s+/g, ' ');
    const at = all.toLowerCase().indexOf(text.toLowerCase());
    if (at < 0) return '';
    let start = at;
    while (start > 0 && !/[.!?…]/.test(all[start - 1])) start--;
    let end = at + text.length;
    while (end < all.length && !/[.!?…]/.test(all[end])) end++;
    const sentence = all.slice(start, end + 1).trim();
    return sentence.length > 300 || sentence.toLowerCase() === text.toLowerCase() ? '' : sentence;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('scenelingo-select');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;';
    shadow = host.attachShadow({ mode: 'closed' });
    const style = el('style');
    style.textContent = CSS;
    shadow.append(style);
    document.documentElement.append(host);
  }

  function hide() {
    token++;
    if (button) button.remove();
    if (card) card.remove();
    button = card = null;
  }

  // Places a box below the selection, or above it when there is no room below; in page coordinates.
  function place(box, rect) {
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let left = Math.min(Math.max(8, rect.left), innerWidth - w - 8);
    let top = rect.bottom + 8;
    if (top + h > innerHeight - 8 && rect.top - h - 8 > 8) top = rect.top - h - 8;
    box.style.left = left + scrollX + 'px';
    box.style.top = top + scrollY + 'px';
  }

  function showButton() {
    ensureHost();
    hide();
    button = el('button', 'sl-sel-button', 'SL');
    button.title = slT('selectTip');
    button.addEventListener('mousedown', (e) => e.preventDefault()); // keeps the selection
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      openCard();
    });
    shadow.append(button);
    const r = picked.rect;
    button.style.left = Math.min(r.right + 4, innerWidth - 40) + scrollX + 'px';
    button.style.top = Math.max(4, r.top - 30) + scrollY + 'px';
  }

  async function lookup(text, sl, tl) {
    const key = sl + '|' + tl + '|' + text.toLowerCase();
    if (cache.has(key)) return cache.get(key);
    const res = await send({ type: 'lookup', text, sl, tl });
    if (res.ok) cache.set(key, res);
    return res;
  }

  function play(text, lang, slow) {
    send({ type: 'tts', text, lang, slow }).then((res) => {
      if (!res.ok) return;
      const audio = new Audio('data:audio/mpeg;base64,' + res.result);
      audio.volume = Math.min(1, (settings.speechVolume || 100) / 100);
      audio.play().catch(() => {});
    });
  }

  function savedHas(words, word) {
    return words.some((w) => w.word.toLowerCase() === word.toLowerCase());
  }

  async function openCard() {
    const mine = ++token;
    const { text, context } = picked;
    if (button) button.remove();
    button = null;
    card = el('div', 'sl-sel-card');
    const head = el('div', 'sl-sel-head');
    const word = el('div', 'sl-sel-word', text.length > 120 ? text.slice(0, 117) + '…' : text);
    const ipa = el('span', 'sl-sel-ipa');
    const close = el('button', 'sl-sel-x', '✕');
    close.addEventListener('click', hide);
    head.append(word, close);
    const body = el('div', 'sl-sel-body', slT('loading'));
    card.append(head, ipa, body);
    shadow.append(card);
    place(card, picked.rect);

    // First as text in the language being learnt; if it turns out to be one's own language, the
    // other way round, so that what is read in Turkish can be learnt in English.
    let sl = settings.learnLang;
    let tl = settings.nativeLang;
    let res = await lookup(text, 'auto', tl);
    if (mine !== token) return;
    const found = res.ok && res.result.src ? res.result.src.split('-')[0].replace('iw', 'he') : '';
    if (found && found === settings.nativeLang && settings.learnLang !== settings.nativeLang) {
      res = await lookup(text, settings.nativeLang, settings.learnLang);
      if (mine !== token) return;
      sl = settings.nativeLang;
      tl = settings.learnLang;
    } else if (found) sl = found;
    body.textContent = '';
    if (!res.ok) {
      body.textContent = res.error === 'stale' ? slT('stale') : slT('translateFailed', res.error);
      return place(card, picked.rect);
    }
    const info = res.result;
    if (info.ipa && !/\s/.test(text.trim())) ipa.textContent = '/' + info.ipa + '/';
    const reversed = sl === settings.nativeLang && tl === settings.learnLang;
    // What is saved and spoken is always the side in the language being learnt.
    const learnt = reversed ? info.translation : text;
    const meaning = reversed ? text : info.translation;
    const learntLang = reversed ? tl : sl;
    if (reversed) body.append(el('div', 'sl-sel-note', slT('selectIn', slLangName(tl))));
    body.append(el('div', 'sl-sel-main', info.translation || '—'));
    const labelled = (label, value) => {
      const line = el('div', 'sl-sel-line');
      line.append(el('span', 'sl-sel-pos', label), document.createTextNode(' ' + value));
      body.append(line);
    };
    const short = text.trim().split(/\s+/).length <= 4;
    if (short) {
      for (const d of (info.dict || []).slice(0, 3)) labelled(d.pos, d.terms.join(', '));
      const def = (info.defs || [])[0];
      if (def) labelled(def.pos, def.text);
      if (def && def.example) body.append(el('div', 'sl-sel-ex', '“' + def.example + '”'));
      if ((info.synonyms || []).length) labelled(slT('synonyms'), info.synonyms.join(', '));
    }

    let sensed = null;
    const btns = el('div', 'sl-sel-btns');
    const voice = learntLang === 'en' ? settings.accent || 'en-GB' : learntLang;
    const listen = el('button', 'sl-sel-btn', '🔊 ' + slT('listen'));
    listen.addEventListener('click', () => play(learnt, voice, false));
    const slow = el('button', 'sl-sel-btn', '🐢 ' + slT('slow'));
    slow.addEventListener('click', () => play(learnt, voice, true));
    const save = el('button', 'sl-sel-btn sl-sel-save');
    const paint = (has) => {
      save.textContent = has ? '★ ' + slT('saved') : '☆ ' + slT('save');
      save.classList.toggle('sl-on', has);
    };
    chrome.storage.local.get({ words: [] }, (d) => paint(savedHas(d.words, learnt)));
    save.addEventListener('click', () => {
      if (!alive()) return;
      chrome.storage.local.get({ words: [] }, (d) => {
        const has = savedHas(d.words, learnt);
        if (has) slForget(learnt);
        const words = has
          ? d.words.filter((w) => w.word.toLowerCase() !== learnt.toLowerCase())
          : [
              {
                word: learnt,
                kind: /[.!?]$/.test(learnt.trim()) || learnt.trim().split(/\s+/).length > 5 ? 'sentence' : /\s/.test(learnt.trim()) ? 'phrase' : 'word',
                translation: meaning,
                ipa: reversed ? '' : info.ipa || '',
                definition: !reversed && info.defs && info.defs[0] ? info.defs[0].text : '',
                synonyms: reversed ? [] : info.synonyms || [],
                context: reversed ? '' : context,
                contextMeaning: sensed ? sensed.meaning : '',
                contextPhrase: sensed ? sensed.phrase || '' : '',
                contextNote: sensed ? sensed.note || '' : '',
                lang: learntLang,
                title: document.title || location.hostname,
                added: Date.now(),
                looked: 2,
              },
              ...d.words,
            ];
        chrome.storage.local.set({ words }, () => paint(!has));
      });
    });
    btns.append(listen, slow, save);
    card.insertBefore(btns, body);
    place(card, picked.rect);

    // Several words: a translation that is not word for word, and the idioms in them.
    if (!reversed && text.trim().split(/\s+/).length >= 3) {
      const r = await send({ type: 'explain', text, sentence: context || text, sl, tl, always: location.protocol === 'chrome-extension:' });
      if (mine !== token) return;
      const x = r && r.ok && r.result;
      const box = el('div', 'sl-sel-sense');
      if (x && x.translation) {
        sensed = { meaning: x.translation, phrase: '', note: x.idioms.map((i) => i.text + ' — ' + i.meaning).join(' · '), engine: 'gemini' };
        const line = el('div');
        line.append(el('span', 'sl-sel-pos', slT('naturalTr')), document.createTextNode(' ' + x.translation), el('span', 'sl-sel-engine', 'Gemini'));
        box.append(line);
        for (const i of x.idioms) {
          const row = el('div', 'sl-sel-ex');
          row.append(el('b', null, i.text), document.createTextNode(' — ' + i.meaning + (i.literal ? ' (' + slT('literally', i.literal) + ')' : '')));
          box.append(row);
        }
        if (x.note) box.append(el('div', 'sl-sel-ex', x.note));
      } else box.append(el('div', 'sl-sel-ex', slT('mtNote')));
      body.insertBefore(box, body.querySelector('.sl-sel-main').nextSibling);
      place(card, picked.rect);
      return;
    }
    // What it means in the sentence it was selected from.
    if (!reversed && short && context) {
      // On the extension's own pages (the review) Gemini is used whenever there is a key.
      const r = await send({ type: 'sense', word: text, sentence: context, sl, tl, always: location.protocol === 'chrome-extension:' });
      if (mine !== token || !r || !r.ok || !r.result || !r.result.meaning) return;
      sensed = r.result;
      if (!sensed.phrase && !sensed.note && sensed.meaning.toLowerCase() === String(info.translation).toLowerCase()) return;
      const box = el('div', 'sl-sel-sense');
      const line = el('div');
      line.append(el('span', 'sl-sel-pos', slT('inSentence')), document.createTextNode(' ' + (sensed.phrase ? sensed.phrase + ' — ' : '') + sensed.meaning));
      line.append(el('span', 'sl-sel-engine', sensed.engine === 'gemini' ? 'Gemini' : slT('engineMarked')));
      box.append(line);
      if (sensed.note) box.append(el('div', 'sl-sel-ex', sensed.note));
      body.insertBefore(box, body.querySelector('.sl-sel-main').nextSibling);
      place(card, picked.rect);
    }
  }

  document.addEventListener(
    'mouseup',
    (e) => {
      if (!alive()) return;
      if (host && e.composedPath().includes(host)) return;
      setTimeout(() => {
        const sel = getSelection();
        const text = sel && sel.rangeCount ? sel.toString().replace(/\s+/g, ' ').trim() : '';
        if (off() || !text || text.length > 400 || !/\p{L}/u.test(text) || ignored(sel.anchorNode)) {
          if (!card) hide();
          return;
        }
        const range = sel.getRangeAt(0);
        const rects = range.getClientRects();
        const rect = rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        picked = { text, context: sentenceAround(range, text), rect: range.getBoundingClientRect() };
        picked.rect = { left: picked.rect.left, top: rect.top, right: rect.right, bottom: picked.rect.bottom };
        showButton();
      }, 0);
    },
    true
  );
  document.addEventListener(
    'mousedown',
    (e) => {
      if (host && e.composedPath().includes(host)) return;
      hide();
    },
    true
  );
  document.addEventListener('keydown', (e) => e.key === 'Escape' && hide(), true);

  // From the extension's own pages: a word tapped there (on a phone nothing is selected easily).
  window.addEventListener('sl-lookup', (e) => {
    const d = e.detail || {};
    if (!d.text || !alive()) return;
    ensureHost();
    hide();
    picked = { text: String(d.text).slice(0, 400), context: d.context || '', rect: d.rect };
    openCard();
  });

  // From the right-click menu: on a page where the extension was not running before.
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'select-lookup' || window !== top) return false;
    const sel = getSelection();
    const range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
    const r = range ? range.getBoundingClientRect() : { left: innerWidth / 2 - 150, top: 80, right: innerWidth / 2, bottom: 80 };
    ensureHost();
    hide();
    picked = { text: String(msg.text || '').replace(/\s+/g, ' ').trim().slice(0, 400), context: range ? sentenceAround(range, String(msg.text || '')) : '', rect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } };
    if (picked.text) openCard();
    return false;
  });

  const CSS = `
    :host { all: initial; }
    .sl-sel-button, .sl-sel-card { position: absolute; font: 14px/1.4 "Segoe UI", system-ui, sans-serif; color: #e6edf3; }
    .sl-sel-button {
      width: 30px; height: 24px; border-radius: 7px; border: 1px solid #1a98ff; background: #1a6fd6;
      color: #fff; font-weight: 700; font-size: 11px; letter-spacing: .04em; cursor: pointer;
      box-shadow: 0 3px 10px rgba(0,0,0,.35);
    }
    .sl-sel-button:hover { background: #2384f5; }
    .sl-sel-card {
      width: 320px; max-width: calc(100vw - 16px); box-sizing: border-box; padding: 12px 14px;
      background: #161b22; border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.45);
    }
    .sl-sel-head { display: flex; gap: 8px; align-items: flex-start; }
    .sl-sel-word { flex: 1; font-weight: 700; font-size: 16px; color: #fff; word-break: break-word; }
    .sl-sel-x { border: 0; background: none; color: #8b949e; cursor: pointer; font-size: 13px; padding: 2px; }
    .sl-sel-x:hover { color: #fff; }
    .sl-sel-ipa { display: block; color: #8b949e; font-size: 13px; }
    .sl-sel-ipa:empty { display: none; }
    .sl-sel-btns { display: flex; gap: 6px; margin: 8px 0; flex-wrap: wrap; }
    .sl-sel-btn {
      font: inherit; font-size: 12px; color: #e6edf3; background: #21262d; border: 1px solid #30363d;
      border-radius: 7px; padding: 3px 9px; cursor: pointer;
    }
    .sl-sel-btn:hover { background: #30363d; }
    .sl-sel-save.sl-on { color: #ffd866; border-color: #8a6d1f; }
    .sl-sel-main { font-size: 16px; color: #ffd866; margin: 2px 0 4px; word-break: break-word; }
    .sl-sel-line { font-size: 13px; color: #c9d1d9; margin-top: 2px; }
    .sl-sel-pos { color: #8b949e; font-style: italic; }
    .sl-sel-ex { font-size: 12px; color: #8b949e; margin-top: 2px; }
    .sl-sel-sense { margin: 4px 0 6px; padding: 6px 8px; border-left: 3px solid #1a98ff; background: rgba(26,152,255,.1); border-radius: 4px; color: #fff; }
    .sl-sel-engine { margin-left: 8px; font-size: 10px; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; }
    .sl-sel-note { font-size: 11px; color: #8b949e; text-transform: uppercase; letter-spacing: .04em; }
  `;
})();
