import { api, qs } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, emptyState, toast, playAudio, currentlyPlaying, pageHeader, linkPrimary } from '../ui.js';

const state = { page: 1, per_page: 15, filters: {} };
const INPUT = 'field w-full bg-white border border-line rounded-full px-4 py-2.5 text-sm transition-shadow';

export async function renderLibrary(el) {
  el.innerHTML = `
    ${pageHeader('Library', 'Search and filter your audio collection.',
      linkPrimary('Upload audio', 'upload', '#/upload'))}

    <form id="filters" class="bg-white rounded-xl2 shadow-card p-5 mb-4">
      <div class="grid grid-cols-2 lg:grid-cols-6 gap-3">
        <div class="col-span-2">
          <label class="block text-xs text-ink-muted mb-1.5">Class</label>
          <input name="class_name" list="classList" placeholder="e.g. Speech" class="${INPUT}">
          <datalist id="classList"></datalist>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Min confidence</label>
          <input name="min_confidence" type="number" min="0" max="1" step="0.05" placeholder="0.50" class="${INPUT}">
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Source</label>
          <select name="source" class="${INPUT}">
            <option value="">All sources</option><option value="upload">Upload</option><option value="esp32">ESP32</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">From</label>
          <input name="date_from" type="date" class="${INPUT}">
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">To</label>
          <input name="date_to" type="date" class="${INPUT}">
        </div>
      </div>
      <div class="flex gap-2.5 justify-end mt-4">
        <button type="button" id="clearBtn"
                class="px-5 py-2.5 rounded-full border border-line text-sm text-ink-secondary hover:border-accent hover:text-accent transition-colors">
          Clear
        </button>
        <button type="submit"
                class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-brand text-white text-sm hover:bg-brand-dark transition-colors">
          ${icon('search', { size: 16 })} Apply filters
        </button>
      </div>
    </form>

    <div id="bulkbar" class="hidden flex-wrap items-center gap-3 bg-brand-tint border border-brand/25 rounded-2xl px-5 py-3 mb-4 text-sm">
      <span id="selCount" class="font-medium"></span>
      <select id="dsSelect" class="field bg-white border border-line rounded-full px-4 py-2 text-sm"></select>
      <button id="addToDs" class="inline-flex items-center gap-1.5 bg-brand text-white px-4 py-2 rounded-full hover:bg-brand-dark transition-colors">
        ${icon('plus', { size: 15 })} Add to dataset
      </button>
      <button id="deleteSel" class="inline-flex items-center gap-1.5 bg-white border border-red-200 text-red-600 px-4 py-2 rounded-full hover:bg-red-50 transition-colors ml-auto">
        ${icon('trash', { size: 15 })} Delete selected
      </button>
    </div>

    <div id="results"></div>`;

  const form = el.querySelector('#filters');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.filters = Object.fromEntries(new FormData(form));
    state.page = 1;
    loadResults(el);
  });
  el.querySelector('#clearBtn').addEventListener('click', () => {
    form.reset(); state.filters = {}; state.page = 1; loadResults(el);
  });

  // restore previous filters when navigating back from detail
  Object.entries(state.filters).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v; });

  api('/stats').then((s) => {
    el.querySelector('#classList').innerHTML =
      s.class_distribution.map((c) => `<option value="${esc(c.class_name)}">`).join('');
  }).catch(() => {});

  loadResults(el);
}

