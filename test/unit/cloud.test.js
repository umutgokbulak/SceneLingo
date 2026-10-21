// The cloud sync against a stand-in for Google Drive.
const test = require('node:test');
const assert = require('node:assert/strict');
const shared = require('../../extension/shared.js');
globalThis.slIsDue = shared.slIsDue;
globalThis.SL_DAY = shared.SL_DAY;
const study = require('../../extension/study.js');
Object.assign(globalThis, study);
const { slAuthUrl, slTokenFrom, slCloudSync, SL_CLOUD } = require('../../extension/cloud.js');

// A Drive with one folder and the requests it was sent.
function drive() {
  const d = { files: {}, calls: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method || 'GET';
    d.calls.push(method + ' ' + u.pathname);
    assert.equal(init.headers.Authorization, 'Bearer tok');
    const json = (o) => ({ ok: true, status: 200, json: async () => o });
    if (u.pathname === '/drive/v3/files' && method === 'GET') {
      assert.equal(u.searchParams.get('spaces'), 'appDataFolder');
      return json({ files: Object.keys(d.files).map((id) => ({ id })) });
    }
    if (u.pathname.startsWith('/drive/v3/files/') && u.searchParams.get('alt') === 'media') return json(d.files[u.pathname.split('/').pop()]);
    if (u.pathname === '/upload/drive/v3/files' && method === 'POST') {
      assert.match(init.body, /"parents":\["appDataFolder"\]/, 'kept where only this app can see it');
      const content = init.body.split('\r\n\r\n')[2].split('\r\n--')[0];
      d.files.f1 = JSON.parse(content);
      return json({ id: 'f1' });
    }
    if (u.pathname.startsWith('/upload/drive/v3/files/') && method === 'PATCH') {
      d.files[u.pathname.split('/').pop()] = JSON.parse(init.body);
      return json({});
    }
    throw new Error('not expected: ' + method + ' ' + url);
  };
  return d;
}

function store(initial) {
  const s = { data: { ...initial } };
  s.get = async (defaults) => ({ ...defaults, ...s.data });
  s.set = async (o) => Object.assign(s.data, o);
  return s;
}

test('the first sync puts the cards in the cloud; the next brings in what another device did', async () => {
  const d = drive();
  const laptop = store({ words: [{ word: 'keen', added: 1 }], reviewLog: { '2026-10-19': { reviews: 3, correct: 2, newSeen: 1 } } });
  const r1 = await slCloudSync('tok', laptop, 1000);
  assert.deepEqual(d.files.f1.words.map((w) => w.word), ['keen']);
  assert.equal(r1.changed, false, 'nothing new for the laptop');
  assert.equal(laptop.data.lastBackup, 1000, 'the cloud copy counts as a backup');

  // the phone: an empty start, then a card of its own and a deletion
  const phone = store({});
  await slCloudSync('tok', phone, 2000);
  assert.deepEqual(phone.data.words.map((w) => w.word), ['keen']);
  phone.data.words = [{ word: 'might', added: 2500 }];
  phone.data.deleted = { keen: 2600 };
  await slCloudSync('tok', phone, 3000);

  d.calls.length = 0;
  const r3 = await slCloudSync('tok', laptop, 4000);
  assert.deepEqual(laptop.data.words.map((w) => w.word), ['might'], 'keen deleted on the phone, might saved there');
  assert.equal(r3.changed, true);
  assert.ok(!d.calls.some((c) => c.startsWith('PATCH')), 'the cloud already had all of it: not written again');
});

test('the scores of speaking and writing go to the other device with the cards', async () => {
  drive();
  const score = { at: 5000, part: 1, bands: { fluency: 6, lexical: 6, grammar: 6, pronunciation: 6 } };
  const laptop = store({ words: [{ word: 'keen', added: 1 }], speakLog: [score], listenRest: { 'a sentence': 9e12 } });
  await slCloudSync('tok', laptop, 6000);
  const phone = store({ writeLog: [{ at: 5500, task: 'task2', bands: { task: 6, coherence: 6, lexical: 6, grammar: 6 } }] });
  await slCloudSync('tok', phone, 7000);
  assert.deepEqual(phone.data.speakLog, [score]);
  assert.deepEqual(phone.data.listenRest, { 'a sentence': 9e12 });
  await slCloudSync('tok', laptop, 8000);
  assert.equal(laptop.data.writeLog.length, 1, "the phone's essay is on the laptop now");
});

test('the sign-in address asks for this folder only, and the token comes back in the fragment', () => {
  SL_CLOUD.clientId = 'id.apps.googleusercontent.com';
  const url = new URL(slAuthUrl('https://example.chromiumapp.org/', false, 'a@b.c'));
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('scope'), 'https://www.googleapis.com/auth/drive.appdata email');
  assert.equal(url.searchParams.get('prompt'), 'none');
  assert.equal(url.searchParams.get('login_hint'), 'a@b.c');
  const t = slTokenFrom('https://example.chromiumapp.org/#access_token=abc&expires_in=3599&token_type=Bearer');
  assert.equal(t.token, 'abc');
  assert.throws(() => slTokenFrom('https://x/#error=access_denied'), /access_denied/);
  SL_CLOUD.clientId = '';
});

test('a card graded while the sync is under way is not lost', async () => {
  drive();
  const laptop = store({ words: [{ word: 'keen', added: 1 }] });
  // the review page grades the card between the sync's read and its write
  const get = laptop.get;
  let first = true;
  laptop.get = async (d) => {
    const r = await get(d);
    if (first) {
      first = false;
      laptop.data.words = [{ word: 'keen', added: 1, reps: 1, interval: 1, last: 5000 }];
    }
    return r;
  };
  await slCloudSync('tok', laptop, 6000);
  assert.equal(laptop.data.words[0].reps, 1, 'the grade made during the sync stays');
});
