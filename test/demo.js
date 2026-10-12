// Drives a page into a fixed state for a README screenshot: add ?shot=<name> to the URL.
//   harness:  ?shot=popup | write | speak | transcript | settings
//   review:   /extension/review.html?mock&seed&shot=review
(async () => {
  const shot = new URLSearchParams(location.search).get('shot');
  if (!shot) return;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (cond, ms = 8000) => {
    for (const end = Date.now() + ms; Date.now() < end && !cond(); ) await wait(50);
    return cond();
  };
  const key = (code, target = window) => target.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));

  if (shot === 'review') {
    await until(() => !document.getElementById('card').hidden);
    document.getElementById('show').click();
    return;
  }

  document.documentElement.classList.add('demo');
  const video = document.querySelector('video');
  await window.loadTitle(false);
  await until(() => document.getElementById('scenelingo-root'));
  const root = document.getElementById('scenelingo-root');
  const q = (s) => root.querySelector(s);
  root.classList.add('sl-awake'); // keep the study bar in the picture
  const showCue = async (time) => {
    video.pause();
    video.currentTime = time;
    await until(() => !q('.sl-box').hidden && q('.sl-primary').textContent);
  };
  // Lets the film reach the end of the line that contains `time`, where practice begins.
  const practise = async (time) => {
    video.currentTime = time;
    await wait(300);
    video.play().catch(() => {});
    await until(() => !q('.sl-strip-wrap').hidden);
  };

  if (shot === 'popup') {
    await showCue(22.5); // "Don't forget your umbrella."
    [...root.querySelectorAll('.sl-word')].find((w) => w.textContent === 'umbrella').click();
    await until(() => q('.sl-pop-main'));
  } else if (shot === 'transcript') {
    await showCue(14.5);
    key('KeyL');
  } else if (shot === 'settings') {
    await showCue(14.5);
    q('.sl-bar .sl-ibtn:last-child').click();
  } else if (shot === 'write') {
    key('KeyW');
    await wait(300);
    await practise(25.12); // just before the line ends, so the answer box opens at once
    const answer = q('.sl-answer');
    answer.textContent = 'dont forget you umbrella';
    key('Enter', answer);
  } else if (shot === 'speak') {
    // The recogniser is told it heard "you" for "your": one word comes out as not understood.
    window.mockSpeech.say = "don't forget you umbrella";
    key('KeyE');
    await wait(300);
    await practise(25.12);
    await until(() => q('.sl-score').textContent);
  }
  if (q('.sl-toast')) q('.sl-toast').hidden = true;
})();