async function loadResults(el) {
  const results = el.querySelector('#results');
  results.innerHTML = spinner();

  // the rows (and their checkboxes) are about to be replaced
  const bar = el.querySelector('#bulkbar');
  bar.classList.add('hidden');
  bar.classList.remove('flex');

  const data = await api('/audio' + qs({ ...state.filters, page: state.page, per_page: state.per_page }));
  if (!data.items.length) {
    results.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState('search', 'No audio found',
      Object.values(state.filters).some(Boolean) ? 'Try loosening the filters' : 'Upload some audio to get started')}</div>`;
    return;
  }

  const pages = Math.max(1, Math.ceil(data.total / state.per_page));
  results.innerHTML = `
    <div class="bg-white rounded-xl2 shadow-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[860px]">
          <thead><tr class="text-left text-xs text-ink-muted border-b border-line bg-page/50">
            <th class="p-4 w-8"><input type="checkbox" id="selAll" class="accent-[#4C7438] w-4 h-4"></th>
            <th class="p-4 w-10"></th>
            <th class="p-4 font-medium">File</th>
            <th class="p-4 font-medium">Top class</th>
            <th class="p-4 font-medium">Duration</th>
            <th class="p-4 font-medium">Source</th>
            <th class="p-4 font-medium">Status</th>
            <th class="p-4 font-medium">Uploaded</th>
            <th class="p-4 w-12"></th>
          </tr></thead>
          <tbody>${data.items.map((f) => `
            <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
              <td class="p-4"><input type="checkbox" class="rowSel accent-[#4C7438] w-4 h-4" value="${f.id}"></td>
              <td class="p-4">
                <button class="playBtn w-9 h-9 rounded-full bg-page text-brand hover:bg-brand hover:text-white transition-colors grid place-items-center"
                        data-id="${f.id}" title="Play or pause" aria-label="Play ${esc(f.filename)}">${icon('play', { size: 14, fill: true })}</button>
              </td>
              <td class="p-4"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
              <td class="p-4">${f.top_class
                ? `${esc(f.top_class.class_name)} <span class="text-xs text-ink-muted tabular-nums">${(f.top_class.confidence * 100).toFixed(0)}%</span>`
                : '<span class="text-ink-muted">—</span>'}</td>
              <td class="p-4 tabular-nums">${fmtDuration(f.duration)}</td>
              <td class="p-4">${sourceBadge(f.source)}</td>
              <td class="p-4">${statusBadge(f.status)}</td>
              <td class="p-4 text-ink-secondary whitespace-nowrap">${fmtDate(f.uploaded_at)}</td>
              <td class="p-4">
                <button class="delBtn w-8 h-8 rounded-full text-ink-muted hover:bg-red-50 hover:text-red-600 transition-colors grid place-items-center"
                        data-id="${f.id}" data-name="${esc(f.filename)}" title="Delete this file" aria-label="Delete ${esc(f.filename)}">
                  ${icon('trash', { size: 15 })}
                </button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="flex items-center justify-between mt-4 text-sm text-ink-secondary">
      <div>${data.total} file${data.total === 1 ? '' : 's'} · page ${state.page} of ${pages}</div>
      <div class="flex gap-2">
        <button id="prevBtn" class="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-line bg-white disabled:opacity-40 hover:border-brand hover:text-brand transition-colors" ${state.page <= 1 ? 'disabled' : ''}>
          ${icon('chevronLeft', { size: 15 })} Previous</button>
        <button id="nextBtn" class="inline-flex items-center gap-1 px-4 py-2 rounded-full border border-line bg-white disabled:opacity-40 hover:border-brand hover:text-brand transition-colors" ${state.page >= pages ? 'disabled' : ''}>
          Next ${icon('chevronRight', { size: 15 })}</button>
      </div>
    </div>`;

  results.querySelector('#prevBtn').addEventListener('click', () => { state.page--; loadResults(el); });
  results.querySelector('#nextBtn').addEventListener('click', () => { state.page++; loadResults(el); });

  // inline playback — signed URL fetched on first play
  const urlCache = {};
  const repaintPlay = () => results.querySelectorAll('.playBtn').forEach((b) => {
    b.innerHTML = icon(b.dataset.id === currentlyPlaying() ? 'pause' : 'play',
                       { size: 14, fill: b.dataset.id !== currentlyPlaying() });
  });
  results.querySelectorAll('.playBtn').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    if (!urlCache[id]) {
      btn.innerHTML = icon('clock', { size: 14 });
      try { urlCache[id] = (await api(`/audio/${id}`)).download_url; }
      catch (e) { toast(e.message, 'error'); repaintPlay(); return; }
    }
    playAudio(id, urlCache[id], repaintPlay);
  }));

  // delete a single row
  results.querySelectorAll('.delBtn').forEach((btn) => btn.addEventListener('click', async () => {
    const { id, name } = btn.dataset;
    if (!confirm(`Delete "${name}" permanently?\n\nIts classifications and dataset links are removed too. This cannot be undone.`)) return;
    btn.disabled = true;
    try {
      await api(`/audio/${id}`, { method: 'DELETE' });
      toast('Audio file deleted', 'success');
      loadResults(el);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }));

  // bulk add-to-dataset / delete
  const bulkbar = el.querySelector('#bulkbar');
  const refreshBulk = () => {
    const sel = [...results.querySelectorAll('.rowSel:checked')];
    bulkbar.classList.toggle('hidden', !sel.length);
    bulkbar.classList.toggle('flex', !!sel.length);
    el.querySelector('#selCount').textContent = `${sel.length} file${sel.length === 1 ? '' : 's'} selected`;
  };
  results.querySelectorAll('.rowSel').forEach((c) => c.addEventListener('change', refreshBulk));
  results.querySelector('#selAll').addEventListener('change', (e) => {
    results.querySelectorAll('.rowSel').forEach((c) => { c.checked = e.target.checked; });
    refreshBulk();
  });

  const dsSelect = el.querySelector('#dsSelect');
  api('/datasets').then((ds) => {
    dsSelect.innerHTML = ds.length
      ? ds.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')
      : '<option value="">No datasets — create one first</option>';
  });
  el.querySelector('#addToDs').onclick = async () => {
    const ids = [...results.querySelectorAll('.rowSel:checked')].map((c) => c.value);
    if (!dsSelect.value) { toast('Create a dataset first on the Datasets page', 'error'); return; }
    try {
      const r = await api(`/datasets/${dsSelect.value}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_file_ids: ids }),
      });
      toast(`Added ${r.added} file${r.added === 1 ? '' : 's'} to the dataset`, 'success');
      results.querySelectorAll('.rowSel:checked').forEach((c) => { c.checked = false; });
      refreshBulk();
    } catch (e) { toast(e.message, 'error'); }
  };

  el.querySelector('#deleteSel').onclick = async () => {
    const ids = [...results.querySelectorAll('.rowSel:checked')].map((c) => c.value);
    if (!confirm(`Delete ${ids.length} file${ids.length === 1 ? '' : 's'} permanently?\n\n`
                 + 'Their classifications and dataset links are removed too. This cannot be undone.')) return;

    const outcomes = await Promise.allSettled(
      ids.map((id) => api(`/audio/${id}`, { method: 'DELETE' })));
    const failed = outcomes.filter((r) => r.status === 'rejected').length;

    if (failed) toast(`Deleted ${ids.length - failed} of ${ids.length}; ${failed} failed`, 'error');
    else toast(`Deleted ${ids.length} file${ids.length === 1 ? '' : 's'}`, 'success');

    state.page = 1;  // the current page may no longer exist
    loadResults(el);
  };
}
