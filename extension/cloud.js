// The cloud: the cards kept in the user's own Google Drive, in a folder only this app can see
// (Drive's "appDataFolder"), so that the same cards are on every computer and on the phone.
// There is no server of ours: signing in is Google's own page, and what comes back is a token
// that lets this app read and write that one folder for an hour.
const SL_CLOUD = {
  // The OAuth client made for SceneLingo in Google Cloud (see the README). It is public by design:
  // it names the app to Google, and gives nothing without the user's own sign-in.
  clientId: '658833440023-ha40akmgia9lpa4uktp5er6qsgmpaufb.apps.googleusercontent.com',
  scopes: 'https://www.googleapis.com/auth/drive.appdata email',
  file: 'scenelingo.json',
  // Where the pages are served on the web, for the phone.
  web: 'https://umutgokbulak.github.io/SceneLingo/extension/words.html',
};

// Google's sign-in page, for a token sent back to `redirect` in the address's #fragment.
// Without `interactive` nothing is shown: an earlier consent is used, or an error comes back.
function slAuthUrl(redirect, interactive, hint) {
  const p = new URLSearchParams({ client_id: SL_CLOUD.clientId, redirect_uri: redirect, response_type: 'token', scope: SL_CLOUD.scopes, include_granted_scopes: 'true' });
  if (!interactive) p.set('prompt', 'none');
  if (hint) p.set('login_hint', hint);
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p;
}

function slTokenFrom(url) {
  const h = new URLSearchParams(String(url).split('#')[1] || '');
  if (h.get('error')) throw new Error(h.get('error'));
  const token = h.get('access_token');
  if (!token) throw new Error('no token');
  // Google lets the user untick the Drive permission; without it there is nothing to sync with.
  if (h.get('scope') && !/drive\.appdata/.test(h.get('scope'))) throw new Error('noDrive');
  return { token, expires: Date.now() + (+h.get('expires_in') || 3600) * 1000 - 60000 };
}

async function slDrive(token, path, init = {}) {
  const res = await fetch('https://www.googleapis.com' + path, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  if (res.status === 401) throw Object.assign(new Error('signed out'), { auth: true });
  if (!res.ok) throw new Error('Drive ' + res.status);
  return res;
}

async function slCloudRead(token) {
  const q = encodeURIComponent(`name='${SL_CLOUD.file}'`);
  const list = await (await slDrive(token, `/drive/v3/files?spaces=appDataFolder&q=${q}&fields=files(id)`)).json();
  const f = list.files && list.files[0];
  if (!f) return { id: null, data: null };
  return { id: f.id, data: await (await slDrive(token, `/drive/v3/files/${f.id}?alt=media`)).json() };
}

async function slCloudWrite(token, id, data) {
  const body = JSON.stringify(data);
  if (id) {
    await slDrive(token, `/upload/drive/v3/files/${id}?uploadType=media`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
    return id;
  }
  const boundary = 'scenelingo' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name: SL_CLOUD.file, parents: ['appDataFolder'], mimeType: 'application/json' });
  const multipart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${boundary}--`;
  const res = await slDrive(token, '/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: multipart });
  return (await res.json()).id;
}

async function slWho(token) {
  try {
    return (await (await slDrive(token, '/oauth2/v3/userinfo')).json()).email || '';
  } catch (e) {
    return '';
  }
}

// One sync: this copy and the cloud's made one, and both given the result. Each side is written
// only if it changed, so a sync with nothing new costs one read.
async function slCloudSync(token, storage, now) {
  const here = await storage.get({ words: [], reviewLog: {}, deleted: {} });
  const remote = await slCloudRead(token);
  const there = remote.data || {};
  const merged = slMergeAll(here, there, now);
  const same = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const sameCards = (a, b) => same([...(a || [])].sort((x, y) => (x.word < y.word ? -1 : 1)), [...(b || [])].sort((x, y) => (x.word < y.word ? -1 : 1)));
  if (!remote.id || !sameCards(merged.words, there.words) || !same(merged.reviewLog, there.reviewLog) || !same(merged.deleted, there.deleted)) {
    await slCloudWrite(token, remote.id, slBackup(merged.words, merged.reviewLog, now, 'cloud', merged.deleted));
  }
  const changes = { lastSync: now, lastBackup: now };
  if (!sameCards(merged.words, here.words)) changes.words = merged.words;
  if (!same(merged.reviewLog, here.reviewLog)) changes.reviewLog = merged.reviewLog;
  if (!same(merged.deleted, here.deleted)) changes.deleted = merged.deleted;
  await storage.set(changes);
  return { added: merged.added, updated: merged.updated, count: merged.words.length, changed: 'words' in changes };
}

if (typeof module !== 'undefined') module.exports = { SL_CLOUD, slAuthUrl, slTokenFrom, slCloudSync };
