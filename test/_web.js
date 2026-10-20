const fs = require('fs');
const { launch, wait } = require('./real-browser');
require('./server.js');
const now = Date.now();
const words = [
  { word: 'learn', kind: 'word', translation: 'öğrenmek', context: 'You have to learn to listen.', contextMeaning: 'öğrenmek', lang: 'en', title: 'Elephants Dream', added: now - 5000, reps: 1, interval: 1, due: now - 1000, last: now - 86400000 },
  { word: 'game', kind: 'word', translation: 'oyun', context: 'This is not some game.', lang: 'en', title: 'Elephants Dream', added: now - 4000 },
];
(async () => {
  const b = await launch();
  try {
    await b.size(390, 844);
    await b.open('http://localhost:8765/extension/words.html');
    await wait(800);
    await b.page(`(localStorage.setItem('scenelingo.local', ${JSON.stringify(JSON.stringify({ words }))}), localStorage.setItem('scenelingo.sync', JSON.stringify({ uiLang: 'tr' })), true)`);
    await b.open('http://localhost:8765/extension/words.html');
    await wait(1200);
    console.log('web mode:', await b.page(`typeof chrome.runtime.id === 'undefined' && !!chrome.storage`));
    console.log('rows:', await b.page(`document.querySelectorAll('.row').length`), '| cloud box hidden:', await b.page(`document.getElementById('cloud').hidden`));
    fs.writeFileSync('test/_web_words.jpg', await b.picture());
    await b.page(`(document.getElementById('study').click(), true)`);
    await wait(1500);
    console.log('review at:', await b.page(`location.pathname`), '|', await b.page(`document.getElementById('left').textContent`));
    await b.named('Space', 32);
    await wait(500);
    await b.named('Digit2', 50);
    await wait(800);
    console.log('saved in the browser:', await b.page(`JSON.parse(localStorage.getItem('scenelingo.local')).words.find((w) => w.word === 'learn').stage`));
    fs.writeFileSync('test/_web_review.jpg', await b.picture());
    console.log('manifest:', await b.page(`fetch('app.webmanifest').then((r) => r.json()).then((m) => m.start_url + ' ' + m.display)`));
  } finally {
    await b.close();
    process.exit(0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
