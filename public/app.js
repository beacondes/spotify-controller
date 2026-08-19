const $ = (id) => document.getElementById(id);
let duration = 0;
let dragging = false;
let isPlaying = false;
let searchTimer = null;

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function refresh() {
  try {
    const r = await fetch('/api/status');
    const d = await r.json();
    if (!d.authed) {
      $('login-view').classList.remove('hidden');
      $('player-view').classList.add('hidden');
      return;
    }
    $('login-view').classList.add('hidden');
    $('player-view').classList.remove('hidden');
    if (d.playing && d.item) {
      duration = d.item.duration_ms;
      isPlaying = !!d.is_playing;
      $('title').textContent = d.item.name;
      $('artist').textContent = d.item.artists.map(a => a.name).join(', ');
      const img = d.item.album.images[0];
      $('cover').src = img ? img.url : '';
      $('dur').textContent = fmt(duration);
      if (!dragging) {
        $('progress').value = duration ? (d.progress_ms / duration) * 100 : 0;
        $('cur').textContent = fmt(d.progress_ms);
      }
      $('playpause').textContent = isPlaying ? '⏸️' : '▶️';
    }
    if (d.device) $('device').textContent = '设备：' + d.device.name;
    refreshDevices();
  } catch (e) {}
}

async function refreshDevices() {
  try {
    const r = await fetch('/api/devices');
    const d = await r.json();
    const sel = $('device-select');
    const current = sel.value;
    sel.innerHTML = '<option value="">选择播放设备…</option>';
    (d.devices || []).forEach(dev => {
      const opt = document.createElement('option');
      opt.value = dev.id;
      opt.textContent = (dev.is_active ? '▶ ' : '') + dev.name + ' · ' + dev.type;
      sel.appendChild(opt);
    });
    if (current) sel.value = current;
  } catch (e) {}
}

function fmt(ms) {
  const s = Math.floor(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

async function call(method, url, body) {
  await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
}

// ---- 搜索点歌 ----
async function search(q) {
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const d = await r.json();
    renderResults(d.tracks || []);
  } catch (e) {}
}

function renderResults(tracks) {
  const box = $('search-results');
  if (!tracks.length) {
    box.innerHTML = '<div class="no-result">没有找到相关歌曲</div>';
    box.classList.add('show');
    return;
  }
  box.innerHTML = tracks.map(t => {
    const img = (t.album.images && t.album.images[0]) ? t.album.images[0].url : '';
    const artists = t.artists.map(a => a.name).join(', ');
    return '<div class="result" data-uri="' + t.uri + '">' +
      '<img class="r-img" src="' + img + '" alt="">' +
      '<div class="r-info">' +
        '<div class="r-name">' + escapeHtml(t.name) + '</div>' +
        '<div class="r-artist">' + escapeHtml(artists) + '</div>' +
      '</div>' +
      '<button class="r-play" title="立即播放">▶</button>' +
      '<button class="r-queue" title="加入队列">＋</button>' +
    '</div>';
  }).join('');
  box.classList.add('show');
}

// ---- 事件 ----
$('search-input').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (!q) {
    $('search-results').innerHTML = '';
    $('search-results').classList.remove('show');
    return;
  }
  searchTimer = setTimeout(() => search(q), 400);
});

$('search-results').addEventListener('click', (e) => {
  const row = e.target.closest('.result');
  if (!row) return;
  const uri = row.getAttribute('data-uri');
  if (e.target.closest('.r-queue')) {
    call('POST', '/api/queue', { uri });
  } else {
    call('POST', '/api/play', { uris: [uri] });
    setTimeout(refresh, 300);
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap')) $('search-results').classList.remove('show');
});

$('playpause').onclick = () => {
  call('PUT', isPlaying ? '/api/pause' : '/api/play');
  setTimeout(refresh, 300);
};
$('next').onclick = () => { call('POST', '/api/next'); setTimeout(refresh, 300); };
$('prev').onclick = () => { call('POST', '/api/previous'); setTimeout(refresh, 300); };
$('volume').oninput = (e) => call('PUT', '/api/volume', { volume: e.target.value });
$('device-select').onchange = (e) => {
  if (e.target.value) { call('PUT', '/api/device', { device_id: e.target.value }); setTimeout(refresh, 500); }
};

$('progress').onmousedown = () => { dragging = true; };
$('progress').onmouseup = () => { dragging = false; };
$('progress').onchange = (e) => {
  const ms = (e.target.value / 100) * duration;
  call('PUT', '/api/seek', { position_ms: Math.round(ms) });
  setTimeout(refresh, 300);
};

refresh();
setInterval(refresh, 2000);
