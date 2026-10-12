// Drives a page into a fixed state for a README screenshot: add ?shot=<name> to the URL.
//   harness:  ?shot=popup | dictation | transcript
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
  const showCue = async (time) => {
    video.pause();
    video.currentTime = time;
    await until(() => !q('.sl-box').hidden && q('.sl-primary').textContent);
  };

  if (shot === 'popup') {
    await showCue(22.5); // "Don't forget your umbrella."
    q('.sl-tools').style.visibility = 'visible';
    [...root.querySelectorAll('.sl-word')].find((w) => w.textContent === 'umbrella').click();
    await until(() => q('.sl-pop-main'));
  } else if (shot === 'transcript') {
    await showCue(14.5);
    key('KeyL');
  } else if (shot === 'dictation') {
    key('KeyW');
    await wait(300);
    video.currentTime = 25.12; // just before the line ends, so the practice box opens at once
    await wait(300);
    video.play().catch(() => {});
    await until(() => !q('.sl-dict').hidden);
    const input = q('.sl-dict-input');
    input.value = 'dont forget you umbrella';
    key('Enter', input);
    q('.sl-toast').hidden = true;
  }
})();
