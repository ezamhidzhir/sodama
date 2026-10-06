import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, timeAgo, statusBadge, spinner, emptyState, toast, pageHeader } from '../ui.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;

export async function renderDevices(el) {
  el.innerHTML = `
    ${pageHeader('Devices', 'Anything that records — an ESP32, or a program on another laptop — can send audio here with its API key.')}

    <form id="regForm" class="bg-white rounded-xl2 shadow-card p-4 sm:p-5 mb-4 flex flex-wrap items-end gap-3">
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs text-ink-muted mb-1.5">Register a new device</label>
        <input name="device_name" required placeholder="e.g. lab-laptop or esp32-farm-02"
               class="field w-full bg-white border border-line rounded-full px-4 py-3 sm:py-2.5 text-[16px] sm:text-sm transition-shadow">
      </div>
      <button class="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand text-white text-sm px-5 py-3 sm:py-2.5 rounded-full hover:bg-brand-dark transition-colors">
        ${icon('plus', { size: 16 })} Register device
      </button>
    </form>

    <div id="newKey"></div>
    <div id="deviceList" class="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">${spinner()}</div>

    ${howItWorks()}

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6">
      <div class="font-semibold mb-2">Recent device recordings</div>
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
      showKey(el, dev.device_name, dev.api_key);
      loadDevices(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  loadDevices(el);
  loadRecordings(el);
}

// The upload contract every client follows, whatever the hardware.
function howItWorks() {
  const steps = [
    ['mic', 'Record', 'A clip, or a ~10 s chunk in stream mode'],
    ['upload', 'Send', 'POST /ingest with its API key, an id and a SHA-256'],
    ['check', 'Receipt', 'The server stores it and replies with the hash it got'],
    ['trash', 'Delete', 'Only when the hashes match — so storage never fills up'],
  ];
  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-5">
      <div class="font-semibold mb-1">How a device sends audio</div>
      <div class="text-xs text-ink-muted mb-4">The same four steps for an ESP32 or a program on a laptop. A failed upload is simply sent again — the server recognises repeats.</div>
      <ol class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        ${steps.map(([ic, title, text], i) => `
          <li class="flex gap-3 items-start bg-page rounded-xl p-3">
            <span class="w-8 h-8 rounded-full bg-white text-brand grid place-items-center shrink-0">${icon(ic, { size: 15 })}</span>
            <div class="min-w-0"><div class="text-sm font-medium">${i + 1}. ${title}</div>
              <div class="text-xs text-ink-secondary">${text}</div></div>
          </li>`).join('')}
      </ol>
      <div class="text-xs text-ink-muted mb-1.5">Try it from any computer with Python (<code>client/sodama_client.py</code> in the repo):</div>
      <pre class="bg-page border border-line rounded-xl p-3 text-xs overflow-x-auto"><code>python sodama_client.py --server ${esc(location.origin)} --key &lt;API key&gt; mic --chunk 10 --join</code></pre>
    </div>`;
}

// The full API key is only ever available right after it is issued.
function showKey(el, deviceName, apiKey, rotated = false) {
  el.querySelector('#newKey').innerHTML = `
    <div class="bg-accent-tint border border-accent/30 rounded-xl2 p-5 mb-4 text-sm fade-in">
      <div class="flex items-center gap-2 font-semibold text-accent-dark mb-2">
        ${icon('lock', { size: 16 })}
        ${rotated ? 'New API key for' : 'API key for'} “${esc(deviceName)}” — shown only once
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <code class="bg-white border border-accent/20 rounded-full px-4 py-2 break-all select-all text-xs">${esc(apiKey)}</code>
        <button id="copyKey" class="inline-flex items-center gap-1.5 shrink-0 text-accent-dark border border-accent/30 rounded-full px-4 py-2 hover:bg-white transition-colors">
          ${icon('copy', { size: 14 })} Copy</button>
      </div>
      <div class="text-ink-secondary mt-2.5">
        Put this in the device's firmware or client config — it is sent as the <code>X-API-Key</code> header.
        ${rotated ? 'The previous key stops working immediately.' : ''}
      </div>
    </div>`;
  el.querySelector('#copyKey').addEventListener('click', () => {
    navigator.clipboard.writeText(apiKey);
    toast('API key copied to clipboard', 'success');
  });
}

