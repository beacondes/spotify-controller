const $ = (id) => document.getElementById(id);
let duration = 0;
let dragging = false;
let isPlaying = false;

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
