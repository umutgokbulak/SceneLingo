// Runs the real background message handler against the live translation service.
let handler;
const noEvent = { addListener() {} };
globalThis.chrome = { runtime: { onMessage: { addListener(fn) { handler = fn; } }, onInstalled: noEvent, onStartup: noEvent }, permissions: { onAdded: noEvent, onRemoved: noEvent } };
require('../extension/background.js');
const ask = (msg) => new Promise((r) => handler(msg, {}, r));
(async () => {
  const texts = ['Hello there,\nhow are you?', "I'm fine, thank you.", '', 'Where are we going tonight?', "Don't forget your umbrella."];
  console.log(JSON.stringify(await ask({ type: 'translate', texts, sl: 'en-us', tl: 'tr' }), null, 1));
  const many = Array.from({ length: 60 }, (_, i) => `This is test sentence number ${i + 1}, and it is fairly long.`);
  const res = await ask({ type: 'translate', texts: many, sl: 'en-us', tl: 'tr' });
  console.log('60 cues ->', res.ok, res.result && res.result.length, res.result && [res.result[0], res.result[59]]);
  console.log(JSON.stringify(await ask({ type: 'lookup', text: 'umbrella', sl: 'en-us', tl: 'tr' })));
  console.log(JSON.stringify(await ask({ type: 'lookup', text: '傘', sl: 'ja-jp', tl: 'tr' })));
})();
