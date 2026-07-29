import { api, qs } from '../api.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, emptyState, toast, playAudio, currentlyPlaying } from '../ui.js';

const state = { page: 1, per_page: 15, filters: {} };

export async function renderLibrary(el) {
  el.innerHTML = `
    <div class="flex items-center justify-between mb-6">
      <h1 class="text-2xl font-bold">Library</h1>
      <a href="#/upload" class="bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark">⬆️ Upload</a>
    </div>

    <form id="filters" class="bg-white rounded-xl border border-grid p-4 mb-4 grid grid-cols-2 lg:grid-cols-6 gap-3 text-sm">
      <div class="col-span-2">
        <label class="block text-xs text-ink-muted mb-1">Class</label>
        <input name="class_name" list="classList" placeholder="e.g. Speech"
               class="w-full border border-grid rounded-lg px-3 py-2 focus:outline-none focus:border-brand">
        <datalist id="classList"></datalist>
      </div>
      <div>
        <label class="block text-xs text-ink-muted mb-1">Min confidence</label>
        <input name="min_confidence" type="number" min="0" max="1" step="0.05" placeholder="0.5"
               class="w-full border border-grid rounded-lg px-3 py-2 focus:outline-none focus:border-brand">
      </div>
      <div>
        <label class="block text-xs text-ink-muted mb-1">Source</label>
        <select name="source" class="w-full border border-grid rounded-lg px-3 py-2 bg-white">
          <option value="">All</option><option value="upload">Upload</option><option value="esp32">ESP32</option>
        </select>
      </div>
      <div>
        <label class="block text-xs text-ink-muted mb-1">From</label>
        <input name="date_from" type="date" class="w-full border border-grid rounded-lg px-3 py-2">
      </div>
      <div>
        <label class="block text-xs text-ink-muted mb-1">To</label>
        <input name="date_to" type="date" class="w-full border border-grid rounded-lg px-3 py-2">
      </div>
      <div class="col-span-2 lg:col-span-6 flex gap-2 justify-end">
        <button type="button" id="clearBtn" class="px-4 py-2 rounded-lg border border-grid hover:bg-gray-50">Clear</button>
        <button type="submit" class="px-4 py-2 rounded-lg bg-brand text-white hover:bg-brand-dark">Apply filters</button>
      </div>
    </form>

    <div id="bulkbar" class="hidden items-center gap-3 bg-brand-light/40 border border-brand/30 rounded-xl px-4 py-2.5 mb-3 text-sm">
      <span id="selCount" class="font-medium"></span>
      <select id="dsSelect" class="border border-grid rounded-lg px-3 py-1.5 bg-white"></select>
      <button id="addToDs" class="bg-brand text-white px-3 py-1.5 rounded-lg hover:bg-brand-dark">Add to dataset</button>
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

  const data = await api('/audio' + qs({ ...state.filters, page: state.page, per_page: state.per_page }));
  if (!data.items.length) {
    results.innerHTML = emptyState('🔍', 'No audio found',
      Object.keys(state.filters).some((k) => state.filters[k]) ? 'Try loosening the filters' : 'Upload some audio to get started');
    return;
  }

  const pages = Math.max(1, Math.ceil(data.total / state.per_page));
  results.innerHTML = `
    <div class="bg-white rounded-xl border border-grid overflow-hidden">
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-ink-muted border-b border-grid bg-gray-50/60">
          <th class="p-3 w-8"><input type="checkbox" id="selAll" class="accent-brand"></th>
          <th class="p-3 w-10"></th>
          <th class="p-3 font-medium">File</th>
          <th class="p-3 font-medium">Top class</th>
          <th class="p-3 font-medium">Duration</th>
          <th class="p-3 font-medium">Source</th>
          <th class="p-3 font-medium">Status</th>
          <th class="p-3 font-medium">Uploaded</th>
        </tr></thead>
        <tbody>${data.items.map((f) => `
          <tr class="border-b border-grid/60 last:border-0 hover:bg-gray-50">
            <td class="p-3"><input type="checkbox" class="rowSel accent-brand" value="${f.id}"></td>
            <td class="p-3">
              <button class="playBtn w-8 h-8 rounded-full bg-brand-light/60 text-brand hover:bg-brand hover:text-white transition-colors"
                      data-id="${f.id}" title="Play / pause">▶</button>
            </td>
            <td class="p-3"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
            <td class="p-3">${f.top_class
              ? `${esc(f.top_class.class_name)} <span class="text-xs text-ink-muted tabular-nums">${(f.top_class.confidence * 100).toFixed(0)}%</span>`
              : '<span class="text-ink-muted">—</span>'}</td>
            <td class="p-3 tabular-nums">${fmtDuration(f.duration)}</td>
            <td class="p-3">${sourceBadge(f.source)}</td>
            <td class="p-3">${statusBadge(f.status)}</td>
            <td class="p-3 text-ink-secondary whitespace-nowrap">${fmtDate(f.uploaded_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
    <div class="flex items-center justify-between mt-4 text-sm text-ink-secondary">
      <div>${data.total} file${data.total === 1 ? '' : 's'} · page ${state.page} of ${pages}</div>
      <div class="flex gap-2">
        <button id="prevBtn" class="px-3 py-1.5 rounded-lg border border-grid disabled:opacity-40 hover:bg-gray-50" ${state.page <= 1 ? 'disabled' : ''}>← Prev</button>
        <button id="nextBtn" class="px-3 py-1.5 rounded-lg border border-grid disabled:opacity-40 hover:bg-gray-50" ${state.page >= pages ? 'disabled' : ''}>Next →</button>
      </div>
    </div>`;

  results.querySelector('#prevBtn').addEventListener('click', () => { state.page--; loadResults(el); });
  results.querySelector('#nextBtn').addEventListener('click', () => { state.page++; loadResults(el); });

  // inline playback — signed URL fetched on first play
  const urlCache = {};
  results.querySelectorAll('.playBtn').forEach((btn) => btn.addEventListener('click', async () => {
    const id = btn.dataset.id;
    if (!urlCache[id]) {
      btn.textContent = '…';
      try { urlCache[id] = (await api(`/audio/${id}`)).download_url; }
      catch (e) { toast(e.message, 'error'); btn.textContent = '▶'; return; }
    }
    playAudio(id, urlCache[id], () => {
      results.querySelectorAll('.playBtn').forEach((b) => {
        b.textContent = b.dataset.id === currentlyPlaying() ? '⏸' : '▶';
      });
    });
  }));

  // bulk add-to-dataset
  const bulkbar = el.querySelector('#bulkbar');
  const refreshBulk = () => {
    const sel = [...results.querySelectorAll('.rowSel:checked')];
    bulkbar.classList.toggle('hidden', !sel.length);
    bulkbar.classList.toggle('flex', !!sel.length);
    el.querySelector('#selCount').textContent = `${sel.length} selected`;
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
    if (!dsSelect.value) { toast('Create a dataset first (Datasets page)', 'error'); return; }
    try {
      const r = await api(`/datasets/${dsSelect.value}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audio_file_ids: ids }),
      });
      toast(`Added ${r.added} file(s) to dataset`, 'success');
      results.querySelectorAll('.rowSel:checked').forEach((c) => { c.checked = false; });
      refreshBulk();
    } catch (e) { toast(e.message, 'error'); }
  };
}
