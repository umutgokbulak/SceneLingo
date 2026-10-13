// Takes the pictures for the README: the extension itself, loaded into a real browser, on a
// film that may be shown (test/film.html). Run by hand; it needs the network and Microsoft Edge.
//
//   node test/pictures.js            the stills, into docs/screenshots
//   node test/pictures.js frames     the frames of the short film at the top of the README, into
//                                    .frames; `python test/animate.py` puts them together
const fs = require('fs');
const path = require('path');
const { launch, wait } = require('./real-browser.js');
require('./server.js'); // serves test/film.html

const frames = process.argv[2] === 'frames';
const LINE = 179.14; // "You have to learn to listen." runs from 2:59.14 to 3:02.00
const stills = path.join(__dirname, '..', 'docs', 'screenshots');
const frameDir = path.join(__dirname, '..', '.frames');

(async () => {
  const browser = await launch({ everywhere: true });
  try {
    await browser.worker(`chrome.storage.sync.set({ introSeen: true })`); // no first-run note in the pictures
    await browser.size(1280, 720);
    await browser.open('http://localhost:8765/test/film.html');
    const page = (expression) => browser.page(`(() => { const root = document.getElementById('scenelingo-root'); const video = document.querySelector('video'); return ${expression}; })()`);
    const until = async (expression, tries = 100) => {
      for (let i = 0; i < tries; i++) {
        if (await page(expression).catch(() => false)) return true;
        await wait(100);
      }
      throw new Error('never came true: ' + expression);
    };
    const wordAt = (word) => page(`(() => { const b = [...root.querySelectorAll('.sl-word')].find((w) => w.textContent.toLowerCase() === ${JSON.stringify(word)}).getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`);
    const playLine = (lead) => page(`(video.currentTime = ${LINE} - ${lead}, video.play(), true)`);
    const lineShown = () => until(`!!root && root.querySelector('.sl-primary').textContent.includes('learn to listen')`);
    const boxOpen = () => until(`!root.querySelector('.sl-strip-wrap').hidden`, 150);
    const modeNoteGone = () => wait(2600);
    const save = async (name) => fs.writeFileSync(path.join(stills, name), await browser.picture());
    await until(`!!root && !root.hidden`, 300);

    if (!frames) {
      // The line with its translation, the study bar, and the card of a word, pinned open.
      await playLine(0.4);
      await lineShown();
      await wait(700);
      const word = await wordAt('listen');
      await browser.move(word[0], word[1] - 80);
      await browser.move(word[0], word[1]);
      await wait(700);
      await browser.click(word[0], word[1]);
      await until(`!!root.querySelector('.sl-pop-def, .sl-pop-dict')`, 80);
      await wait(600);
      await save('popup.jpg');
      await browser.named('Escape', 27);
      await browser.move(1100, 120);

      // The list of all lines beside the film.
      await browser.press('KeyL', 'l');
      await browser.move(500, 600);
      await wait(500);
      await save('transcript.jpg');
      await browser.press('KeyL', 'l');
      await browser.move(1100, 120);

      // Writing practice, with one word missed.
      await browser.press('KeyW', 'w');
      await modeNoteGone();
      await playLine(0.3);
      await boxOpen();
      await wait(500);
      await browser.type('you have to learn to lisen');
      await browser.named('Enter', 13);
      await wait(900);
      await save('write.jpg');
      await browser.named('ArrowDown', 40);
      await browser.press('KeyW', 'w');
      await modeNoteGone();

      // Speaking practice. There is no microphone here: a stand-in for the browser's speech
      // recogniser "hears" the sentence with its last word different, and a tone stands in for
      // the voice that is recorded.
      await browser.extensionWorld(`(() => {
        window.SpeechRecognition = window.webkitSpeechRecognition = class {
          start() {
            setTimeout(() => this.onstart && this.onstart(), 0);
            this.timer = setTimeout(() => this.onresult && this.onresult({ results: [Object.assign([{ transcript: 'you have to learn to listing', confidence: 0.9 }], { isFinal: true })], resultIndex: 0 }), 900);
          }
          stop() { setTimeout(() => this.onend && this.onend(), 0); }
          abort() { clearTimeout(this.timer); }
        };
        navigator.mediaDevices.getUserMedia = async () => {
          const audio = new AudioContext();
          const tone = audio.createOscillator();
          const out = audio.createMediaStreamDestination();
          tone.connect(out);
          tone.start();
          return out.stream;
        };
      })()`);
      await browser.press('KeyE', 'e');
      await modeNoteGone();
      await playLine(0.3);
      await boxOpen();
      await until(`!!root.querySelector('.sl-score').textContent`, 150);
      await wait(600);
      await save('speak.jpg');
      console.log('stills written to', stills);
    } else {
      // Frames, each with the time it was taken and where the pointer was: a screenshot has no
      // pointer in it, so it is drawn in when the frames are put together.
      fs.rmSync(frameDir, { recursive: true, force: true });
      fs.mkdirSync(frameDir, { recursive: true });
      const taken = [];
      let pointer = [930, 250];
      let recording = true;
      const record = async () => {
        const started = Date.now();
        while (recording) {
          const file = String(taken.length).padStart(4, '0') + '.jpg';
          fs.writeFileSync(path.join(frameDir, file), await browser.picture(84));
          taken.push({ file, t: Date.now() - started, pointer: pointer.slice() });
          await wait(30);
        }
      };
      const glide = async (to, ms) => {
        const from = pointer.slice();
        for (let i = 1; i <= 12; i++) {
          pointer = [from[0] + ((to[0] - from[0]) * i) / 12, from[1] + ((to[1] - from[1]) * i) / 12];
          await browser.move(pointer[0], pointer[1]);
          await wait(ms / 12);
        }
      };
      await browser.move(pointer[0], pointer[1]);
      await playLine(0.5);
      await lineShown(); // the film starts on the line, so the first frame says what this is
      const recorded = record();
      await wait(1000);
      await glide(await wordAt('learn'), 600); // pointing at a word stops the film and opens its card
      await wait(2300);
      await glide([980, 240], 500); // away: the card closes and the film goes on
      await wait(900);
      await browser.press('KeyW', 'w'); // writing practice: the line is hidden until it has been typed
      await playLine(0.2);
      await boxOpen();
      await wait(600);
      for (const ch of 'you have to learn to lisen') {
        await browser.type(ch);
        await wait(40);
      }
      await wait(400);
      await browser.named('Enter', 13);
      await wait(1500);
      recording = false;
      await recorded;
      fs.writeFileSync(path.join(frameDir, 'frames.json'), JSON.stringify(taken));
      console.log(taken.length, 'frames over', (taken[taken.length - 1].t / 1000).toFixed(1), 's written to', frameDir);
    }
  } catch (e) {
    console.log('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
    process.exit();
  }
})();
