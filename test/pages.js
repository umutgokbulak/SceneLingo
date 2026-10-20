// The extension's own pages, the review and the list of words, in a real browser.
//   node test/pages.js            checks them: the kinds of cards, typed answers, hints, grading,
//                                 listening, the list's filters, editing, deleting, backup and restore
//   node test/pages.js pictures   takes the README's pictures of them
// Sample cards come from Elephants Dream, the film the other pictures show. Needs Google Chrome
// (or Edge), not the network: what the background would fetch is already on the cards.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const { launch, wait } = require('./real-browser');

const NOW = Date.now();
const DAY = 86400000;
const SOURCE = 'Elephants Dream';

function cards() {
  return [
    {
      word: 'learn', kind: 'word', translation: 'öğrenmek', ipa: 'lərn', context: 'You have to learn to listen.', contextTranslation: 'Dinlemeyi öğrenmelisin.',
      contextMeaning: 'öğrenmek, alışmak', contextPhrase: 'learn to', contextNote: 'Zamanla bir beceri kazanmak anlamında: dinlemeyi bir alışkanlık hâline getirmek.', senseEngine: 'gemini', sensed: true,
      definition: 'gain or acquire knowledge of or skill in (something) by study, experience, or being taught.', synonyms: ['master', 'pick up', 'grasp', 'absorb'],
      extra: {
        ipa: '/lɜːn/', level: 'A2', academic: false,
        collocations: [{ text: 'learn a language', meaning: 'bir dil öğrenmek' }, { text: 'learn by heart', meaning: 'ezberlemek' }, { text: 'learn from mistakes', meaning: 'hatalardan ders almak' }],
        examples: [{ text: 'She learned to swim last summer.', translation: 'Geçen yaz yüzmeyi öğrendi.' }, { text: 'We learn something new every day.', translation: 'Her gün yeni bir şey öğreniriz.' }],
      },
      enriched: 2, looked: 2, lang: 'en', title: SOURCE, added: NOW - 9 * DAY, reps: 2, interval: 3, due: NOW - 60000, last: NOW - 3 * DAY,
      source: { url: 'https://commons.wikimedia.org/wiki/File:Elephants_Dream_(2006).webm', time: 179 },
      examples: [{ text: 'You have to learn to see.', title: SOURCE, source: { url: 'https://commons.wikimedia.org/wiki/File:Elephants_Dream_(2006).webm', time: 420 } }],
    },
    {
      word: 'game', kind: 'word', translation: 'oyun', context: 'This is not some game.', contextTranslation: 'Bu bir oyun değil.', contextMeaning: 'oyun', senseEngine: 'gemini', sensed: true,
      extra: { ipa: '/ɡeɪm/', level: 'A1' }, enriched: 2, looked: 2, lang: 'en', title: SOURCE, added: NOW - 8 * DAY, stage: 1, reps: 1, interval: 1, due: NOW - 50000, last: NOW - DAY,
    },
    {
      word: 'listen', kind: 'word', translation: 'dinlemek', context: 'Emo, look… I mean, listen.', contextTranslation: 'Emo, bak… Yani, dinle.', contextMeaning: 'dinlemek', senseEngine: 'gemini', sensed: true,
      extra: { ipa: '/ˈlɪsn/', level: 'A1' }, enriched: 2, looked: 2, lang: 'en', title: SOURCE, added: NOW - 7 * DAY, stage: 2, reps: 3, interval: 8, due: NOW - 40000, lapses: 3, last: NOW - 8 * DAY,
    },
    { word: 'I mean', kind: 'phrase', translation: 'yani, demek istediğim', context: 'Emo, look… I mean, listen.', lang: 'en', title: SOURCE, added: NOW - 6 * DAY, reps: 6, interval: 30, due: NOW + 25 * DAY, last: NOW - 5 * DAY },
    { word: '[Proog] You have to learn to listen.', kind: 'sentence', translation: 'Dinlemeyi öğrenmelisin.', lang: 'en', title: SOURCE, added: NOW - 5 * DAY, stage: 1, reps: 1, interval: 1, due: NOW - 30000, last: NOW - DAY },
    { word: 'machine', kind: 'word', translation: 'makine', context: "It's like a machine.", contextMeaning: 'makine', lang: 'en', title: SOURCE, added: NOW - DAY },
    { word: 'careful', kind: 'word', translation: 'dikkatli', context: 'Be careful!', contextMeaning: 'dikkatli', lang: 'en', title: SOURCE, added: NOW - 2 * DAY },
  ];
}

