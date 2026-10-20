const fs = require('fs');
const { launch, wait } = require('./real-browser');
(async () => {
  const b = await launch();
  try {
    await b.worker(`chrome.storage.sync.set({ uiLang: 'tr' })`);
    await b.worker(`(SL_CLOUD.clientId = 'placeholder.apps.googleusercontent.com', chrome.storage.local.set({ words: [{ word: 'learn', translation: 'öğrenmek', added: 1 }], lastBackup: Date.now() }))`);
    console.log('id:', await b.worker(`chrome.runtime.id`), '| redirect:', await b.worker(`chrome.identity.getRedirectURL()`));
    await b.size(1300, 500);
    await b.open(b.extensionPage('words.html'));
    await wait(1200);
    fs.writeFileSync('test/_cl_out.jpg', await b.picture());
    await b.worker(`chrome.storage.local.set({ cloudEmail: 'umut@example.com', lastSync: Date.now() - 120000 })`);
    await b.open(b.extensionPage('words.html'));
    await wait(1200);
    fs.writeFileSync('test/_cl_in.jpg', await b.picture());
  } finally { await b.close(); }
})();
