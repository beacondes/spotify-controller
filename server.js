const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const fs = require('fs');

const app = express();
app.use(express.json());

const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD;
const AUTH_HASH = ACCESS_PASSWORD
  ? crypto.createHash('sha256').update(ACCESS_PASSWORD).digest('hex')
  : null;

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach(kv => {
    const i = kv.indexOf('=');
    if (i > 0) out[kv.slice(0, i).trim()] = kv.slice(i + 1).trim();
  });
  return out;
}

// PWA 元数据与精简页框架不含敏感数据，放行（浏览器获取 manifest/图标时可能不带 cookie）
const PUBLIC_PATHS = ['/manifest.json', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png', '/mini'];

// 访问密码门禁（未设置 ACCESS_PASSWORD 时放行，便于本地开发）
app.use((req, res, next) => {
  if (!ACCESS_PASSWORD) return next();
  if (req.path === '/auth' || req.path === '/api/auth') return next();
  if (PUBLIC_PATHS.includes(req.path)) return next();
  const c = parseCookies(req.headers.cookie);
  if (c.auth === AUTH_HASH) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: '未登录' });
  return res.redirect('/auth');
});

app.use(express.static('public'));

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3000/callback';
const PORT = process.env.PORT || 3000;

const TOKEN_FILE = process.env.TOKEN_FILE || 'tokens.json';

let accessToken = null;
let refreshToken = null;
let tokenExpiry = 0;        // accessToken 过期时间戳
let refreshPromise = null;  // 并发刷新锁

// 启动时恢复之前保存的凭证（一次授权，之后免登录）
try {
  const saved = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  if (saved.refreshToken) refreshToken = saved.refreshToken;
  if (saved.accessToken) accessToken = saved.accessToken;
  console.log('已恢复保存的 Spotify 凭证');
} catch (e) {}

function saveTokens() {
  try {
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ accessToken, refreshToken }, null, 2));
  } catch (e) {}
}

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
    tokenExpiry = Date.now() + (resp.data.expires_in || 3600) * 1000;
    saveTokens();
    res.redirect('/');
  } catch (e) {
    const msg = e.response && e.response.data && e.response.data.error_description
      ? e.response.data.error_description : e.message;
    res.status(500).send('授权失败：' + msg);
  }
});

async function ensureToken() {
  // token 还有 60 秒以上有效，直接复用（避免每次请求都刷新导致 Spotify 403）
  if (accessToken && Date.now() < tokenExpiry - 60000) return accessToken;
  if (!refreshToken) return accessToken;
  // 并发刷新锁：多个请求同时需要刷新时，只发一次刷新请求
  if (!refreshPromise) {
    refreshPromise = (async () => {
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
        tokenExpiry = Date.now() + (resp.data.expires_in || 3600) * 1000;
        saveTokens();
      } catch (e) {
        // 刷新失败就返回当前 token，让请求层去处理 401
      }
      refreshPromise = null;
      return accessToken;
    })();
  }
  return refreshPromise;
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

// 访问密码登录页
app.get('/auth', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>登录 - Spotify 控制器</title>
<style>
* { box-sizing:border-box; margin:0; padding:0; }
body { font-family:-apple-system,"Segoe UI",Roboto,sans-serif; background:linear-gradient(135deg,#1db954,#191414); min-height:100vh; display:flex; align-items:center; justify-content:center; color:#fff; }
.box { width:100%; max-width:340px; padding:32px 28px; background:rgba(0,0,0,.35); border-radius:16px; text-align:center; }
h1 { font-size:1.6rem; margin-bottom:6px; }
p { color:#ccc; font-size:.85rem; margin-bottom:24px; }
input { width:100%; padding:12px 14px; border:none; border-radius:8px; font-size:1rem; outline:none; margin-bottom:16px; }
button { width:100%; padding:12px; background:#1db954; border:none; border-radius:30px; color:#fff; font-size:1rem; font-weight:bold; cursor:pointer; }
button:hover { filter:brightness(1.1); }
#err { color:#ff6b6b; font-size:.85rem; margin-top:12px; min-height:1.2em; }
</style>
</head>
<body>
<div class="box">
<h1>🎵 Spotify 控制器</h1>
<p>请输入访问密码</p>
<form id="f">
<input type="password" id="pw" placeholder="访问密码" autocomplete="current-password" autofocus>
<button type="submit">进入</button>
</form>
<div id="err"></div>
</div>
<script>
document.getElementById('f').addEventListener('submit', async function(e) {
  e.preventDefault();
  var err = document.getElementById('err');
  err.textContent = '';
  try {
    var r = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: document.getElementById('pw').value })
    });
    if (r.ok) { location.href = '/'; }
    else { var d = await r.json().catch(function(){ return {}; }); err.textContent = d.error || '密码错误'; }
  } catch (ex) { err.textContent = '网络错误'; }
});
</script>
</body>
</html>`);
});

// 登录接口
app.post('/api/auth', (req, res) => {
  if (req.body && req.body.password === ACCESS_PASSWORD) {
    res.setHeader('Set-Cookie', 'auth=' + AUTH_HASH + '; HttpOnly; Path=/; Max-Age=31536000; SameSite=Lax');
    res.json({ ok: true });
  } else {
    res.status(401).json({ error: '密码错误' });
  }
});

// 精简控制页（无封面，仅控制按钮）
app.get('/mini', (req, res) => res.sendFile(__dirname + '/public/mini.html'));

app.listen(PORT, () => console.log('Spotify 控制器运行在 http://localhost:' + PORT));
