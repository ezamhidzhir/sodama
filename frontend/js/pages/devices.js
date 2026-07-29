import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, timeAgo, statusBadge, spinner, emptyState, toast, pageHeader } from '../ui.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function renderDevices(el) {
  el.innerHTML = `
    ${pageHeader('Devices', 'ESP32 recorders that stream audio to the ingest endpoint using their API key.')}

    <form id="regForm" class="bg-white rounded-xl2 shadow-card p-5 mb-4 flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-[240px]">
        <label class="block text-xs text-ink-muted mb-1.5">Register a new device</label>
        <input name="device_name" required placeholder="e.g. esp32-farm-02"
               class="field w-full bg-white border border-line rounded-full px-4 py-2.5 text-sm transition-shadow">
      </div>
      <button class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">
        ${icon('plus', { size: 16 })} Register device
      </button>
    </form>

    <div id="newKey"></div>
    <div id="deviceList" class="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">${spinner()}</div>

    <div class="bg-white rounded-xl2 shadow-card p-6">
      <div class="font-semibold mb-4">Recent ESP32 recordings</div>
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
        <div class="bg-accent-tint border border-accent/30 rounded-xl2 p-5 mb-4 text-sm fade-in">
          <div class="flex items-center gap-2 font-semibold text-accent-dark mb-2">
            ${icon('lock', { size: 16 })} API key for “${esc(dev.device_name)}” — shown only once
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <code class="bg-white border border-accent/20 rounded-full px-4 py-2 break-all select-all text-xs">${dev.api_key}</code>
            <button id="copyKey" class="inline-flex items-center gap-1.5 shrink-0 text-accent-dark border border-accent/30 rounded-full px-4 py-2 hover:bg-white transition-colors">
              ${icon('copy', { size: 14 })} Copy</button>
          </div>
          <div class="text-ink-secondary mt-2.5">
            Flash this into the ESP32 firmware as the <code>X-API-Key</code> header value.
          </div>
        </div>`;
      el.querySelector('#copyKey').addEventListener('click', () => {
        navigator.clipboard.writeText(dev.api_key);
        toast('API key copied to clipboard', 'success');
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
    list.innerHTML = `<div class="md:col-span-2 xl:col-span-3 bg-white rounded-xl2 shadow-card">
      ${emptyState('device', 'No devices registered', 'Register your ESP32 above to receive an API key')}</div>`;
    return;
  }
  list.innerHTML = devices.map((d) => {
    const online = d.last_seen && (Date.now() - new Date(d.last_seen).getTime()) < ONLINE_WINDOW_MS;
    return `
      <div class="bg-white rounded-xl2 shadow-card p-5">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div class="flex items-center gap-2.5 min-w-0">
            <span class="w-9 h-9 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon('device', { size: 16 })}</span>
            <span class="font-medium truncate">${esc(d.device_name)}</span>
          </div>
          ${online
            ? '<span class="inline-flex items-center gap-1.5 text-xs text-brand-dark bg-brand-tint border border-brand/25 rounded-full px-2.5 py-1"><span class="w-1.5 h-1.5 rounded-full bg-brand"></span>Online</span>'
            : '<span class="inline-flex items-center gap-1.5 text-xs text-ink-muted bg-page border border-line rounded-full px-2.5 py-1"><span class="w-1.5 h-1.5 rounded-full bg-ink-muted/50"></span>Offline</span>'}
        </div>
        <dl class="text-xs space-y-1.5">
          <div class="flex justify-between gap-2"><dt class="text-ink-muted">Last seen</dt><dd class="text-right">${d.last_seen ? timeAgo(d.last_seen) : 'Never'}</dd></div>
          <div class="flex justify-between gap-2"><dt class="text-ink-muted">API key</dt><dd><code>${esc(d.api_key)}</code></dd></div>
          <div class="flex justify-between gap-2"><dt class="text-ink-muted">Registered</dt><dd class="text-right">${fmtDate(d.created_at)}</dd></div>
        </dl>
      </div>`;
  }).join('');
}

async function loadRecordings(el) {
  const box = el.querySelector('#recordings');
  const data = await api('/audio?source=esp32&per_page=10');
  if (!data.items.length) {
    box.innerHTML = emptyState('waveform', 'No ESP32 recordings yet',
      'Recordings appear here once a device streams audio to the ingest endpoint');
    return;
  }
  box.innerHTML = `
    <div class="overflow-x-auto">
      <table class="w-full text-sm min-w-[600px]">
        <thead><tr class="text-left text-xs text-ink-muted border-b border-line">
          <th class="py-2.5 pr-3 font-medium">File</th><th class="py-2.5 pr-3 font-medium">Top class</th>
          <th class="py-2.5 pr-3 font-medium">Duration</th><th class="py-2.5 pr-3 font-medium">Status</th>
          <th class="py-2.5 font-medium">Recorded</th>
        </tr></thead>
        <tbody>${data.items.map((f) => `
          <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
            <td class="py-3 pr-3"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
            <td class="py-3 pr-3">${f.top_class ? esc(f.top_class.class_name) : '<span class="text-ink-muted">—</span>'}</td>
            <td class="py-3 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
            <td class="py-3 pr-3">${statusBadge(f.status)}</td>
            <td class="py-3 text-ink-secondary whitespace-nowrap">${fmtDate(f.uploaded_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
