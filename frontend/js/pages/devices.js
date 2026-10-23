// Devices — recorders that send audio on their own (another computer, an ESP32,
// a custom program). Built as a guided setup: pick what records, name it, then
// follow instructions with the key already filled in, and watch for the first
// recording to arrive.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, timeAgo, statusBadge, spinner, toast, pageHeader, INPUT } from '../ui.js';

const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const POLL_MS = 5000;
const KEY_PLACEHOLDER = '<your-device-key>';

const KINDS = {
  computer: {
    icon: 'device', title: 'Another computer', label: 'Computer',
    text: 'A laptop or PC records with its microphone, or sends audio files. Runs a small Python script.',
    placeholder: 'e.g. Lab laptop',
  },
  api: {
    icon: 'gear', title: 'ESP32 or your own program', label: 'ESP32 / program',
    text: 'Anything that can send a web request. You get an address and a key to put in its code.',
    placeholder: 'e.g. ESP32 by the pond',
  },
};

const BTN = 'inline-flex items-center justify-center gap-2 text-sm px-5 py-2.5 rounded-full transition-colors';
const BTN_MAIN = `${BTN} bg-brand text-white hover:bg-brand-dark`;
const BTN_GHOST = `${BTN} bg-white border border-line text-ink-secondary hover:border-brand hover:text-brand`;
const BTN_SMALL = 'inline-flex items-center gap-1.5 whitespace-nowrap text-xs text-ink-secondary rounded-full px-2.5 py-1.5 hover:bg-page transition-colors';

const isOnline = (d) => d.last_seen && Date.now() - new Date(d.last_seen).getTime() < ONLINE_WINDOW_MS;
const kindOf = (d) => KINDS[d.kind] ? d.kind : 'computer';

const copyBtn = (text, label) => `
  <button type="button" data-copy="${esc(text)}" data-copy-label="${esc(label)}" title="Copy"
          class="w-8 h-8 shrink-0 rounded-full bg-white border border-line text-ink-secondary hover:border-brand hover:text-brand grid place-items-center transition-colors"
          aria-label="Copy">${icon('copy', { size: 14 })}</button>`;

const cmdBox = (cmd) => `
  <div class="flex items-start gap-2 bg-page border border-line rounded-xl p-2.5">
    <code class="flex-1 min-w-0 text-xs break-all leading-relaxed pt-1.5">${esc(cmd)}</code>
    ${copyBtn(cmd, 'Command copied')}
  </div>`;

const valueRow = (label, value) => `
  <div class="p-3 flex items-start gap-2">
    <div class="flex-1 min-w-0"><dt class="text-xs text-ink-muted mb-1">${label}</dt>
      <dd><code class="text-xs break-all">${esc(value)}</code></dd></div>
    ${copyBtn(value, `${label} copied`)}
  </div>`;

const stepItem = (n, title, body) => `
  <li class="flex gap-3">
    <span class="w-7 h-7 rounded-full bg-brand-tint text-brand-dark grid place-items-center text-xs font-semibold shrink-0">${n}</span>
    <div class="min-w-0 flex-1 text-sm">
      <div class="font-medium text-ink pt-1">${title}</div>
      <div class="text-ink-secondary">${body}</div>
    </div>
  </li>`;

