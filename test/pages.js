// The extension's own pages, the review and the list of words, in a real browser.
//   node test/pages.js            checks them: the kinds of cards, typed answers, hints, grading,
//                                 listening, speaking, writing, reading, the list's filters, editing, deleting, backup and restore
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

// Gemini, stood in for in the background: an examiner's score, and a waiter at a café.
const GEMINI_STUB = `(() => {
  const real = self.__realFetch || fetch;
  self.__realFetch = real;
  const answer = (o) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }), { headers: { 'Content-Type': 'application/json' } });
  self.fetch = async (url, init) => {
    // Google Translate: the word, and the sentence it was heard in.
    if (String(url).includes('translate.googleapis.com')) {
      const q = new URL(String(url)).searchParams.get('q');
      const tr = { 'swoop in': 'baskın yapmak', 'They swoop in at night.': 'Geceleyin baskın yapıyorlar.' }[q] || q;
      return new Response(JSON.stringify([[[tr, q]], null, 'en']), { headers: { 'Content-Type': 'application/json' } });
    }
    if (!String(url).includes('generativelanguage')) return real(url, init);
    const prompt = JSON.parse(init.body).contents[0].parts[0].text;
    if (prompt.includes('IELTS Speaking examiner'))
      return answer({
        bands: { fluency: 6, lexical: 6.5, grammar: 5.5, pronunciation: 7 },
        summary: 'Akıcı konuştun; geçmiş zamanı karıştırdın.',
        corrections: [{ said: 'I live here since five years', better: 'I have lived here for five years', note: 'süregelen durum: present perfect' }],
        better: 'I have lived in a small flat near the city centre for five years. What I like most is that everything is within walking distance.',
        phrases: [{ text: 'within walking distance', meaning: 'yürüme mesafesinde' }],
        used: [{ word: 'learn', ok: true, sentence: 'I learn something new in my neighbourhood every week.' }],
      });
    if (prompt.includes('IELTS Writing examiner'))
      return answer({
        bands: { task: 6, coherence: 6.5, lexical: 6, grammar: 5.5 },
        summary: 'Fikirlerin net; paragraflar arası bağlantı zayıf.',
        corrections: [{ said: 'peoples thinks', better: 'people think', note: 'people zaten çoğul' }],
        better: 'Some people believe that films are the best teachers.\\n\\nOn the other hand, classrooms give structure.',
        phrases: [{ text: 'on the other hand', meaning: 'öte yandan' }],
        used: [],
      });
    if (prompt.includes('wrote this for the task'))
      return answer({ level: 'A2', points: [true, true, false], summary: 'Anlaşılır.', corrections: [{ said: 'is broken since three days', better: 'has been broken for three days', note: 'süregelen durum' }], better: 'Dear Mr Brown, the heating has been broken for three days.', phrases: [{ text: 'as soon as possible', meaning: 'en kısa sürede' }], used: [] });
    if (prompt.includes('role-playing')) {
      const turns = prompt.split('Learner: ').length - 1;
      if (!turns) return answer({ reply: 'Good morning! What can I get you?', translation: 'Günaydın! Ne alırsınız?', correction: null, done: false });
      return answer({ reply: 'A cappuccino, coming right up. Anything to eat?', translation: 'Bir kapuçino, hemen geliyor. Yiyecek bir şey?', correction: { ok: false, better: 'I would like a cappuccino, please.', meaning: 'Bir kapuçino rica ediyorum.', note: 'I want yerine kibar I would like.' }, done: turns >= 2 });
    }
    if (prompt.includes('IELTS Academic Reading'))
      return answer({
        title: 'How honeybees choose a new home',
        paragraphs: [
          'Every spring, a strong honeybee colony divides in two. The old queen leaves with around ten thousand workers, and the swarm hangs from a branch while it decides where to live. It may stay there for only a few hours, or for as long as three days.',
          'The decision is made not by the queen but by a few hundred older bees known as scouts. They fly off in all directions and inspect hollow trees, holes in walls and even empty boxes. A good site, the biologist Thomas Seeley found, has a small entrance, a volume of about forty litres and a floor well above the ground.',
          'When a scout returns, she reports on what she has found by dancing on the surface of the swarm. The angle of the dance shows the direction of the site, and its length shows the distance. The better the site, the more energetically she dances, so that more bees are persuaded to go and look for themselves.',
          'Gradually, support grows for one site and fades for the others. Seeley calls this a kind of democracy: no single bee compares all the options, yet the group almost always chooses the best one. Once about fifteen scouts are gathered at the same site at once, the swarm takes this as a sign that agreement has been reached.',
          'Researchers believe that human committees could learn from the bees. Seeley himself has used their method in faculty meetings, encouraging colleagues to explore options independently before any vote. Whether the approach works as well for people, who are rarely as patient as bees, has not yet been tested.',
        ],
        headings: ['A signal that the debate is over', 'A temporary resting place', 'What the queen decides', 'Advertising a discovery', 'Lessons for people', 'Searching and judging', 'Why swarms are dangerous'],
        headingAnswers: [1, 5, 3, 0, 4].map((heading) => ({ heading, why: 'Paragrafın ana fikri bu.' })),
        tfng: [
          { statement: 'The queen chooses where the swarm will live.', answer: 'FALSE', why: 'Kararı kraliçe değil, kâşif arılar verir.', quote: 'The decision is made not by the queen but by a few hundred older bees known as scouts.' },
          { statement: 'Scouts prefer sites that are high off the ground.', answer: 'TRUE', why: 'İyi bir yerin tabanı yerden yüksektir.', quote: 'a floor well above the ground' },
          { statement: 'Most swarms find a new home within a day.', answer: 'NOT GIVEN', why: 'Metin çoğu sürünün ne kadar sürede karar verdiğini söylemiyor.', quote: '' },
          { statement: 'Seeley has tried the bees’ method with people.', answer: 'TRUE', why: 'Fakülte toplantılarında denemiş.', quote: 'Seeley himself has used their method in faculty meetings' },
        ],
        choice: [
          { q: 'What tells the swarm that a decision has been made?', options: ['The queen leaves the branch', 'About fifteen scouts meet at one site', 'All the scouts dance together', 'The scouts stop flying'], answer: 1, why: 'On beş kadar kâşif aynı yerde toplanınca karar verilmiş sayılır.', quote: 'Once about fifteen scouts are gathered at the same site at once' },
          { q: 'According to the passage, what is not yet known?', options: ['How scouts measure a site', 'Why colonies divide', 'Whether the method suits human groups', 'How long swarms can wait'], answer: 2, why: 'İnsanlarda işe yarayıp yaramadığı henüz denenmedi.', quote: 'has not yet been tested' },
        ],
        gaps: [
          { sentence: 'The direction of a site is shown by the ____ of the dance.', answers: ['angle'], why: 'Dansın açısı yönü gösterir.', quote: 'The angle of the dance shows the direction of the site' },
          { sentence: 'An ideal home has a volume of roughly ____.', answers: ['forty litres', '40 litres'], why: 'Yaklaşık kırk litre.', quote: 'a volume of about forty litres' },
        ],
      });
    return answer({ parts: [] });
  };
  return true;
})()`;

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
      await b.worker(GEMINI_STUB);
      await b.open(b.extensionPage('write.html'));
      await wait(1000);
      await page(`(document.querySelectorAll('#parts .tile')[2].click(), true)`);
      await wait(300);
      await page(`(() => { const t = $('#text'); t.value = 'Some peoples thinks that watching films is the best way to learn a language, because you hear how people really speak. Others believe classrooms are better.'; t.dispatchEvent(new Event('input')); $('#go').click(); return true; })()`);
      await wait(1000);
      await page(`(scrollTo(0, 0), true)`);
      fs.writeFileSync(path.join(dir, 'ielts-writing.jpg'), await b.picture(88));
      await b.open(b.extensionPage('read.html'));
      await wait(1000);
      await page(`(document.querySelector('#parts .tile').click(), true)`);
      await wait(800);
      await page(`(() => {
        const g = current.test.groups[0];
        const right = ['A temporary resting place', 'Searching and judging', 'Advertising a discovery', 'A signal that the debate is over', 'Lessons for people'];
        g.items.forEach((item, i) => (current.answers[item.id] = g.list.indexOf(right[i])));
        current.answers.q6 = 'F'; current.answers.q7 = 'T'; current.answers.q8 = 'F'; current.answers.q9 = 'T';
        current.answers.q10 = 1; current.answers.q11 = 0; current.answers.q12 = 'angle'; current.answers.q13 = 'forty litres';
        current.started = Date.now() - (17 * 60 + 42) * 1000; // as if read in 17 minutes
        check();
        document.querySelector('.q[data-id="q6"] .why .link').click();
        return true;
      })()`);
      await wait(900);
      await page(`(scrollTo(0, 0), $('#qScroll').scrollTop = 0, true)`);
      fs.writeFileSync(path.join(dir, 'ielts-reading.jpg'), await b.picture(88));
      const week = days();
      const dk = (t) => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
      week[dk(NOW)] = { reviews: 9, correct: 8, newSeen: 2, listen: 5, listenScore: 410 };
      Object.assign(week[dk(NOW - DAY)], { listen: 3, listenScore: 250, speak: 1 });
      Object.assign(week[dk(NOW - 3 * DAY)], { speak: 2, write: 1 });
      Object.assign(week[dk(NOW - 2 * DAY)], { read: 1, readScore: 77 });
      const bands = (o, n) => Array.from({ length: n }, (_, i) => ({ at: NOW - (n - i) * DAY, bands: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.min(9, v + Math.floor(i / 3) * 0.5)])) }));
      await seed({ reviewLog: week, speakLog: bands({ fluency: 5.5, lexical: 6, grammar: 5.5, pronunciation: 6.5 }, 8), writeLog: bands({ task: 5.5, coherence: 6, lexical: 6, grammar: 5.5 }, 5), readLog: [6, 6.5, 6.5, 7].map((band, i) => ({ at: NOW - (8 - 2 * i) * DAY, task: 'academic', score: 9, total: 13, band })) });
      await b.open(b.extensionPage('progress.html'));
      await wait(1000);
      fs.writeFileSync(path.join(dir, 'progress.jpg'), await b.picture(88));
      await b.open(b.extensionPage('speak.html'));
      await wait(1000);
      await page(`(document.querySelector('#parts .tile').click(), true)`);
      await wait(300);
      await page(`(() => { const t = $('#examText'); t.value = 'I live in a flat near the city centre since five years and I like it because everything is near'; t.dispatchEvent(new Event('input')); $('#examGo').click(); return true; })()`);
      await wait(1000);
      await page(`(scrollTo(0, 0), true)`);
      fs.writeFileSync(path.join(dir, 'ielts-speaking.jpg'), await b.picture(88));
      await b.open(b.extensionPage('speak.html'));
      await wait(1000);
      await page(`([...document.querySelectorAll('#scenes .tile')].find((t) => /café/i.test(t.textContent)).click(), true)`);
      await wait(800);
      await page(`(() => { const t = $('#talkText'); t.value = 'I want a cappuccino'; t.dispatchEvent(new Event('input')); $('#talkGo').click(); return true; })()`);
      await wait(800);
      fs.writeFileSync(path.join(dir, 'conversation.jpg'), await b.picture(88));
      console.log('pictures written to docs/screenshots');
      return;
    }

    // ---- the review ----
    await seed();
    await b.size(1440, 820);
    await b.open(b.extensionPage('review.html'));
    await wait(1200);
    assert.match(await page(`$('#left').textContent`), /^6 /, 'four cards due, and the two new ones');
    // every page has the same tabs to the others: here the review's, with the cards waiting
    assert.equal(await page(`[...document.querySelectorAll('.sl-tab')].map((t) => t.getAttribute('href')).join()`), 'progress.html,review.html,words.html,listen.html,speak.html,read.html,write.html');
    assert.equal(await page(`$('.sl-tab.on').getAttribute('href')`), 'review.html');
    assert.equal(await page(`$('.sl-tab.on .sl-badge').textContent`), '6');
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

    // ---- speaking ----
    await seed();
    await b.worker(GEMINI_STUB);
    await b.open(b.extensionPage('speak.html'));
    await wait(1000);
    assert.equal(await page(`document.querySelectorAll('#scenes .tile:not([disabled])').length`), 12);
    assert.ok(await page(`!$('#ieltsBox').hidden`), 'IELTS for English');
    // a conversation at a café: the waiter opens, the learner answers, and is put right
    await page(`([...document.querySelectorAll('#scenes .tile')].find((t) => /Kafe|café/i.test(t.textContent)).click(), true)`);
    await wait(800);
    assert.match(await page(`$('#chat .msg.them').textContent`), /What can I get you/);
    await page(`(() => { const t = $('#talkText'); t.focus(); t.value = 'I want cappuccino'; t.dispatchEvent(new Event('input')); return true; })()`);
    await b.named('Enter', 13);
    await wait(800);
    assert.match(await page(`$('#chat .corr.fix b').textContent`), /I would like a cappuccino/);
    assert.equal(await page(`document.querySelectorAll('#chat .msg.them').length`), 2);
    await page(`($('#chat .corr.fix .star').click(), true)`);
    await wait(400);
    const sentenceCard = JSON.parse(await b.worker(`chrome.storage.local.get('words').then((d) => JSON.stringify(d.words.find((w) => w.word === 'I would like a cappuccino, please.')))`));
    assert.equal(sentenceCard.kind, 'sentence');
    assert.equal(sentenceCard.translation, 'Bir kapuçino rica ediyorum.');
    await page(`(() => { const t = $('#talkText'); t.value = 'no thanks'; t.dispatchEvent(new Event('input')); $('#talkGo').click(); return true; })()`);
    await wait(800);
    assert.ok(await page(`!!$('#chat .ended') && $('#talkComposer').hidden`), 'the waiter ends it');
    // IELTS Part 1: an answer, scored on the four criteria
    await page(`($('#toHome').click(), true)`);
    await page(`(document.querySelector('#parts .tile').click(), true)`);
    await wait(300);
    assert.match(await page(`$('#examHead').textContent`), /Part 1/);
    assert.ok(await page(`$('#examGo').disabled`), 'nothing said yet');
    await page(`(() => { const t = $('#examText'); t.value = 'I live here since five years and I like it'; t.dispatchEvent(new Event('input')); $('#examGo').click(); return true; })()`);
    await wait(1000);
    assert.equal(await page(`$('#fb .band.all b').textContent`), '6.5');
    assert.match(await page(`$('#fb .fix').textContent`), /I have lived here for five years/);
    await page(`($('#fb .phrase .star').click(), true)`);
    await wait(400);
    const saved = JSON.parse(await b.worker(`chrome.storage.local.get(['words', 'speakLog']).then((d) => JSON.stringify(d))`));
    const phrase = saved.words.find((w) => w.word === 'within walking distance');
    assert.equal(phrase.context, 'What I like most is that everything is within walking distance.');
    assert.ok(saved.words.find((w) => w.word === 'learn').examples.some((e) => /neighbourhood/.test(e.text)), 'a word used rightly keeps the sentence');
    assert.equal(saved.speakLog.length, 1);
    // the rest skipped: the estimate from the one answer
    for (let i = 0; i < 4; i++) await page(`(($('#skip').hidden ? $('#examGo') : $('#skip')).click(), true)`);
    await wait(300);
    assert.ok(await page(`!$('#end').hidden && /6\.5/.test($('#endBody .big').textContent)`));
    // Part 2: a minute to prepare first
    await page(`($('#endBody .btn.primary').click(), document.querySelectorAll('#parts .tile')[1].click(), true)`);
    await wait(300);
    assert.ok(await page(`!$('#clock').hidden && !$('#points').hidden && $('#examMic').disabled`));
    // "I am ready", clicked while the minute counts down: the talking starts
    await wait(1100);
    await page(`($('#clock button').click(), true)`);
    await wait(300);
    assert.ok(await page(`!$('#examMic').disabled && !$('#clock button')`), 'talking: the microphone is free, and the clock has no button');

    // ---- writing ----
    await seed();
    await b.worker(GEMINI_STUB);
    await b.open(b.extensionPage('write.html'));
    await wait(1000);
    assert.equal(await page(`document.querySelectorAll('#tasks .tile:not([disabled])').length`), 10);
    assert.equal(await page(`document.querySelectorAll('#parts .tile').length`), 3);
    // IELTS Task 2: against the clock, the words counted, the draft kept
    await page(`(document.querySelectorAll('#parts .tile')[2].click(), true)`);
    await wait(300);
    assert.match(await page(`$('#timer').textContent`), /^(39|40):/);
    await page(`(() => { const t = $('#text'); t.value = 'Some peoples thinks that films are the best teachers of a language.'; t.dispatchEvent(new Event('input')); return true; })()`);
    assert.match(await page(`$('#count').textContent`), /^12 \/ 250/);
    await wait(900);
    await b.open(b.extensionPage('write.html'));
    await wait(1000);
    assert.ok(await page(`!$('#resume').hidden`), 'the half-written text is offered back');
    await page(`([...document.querySelectorAll('#resume button')].pop().click(), true)`);
    await wait(300);
    assert.match(await page(`$('#text').value`), /best teachers/);
    await b.named('Enter', 13, 2); // with Ctrl
    await wait(1000);
    assert.equal(await page(`$('#fb .band.all b').textContent`), '6.0');
    assert.match(await page(`$('#fb .fix').textContent`), /people think/);
    const written = JSON.parse(await b.worker(`chrome.storage.local.get(['writeLog', 'writeDraft']).then((d) => JSON.stringify(d))`));
    assert.equal(written.writeLog.length, 1);
    assert.equal(written.writeDraft, null, 'sent: the draft is not kept');
    // everyday: a letter to the landlord, its level and what it said of what was asked
    await page(`($('#toHome').click(), true)`);
    await page(`(document.querySelector('#tasks .tile').click(), true)`);
    await wait(300);
    await page(`(() => { const t = $('#text'); t.value = 'Dear Mr Brown, the heating is broken since three days.'; t.dispatchEvent(new Event('input')); $('#go').click(); return true; })()`);
    await wait(1000);
    assert.match(await page(`$('#fb .level').textContent`), /A2/);
    assert.equal(await page(`document.querySelectorAll('#fb .checks .yes').length + '/' + document.querySelectorAll('#fb .checks .no').length`), '2/1');

    // ---- reading ----
    // (on top of the writing above: the week's plan below counts both)
    await b.worker(GEMINI_STUB);
    await b.open(b.extensionPage('read.html'));
    await wait(1000);
    assert.equal(await page(`document.querySelectorAll('#kinds .tile:not([disabled])').length`), 8);
    assert.equal(await page(`document.querySelectorAll('#parts .tile').length`), 2);
    await page(`(document.querySelector('#parts .tile').click(), true)`);
    await wait(1000);
    assert.ok(await page(`!$('#desk').hidden`));
    assert.equal(await page(`document.querySelectorAll('#qs .q').length`), 13);
    assert.equal(await page(`[...document.querySelectorAll('#text p .pl')].map((x) => x.textContent).join('')`), 'ABCDE');
    assert.match(await page(`$('#timer').textContent`), /^(19|20):/);
    assert.ok(await page(`$('#go').disabled`), 'nothing answered yet');
    assert.ok(!(await page(`!!document.querySelector('#text [data-w]')`)), 'no word to tap during the test');
    // the headings, right; four statements, one wrong; one option; the gaps, one right
    await page(`(() => {
      const right = ['A temporary resting place', 'Searching and judging', 'Advertising a discovery', 'A signal that the debate is over', 'Lessons for people'];
      const g = current.test.groups[0];
      document.querySelectorAll('.hsel select').forEach((sel, i) => { sel.value = String(g.list.indexOf(right[i])); sel.dispatchEvent(new Event('change')); });
      const seg = document.querySelectorAll('.seg');
      ['FALSE', 'TRUE', 'NOT GIVEN', 'FALSE'].forEach((v, i) => [...seg[i].children].find((x) => x.textContent === v).click());
      [...document.querySelectorAll('.opts')][0].querySelectorAll('button').forEach((x) => /fifteen/.test(x.textContent) && x.click());
      const gaps = document.querySelectorAll('.gap');
      gaps[0].value = 'Angle'; gaps[0].dispatchEvent(new Event('input'));
      gaps[1].value = 'forty'; gaps[1].dispatchEvent(new Event('input'));
      return true;
    })()`);
    assert.equal(await page(`$('#answered').textContent`), '12 / 13 cevaplandı');
    // left and come back to: the answers are kept
    await wait(600);
    await b.open(b.extensionPage('read.html'));
    await wait(1000);
    assert.match(await page(`$('#resume').textContent`), /honeybees.*13 sorudan 12/);
    await page(`([...document.querySelectorAll('#resume button')].pop().click(), true)`);
    await wait(300);
    assert.equal(await page(`[...document.querySelectorAll('.seg button.on')].map((x) => x.textContent).join()`), 'FALSE,TRUE,NOT GIVEN,FALSE');
    await b.named('Enter', 13, 2); // with Ctrl
    await wait(500);
    // 5 headings + 3 statements + 1 option + 1 gap: 10 of 13, 31 of 40, band 7
    assert.equal(await page(`$('#result .big').textContent`), '10 / 13');
    assert.equal(await page(`$('#result .band b').textContent`), '≈ 7.0');
    assert.equal(await page(`document.querySelectorAll('#qs .q.wrong').length`), 3);
    assert.match(await page(`document.querySelectorAll('#qs .q.wrong .why .ans')[0].textContent`), /TRUE/);
    const read = JSON.parse(await b.worker(`chrome.storage.local.get(['readLog', 'readDraft', 'reviewLog']).then((d) => JSON.stringify(d))`));
    assert.deepEqual([read.readLog.length, read.readLog[0].band, read.readLog[0].score, read.readLog[0].task], [1, 7, 10, 'academic']);
    assert.equal(read.readDraft, null, 'checked: the draft is not kept');
    // where in the text an answer is: marked, in its paragraph
    await page(`(document.querySelector('.q[data-id="q6"] .why .link').click(), true)`);
    await wait(300);
    assert.match(await page(`$('#text mark').textContent`), /not by the queen/);
    assert.equal(await page(`$('#text mark').closest('p').dataset.para`), 'B');
    // checked: every word opens its meaning
    await page(`(document.querySelector('#text [data-w]').click(), true)`);
    await wait(300);
    assert.ok(await page(`!!document.querySelector('scenelingo-select')`));

    // ---- today's plan, and the week ----
    // what the writing above did is in the record of days, beside the cards of the four days before
    await b.open(b.extensionPage('progress.html'));
    await wait(1000);
    assert.equal(await page(`$('#streak').textContent`), '5', 'writing today, cards on the four days before');
    assert.deepEqual(JSON.parse(await page(`JSON.stringify([...document.querySelectorAll('#plan .sl-step')].map((s) => s.classList.contains('done')))`)), [false, false, false, true, false], 'two texts written this week: done; one read of two');
    assert.match(await page(`$('#plan .sl-next').textContent`), /Kart|Cards/);
    assert.equal(await page(`[...document.querySelectorAll('#grid .cell')].slice(-8)[0].textContent`), '2', 'two texts written today, in the last column');
    assert.equal(await page(`[...document.querySelectorAll('#grid .cell')].slice(-1)[0].textContent`), '1', 'and one read');
    assert.match(await page(`$('#bands').textContent`), /Writing.*Band 6\.0.*Reading.*Band 7\.0/);
    // a goal of one's own: no listening, and the plan has a step less
    await page(`(() => { const sel = document.querySelector('#goals select'); sel.value = '0'; sel.dispatchEvent(new Event('change')); return true; })()`);
    await wait(500);
    assert.equal(await page(`document.querySelectorAll('#plan .sl-step').length`), 4);
    assert.equal(await b.worker(`chrome.storage.sync.get('goalListen').then((d) => d.goalListen)`), 0);
    // the daily reminder, set on the page: an alarm at that hour, and a notification of what is left
    await page(`($('#remindAt').value = '07:30', $('#remindAt').dispatchEvent(new Event('change')), $('#remindOn').click(), true)`);
    await wait(600);
    assert.equal(await b.worker(`chrome.alarms.get('remind').then((a) => a && new Date(a.scheduledTime).toTimeString().slice(0, 5))`), '07:30');
    assert.deepEqual(await b.worker(`remind().then(() => new Promise((r) => chrome.notifications.getAll(r))).then((n) => Object.keys(n))`), ['remind']);
    await b.worker(`chrome.storage.sync.set({ remindOn: false })`);

    // ---- German nouns: der, die or das ----
    await b.worker(`chrome.storage.local.set(${JSON.stringify({ words: [{ word: 'Rechnung', kind: 'word', translation: 'fatura', context: 'Kann ich bitte die Rechnung haben?', lang: 'de', added: NOW - DAY, due: NOW - 1000 }] })})`);
    await b.open(b.extensionPage('review.html'));
    await wait(1200);
    assert.match(await page(`$('#front .term').textContent`), /^___ Rechnung/, 'the article is asked first');
    assert.ok(await page(`$('#front .plural').hidden`), 'and the plural, which would give it away, waits');
    await b.named('Digit1', 49); // der
    await wait(300);
    assert.equal(await page(`[...document.querySelectorAll('.artask button')].map((x) => x.dataset.a + ':' + x.className.replace('btn small', '').trim()).join()`), 'der:wrong,die:right,das:');
    assert.match(await page(`$('#front .term').textContent`), /^die Rechnung/);
    assert.match(await page(`$('#front .plural').textContent`), /die Rechnungen/);
    await b.open(b.extensionPage('words.html'));
    await wait(1200);
    assert.equal(await page(`$('.row .w b').textContent`), 'die Rechnung');

    // ---- the list of all words ----
    await seed();
    await b.open(b.extensionPage('words.html'));
    await wait(1000);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 7);
    assert.ok(await page(`!$('#banner').hidden`), 'never backed up: the reminder shows');
    // a word heard somewhere else, added by hand with its sentence; one already there is not added twice
    await b.worker(GEMINI_STUB);
    await page(`($('#addWord').value = 'swoop in', $('#addSentence').value = 'They swoop in at night.', $('#addGo').click(), true)`);
    await wait(1200);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 8);
    const added = JSON.parse(await b.worker(`chrome.storage.local.get('words').then((d) => JSON.stringify(d.words[0]))`));
    assert.deepEqual([added.word, added.kind, added.translation, added.context, added.contextTranslation], ['swoop in', 'phrase', 'baskın yapmak', 'They swoop in at night.', 'Geceleyin baskın yapıyorlar.']);
    await page(`($('#addWord').value = 'Machine', $('#addGo').click(), true)`);
    await wait(300);
    assert.equal(await page(`document.querySelectorAll('.row').length`), 8);
    assert.match(await page(`$('#notice').textContent`), /zaten|already/);
    // the rest with the sample cards as they were
    await seed();
    await b.open(b.extensionPage('words.html'));
    await wait(1000);
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
