// The icons, drawn from the two SVGs in extension/icons in a real browser, into the PNGs the
// browser, the phone and the README use: logo-small.svg below 48 px, logo.svg from there up. The
// phone's home screen rounds its icons itself, so its own is square.
//   node test/icons.js
const fs = require('fs');
const path = require('path');
const { launch } = require('./real-browser');

const dir = path.join(__dirname, '..', 'extension', 'icons');
const svg = (file) => fs.readFileSync(path.join(dir, file), 'utf8');
const OUT = [
  { file: '16.png', size: 16, svg: 'logo-small.svg' },
  { file: '32.png', size: 32, svg: 'logo-small.svg' },
  { file: '48.png', size: 48, svg: 'logo.svg' },
  { file: '128.png', size: 128, svg: 'logo.svg' },
  { file: '180.png', size: 180, svg: 'logo.svg', square: true },
  { file: '512.png', size: 512, svg: 'logo.svg' },
];

(async () => {
  const b = await launch();
  try {
    for (const o of OUT) {
      let text = svg(o.svg);
      if (o.square) text = text.replace(/ rx="29"/g, '');
      const src = 'data:image/svg+xml;base64,' + Buffer.from(text).toString('base64');
      const data = await b.page(`new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = c.height = ${o.size};
          c.getContext('2d').drawImage(img, 0, 0, ${o.size}, ${o.size});
          resolve(c.toDataURL('image/png').split(',')[1]);
        };
        img.onerror = () => reject(new Error('could not draw ${o.svg}'));
        img.src = ${JSON.stringify(src)};
      })`);
      fs.writeFileSync(path.join(dir, o.file), Buffer.from(data, 'base64'));
      console.log('icons/' + o.file);
    }
  } finally {
    await b.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
