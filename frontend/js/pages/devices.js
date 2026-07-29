import { api } from '../api.js';
import { esc, fmtDuration, fmtDate, timeAgo, statusBadge, spinner, emptyState, toast } from '../ui.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function renderDevices(el) {
  el.innerHTML = `
    <h1 class="text-2xl font-bold mb-2">Devices</h1>
    <p class="text-sm text-ink-muted mb-6">ESP32 recorders that stream audio to <code>POST /ingest</code> using their API key.</p>

    <form id="regForm" class="bg-white rounded-xl border border-grid p-4 mb-4 flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-[220px]">
        <label class="block text-xs text-ink-muted mb-1">Register new device</label>
        <input name="device_name" required placeholder="e.g. esp32-farm-02"
               class="w-full border border-grid rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
      </div>
      <button class="bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark">+ Register</button>
    </form>
    <div id="newKey"></div>
    <div id="deviceList" class="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">${spinner()}</div>

    <div class="bg-white rounded-xl border border-grid p-5">
      <div class="font-semibold mb-3">Recent ESP32 recordings</div>
      <div id="recordings">${spinner()}</div>
    </div>`;

  el.querySelector('#regForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const dev = await api('/devices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      e.target.reset();
      el.querySelector('#newKey').innerHTML = `
        <div class="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4 text-sm fade-in">
          <div class="font-semibold text-amber-800 mb-1">⚠️ API key for “${esc(dev.device_name)}” — shown only once</div>
          <div class="flex items-center gap-2">
            <code class="bg-white border border-amber-200 rounded px-2 py-1 break-all select-all" id="keyVal">${dev.api_key}</code>
            <button id="copyKey" class="shrink-0 text-amber-800 border border-amber-300 rounded-lg px-3 py-1 hover:bg-amber-100">Copy</button>
          </div>
          <div class="text-amber-700 mt-2">Flash this into the ESP32 firmware as the <code>X-API-Key</code> header value.</div>
        </div>`;
      el.querySelector('#copyKey').addEventListener('click', () => {
        navigator.clipboard.writeText(dev.api_key);
        toast('API key copied', 'success');
      });
      loadDevices(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  loadDevices(el);
  loadRecordings(el);
}

async function loadDevices(el) {
  const list = el.querySelector('#deviceList');
  const devices = await api('/devices');
  if (!devices.length) {
    list.innerHTML = `<div class="md:col-span-2 lg:col-span-3">${emptyState('📡', 'No devices registered', 'Register your ESP32 above to get an API key')}</div>`;
    return;
  }
  list.innerHTML = devices.map((d) => {
    const online = d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < ONLINE_WINDOW_MS;
    return `
      <div class="bg-white rounded-xl border border-grid p-4">
        <div class="flex items-center justify-between">
          <div class="font-medium">📡 ${esc(d.device_name)}</div>
          ${online
            ? '<span class="inline-flex items-center gap-1.5 text-xs text-green-700"><span class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>online</span>'
            : '<span class="inline-flex items-center gap-1.5 text-xs text-ink-muted"><span class="w-2 h-2 rounded-full bg-gray-300"></span>offline</span>'}
        </div>
        <div class="text-xs text-ink-muted mt-2 space-y-0.5">
          <div>Last seen: ${d.last_seen ? `${timeAgo(d.last_seen)} (${fmtDate(d.last_seen)})` : 'never'}</div>
          <div>API key: <code>${esc(d.api_key)}</code></div>
          <div>Registered: ${fmtDate(d.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

async function loadRecordings(el) {
  const box = el.querySelector('#recordings');
  const data = await api('/audio?source=esp32&per_page=10');
  if (!data.items.length) {
    box.innerHTML = emptyState('🎙️', 'No ESP32 recordings yet',
      'Recordings appear here once a device streams audio to /ingest');
    return;
  }
  box.innerHTML = `
    <table class="w-full text-sm">
      <thead><tr class="text-left text-xs text-ink-muted border-b border-grid">
        <th class="py-2 pr-3 font-medium">File</th><th class="py-2 pr-3 font-medium">Top class</th>
        <th class="py-2 pr-3 font-medium">Duration</th><th class="py-2 pr-3 font-medium">Status</th>
        <th class="py-2 font-medium">Recorded</th>
      </tr></thead>
      <tbody>${data.items.map((f) => `
        <tr class="border-b border-grid/60 last:border-0 hover:bg-gray-50">
          <td class="py-2.5 pr-3"><a class="text-brand hover:underline" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
          <td class="py-2.5 pr-3">${f.top_class ? esc(f.top_class.class_name) : '<span class="text-ink-muted">—</span>'}</td>
          <td class="py-2.5 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
          <td class="py-2.5 pr-3">${statusBadge(f.status)}</td>
          <td class="py-2.5 text-ink-secondary">${fmtDate(f.uploaded_at)}</td>
        </tr>`).join('')}
      </tbody>
    </table>`;
}
