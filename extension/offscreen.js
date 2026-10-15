// The sound of a tab, played louder. The browser gives the extension the tab's sound as a stream
// (tab capture); while it is captured the tab itself is silent, so the stream is played here,
// through a gain and a limiter that keeps a loud film from clipping.
const boosted = new Map(); // tab id -> { audio, gain, stream, level }

function stop(tabId) {
  const tab = boosted.get(tabId);
  if (!tab) return;
  boosted.delete(tabId);
  for (const track of tab.stream.getTracks()) track.stop();
  tab.audio.close();
}

async function boost({ tabId, level, streamId }) {
  if (level <= 100) {
    stop(tabId);
    return { level: 100 };
  }
  let tab = boosted.get(tabId);
  if (!tab) {
    if (!streamId) throw new Error('no stream');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
      video: false,
    });
    const audio = new AudioContext();
    const gain = audio.createGain();
    const limiter = audio.createDynamicsCompressor();
    limiter.threshold.value = -2;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    audio.createMediaStreamSource(stream).connect(gain).connect(limiter).connect(audio.destination);
    tab = { audio, gain, stream, level: 100 };
    boosted.set(tabId, tab);
    // The capture ends when the tab is closed or goes to another site.
    for (const track of stream.getAudioTracks()) track.addEventListener('ended', () => stop(tabId));
  }
  tab.level = level;
  tab.gain.gain.setTargetAtTime(level / 100, tab.audio.currentTime, 0.05);
  return { level };
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (!msg || msg.target !== 'offscreen') return false;
  if (msg.type === 'boost-state') {
    const tab = boosted.get(msg.tabId);
    reply({ ok: true, result: { level: tab ? tab.level : 100 } });
    return false;
  }
  boost(msg).then((result) => reply({ ok: true, result }), (e) => reply({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