function days() {
  const log = {};
  const key = (t) => {
    const d = new Date(t);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  for (const back of [1, 2, 3, 4]) log[key(NOW - back * DAY)] = { reviews: 12, correct: 10, newSeen: 3 };
  return log;
}

(async () => {
  const pictures = process.argv[2] === 'pictures';
  const b = await launch();
  const page = (expression) => b.page(`(() => { const $ = (s) => document.querySelector(s); return ${expression}; })()`);
  const seed = (extra = {}) =>
    b.worker(`chrome.storage.local.set(${JSON.stringify({ words: cards(), reviewLog: days(), geminiKey: 'test-key-for-the-pictures', lastBackup: 0, ...extra })})`);
  try {
    await b.worker(`chrome.storage.sync.set({ uiLang: '${pictures ? 'en' : 'tr'}', learnLang: 'en', nativeLang: 'tr', autoSpeak: false, newPerDay: 15 })`);

    if (pictures) {
      const dir = path.join(__dirname, '..', 'docs', 'screenshots');
      await seed();
      await b.size(1440, 820);
      await b.open(b.extensionPage('review.html'));
      await wait(1200);
      await b.named('Space', 32);
      await wait(900);
      fs.writeFileSync(path.join(dir, 'review.jpg'), await b.picture(88));
      await b.open(b.extensionPage('words.html'));
      await wait(1000);
      await page(`($('.row .line').click(), true)`);
      await wait(500);
      fs.writeFileSync(path.join(dir, 'words.jpg'), await b.picture(88));
      await seed({ listenGloss: { 'you have to learn to listen': { parts: [{ text: 'have to', base: '', meaning: 'zorunda olmak, -meli' }, { text: 'learn', base: '', meaning: 'öğrenmek' }, { text: 'listen', base: '', meaning: 'dinlemek' }], at: NOW } } });
      await b.open(b.extensionPage('listen.html'));
      await wait(1000);
      await page(`(at = round.findIndex((s) => s.text === 'You have to learn to listen.'), show(), $('#typed').value = 'You have learn to lisen', $('#go').click(), true)`);
      await wait(500);
      fs.writeFileSync(path.join(dir, 'listen.jpg'), await b.picture(88));
      console.log('pictures written to docs/screenshots');
      return;
    }

    // ---- the review ----
    await seed();
    await b.size(1440, 820);
    await b.open(b.extensionPage('review.html'));
    await wait(1200);
    assert.match(await page(`$('#left').textContent`), /^6 /, 'four cards due, and the two new ones');
    // 1. learn: recognised; the sentence shows without "[Proog]"-like notes, and the answer opens
    assert.match(await page(`$('#top').textContent`), /TANI|Tanı/i);
    await b.named('Space', 32);
    await wait(500);
    assert.match(await page(`$('#back').textContent`), /öğrenmek, alışmak/);
    assert.equal(await page(`$('#sideBody').querySelectorAll('.sec').length`), 4, 'goes with, examples, met again and the definition, all at once');
    assert.ok(await page(`!$('#sideFoot').hidden`), 'a sentence of one’s own at the foot of the panel');
    await b.named('Digit2', 50);
    await wait(800);
    // 2. game: a gap, two hints, then the answer
    await page(`($('#hintBtn').click(), $('#hintBtn').click(), true)`);
    assert.equal(await page(`$('.quote input').placeholder`), 'ga__');
    await b.type('game');
    await b.named('Enter', 13);
    await wait(500);
    assert.match(await page(`$('.verdict').className`), /right/);
    assert.ok(await page(`$('#easy').hidden`), 'with a hint, it was not easy');
    await b.named('Digit2', 50);
    await wait(800);
    // 3. listen: produced from its meaning; a wrong answer leaves only "missed it"
    assert.match(await page(`$('#front').textContent`), /dinlemek/);
    await b.type('hear');
    await b.named('Enter', 13);
    await wait(500);
    assert.ok(await page(`$('#good').hidden && !$('#countIt').hidden`));
    await b.named('Digit1', 49);
    await wait(800);
    // 4. the sentence, said from its translation, without its note for the hard of hearing
    await page(`($('#front textarea').value = 'you have to learn to listen', $('#show').click(), true)`);
    await wait(500);
    assert.match(await page(`$('.verdict').className`), /right/);
    await b.named('Digit2', 50);
    await wait(800);
    const after = JSON.parse(await b.worker(`chrome.storage.local.get(['words', 'reviewLog']).then((d) => JSON.stringify(d))`));
    const card = (w) => after.words.find((x) => x.word === w);
    assert.equal(card('learn').stage, 1, 'recognised: on to the gap');
    assert.equal(card('game').stage, 1, 'one gap right: two are needed');
    assert.equal(card('listen').stage, 1, 'missed: a step back');
    assert.ok(card('learn').last > NOW - 60000, 'the time it was seen is kept');
    // the missed card comes back in the same session, after the new ones
    assert.match(await page(`$('#left').textContent`), /^3 /);
    // the settings under the button on the right
    await page(`($('#gear').click(), true)`);
    assert.ok(await page(`!$('#gearMenu').hidden && /Seri|Streak/.test($('#gearMenu').textContent)`));

    // ---- listening ----
    await seed();
    await b.open(b.extensionPage('listen.html'));
    await wait(1000);
    // five sentences: "Be careful!" is too short, and the saved sentence is the word's own one
    assert.equal(await page(`$('#count').textContent`), '1 / 5');
    // typed, then Enter: checked, and still on the same sentence
    await page(`($('#typed').focus(), true)`);
    await b.type(await page(`round[at].text.toLowerCase().replace(/[.,!?…]/g, '')`));
    await b.named('Enter', 13);
    await wait(300);
    assert.equal(await page(`$('#count').textContent`), '1 / 5', 'Enter checks; it does not skip');
    assert.match(await page(`$('#result .verdict').className`), /right/);
    assert.match(await page(`$('#result .verdict').textContent`), /100/);
    await page(`($('#go').click(), true)`);
    assert.equal(await page(`$('#count').textContent`), '2 / 5');
    // a word left out is shown as not heard, in its place
    await page(`($('#typed').value = round[at].text.split(' ').slice(1).join(' '), $('#go').click(), true)`);
    assert.ok(await page(`!!document.querySelector('#result .heard .missed') && !/right/.test($('#result .verdict').className)`));
    await b.named('Enter', 13);
    await wait(300);
    assert.equal(await page(`$('#count').textContent`), '3 / 5');
    for (let i = 0; i < 3; i++) await page(`($('#giveUp').click(), $('#go').click(), true)`);
    assert.ok(await page(`$('#card').hidden && !$('#end').hidden && $('#end .list').children.length === 5`));
    assert.equal(Object.keys(JSON.parse(await b.worker(`chrome.storage.local.get('listenRest').then((d) => JSON.stringify(d.listenRest))`))).length, 5, 'each sentence rests a while');
    // the words of the sentence with their meanings, from Gemini once and kept; each can be saved
    const parts = [{ text: 'have to', base: '', meaning: 'zorunda olmak' }, { text: 'learn', base: '', meaning: 'öğrenmek' }, { text: 'listen', base: '', meaning: 'dinlemek' }];
    await seed({ listenGloss: { 'you have to learn to listen': { parts, at: NOW } } });
    await b.open(b.extensionPage('listen.html'));
    await wait(1000);
    await page(`(at = round.findIndex((s) => s.text === 'You have to learn to listen.'), show(), $('#giveUp').click(), true)`);
    await wait(300);
    assert.equal(await page(`[...document.querySelectorAll('.part')].map((r) => r.querySelector('b').textContent + '=' + r.querySelector('span').textContent).join()`), 'have to=zorunda olmak,learn=öğrenmek,listen=dinlemek');
    assert.deepEqual(JSON.parse(await page(`JSON.stringify([...document.querySelectorAll('.part .star')].map((x) => x.textContent))`)), ['☆', '★', '★'], 'learn and listen are saved already');
    await page(`(document.querySelector('.part .star').click(), true)`);
    await wait(400);
    const made = JSON.parse(await b.worker(`chrome.storage.local.get('words').then((d) => JSON.stringify(d.words.find((w) => w.word === 'have to')))`));
    assert.equal(made.context, 'You have to learn to listen.');
    assert.equal(made.contextMeaning, 'zorunda olmak');
    // a word of the sentence, tapped, opens its card
    await page(`(document.querySelector('#result .heard [data-w]').click(), true)`);
    await wait(300);
    assert.ok(await page(`!!document.querySelector('scenelingo-select')`));

    // ---- the list of all words ----
    await seed();
    await b.open(b.extensionPage('words.html'));
    await wait(1000);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 7);
    assert.ok(await page(`!$('#banner').hidden`), 'never backed up: the reminder shows');
    await page(`($('.sum.hard').click(), true)`);
    assert.equal(await page(`[...document.querySelectorAll('.row .w b')].map((x) => x.textContent).join()`), 'listen');
    await page(`($('.sum.hard').click(), true)`);
    await page(`(() => { const q = $('#q'); q.value = 'alışmak'; q.dispatchEvent(new Event('input')); return true; })()`);
    assert.equal(await page(`[...document.querySelectorAll('.row .w b')].map((x) => x.textContent).join()`), 'learn', 'found by its meaning, not only by the word');
    await page(`(() => { const q = $('#q'); q.value = ''; q.dispatchEvent(new Event('input')); return true; })()`);
    // a row opens to all that is known of it; the sentence shown without its notes
    await page(`([...document.querySelectorAll('.row')].find((r) => r.textContent.includes('You have to learn to listen.')).querySelector('.line').click(), true)`);
    assert.ok(await page(`!document.body.textContent.includes('[Proog]')`));
    // edited into a word there is already a card for: the two become one
    await page(`([...document.querySelectorAll('.row')].find((r) => r.querySelector('.w b').textContent === 'machine').querySelector('.line').click(), true)`);
    await page(`([...document.querySelectorAll('.detail .link')].find((x) => /Düzenle|Edit/.test(x.textContent)).click(), true)`);
    await page(`(() => { const i = document.querySelector('.detail .edit input'); i.value = 'careful'; return true; })()`);
    await page(`([...document.querySelectorAll('.detail .edit button')][0].click(), true)`);
    await wait(500);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 6);
    // deleting asks twice
    const del = `[...document.querySelectorAll('.row')].find((r) => r.querySelector('.w b').textContent === 'careful').querySelector('.iconbtn.danger').click()`;
    await page(`(${del}, true)`);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 6);
    await page(`(${del}, true)`);
    await wait(500);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 5);
    // a backup, and the reminder goes
    await page(`($('#backup').click(), true)`);
    await wait(600);
    assert.ok(await page(`$('#banner').hidden`));
    assert.ok(await b.worker(`chrome.storage.local.get('lastBackup').then((d) => d.lastBackup > 0)`));
    // restored from a file: what was deleted comes back, and nothing is lost
    const file = JSON.stringify({ app: 'SceneLingo', kind: 'backup', words: cards(), reviewLog: days() });
    await page(`(restore(new File([${JSON.stringify(file)}], 'backup.json')), true)`);
    await wait(800);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 7);
    assert.match(await page(`$('#notice').textContent`), /^2 /, 'the two deleted cards came back');
    console.log('the review page and the list of words work');
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
