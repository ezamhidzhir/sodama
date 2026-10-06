// Record — capture a sound on the phone, name it, file it into a folder.
//
// The flow is built for someone standing next to the sound source with one
// hand free: choose the folder once, then tap record / tap stop / tap a label
// chip / tap save, and repeat. Date, time, duration and location are filled in
// automatically; the only thing the person has to supply is what the sound is.
import { api, qs, upload } from '../api.js';
import { createFolderSheet } from '../folders.js';
import { icon } from '../icons.js';
import { Recorder, recordingSupported, describeDevice, getPosition, placeName } from '../recorder.js';
import { esc, fmtDuration, fmtDate, toast, playAudio, currentlyPlaying, setLeaveGuard, INPUT, TEXTAREA } from '../ui.js';

const MAX_SECONDS = 300;
const MIN_SECONDS = 0.5;
const POLL_MS = 2500;
const KEY_FOLDER = 'sodama.recordFolder';
const KEY_LOCATION = 'sodama.recordLocation';
const KEY_RECENT = 'sodama.recentLabels';

const store = {
  get: (k, d = null) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const pad = (n) => String(n).padStart(2, '0');
const clock = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}.${Math.floor((s % 1) * 10)}`;

export async function renderRecord(el) {
  const state = {
    stage: 'idle',                 // idle | recording | review | saving | saved
    folders: [],
    folderId: store.get(KEY_FOLDER),
    locationOn: store.get(KEY_LOCATION, true),
    loc: null,                     // { lat, lng, acc, name, error }
    take: null,                    // { blob, url, duration, startedAt }
    label: '',
    lastLabel: '',
    saved: null,
    rec: null,
  };

  el.innerHTML = `
    <div class="max-w-xl mx-auto">
      <div class="mb-4 sm:mb-5">
        <h1 class="text-[1.35rem] sm:text-[1.6rem] font-bold tracking-tight">Record a sound</h1>
        <p class="text-sm text-ink-muted mt-1">Capture it, name it, and it is saved into your folder with time and place attached.</p>
      </div>
      <div id="folderCard" class="bg-white rounded-xl2 shadow-card p-4 mb-3"></div>
      <div id="stage" class="bg-white rounded-xl3 shadow-card p-5 sm:p-6 mb-4"></div>
      <div id="recent"></div>
    </div>`;

  if (!recordingSupported()) {
    el.querySelector('#stage').innerHTML = `
      <div class="text-center py-6">
        <div class="w-14 h-14 rounded-full bg-accent-tint text-accent grid place-items-center mx-auto mb-3">${icon('alert', { size: 24 })}</div>
        <div class="font-semibold">Recording is not available here</div>
        <p class="text-sm text-ink-muted mt-1.5">This browser cannot access the microphone${location.protocol === 'http:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
          ? ' — microphones only work on <span class="font-medium">https://</span> pages' : ''}.
          You can still <a href="#/upload" class="text-brand hover:underline">upload audio files</a>.</p>
      </div>`;
  }

  const folder = () => state.folders.find((f) => f.id === state.folderId) || null;

  // Unsaved audio should not vanish because a thumb brushed the tab bar.
  const dirty = () => ['recording', 'review', 'saving'].includes(state.stage);
  setLeaveGuard(() => {
    if (dirty() && !confirm('Discard this recording? It has not been saved.')) return false;
    clearInterval(tick);
    state.rec?.cancel();          // release the microphone
    discardTake();
    return true;
  });
  window.onbeforeunload = () => (dirty() ? true : undefined);

  // ------------------------------------------------------------ folder card
  async function loadFolders() {
    state.folders = await api('/datasets');
    if (state.folderId && !folder()) state.folderId = null;
    paintFolder();
  }

  function paintFolder() {
    const f = folder();
    const card = el.querySelector('#folderCard');
    card.innerHTML = `
      <label class="block text-xs text-ink-muted mb-1.5" for="folderSel">Save recordings to</label>
      <div class="flex gap-2">
        <div class="relative flex-1 min-w-0">
          <span class="absolute left-4 top-1/2 -translate-y-1/2 text-brand pointer-events-none">${icon('folder', { size: 18 })}</span>
          <select id="folderSel" class="${INPUT} pl-11 appearance-none font-medium">
            <option value="">No folder (Library only)</option>
            ${state.folders.map((d) => `<option value="${d.id}" ${d.id === state.folderId ? 'selected' : ''}>${esc(d.name)} · ${d.item_count}</option>`).join('')}
          </select>
        </div>
        <button id="newFolderBtn" class="shrink-0 inline-flex items-center gap-1.5 px-4 rounded-full border border-line text-sm text-ink-secondary hover:border-brand hover:text-brand transition-colors" aria-label="New folder">
          ${icon('plus', { size: 16 })}<span class="hidden sm:inline">New folder</span></button>
      </div>
      ${f?.labels?.length ? `
        <div class="flex items-center gap-1.5 mt-2.5 overflow-x-auto no-scrollbar">
          <span class="text-xs text-ink-muted shrink-0">Classes</span>
          ${f.labels.map((l) => `<span class="shrink-0 text-xs px-2.5 py-1 rounded-full bg-page border border-line">${esc(l)}</span>`).join('')}
        </div>` : ''}
      ${!state.folders.length ? `<p class="text-xs text-ink-muted mt-2">Tip: create a folder such as “Car engines” so your recordings are grouped for training.</p>` : ''}`;

    card.querySelector('#folderSel').addEventListener('change', (e) => {
      state.folderId = e.target.value || null;
      store.set(KEY_FOLDER, state.folderId);
      paintFolder();
      if (state.stage === 'review') paintStage();
      loadRecent();
    });
    card.querySelector('#newFolderBtn').addEventListener('click', async () => {
      const ds = await createFolderSheet();
      if (!ds) return;
      state.folders.unshift(ds);
      state.folderId = ds.id;
      store.set(KEY_FOLDER, ds.id);
      paintFolder();
      if (state.stage === 'review') paintStage();
      loadRecent();
    });
  }

  // ------------------------------------------------------------ location
  function locationChip() {
    if (!state.locationOn) {
      return `<button id="locToggle" class="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border border-line text-ink-muted hover:border-brand hover:text-brand">
        ${icon('pin', { size: 14 })} Location off · tap to turn on</button>`;
    }
    const l = state.loc;
    const text = !l ? 'Location on' : l.error ? l.error : l.name || `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`;
    return `<button id="locToggle" class="inline-flex items-center gap-1.5 text-xs px-3 py-2 rounded-full border ${l?.error ? 'border-accent/40 text-accent' : 'border-brand/30 bg-brand-tint/60 text-brand-dark'} max-w-full">
      ${icon('pin', { size: 14 })}<span class="truncate">${esc(text)}</span><span class="text-ink-muted shrink-0">· turn off</span></button>`;
  }

  function wireLocationToggle(root) {
    root.querySelector('#locToggle')?.addEventListener('click', () => {
      state.locationOn = !state.locationOn;
      store.set(KEY_LOCATION, state.locationOn);
      if (!state.locationOn) state.loc = null;
      else locate();
      paintStage();
    });
  }

  async function locate() {
    if (!state.locationOn) return;
    try {
      const p = await getPosition();
      state.loc = { ...p, name: null };
      if (['idle', 'review', 'recording'].includes(state.stage)) paintLocationOnly();
      state.loc.name = await placeName(p.lat, p.lng);
    } catch (e) {
      state.loc = { error: e.message };
    }
    paintLocationOnly();
  }

  function paintLocationOnly() {
    const slot = el.querySelector('#locSlot');
    if (slot) { slot.innerHTML = locationChip(); wireLocationToggle(slot); }
    const meta = el.querySelector('#metaLoc');
    if (meta) meta.innerHTML = locText();
  }

  const locText = () => {
    const l = state.loc;
    if (!state.locationOn) return '<span class="text-ink-muted">Off</span>';
    if (!l) return '<span class="text-ink-muted">Finding…</span>';
    if (l.error) return `<span class="text-accent">${esc(l.error)}</span>`;
    return `${esc(l.name || `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`)}
      <span class="block text-[11px] text-ink-muted tabular-nums">±${Math.round(l.acc)} m</span>`;
  };

  // ------------------------------------------------------------ stages
  function paintStage() {
    const box = el.querySelector('#stage');
    if (!recordingSupported()) return;
    if (state.stage === 'idle') paintIdle(box);
    else if (state.stage === 'recording') paintRecording(box);
    else if (state.stage === 'review') paintReview(box);
    else if (state.stage === 'saving') paintSaving(box);
    else if (state.stage === 'saved') paintSaved(box);
  }

  function paintIdle(box) {
    box.innerHTML = `
      <div class="flex flex-col items-center text-center py-4">
        <button id="recBtn" class="relative w-32 h-32 rounded-full bg-brand text-white grid place-items-center shadow-lift hover:bg-brand-dark active:scale-95 transition"
                aria-label="Start recording">
          <span class="absolute inset-0 rounded-full ring-8 ring-brand/15"></span>
          ${icon('mic', { size: 44 })}
        </button>
        <div class="font-semibold text-lg mt-5">Tap to record</div>
        <p class="text-sm text-ink-muted mt-1 max-w-xs">Point the phone at the sound and keep it steady. Up to ${MAX_SECONDS / 60} minutes.</p>
        <div id="locSlot" class="mt-4 max-w-full">${locationChip()}</div>
      </div>`;
    wireLocationToggle(box);
    box.querySelector('#recBtn').addEventListener('click', startRecording);
  }

  let tick = null;
  function paintRecording(box) {
    box.innerHTML = `
      <div class="flex flex-col items-center text-center py-2">
        <div class="inline-flex items-center gap-2 text-sm font-medium text-accent-dark">
          <span class="relative flex w-2.5 h-2.5"><span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C4452E] opacity-60"></span><span class="relative inline-flex rounded-full w-2.5 h-2.5 bg-[#C4452E]"></span></span>
          Recording
        </div>
        <div id="timer" class="text-5xl font-bold tabular-nums tracking-tight mt-3">00:00.0</div>
        <div id="meter" class="flex items-end justify-center gap-[3px] h-16 mt-5 w-full max-w-xs" aria-hidden="true">
          ${Array.from({ length: 32 }, () => '<span class="w-1.5 rounded-full bg-brand/70" style="height:6%"></span>').join('')}
        </div>
        <div id="clipWarn" class="text-xs text-accent h-4 mt-2"></div>
        <button id="stopBtn" class="mt-4 w-24 h-24 rounded-full bg-[#C4452E] text-white grid place-items-center shadow-lift active:scale-95 transition" aria-label="Stop recording">
          ${icon('stop', { size: 34, fill: true })}
        </button>
        <button id="cancelRec" class="mt-4 text-sm text-ink-muted hover:text-accent py-2 px-4">Cancel</button>
        <div id="locSlot" class="mt-1 max-w-full">${locationChip()}</div>
      </div>`;
    wireLocationToggle(box);
    box.querySelector('#stopBtn').addEventListener('click', stopRecording);
    box.querySelector('#cancelRec').addEventListener('click', () => {
      clearInterval(tick);
      state.rec?.cancel();
      state.stage = 'idle';
      paintStage();
    });
  }

  function paintReview(box) {
    const f = folder();
    const recent = store.get(KEY_RECENT, []);
    const choices = [...new Set([...(f?.labels || []), ...recent])].slice(0, 16);
    const t = state.take;
    const isNew = state.label && f && !f.labels.some((l) => l.toLowerCase() === state.label.toLowerCase());

    box.innerHTML = `
      <div class="flex items-center gap-3 mb-4">
        <button id="previewPlay" class="w-12 h-12 rounded-full bg-brand text-white grid place-items-center shrink-0 hover:bg-brand-dark" aria-label="Play recording">
          ${icon('play', { size: 18, fill: true })}</button>
        <div id="previewWave" class="flex-1 min-w-0"></div>
      </div>

      <dl class="grid grid-cols-2 gap-2 text-sm mb-5">
        <div class="bg-page rounded-xl2 p-3"><dt class="text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-1">${icon('calendar', { size: 12 })} Date</dt>
          <dd class="font-medium mt-0.5">${t.startedAt.toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' })}</dd></div>
        <div class="bg-page rounded-xl2 p-3"><dt class="text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-1">${icon('clock', { size: 12 })} Time</dt>
          <dd class="font-medium mt-0.5">${t.startedAt.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</dd></div>
        <div class="bg-page rounded-xl2 p-3"><dt class="text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-1">${icon('waveform', { size: 12 })} Duration</dt>
          <dd class="font-medium mt-0.5 tabular-nums">${fmtDuration(t.duration)}</dd></div>
        <div class="bg-page rounded-xl2 p-3 min-w-0"><dt class="text-[11px] uppercase tracking-wider text-ink-muted flex items-center gap-1">${icon('pin', { size: 12 })} Location</dt>
          <dd class="font-medium mt-0.5 break-words" id="metaLoc">${locText()}</dd></div>
      </dl>
      ${t.peak < 0.01 ? `<div class="text-sm text-accent-dark bg-accent-tint/60 rounded-xl2 p-3 mb-4 flex gap-2">${icon('alert', { size: 16 })}<span>This recording is almost silent. Check the microphone isn't covered, then record again.</span></div>`
        : t.peak > 0.99 ? `<div class="text-sm text-accent-dark bg-accent-tint/60 rounded-xl2 p-3 mb-4 flex gap-2">${icon('alert', { size: 16 })}<span>The sound was too loud and clipped. Move a little further away if you can.</span></div>` : ''}

      <form id="labelForm">
        <label for="labelInput" class="block font-semibold mb-1">What is this sound?</label>
        <p class="text-xs text-ink-muted mb-2.5">Be specific — this is the label your model will learn, e.g. <span class="font-medium">Honda Civic</span> rather than “car”.</p>
        <input id="labelInput" name="label" maxlength="60" value="${esc(state.label)}" autocomplete="off" enterkeyhint="done"
               placeholder="Type a label" class="${INPUT} text-base font-medium">
        <div id="labelHint" class="text-xs mt-1.5 min-h-[1rem] ${isNew ? 'text-brand-dark' : 'text-ink-muted'}">
          ${isNew ? `New class — it will be added to “${esc(f.name)}”` : ''}</div>
        ${choices.length ? `
          <div class="flex flex-wrap gap-2 mt-2" id="chips">
            ${choices.map((c) => `
              <button type="button" data-label="${esc(c)}"
                      class="chip px-3.5 py-2 rounded-full border text-sm transition-colors
                             ${c.toLowerCase() === state.label.toLowerCase() ? 'bg-brand text-white border-brand' : 'bg-white border-line hover:border-brand hover:text-brand'}">${esc(c)}</button>`).join('')}
          </div>` : ''}

        <details class="mt-4 group">
          <summary class="text-sm text-ink-secondary cursor-pointer select-none py-1 inline-flex items-center gap-1.5">
            ${icon('pencil', { size: 14 })} Add a note <span class="text-ink-muted">(optional)</span></summary>
          <textarea name="notes" rows="2" maxlength="500" class="${TEXTAREA} mt-2"
                    placeholder="e.g. cold start, engine idling, about 3 m away"></textarea>
        </details>

        <div class="text-xs text-ink-muted mt-4 flex items-center gap-1.5">
          ${icon('folder', { size: 14 })} Saving to <span class="font-medium text-ink-secondary">${f ? esc(f.name) : 'Library (no folder)'}</span>
        </div>

        <button type="submit" class="mt-3 w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-3.5 font-semibold hover:bg-brand-dark transition-colors">
          ${icon('check', { size: 18 })} Save recording</button>
        <div class="grid grid-cols-2 gap-2 mt-2">
          <button type="button" id="againBtn" class="inline-flex items-center justify-center gap-1.5 border border-line rounded-full py-3 text-sm text-ink-secondary hover:border-brand hover:text-brand">
            ${icon('refresh', { size: 16 })} Record again</button>
          <button type="button" id="discardBtn" class="inline-flex items-center justify-center gap-1.5 border border-line rounded-full py-3 text-sm text-ink-secondary hover:border-accent hover:text-accent">
            ${icon('trash', { size: 16 })} Discard</button>
        </div>
      </form>`;

    // preview player
    const ws = WaveSurfer.create({
      container: box.querySelector('#previewWave'), url: t.url, height: 48,
      waveColor: '#C5D6B2', progressColor: '#4C7438', cursorColor: '#7A5239',
      barWidth: 2, barGap: 1.5, barRadius: 3,
    });
    const pb = box.querySelector('#previewPlay');
    pb.addEventListener('click', () => ws.playPause());
    ws.on('play', () => { pb.innerHTML = icon('pause', { size: 18 }); });
    ws.on('pause', () => { pb.innerHTML = icon('play', { size: 18, fill: true }); });
    ws.on('finish', () => { pb.innerHTML = icon('play', { size: 18, fill: true }); });
    state.preview = ws;

    const input = box.querySelector('#labelInput');
    const hint = box.querySelector('#labelHint');
    const syncChips = () => {
      state.label = input.value.trim();
      box.querySelectorAll('.chip').forEach((c) => {
        const on = c.dataset.label.toLowerCase() === state.label.toLowerCase() && state.label;
        c.className = c.className.replace(/bg-brand text-white border-brand|bg-white border-line hover:border-brand hover:text-brand/,
          on ? 'bg-brand text-white border-brand' : 'bg-white border-line hover:border-brand hover:text-brand');
      });
      const fresh = state.label && f && !f.labels.some((l) => l.toLowerCase() === state.label.toLowerCase());
      hint.textContent = fresh ? `New class — it will be added to “${f.name}”` : '';
      hint.className = `text-xs mt-1.5 min-h-[1rem] ${fresh ? 'text-brand-dark' : 'text-ink-muted'}`;
    };
    input.addEventListener('input', syncChips);
    box.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
      input.value = c.dataset.label;
      syncChips();
    }));

    box.querySelector('#againBtn').addEventListener('click', () => {
      if (!confirm('Record again? This take will be discarded.')) return;
      discardTake();
      startRecording();
    });
    box.querySelector('#discardBtn').addEventListener('click', () => {
      if (!confirm('Discard this recording?')) return;
      discardTake();
      state.stage = 'idle';
      paintStage();
    });
    box.querySelector('#labelForm').addEventListener('submit', (e) => {
      e.preventDefault();
      syncChips();
      if (!state.label && !confirm('Save without a label?\n\nYAMNet will suggest one, but you will need to review it before training.')) {
        input.focus();
        return;
      }
      save(new FormData(e.target).get('notes'));
    });
  }

  function paintSaving(box) {
    box.innerHTML = `
      <div class="py-8 text-center">
        <div class="font-semibold">Saving recording…</div>
        <div class="h-2 bg-page rounded-full mt-4 overflow-hidden max-w-xs mx-auto">
          <div id="saveBar" class="h-full bg-brand rounded-full transition-all" style="width:0%"></div>
        </div>
        <div id="savePct" class="text-sm text-ink-muted mt-2 tabular-nums">0%</div>
      </div>`;
  }

  function paintSaved(box) {
    const s = state.saved;
    box.innerHTML = `
      <div class="text-center py-3">
        <div class="w-16 h-16 rounded-full bg-brand-tint text-brand grid place-items-center mx-auto">${icon('checkCircle', { size: 30 })}</div>
        <div class="font-semibold text-lg mt-3">Saved${s.verified_label ? ` as “${esc(s.verified_label)}”` : ''}</div>
        <div class="text-sm text-ink-muted mt-1">${s.dataset ? `In ${esc(s.dataset.name)} · ` : ''}${fmtDuration(s.duration)}${s.location_name ? ` · ${esc(s.location_name)}` : ''}</div>
        <div id="yamnet" class="mt-4 text-sm bg-page rounded-xl2 px-4 py-3 inline-flex items-center gap-2 text-ink-secondary">
          ${icon('gear', { size: 15 })} YAMNet is listening to it…</div>
        <button id="nextBtn" class="mt-5 w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-3.5 font-semibold hover:bg-brand-dark">
          ${icon('mic', { size: 18 })} Record another${state.lastLabel ? ` “${esc(state.lastLabel)}”` : ''}</button>
        <a href="#/audio/${s.id}" class="mt-2 w-full inline-flex items-center justify-center gap-1.5 border border-line rounded-full py-3 text-sm text-ink-secondary hover:border-brand hover:text-brand">
          View clip ${icon('arrowRight', { size: 15 })}</a>
      </div>`;
    box.querySelector('#nextBtn').addEventListener('click', startRecording);
    pollYamnet(s.id);
  }

  async function pollYamnet(id) {
    try {
      const d = await api(`/audio/${id}`);
      const slot = el.querySelector('#yamnet');
      if (!slot || state.saved?.id !== id) return;
      if (d.status === 'done') {
        const top = d.top_classes[0];
        slot.innerHTML = top
          ? `${icon('waveform', { size: 15 })} YAMNet hears <span class="font-medium text-ink">${esc(top.class_name)}</span>
             <span class="text-ink-muted tabular-nums">${(top.mean_confidence * 100).toFixed(0)}%</span>`
          : `${icon('waveform', { size: 15 })} YAMNet found no clear class`;
      } else if (d.status === 'error') {
        slot.innerHTML = `${icon('alert', { size: 15 })} Automatic classification failed — your label is kept`;
      } else {
        setTimeout(() => pollYamnet(id), POLL_MS);
      }
    } catch { /* the page moved on */ }
  }

  // ------------------------------------------------------------ actions
  async function startRecording() {
    discardTake();
    const rec = new Recorder({ onLevel: meter });
    state.rec = rec;
    try {
      await rec.start();
    } catch (e) {
      const denied = e.name === 'NotAllowedError' || e.name === 'SecurityError';
      toast(denied ? 'Microphone permission was denied. Allow it in your browser settings, then try again.'
        : `Could not start the microphone: ${e.message}`, 'error');
      state.stage = 'idle';
      paintStage();
      return;
    }
    state.stage = 'recording';
    if (state.locationOn) { state.loc = null; locate(); }
    paintStage();
    const timer = el.querySelector('#timer');
    tick = setInterval(() => {
      if (!timer.isConnected) { clearInterval(tick); return; }
      timer.textContent = clock(rec.seconds);
      if (rec.seconds >= MAX_SECONDS) stopRecording();
    }, 100);
  }

  let bars = 0;
  function meter(rms, peak) {
    const m = el.querySelector('#meter');
    if (!m) return;
    const kids = m.children;
    const h = Math.min(100, Math.max(6, Math.sqrt(rms) * 220));
    kids[bars % kids.length].style.height = `${h}%`;
    bars++;
    if (peak > 0.99) el.querySelector('#clipWarn').textContent = 'Too loud — move back a little';
  }

  async function stopRecording() {
    clearInterval(tick);
    const rec = state.rec;
    if (!rec || state.stage !== 'recording') return;
    state.stage = 'processing';
    const take = await rec.stop();
    if (take.duration < MIN_SECONDS) {
      toast('That was too short — hold record a little longer.', 'error');
      state.stage = 'idle';
      paintStage();
      return;
    }
    state.take = { ...take, url: URL.createObjectURL(take.blob) };
    state.label = state.lastLabel;     // batch recording: same class again by default
    state.stage = 'review';
    paintStage();
    navigator.vibrate?.(30);
  }

  function discardTake() {
    state.preview?.destroy();
    state.preview = null;
    if (state.take?.url) URL.revokeObjectURL(state.take.url);
    state.take = null;
  }

  async function save(notes) {
    const t = state.take;
    const form = new FormData();
    form.append('file', t.blob, 'recording.wav');
    if (state.label) form.append('label', state.label);
    if (state.folderId) form.append('dataset_id', state.folderId);
    form.append('recorded_at', t.startedAt.toISOString());
    form.append('recording_device', describeDevice());
    if (notes?.trim()) form.append('notes', notes.trim());
    const l = state.loc;
    if (state.locationOn && l && !l.error) {
      form.append('latitude', l.lat);
      form.append('longitude', l.lng);
      form.append('location_accuracy', Math.round(l.acc));
      if (l.name) form.append('location_name', l.name);
    }

    state.stage = 'saving';
    state.preview?.pause();
    paintStage();
    try {
      const row = await upload('/recordings', form, (pct) => {
        const bar = el.querySelector('#saveBar');
        if (!bar) return;
        bar.style.width = `${pct}%`;
        el.querySelector('#savePct').textContent = pct < 100 ? `Uploading ${pct}%` : 'Processing on the server…';
      });
      if (state.label) {
        state.lastLabel = row.verified_label || state.label;
        store.set(KEY_RECENT, [state.lastLabel, ...store.get(KEY_RECENT, [])
          .filter((x) => x.toLowerCase() !== state.lastLabel.toLowerCase())].slice(0, 8));
      }
      discardTake();
      state.saved = row;
      state.stage = 'saved';
      paintStage();
      toast('Recording saved', 'success');
      loadFolders();            // counts and any newly added class
      loadRecent();
    } catch (e) {
      toast(e.message, 'error');
      state.stage = 'review';   // keep the take so nothing is lost
      paintStage();
    }
  }

  // ------------------------------------------------------------ recent list
  async function loadRecent() {
    const box = el.querySelector('#recent');
    const data = await api('/audio' + qs({ source: 'recording', dataset_id: state.folderId, per_page: 5 }))
      .catch(() => null);
    if (!data?.items.length) { box.innerHTML = ''; return; }
    const f = folder();
    box.innerHTML = `
      <div class="flex items-center justify-between mb-2 px-1">
        <div class="font-semibold text-sm">Recent recordings${f ? ` in ${esc(f.name)}` : ''}</div>
        <a href="#/library" class="text-xs text-brand hover:underline">See all</a>
      </div>
      <div class="bg-white rounded-xl2 shadow-card divide-y divide-line/60">
        ${data.items.map((r) => `
          <div class="flex items-center gap-3 p-3">
            <button class="recPlay w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0" data-id="${r.id}" aria-label="Play">
              ${icon('play', { size: 14, fill: true })}</button>
            <a href="#/audio/${r.id}" class="min-w-0 flex-1">
              <div class="font-medium truncate">${esc(r.verified_label || r.top_class?.class_name || 'Unlabelled')}</div>
              <div class="text-xs text-ink-muted truncate">${fmtDuration(r.duration)} · ${fmtDate(r.recorded_at || r.uploaded_at)}${r.location_name ? ` · ${esc(r.location_name)}` : ''}</div>
            </a>
          </div>`).join('')}
      </div>`;
    const urls = {};
    const repaint = () => box.querySelectorAll('.recPlay').forEach((b) => {
      const on = b.dataset.id === currentlyPlaying();
      b.innerHTML = icon(on ? 'pause' : 'play', { size: 14, fill: !on });
    });
    box.querySelectorAll('.recPlay').forEach((b) => b.addEventListener('click', async () => {
      const id = b.dataset.id;
      urls[id] ??= (await api(`/audio/${id}`)).download_url;
      playAudio(id, urls[id], repaint);
    }));
  }

  paintStage();
  if (state.locationOn && recordingSupported()) locate();
  await loadFolders();
  loadRecent();
}