async function loadDevices(el) {
  const list = el.querySelector('#deviceList');
  const devices = await api('/devices');
  if (!devices.length) {
    list.innerHTML = `<div class="md:col-span-2 xl:col-span-3 bg-white rounded-xl2 shadow-card">
      ${emptyState('device', 'No devices registered', 'Register a device above to receive an API key')}</div>`;
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

        <div class="flex items-center gap-2 mt-4 pt-3 border-t border-line">
          <button class="renameBtn inline-flex items-center gap-1.5 text-xs text-ink-secondary border border-line rounded-full px-3 py-1.5 hover:border-brand hover:text-brand transition-colors"
                  data-id="${d.id}" data-name="${esc(d.device_name)}">${icon('clip', { size: 13 })} Rename</button>
          <button class="rotateBtn inline-flex items-center gap-1.5 text-xs text-ink-secondary border border-line rounded-full px-3 py-1.5 hover:border-accent hover:text-accent transition-colors"
                  data-id="${d.id}" data-name="${esc(d.device_name)}" title="Issue a new API key">${icon('lock', { size: 13 })} New key</button>
          <button class="delDevBtn inline-flex items-center gap-1.5 text-xs text-ink-muted rounded-full px-3 py-1.5 ml-auto hover:bg-red-50 hover:text-red-600 transition-colors"
                  data-id="${d.id}" data-name="${esc(d.device_name)}" title="Delete device">${icon('trash', { size: 13 })} Delete</button>
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.renameBtn').forEach((b) => b.addEventListener('click', async () => {
    const { id, name } = b.dataset;
    const next = prompt(`Rename device “${name}” to:`, name);
    if (next === null || next.trim() === '' || next.trim() === name) return;
    try {
      await api(`/devices/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ device_name: next.trim() }),
      });
      toast('Device renamed', 'success');
      loadDevices(el);
    } catch (e) { toast(e.message, 'error'); }
  }));

  list.querySelectorAll('.rotateBtn').forEach((b) => b.addEventListener('click', async () => {
    const { id, name } = b.dataset;
    if (!confirm(`Issue a new API key for “${name}”?\n\nThe current key stops working immediately, so the device must be reflashed.`)) return;
    try {
      const dev = await api(`/devices/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate_key: true }),
      });
      showKey(el, dev.device_name, dev.api_key, true);
      loadDevices(el);
    } catch (e) { toast(e.message, 'error'); }
  }));

  list.querySelectorAll('.delDevBtn').forEach((b) => b.addEventListener('click', async () => {
    const { id, name } = b.dataset;
    if (!confirm(`Delete device “${name}”?\n\nIts API key stops working. Recordings it already uploaded stay in the Library.`)) return;
    try {
      await api(`/devices/${id}`, { method: 'DELETE' });
      toast('Device deleted', 'success');
      loadDevices(el);
    } catch (e) { toast(e.message, 'error'); }
  }));
}

async function loadRecordings(el) {
  const box = el.querySelector('#recordings');
  const data = await api('/audio?source=device&per_page=10');
  if (!data.items.length) {
    box.innerHTML = emptyState('waveform', 'No device recordings yet',
      'Recordings appear here once a device streams audio to the ingest endpoint');
    return;
  }
  box.innerHTML = `
    <div class="divide-y divide-line/60">
      ${data.items.map((f) => `
        <a href="#/audio/${f.id}" class="flex items-center gap-3 py-3 hover:bg-page/60 -mx-2 px-2 rounded-xl">
          <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon('device', { size: 16 })}</span>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">${esc(f.verified_label || f.top_class?.class_name || 'Not classified yet')}</div>
            <div class="text-xs text-ink-muted truncate">${esc(f.filename)} · ${fmtDuration(f.duration)} · ${fmtDate(f.recorded_at || f.uploaded_at)}</div>
          </div>
          ${statusBadge(f.status)}
        </a>`).join('')}
    </div>`;
}
