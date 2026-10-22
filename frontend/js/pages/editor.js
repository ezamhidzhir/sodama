// Sound editor — keep the part of a sound you need, label it, make it longer.
// #/edit/{id}    one of your own sounds
// #/sound/{id}   a sound from a public Community dataset (saved as a credited copy)
//
// The supervisor's example: an editor finds a 20 s Porsche, keeps 10 s,
// labels it, and extends it to 40 s for a scene.
import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, spinner, toast, INPUT } from '../ui.js';

const BTN = 'inline-flex items-center justify-center gap-2 px-5 py-3 rounded-full text-sm font-medium transition-colors';

const fmt = (sec) => {
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
};

export async function renderEditor(el, id, { community = false } = {}) {
  el.innerHTML = spinner();
  const [d, folders] = await Promise.all([
    api(community ? `/community/clips/${id}` : `/audio/${id}`),
    api('/datasets'),
  ]);
  const label = community ? d.label : (d.label || '');
  const playUrl = community ? d.url : d.download_url;

  el.innerHTML = `
    <a href="${community ? `#/community/${d.dataset.id}` : `#/audio/${id}`}"
       class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} ${community ? esc(d.dataset.name) : 'Back to the sound'}</a>

    <div class="mb-5">
      <h1 class="text-[1.35rem] sm:text-[1.6rem] font-bold tracking-tight">Edit sound</h1>
      <p class="text-sm text-ink-muted mt-1">
        ${community
          ? `“${esc(d.label)}” by <a href="#/u/${encodeURIComponent(d.author)}" class="text-brand hover:underline">@${esc(d.author)}</a>
             · ${esc(d.license_name || d.license || 'no licence')} — your copy keeps this credit`
          : `${esc(label || d.filename)} · ${fmtDuration(d.duration)}`}
      </p>
    </div>

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-3 mb-3">
        <button id="playSel" class="w-12 h-12 rounded-full bg-brand text-white hover:bg-brand-dark grid place-items-center shrink-0" aria-label="Play selection">
          ${icon('play', { size: 18, fill: true })}</button>
        <div class="text-sm">
          <div class="font-medium">Selection <span id="selRange" class="tabular-nums"></span></div>
          <div class="text-xs text-ink-muted">Drag the shaded area's edges, or drag across the waveform to select again</div>
        </div>
      </div>
      <div id="waveform"></div>
    </div>

    <form id="editForm" class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 space-y-4">
      <div>
        <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="labelIn">Label</label>
        <input id="labelIn" name="label" maxlength="60" ${community ? 'required' : ''}
               value="${esc(label)}" placeholder="What is this sound? e.g. Porsche 911 idle" class="${INPUT}">
      </div>

      <div class="rounded-xl2 border border-line p-4">
        <label class="flex items-center gap-2.5 text-sm font-medium">
          <input type="checkbox" id="extendOn"> Make it longer by looping</label>
        <div id="extendBox" class="hidden mt-3">
          <div class="flex flex-wrap items-center gap-3">
            <label class="text-sm text-ink-secondary">Length
              <input id="extendTo" type="number" min="1" max="600" step="1" value="40"
                     class="field bg-white border border-line rounded-full px-3 py-2 text-sm w-24 ml-2"> seconds</label>
            <span class="text-xs text-ink-muted" id="extendHint"></span>
          </div>
          <p class="text-xs text-ink-muted mt-2">The selection repeats with a short crossfade at each join. Looped sounds are
            marked <b>edited</b> and left out of training exports, because repeated audio makes a dataset look bigger than it is.</p>
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="folderIn">Save into folder</label>
        <select id="folderIn" class="${INPUT}">
          <option value="">No folder (Library only)</option>
          ${folders.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join('')}
        </select>
      </div>

      <button id="saveBtn" type="submit" class="${BTN} w-full bg-brand text-white hover:bg-brand-dark disabled:opacity-60">
        ${icon('check', { size: 16 })} <span>Save to my library</span></button>
      <p class="text-xs text-ink-muted text-center" id="saveHint"></p>
    </form>`;

  // ---- waveform with one selection region ----
  const ws = WaveSurfer.create({
    container: el.querySelector('#waveform'),
    url: playUrl,
    peaks: d.waveform && d.waveform.length ? [d.waveform] : undefined,
    duration: d.duration,
    height: 96,
    waveColor: '#C5D6B2',
    progressColor: '#4C7438',
    cursorColor: '#7A5239',
    barWidth: 2, barGap: 1.5, barRadius: 3,
  });
  const regions = ws.registerPlugin(WaveSurfer.Regions.create());
  let sel = null;
  const COLOR = 'rgba(76,116,56,0.22)';

  const paint = () => {
    const start = sel ? sel.start : 0, end = sel ? sel.end : d.duration;
    el.querySelector('#selRange').textContent = `${fmt(start)}–${fmt(end)} · ${(end - start).toFixed(1)} s`;
    const ext = el.querySelector('#extendTo');
    el.querySelector('#extendHint').textContent =
      `${Math.ceil(+ext.value / Math.max(0.1, end - start))}× the selection`;
    const extending = el.querySelector('#extendOn').checked;
    el.querySelector('#saveHint').textContent = community || extending
      ? 'Saved as a new file — it counts toward your storage allowance.'
      : 'Saved as a clip of the original — no extra storage used.';
  };

  const ready = () => {
    sel = regions.addRegion({ start: 0, end: d.duration, color: COLOR, drag: true, resize: true });
    regions.enableDragSelection({ color: COLOR });
    paint();
  };
  let isReady = false;
  const onceReady = () => { if (!isReady) { isReady = true; ready(); } };
  ws.once('decode', onceReady);
  ws.once('ready', onceReady);

  // Dragging a new selection replaces the old one: the editor keeps one stretch.
  regions.on('region-created', (r) => {
    if (sel && r !== sel) { sel.remove(); }
    sel = r;
    paint();
  });
  regions.on('region-updated', paint);

  const playBtn = el.querySelector('#playSel');
  playBtn.addEventListener('click', () => {
    if (ws.isPlaying()) { ws.pause(); return; }
    if (sel) sel.play(); else ws.play();
  });
  ws.on('play', () => { playBtn.innerHTML = icon('pause', { size: 18 }); });
  ws.on('pause', () => { playBtn.innerHTML = icon('play', { size: 18, fill: true }); });

  const extendOn = el.querySelector('#extendOn');
  extendOn.addEventListener('change', () => {
    el.querySelector('#extendBox').classList.toggle('hidden', !extendOn.checked);
    paint();
  });
  el.querySelector('#extendTo').addEventListener('input', paint);

  // ---- save ----
  el.querySelector('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const start = sel ? +sel.start.toFixed(3) : 0;
    const end = sel ? +sel.end.toFixed(3) : d.duration;
    const text = el.querySelector('#labelIn').value.trim();
    const folder = el.querySelector('#folderIn').value || null;
    const extendTo = extendOn.checked ? +el.querySelector('#extendTo').value : null;
    if (community && !text) { toast('Give the sound a label first', 'error'); return; }
    if (extendTo && extendTo <= end - start) {
      toast('The new length must be longer than the selection', 'error'); return;
    }
    const btn = el.querySelector('#saveBtn');
    btn.disabled = true;
    btn.querySelector('span').textContent = 'Saving…';
    const post = (path, body) => api(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    try {
      let newId;
      if (community) {
        newId = (await post(`/community/clips/${id}/save`, {
          start, end, label: text, loop_to: extendTo, dataset_id: folder })).id;
      } else if (extendTo) {
        newId = (await post(`/audio/${id}/loop`, {
          start, end, seconds: extendTo, label: text || null, dataset_id: folder })).id;
      } else {
        const res = await post(`/audio/${id}/clips`, {
          segments: [{ start, end }], replace_in_folders: false, dataset_id: folder });
        newId = res.clips[0].id;
        if (text) {
          await api(`/audio/${newId}/review`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ review_status: 'approved', verified_label: text }),
          });
        }
      }
      toast('Saved to your library', 'success');
      location.hash = `#/audio/${newId}`;
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Save to my library';
    }
  });
}