export async function renderDevices(el) {
  // What the page shows; everything below re-renders from these two.
  let devices = [];
  let wizard = null;   // { step: 'choose'|'name'|'connect', kind, device, key, fresh, rotated, saved }

  el.innerHTML = `
    ${pageHeader('Devices',
      'Let another computer or a microcontroller send recordings to SODAMA on its own, without signing in.',
      `<button id="addBtn" class="hidden ${BTN_MAIN}">${icon('plus', { size: 16 })} Add a device</button>`)}

    <div class="flex gap-3 bg-brand-soft border border-brand/20 rounded-xl2 p-4 mb-5 text-sm text-ink-secondary">
      <span class="text-brand shrink-0 mt-0.5">${icon('helpCircle', { size: 18 })}</span>
      <div>
        <span class="font-medium text-ink">Do you need a device?</span>
        Recording on this phone or laptop? Use <a href="#/record" class="text-brand font-medium hover:underline">Record</a>.
        Already have audio files? Use <a href="#/upload" class="text-brand font-medium hover:underline">Upload</a>.
        A device is for a recorder that runs by itself, such as a laptop left in the lab or an ESP32 by a pond.
      </div>
    </div>

    <div id="setup"></div>
    <div id="deviceList" class="grid md:grid-cols-2 xl:grid-cols-3 gap-4 mb-5">${spinner()}</div>

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-5">
      <div class="font-semibold mb-2">Recent device recordings</div>
      <div id="recordings">${spinner()}</div>
    </div>

    ${developerNotes()}`;

  const setupBox = el.querySelector('#setup');
  const listBox = el.querySelector('#deviceList');
  const addBtn = el.querySelector('#addBtn');
  addBtn.addEventListener('click', () => openWizard({ step: 'choose' }));

  // Copy buttons anywhere on the page carry their text in data-copy.
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copy]');
    if (!b) return;
    navigator.clipboard.writeText(b.dataset.copy).then(
      () => {
        toast(b.dataset.copyLabel || 'Copied', 'success');
        if (wizard && b.dataset.copyKey) { wizard.saved = true; }
      },
      () => toast('Could not copy — select the text and copy it by hand', 'error'));
  });

  function openWizard(next, { scroll = true } = {}) {
    wizard = next;
    paintSetup();
    if (scroll) setupBox.scrollIntoView({ behavior: 'smooth', block: 'start' });
    if (wizard.step === 'connect' && !wizard.device.last_seen) waitForFirstRecording();
  }

  function closeWizard() {
    if (wizard?.fresh && !wizard.saved
        && !confirm('Have you saved the device key?\n\nIt is shown only once. Without it the device cannot send audio, and you will need to replace the key.')) return;
    wizard = null;
    paintSetup();
    paintList();
  }

  // ------------------------------------------------------------ setup wizard

  function paintSetup() {
    addBtn.classList.toggle('hidden', !!wizard || !devices.length);
    if (!wizard) { setupBox.innerHTML = ''; return; }
    const canClose = devices.length > 0;
    const steps = ['What records', 'Name it', 'Connect'];
    const at = { choose: 0, name: 1, connect: 2 }[wizard.step];
    setupBox.innerHTML = `
      <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-5 fade-in">
        <div class="flex items-center justify-between gap-3 mb-5">
          <ol class="flex items-center gap-2 text-xs">
            ${steps.map((s, i) => `
              <li class="flex items-center gap-2 ${i <= at ? 'text-ink' : 'text-ink-muted'}">
                <span class="w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold
                  ${i < at ? 'bg-brand text-white' : i === at ? 'bg-brand-tint text-brand-dark ring-1 ring-brand/40' : 'bg-page text-ink-muted'}">
                  ${i < at ? icon('check', { size: 12 }) : i + 1}</span>
                <span class="hidden sm:inline ${i === at ? 'font-medium' : ''}">${s}</span>
              </li>${i < steps.length - 1 ? '<li class="w-5 sm:w-8 h-px bg-line"></li>' : ''}`).join('')}
          </ol>
          ${canClose ? `<button id="closeSetup" class="w-8 h-8 rounded-full text-ink-muted hover:bg-page grid place-items-center" aria-label="Close setup">${icon('close', { size: 16 })}</button>` : ''}
        </div>
        <div id="stepBody">${stepBody()}</div>
      </div>`;
    setupBox.querySelector('#closeSetup')?.addEventListener('click', closeWizard);
    wireStep();
  }

  function stepBody() {
    if (wizard.step === 'choose') {
      return `
        <h2 class="text-lg font-semibold mb-1">What will record the audio?</h2>
        <p class="text-sm text-ink-muted mb-4">This decides which setup steps you see next.</p>
        <div class="grid sm:grid-cols-2 gap-3">
          ${Object.entries(KINDS).map(([k, v]) => `
            <button data-kind="${k}" class="kindBtn text-left flex gap-3 items-start border border-line rounded-xl2 p-4 hover:border-brand hover:bg-brand-soft transition-colors">
              <span class="w-11 h-11 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(v.icon, { size: 20 })}</span>
              <span class="min-w-0">
                <span class="block font-semibold">${v.title}</span>
                <span class="block text-sm text-ink-secondary mt-0.5">${v.text}</span>
              </span>
            </button>`).join('')}
        </div>`;
    }
    if (wizard.step === 'name') {
      const k = KINDS[wizard.kind];
      return `
        <h2 class="text-lg font-semibold mb-1">Give it a name</h2>
        <p class="text-sm text-ink-muted mb-4">The name appears on every recording it sends, so you can tell where audio came from.</p>
        <form id="nameForm" class="space-y-4">
          <div class="flex items-center gap-2 text-sm text-ink-secondary">
            ${icon(k.icon, { size: 16 })} ${k.title}
            <button type="button" id="backBtn" class="text-brand hover:underline ml-1">Change</button>
          </div>
          <input name="device_name" required maxlength="64" autocomplete="off" placeholder="${esc(k.placeholder)}" class="${INPUT}">
          <div class="flex gap-2.5">
            <button class="${BTN_MAIN}">${icon('arrowRight', { size: 16 })} Create device</button>
          </div>
        </form>`;
    }
    return connectBody();
  }

  function connectBody() {
    const { device, kind, key, fresh, rotated } = wizard;
    const live = devices.find((d) => d.id === device.id) || device;
    return `
      <h2 class="text-lg font-semibold mb-1">
        ${fresh && !rotated ? `${icon('checkCircle', { size: 18 })} “${esc(device.device_name)}” is ready. Now connect it.` : `Connect “${esc(device.device_name)}”`}
      </h2>
      <p class="text-sm text-ink-muted mb-5">${kind === 'computer'
        ? 'Do these steps on the computer that will record.'
        : 'Put these values in the ESP32 firmware or your program.'}</p>
      ${keyBlock(key, fresh, rotated)}
      ${kind === 'computer' ? computerSteps(key || KEY_PLACEHOLDER) : apiSteps(key || KEY_PLACEHOLDER)}
      <div id="connStatus" class="mt-5">${connectionStatus(live)}</div>
      <div class="flex justify-end mt-5">
        <button id="doneBtn" class="${BTN_GHOST}">${icon('check', { size: 16 })} Done</button>
      </div>`;
  }

  function keyBlock(key, fresh, rotated) {
    if (key) {
      return `
        <div class="bg-accent-tint border border-accent/30 rounded-xl2 p-4 mb-5 text-sm">
          <div class="flex items-center gap-2 font-semibold text-accent-dark mb-1">
            ${icon('key', { size: 16 })} ${rotated ? 'New device key' : 'Device key'} — copy it now, it is shown only once
          </div>
          <p class="text-ink-secondary mb-3">It works like a password for this device. Anyone with it can send audio into your account.
            ${rotated ? ' The old key has stopped working.' : ''}</p>
          <div class="flex flex-wrap items-center gap-2">
            <code class="bg-white border border-accent/20 rounded-full px-4 py-2 break-all select-all text-xs">${esc(key)}</code>
            <button data-copy="${esc(key)}" data-copy-key="1" data-copy-label="Device key copied"
                    class="inline-flex items-center gap-1.5 text-accent-dark border border-accent/30 rounded-full px-4 py-2 hover:bg-white transition-colors">
              ${icon('copy', { size: 14 })} Copy key</button>
          </div>
        </div>`;
    }
    return `
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 bg-page rounded-xl2 p-4 mb-5 text-sm text-ink-secondary">
        <span class="text-ink-muted">${icon('key', { size: 16 })}</span>
        <span class="flex-1 min-w-[14rem]">The key was shown once, when this device was added. Use it where the steps say
          <code>${esc(KEY_PLACEHOLDER)}</code>. Lost it?</span>
        <button id="guideReplaceKey" class="${BTN_SMALL} border border-line bg-white">${icon('refresh', { size: 13 })} Replace key</button>
      </div>`;
  }

  function computerSteps(key) {
    const base = `python sodama_client.py --server ${location.origin} --key ${key}`;
    const ways = [
      ['mic', 'Record from its microphone', `${base} mic --chunk 10`,
        'Sends a 10-second clip at a time until you press Ctrl+C. Needs the two packages from step 2.'],
      ['upload', 'Send audio files you already have', `${base} send --keep recording1.wav recording2.wav`,
        'WAV, FLAC, MP3 or OGG. <code>--keep</code> leaves your files where they are.'],
      ['folder', 'Send whatever lands in a folder', `${base} watch C:\\recordings`,
        'Each file is removed from the folder once SODAMA confirms it arrived safely, so the folder never fills up.'],
    ];
    return `
      <ol class="space-y-5">
        ${stepItem(1, 'Install Python 3.10 or newer', `Skip this if the computer already has it. Get it from
          <a href="https://www.python.org/downloads/" target="_blank" rel="noopener" class="text-brand hover:underline">python.org</a>.`)}
        ${stepItem(2, 'Download the SODAMA script', `
          <div class="flex flex-wrap items-center gap-2 mt-2">
            <a href="/client/sodama_client.py" download class="${BTN_MAIN}">${icon('download', { size: 16 })} Download sodama_client.py</a>
          </div>
          <div class="text-ink-muted mt-3 mb-1.5">To record from the microphone, also install two packages once:</div>
          ${cmdBox('pip install sounddevice numpy')}`)}
        ${stepItem(3, 'Open a terminal where you saved the script, and run one of these', `
          <div class="space-y-3 mt-2">
            ${ways.map(([ic, title, cmd, note]) => `
              <div class="border border-line rounded-xl2 p-3">
                <div class="flex items-center gap-2 font-medium text-ink mb-2">${icon(ic, { size: 15 })} ${title}</div>
                ${cmdBox(cmd)}
                <div class="text-xs text-ink-muted mt-1.5">${note}</div>
              </div>`).join('')}
          </div>`)}
      </ol>`;
  }

  function apiSteps(key) {
    const curl = `curl -X POST "${location.origin}/ingest" -H "X-API-Key: ${key}" -H "Content-Type: audio/wav" --data-binary @sound.wav`;
    return `
      <ol class="space-y-5">
        ${stepItem(1, 'Send each recording to this address', `
          <dl class="mt-2 border border-line rounded-xl2 divide-y divide-line text-sm">
            ${valueRow('Address', `POST ${location.origin}/ingest`)}
            ${valueRow('Header', `X-API-Key: ${key}`)}
            <div class="p-3"><dt class="text-xs text-ink-muted mb-1">Body</dt>
              <dd>An audio file (WAV, FLAC, MP3 or OGG) with its <code>Content-Type</code>, or raw 16-bit mono PCM at 16 kHz.</dd></div>
          </dl>`)}
        ${stepItem(2, 'Test it from any terminal', `
          <div class="mt-2">${cmdBox(curl)}</div>
          <div class="text-xs text-ink-muted mt-1.5">The reply is a receipt. Delete the device's copy only when its <code>sha256</code> matches the file you sent.</div>`)}
      </ol>
      <div class="flex gap-2 bg-page rounded-xl2 p-3 mt-5 text-xs text-ink-secondary">
        ${icon('helpCircle', { size: 15 })}
        <span>SODAMA's ESP32 firmware is still being built; it will use exactly this address and key.
          Retries, streaming and receipts are in the <a href="/docs" target="_blank" class="text-brand hover:underline">API documentation</a>.</span>
      </div>`;
  }

  function connectionStatus(d) {
    if (!d.last_seen) {
      return `
        <div class="flex items-center gap-3 border border-dashed border-line rounded-xl2 p-4 text-sm">
          <svg class="animate-spin h-5 w-5 text-brand shrink-0" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3.5"/>
            <path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
          <div><div class="font-medium">Waiting for the first recording…</div>
            <div class="text-xs text-ink-muted">This updates by itself once the device sends audio.</div></div>
        </div>`;
    }
    return `
      <div class="flex flex-wrap items-center gap-3 bg-brand-tint border border-brand/25 rounded-xl2 p-4 text-sm">
        <span class="text-brand">${icon('checkCircle', { size: 20 })}</span>
        <div class="flex-1 min-w-[12rem]"><div class="font-medium text-brand-dark">Connected</div>
          <div class="text-xs text-ink-secondary">Last heard from ${esc(timeAgo(d.last_seen))}</div></div>
        <a href="#/library/device:${d.id}" class="${BTN_MAIN}">${icon('search', { size: 16 })} View recordings</a>
      </div>`;
  }

  function wireStep() {
    setupBox.querySelectorAll('.kindBtn').forEach((b) => b.addEventListener('click', () => {
      wizard = { step: 'name', kind: b.dataset.kind };
      paintSetup();
      setupBox.querySelector('input[name=device_name]')?.focus();
    }));
    setupBox.querySelector('#backBtn')?.addEventListener('click', () => {
      wizard = { step: 'choose' };
      paintSetup();
    });
    setupBox.querySelector('#nameForm')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = new FormData(e.target).get('device_name').trim();
      if (!name) return;
      const btn = e.target.querySelector('button:not([type])');
      btn.disabled = true;
      try {
        const dev = await api.json('/devices', 'POST', { device_name: name, kind: wizard.kind });
        await loadDevices();
        openWizard({ step: 'connect', kind: wizard.kind, device: dev, key: dev.api_key, fresh: true });
      } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
    });
    setupBox.querySelector('#doneBtn')?.addEventListener('click', closeWizard);
    setupBox.querySelector('#guideReplaceKey')?.addEventListener('click', () => replaceKey(wizard.device));
  }

  // Poll the device list while this connect step is open, until the device
  // sends its first recording. Stops by itself when the setup closes, another
  // setup opens, or the page is left.
  function waitForFirstRecording() {
    const mine = wizard, deviceId = wizard.device.id;
    const tick = async () => {
      if (!el.isConnected || wizard !== mine) return;
      try {
        await loadDevices();
        if (wizard !== mine) return;
        const d = devices.find((x) => x.id === deviceId);
        if (!d) return;   // deleted meanwhile
        const status = setupBox.querySelector('#connStatus');
        if (status) status.innerHTML = connectionStatus(d);
        if (d.last_seen) {
          toast(`“${d.device_name}” is connected`, 'success');
          loadRecordings();
          return;
        }
      } catch { /* try again next tick */ }
      setTimeout(tick, POLL_MS);
    };
    setTimeout(tick, POLL_MS);
  }

  // ------------------------------------------------------------ device list

  async function loadDevices() {
    devices = await api('/devices');
    paintList();
  }

  function paintList() {
    addBtn.classList.toggle('hidden', !!wizard || !devices.length);
    if (!devices.length) {
      listBox.innerHTML = '';
      if (!wizard) openWizard({ step: 'choose' }, { scroll: false });   // already at the top
      return;
    }
    listBox.innerHTML = devices.map(card).join('');
    wireCards();
  }

  function card(d) {
    const k = KINDS[kindOf(d)];
    const pill = !d.last_seen
      ? '<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-[#8A6208] bg-[#FBF3E0] border border-[#EBD9AE] rounded-full px-2 py-0.5"><span class="w-1.5 h-1.5 rounded-full bg-[#C99A2E]"></span>Not connected yet</span>'
      : isOnline(d)
        ? '<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-brand-dark bg-brand-tint border border-brand/25 rounded-full px-2 py-0.5"><span class="w-1.5 h-1.5 rounded-full bg-brand"></span>Online</span>'
        : '<span class="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-ink-muted bg-page border border-line rounded-full px-2 py-0.5"><span class="w-1.5 h-1.5 rounded-full bg-ink-muted/50"></span>Offline</span>';
    const stats = d.recordings
      ? `<span class="font-semibold text-ink">${d.recordings}</span> recording${d.recordings === 1 ? '' : 's'} · ${esc(fmtDuration(d.total_seconds))}
         <div class="text-xs text-ink-muted mt-0.5">Latest ${esc(timeAgo(d.last_recording))}</div>`
      : d.last_seen
        ? `No recordings yet<div class="text-xs text-ink-muted mt-0.5">Last heard from ${esc(timeAgo(d.last_seen))}</div>`
        : 'No recordings yet<div class="text-xs text-ink-muted mt-0.5">Finish the setup to start receiving audio</div>';
    return `
      <div class="bg-white rounded-xl2 shadow-card p-5 flex flex-col" data-card="${d.id}">
        <div class="flex items-center gap-2.5 min-w-0 mb-3 nameArea">
          <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(k.icon, { size: 17 })}</span>
          <div class="min-w-0">
            <div class="font-semibold truncate">${esc(d.device_name)}</div>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
              <span class="text-xs text-ink-muted">${k.label}</span>${pill}
            </div>
          </div>
        </div>
        <div class="text-sm text-ink-secondary mb-1">${stats}</div>
        <div class="text-xs text-ink-muted mb-4">Key ends in <code>${esc(d.api_key.replace('…', ''))}</code> · added ${esc(fmtDate(d.created_at))}</div>
        <div class="flex flex-wrap gap-2 mt-auto">
          ${d.last_seen
            ? `<a href="#/library/device:${d.id}" class="${BTN_MAIN} !px-4 !py-2">${icon('search', { size: 15 })} View recordings</a>
               <button data-guide="${d.id}" class="${BTN_GHOST} !px-4 !py-2">${icon('helpCircle', { size: 15 })} Setup guide</button>`
            : `<button data-guide="${d.id}" class="${BTN_MAIN} !px-4 !py-2">${icon('arrowRight', { size: 15 })} Connect</button>`}
        </div>
        <div class="flex items-center gap-1 mt-3 pt-3 border-t border-line">
          <button data-rename="${d.id}" class="${BTN_SMALL}">${icon('pencil', { size: 13 })} Rename</button>
          <button data-rotate="${d.id}" class="${BTN_SMALL}" title="Issue a new key; the old one stops working">${icon('refresh', { size: 13 })} Replace key</button>
          <button data-delete="${d.id}" class="${BTN_SMALL} ml-auto hover:!bg-red-50 hover:text-red-600">${icon('trash', { size: 13 })} Delete</button>
        </div>
      </div>`;
  }

  function wireCards() {
    const byId = (id) => devices.find((d) => d.id === id);
    listBox.querySelectorAll('[data-guide]').forEach((b) => b.addEventListener('click', () => {
      const d = byId(b.dataset.guide);
      openWizard({ step: 'connect', kind: kindOf(d), device: d });
    }));
    listBox.querySelectorAll('[data-rotate]').forEach((b) => b.addEventListener('click', () => replaceKey(byId(b.dataset.rotate))));
    listBox.querySelectorAll('[data-rename]').forEach((b) => b.addEventListener('click', () => renameInline(byId(b.dataset.rename))));
    listBox.querySelectorAll('[data-delete]').forEach((b) => b.addEventListener('click', async () => {
      const d = byId(b.dataset.delete);
      if (!confirm(`Delete “${d.device_name}”?\n\nIts key stops working. Recordings it already sent stay in your Library.`)) return;
      try {
        await api(`/devices/${d.id}`, { method: 'DELETE' });
        toast('Device deleted', 'success');
        if (wizard?.device?.id === d.id) wizard = null;
        await loadDevices();
        paintSetup();
      } catch (e) { toast(e.message, 'error'); }
    }));
  }

  function renameInline(d) {
    const area = listBox.querySelector(`[data-card="${d.id}"] .nameArea`);
    area.innerHTML = `
      <form class="flex items-center gap-2 w-full">
        <input name="n" value="${esc(d.device_name)}" maxlength="64" required class="${INPUT} !py-2" aria-label="Device name">
        <button class="w-9 h-9 shrink-0 rounded-full bg-brand text-white grid place-items-center" aria-label="Save">${icon('check', { size: 15 })}</button>
        <button type="button" class="cancel w-9 h-9 shrink-0 rounded-full text-ink-muted hover:bg-page grid place-items-center" aria-label="Cancel">${icon('close', { size: 15 })}</button>
      </form>`;
    const form = area.querySelector('form');
    const input = form.elements.n;
    input.focus();
    input.select();
    form.querySelector('.cancel').addEventListener('click', paintList);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const next = input.value.trim();
      if (!next || next === d.device_name) { paintList(); return; }
      try {
        await api.json(`/devices/${d.id}`, 'PATCH', { device_name: next });
        toast('Device renamed', 'success');
        await loadDevices();
        loadRecordings();
      } catch (err) { toast(err.message, 'error'); }
    });
  }

  async function replaceKey(d) {
    if (!confirm(`Replace the key for “${d.device_name}”?\n\nThe current key stops working straight away. Whatever uses it — a script or an ESP32 — must be given the new key.`)) return;
    try {
      const dev = await api.json(`/devices/${d.id}`, 'PATCH', { regenerate_key: true });
      await loadDevices();
      openWizard({ step: 'connect', kind: kindOf(d), device: { ...d, ...dev }, key: dev.api_key, fresh: true, rotated: true });
    } catch (e) { toast(e.message, 'error'); }
  }

  // ------------------------------------------------------------ recordings

  async function loadRecordings() {
    const box = el.querySelector('#recordings');
    const data = await api('/audio?source=device&kind=recordings&per_page=10');
    if (!el.isConnected) return;
    if (!data.items.length) {
      box.innerHTML = `<div class="flex items-center gap-3 text-sm text-ink-muted py-2">
        ${icon('waveform', { size: 18 })} Nothing yet. Recordings show up here as soon as a device sends audio.</div>`;
      return;
    }
    const names = Object.fromEntries(devices.map((d) => [d.id, d.device_name]));
    box.innerHTML = `
      <div class="divide-y divide-line/60">
        ${data.items.map((f) => `
          <a href="#/audio/${f.id}" class="flex items-center gap-3 py-3 hover:bg-page/60 -mx-2 px-2 rounded-xl">
            <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon('device', { size: 16 })}</span>
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">${esc(f.verified_label || f.top_class?.class_name || 'Not classified yet')}</div>
              <div class="text-xs text-ink-muted truncate">${esc(names[f.device_id] || 'Removed device')} · ${fmtDuration(f.duration)} · ${fmtDate(f.recorded_at || f.uploaded_at)}</div>
            </div>
            ${f.status !== 'done' ? statusBadge(f.status) : ''}
          </a>`).join('')}
      </div>`;
  }

  await loadDevices();
  loadRecordings();
}

// The upload contract, for people writing their own client.
function developerNotes() {
  const steps = [
    ['mic', 'Record', 'A clip, or a ~10 s chunk in stream mode'],
    ['upload', 'Send', 'POST /ingest with the device key, a client id and a SHA-256'],
    ['check', 'Receipt', 'The server stores it and replies with the hash it received'],
    ['trash', 'Delete', 'The device deletes its copy only when the hashes match'],
  ];
  return `
    <details class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 group">
      <summary class="flex items-center justify-between gap-3 cursor-pointer list-none">
        <span><span class="font-semibold">For developers: how a device upload works</span>
          <span class="block text-xs text-ink-muted mt-0.5">Only needed if you are writing your own client</span></span>
        <span class="text-ink-muted transition-transform group-open:rotate-90">${icon('chevronRight', { size: 18 })}</span>
      </summary>
      <ol class="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4 mb-3">
        ${steps.map(([ic, title, text], i) => `
          <li class="flex gap-3 items-start bg-page rounded-xl p-3">
            <span class="w-8 h-8 rounded-full bg-white text-brand grid place-items-center shrink-0">${icon(ic, { size: 15 })}</span>
            <div class="min-w-0"><div class="text-sm font-medium">${i + 1}. ${title}</div>
              <div class="text-xs text-ink-secondary">${text}</div></div>
          </li>`).join('')}
      </ol>
      <p class="text-xs text-ink-muted">A failed upload is simply sent again; the server recognises repeats, so nothing is stored twice.
        Full reference: <a href="/docs" target="_blank" class="text-brand hover:underline">API documentation</a>.</p>
    </details>`;
}
