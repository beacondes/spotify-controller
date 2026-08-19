const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.static('public'));

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
const PORT = process.env.PORT || 3000;

let accessToken = null;
let refreshToken = null;

app.get('/login', (req, res) => {
  const scope = 'user-read-playback-state user-modify-playback-state user-read-currently-playing';
  const state = crypto.randomBytes(16).toString('hex');
  const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    state
  }).toString();
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const code = req.query.code;
  try {
    const resp = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ code, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }).toString(),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    accessToken = resp.data.access_token;
    refreshToken = resp.data.refresh_token;
    res.redirect('/');
  } catch (e) {
    const msg = e.response && e.response.data && e.response.data.error_description
      ? e.response.data.error_description : e.message;
    res.status(500).send('授权失败：' + msg);
  }
});

async function ensureToken() {
  if (!refreshToken) return accessToken;
  try {
    const resp = await axios.post('https://accounts.spotify.com/api/token',
      new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }).toString(),
      {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(CLIENT_ID + ':' + CLIENT_SECRET).toString('base64'),
          'Content-Type': 'application/x-www-form-urlencoded'
        }
      });
    accessToken = resp.data.access_token;
  } catch (e) {
    // 刷新失败就返回当前 token，让请求层去处理 401
  }
  return accessToken;
}

async function spotify(method, url, body) {
  const token = await ensureToken();
  return axios({
    method,
    url: 'https://api.spotify.com/v1' + url,
    data: body,
    headers: { 'Authorization': 'Bearer ' + token }
  });
}

// 当前播放状态
app.get('/api/status', async (req, res) => {
  if (!accessToken) return res.json({ authed: false });
  try {
    const r = await spotify('GET', '/me/player');
    if (r.status === 204) return res.json({ authed: true, playing: false });
    const d = r.data;
    res.json({
      authed: true,
      playing: true,
      item: d.item,
      is_playing: d.is_playing,
      progress_ms: d.progress_ms,
      device: d.device
    });
  } catch (e) {
    if (e.response && e.response.status === 401) {
      accessToken = null;
      return res.json({ authed: false });
    }
    res.status(500).json({ error: e.message });
  }
});

// 可选设备列表
app.get('/api/devices', async (req, res) => {
  try {
    const r = await spotify('GET', '/me/player/devices');
    res.json({ devices: r.data.devices });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 切换播放设备
app.put('/api/device', async (req, res) => {
  const id = req.body.device_id;
  try {
    await spotify('PUT', '/me/player', { device_ids: [id] });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/play', async (req, res) => {
  try { await spotify('PUT', '/me/player/play', {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/pause', async (req, res) => {
  try { await spotify('PUT', '/me/player/pause', {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/next', async (req, res) => {
  try { await spotify('POST', '/me/player/next', {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/previous', async (req, res) => {
  try { await spotify('POST', '/me/player/previous', {}); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/volume', async (req, res) => {
  const v = req.body.volume;
  try { await spotify('PUT', '/me/player/volume?volume_percent=' + v); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/seek', async (req, res) => {
  const ms = req.body.position_ms;
  try { await spotify('PUT', '/me/player/seek?position_ms=' + ms); res.json({ ok: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// 搜索歌曲
app.get('/api/search', async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json({ tracks: [] });
  try {
    const r = await spotify('GET', '/search?q=' + encodeURIComponent(q) + '&type=track&limit=20');
    res.json({ tracks: r.data.tracks.items });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 直接播放指定曲目（传入 uris；不传则恢复当前播放）
app.post('/api/play', async (req, res) => {
  const uris = req.body.uris;
  try {
    await spotify('PUT', '/me/player/play', (uris && uris.length) ? { uris } : {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// 加入播放队列（作为下一首）
app.post('/api/queue', async (req, res) => {
  const uri = req.body.uri;
  if (!uri) return res.status(400).json({ error: 'missing uri' });
  try {
    await spotify('POST', '/me/player/queue?uri=' + encodeURIComponent(uri));
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => console.log('Spotify 控制器运行在 http://localhost:' + PORT));
