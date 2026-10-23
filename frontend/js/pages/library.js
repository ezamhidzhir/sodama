import { api, qs } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, reviewBadge, spinner, emptyState, toast,
         playAudio, currentlyPlaying, pageHeader, INPUT } from '../ui.js';

// `review` is kept out of `filters` because the filter form is rebuilt wholesale
// on submit, which would wipe a tab chosen above it.
const state = { page: 1, per_page: 15, filters: {}, review: '', showFilters: false };

const TABS = [
  { key: '', label: 'All' },
  { key: 'unreviewed', label: 'Needs review' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];

const TAB_ON = 'bg-brand text-white border-brand';
const TAB_OFF = 'bg-white border-line text-ink-secondary hover:border-brand hover:text-brand';

export async function renderLibrary(el, arg) {
  // #/library/device:<id> — opened from a device card: show that device's audio.
  if (arg?.startsWith('device:')) {
    state.filters = { device_id: arg.slice('device:'.length) };
    state.review = '';
    state.page = 1;
    state.showFilters = true;
  }
  el.innerHTML = `
    ${pageHeader('Library', 'Search your collection, then confirm or correct each label.',
      `<a href="#/record" class="hidden sm:inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">${icon('mic', { size: 16 })} Record</a>
       <a href="#/upload" class="hidden sm:inline-flex items-center gap-2 bg-white border border-line text-ink-secondary text-sm px-5 py-2.5 rounded-full hover:border-brand hover:text-brand transition-colors">${icon('upload', { size: 16 })} Upload</a>`)}

    <form id="searchForm" class="flex gap-2 mb-3">
      <div class="relative flex-1">
        <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none">${icon('search', { size: 17 })}</span>
        <input name="q" type="search" enterkeyhint="search" placeholder="Search label, file name or place"
               value="${esc(state.filters.q || '')}" class="${INPUT} pl-11">
      </div>
      <button type="button" id="filterToggle" class="shrink-0 inline-flex items-center gap-1.5 px-4 rounded-full border text-sm transition-colors
              ${state.showFilters ? TAB_ON : TAB_OFF}" aria-expanded="${state.showFilters}">
        ${icon('filter', { size: 16 })}<span class="hidden sm:inline">Filters</span><span id="filterCount" class="text-xs"></span></button>
    </form>

    <form id="filters" class="${state.showFilters ? '' : 'hidden'} bg-white rounded-xl2 shadow-card p-4 sm:p-5 mb-3">
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div class="col-span-2">
          <label class="block text-xs text-ink-muted mb-1.5">Folder</label>
          <select name="dataset_id" id="folderFilter" class="${INPUT}"><option value="">All folders</option></select>
        </div>
        <div class="col-span-2">
          <label class="block text-xs text-ink-muted mb-1.5">YAMNet class</label>
          <input name="class_name" list="classList" placeholder="e.g. Vehicle" class="${INPUT}">
          <datalist id="classList"></datalist>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Min confidence</label>
          <input name="min_confidence" type="number" inputmode="decimal" min="0" max="1" step="0.05" placeholder="0.50" class="${INPUT}">
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Source</label>
          <select name="source" class="${INPUT}">
            <option value="">All sources</option><option value="recording">Recorded</option>
            <option value="upload">Upload</option><option value="device">Device</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Device</label>
          <select name="device_id" id="deviceFilter" class="${INPUT}"><option value="">All devices</option></select>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Show</label>
          <select name="kind" class="${INPUT}">
            <option value="">Recordings and clips</option>
            <option value="recordings">Whole recordings</option>
            <option value="clips">Clips only</option>
          </select>
        </div>
        <div>
          <label class="block text-xs text-ink-muted mb-1.5">Length (seconds)</label>
          <div class="flex gap-2">
            <input name="min_duration" type="number" inputmode="decimal" min="0" step="0.5" placeholder="min" class="${INPUT}">
            <input name="max_duration" type="number" inputmode="decimal" min="0" step="0.5" placeholder="max" class="${INPUT}">
          </div>
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
          ${icon('search', { size: 16 })} Apply
        </button>
      </div>
    </form>

    <div class="flex gap-2 mb-4 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0" id="reviewTabs">
      ${TABS.map((t) => `
        <button data-review="${t.key}"
                class="tab shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-colors
                       ${t.key === state.review ? TAB_ON : TAB_OFF}">
          ${esc(t.label)}<span class="tabCount text-xs opacity-70 tabular-nums" data-review="${t.key}"></span>
        </button>`).join('')}
    </div>

    <div id="bulkbar" class="hidden fixed lg:static inset-x-3 bottom-[5.5rem] z-30 flex-wrap items-center gap-2 bg-brand-tint border border-brand/25 rounded-2xl px-4 py-3 mb-4 text-sm shadow-lift lg:shadow-none">
      <span id="selCount" class="font-medium w-full sm:w-auto"></span>
      <button id="approveSel" class="inline-flex items-center gap-1.5 bg-brand text-white px-4 py-2 rounded-full hover:bg-brand-dark transition-colors"
              title="Accept each file's own label">
        ${icon('check', { size: 15 })} Approve</button>
      <select id="dsSelect" class="field bg-white border border-line rounded-full px-3 py-2 text-sm max-w-[10rem]"></select>
      <button id="addToDs" class="inline-flex items-center gap-1.5 bg-white border border-line px-3.5 py-2 rounded-full hover:border-brand hover:text-brand transition-colors">
        ${icon('plus', { size: 15 })} Add</button>
      <button id="mergeSel" class="inline-flex items-center gap-1.5 bg-white border border-line px-3.5 py-2 rounded-full hover:border-brand hover:text-brand transition-colors"
              title="Join the selected sounds into one, in list order">
        ${icon('waveform', { size: 15 })} Merge</button>
      <button id="deleteSel" class="inline-flex items-center gap-1.5 bg-white border border-red-200 text-red-600 px-3.5 py-2 rounded-full hover:bg-red-50 transition-colors sm:ml-auto" aria-label="Delete selected">
        ${icon('trash', { size: 15 })}<span class="hidden sm:inline">Delete</span></button>
    </div>

    <div id="results"></div>`;

  const form = el.querySelector('#filters');
  const search = el.querySelector('#searchForm');
  const readFilters = () => {
    state.filters = { ...Object.fromEntries(new FormData(form)), q: search.elements.q.value.trim() };
    state.page = 1;
    paintFilterCount(el);
    loadResults(el);
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); readFilters(); });
  search.addEventListener('submit', (e) => { e.preventDefault(); search.elements.q.blur(); readFilters(); });
  search.elements.q.addEventListener('search', readFilters);   // the × in a search field
  el.querySelector('#filterToggle').addEventListener('click', (e) => {
    state.showFilters = !state.showFilters;
    form.classList.toggle('hidden', !state.showFilters);
    e.currentTarget.className = e.currentTarget.className.replace(state.showFilters ? TAB_OFF : TAB_ON, state.showFilters ? TAB_ON : TAB_OFF);
  });
  el.querySelector('#clearBtn').addEventListener('click', () => {
    form.reset(); search.reset(); state.filters = {}; state.page = 1;
    paintFilterCount(el); loadResults(el);
  });

  el.querySelectorAll('#reviewTabs .tab').forEach((b) => b.addEventListener('click', () => {
    state.review = b.dataset.review;
    state.page = 1;
    el.querySelectorAll('#reviewTabs .tab').forEach((o) => {
      const on = o.dataset.review === state.review;
      o.className = o.className.replace(on ? TAB_OFF : TAB_ON, on ? TAB_ON : TAB_OFF);
    });
    loadResults(el);
  }));

  api('/stats').then((s) => {
    el.querySelector('#classList').innerHTML =
      s.class_distribution.map((c) => `<option value="${esc(c.class_name)}">`).join('');
  }).catch(() => {});

  const [datasets, devices] = await Promise.all([
    api('/datasets').catch(() => []), api('/devices').catch(() => [])]);
  el.querySelector('#deviceFilter').innerHTML = '<option value="">All devices</option>'
    + devices.map((d) => `<option value="${d.id}">${esc(d.device_name)}</option>`).join('');
  el.querySelector('#folderFilter').innerHTML = '<option value="">All folders</option>'
    + datasets.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('');
  el.querySelector('#dsSelect').innerHTML = datasets.length
    ? datasets.map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')
    : '<option value="">No folders yet</option>';

  // restore previous filters when navigating back from detail
  Object.entries(state.filters).forEach(([k, v]) => { if (form.elements[k]) form.elements[k].value = v; });
  paintFilterCount(el);

  refreshCounts(el);
  loadResults(el);
}

function paintFilterCount(el) {
  const n = Object.entries(state.filters).filter(([k, v]) => k !== 'q' && v).length;
  el.querySelector('#filterCount').textContent = n ? `(${n})` : '';
}

// Tab counts come from the dashboard aggregate — one round-trip for all four.
function refreshCounts(el) {
  api('/stats').then((s) => {
    const by = s.files_by_review ?? {};
    el.querySelectorAll('.tabCount').forEach((n) => {
      const k = n.dataset.review;
      const count = k ? (by[k] ?? 0) : s.total_files;
      n.textContent = count ? String(count) : '';
    });
  }).catch(() => {});
}

const labelCell = (f) => (f.verified_label
  ? esc(f.verified_label)
  : f.top_class
    ? `${esc(f.top_class.class_name)} <span class="text-xs text-ink-muted tabular-nums">${(f.top_class.confidence * 100).toFixed(0)}%</span>`
    : '<span class="text-ink-muted">—</span>');

const playBtn = (f, size = 'w-9 h-9') => `
  <button class="playBtn ${size} rounded-full bg-page text-brand hover:bg-brand hover:text-white transition-colors grid place-items-center shrink-0"
          data-id="${f.id}" title="Play or pause" aria-label="Play ${esc(f.filename)}">${icon('play', { size: 14, fill: true })}</button>`;

async function loadResults(el) {
  const results = el.querySelector('#results');
  results.innerHTML = spinner();

  // the rows (and their checkboxes) are about to be replaced
  const bar = el.querySelector('#bulkbar');
  bar.classList.add('hidden');
  bar.classList.remove('flex');

  const data = await api('/audio' + qs({
    ...state.filters, review_status: state.review, page: state.page, per_page: state.per_page }));
  if (!el.isConnected) return;   // the person left the Library meanwhile
  if (!data.items.length) {
    const hint = state.review === 'unreviewed' ? 'Every file has been reviewed — nothing left in the queue'
      : state.review ? 'No files in this review state yet'
      : Object.values(state.filters).some(Boolean) ? 'Try loosening the search or filters'
      : 'Record a sound or upload audio to get started';
    results.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState(
      state.review === 'unreviewed' ? 'checkCircle' : 'search', 'No audio found', hint)}</div>`;
    return;
  }

  const pages = Math.max(1, Math.ceil(data.total / state.per_page));
  results.innerHTML = `
    <!-- phone: cards -->
    <div class="md:hidden">
      <label class="flex items-center gap-2 text-xs text-ink-muted mb-2 px-1">
        <input type="checkbox" class="selAll accent-[#4C7438] w-4 h-4"> Select all on this page</label>
      <div class="space-y-2.5">${data.items.map((f) => `
        <div class="bg-white rounded-xl2 shadow-card p-3.5 flex gap-3">
          <div class="flex flex-col items-center gap-2.5">
            ${playBtn(f, 'w-11 h-11')}
            <input type="checkbox" class="rowSel accent-[#4C7438] w-5 h-5" value="${f.id}" aria-label="Select ${esc(f.filename)}">
          </div>
          <a href="#/audio/${f.id}" class="min-w-0 flex-1">
            <div class="flex items-start justify-between gap-2">
              <div class="font-semibold truncate">${labelCell(f)}</div>
              ${reviewBadge(f.review_status)}
            </div>
            <div class="text-xs text-ink-muted truncate mt-0.5">${clipNote(f) || esc(f.filename)}</div>
            <div class="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-ink-secondary">
              ${sourceBadge(f.source)}
              ${f.status !== 'done' ? statusBadge(f.status) : ''}
              <span class="tabular-nums">${fmtDuration(f.duration)}</span>
              <span class="text-ink-muted">·</span>
              <span>${fmtDate(f.recorded_at || f.uploaded_at)}</span>
            </div>
            ${f.location_name ? `<div class="text-xs text-ink-muted mt-1 flex items-center gap-1 truncate">${icon('pin', { size: 12 })}${esc(f.location_name)}</div>` : ''}
          </a>
        </div>`).join('')}
      </div>
    </div>

    <!-- tablet / desktop: table -->
    <div class="hidden md:block bg-white rounded-xl2 shadow-card overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-left text-xs text-ink-muted border-b border-line bg-page/50">
            <th class="p-4 w-8"><input type="checkbox" class="selAll accent-[#4C7438] w-4 h-4" aria-label="Select all"></th>
            <th class="p-4 w-10"></th>
            <th class="p-4 font-medium">Label</th>
            <th class="p-4 font-medium">Review</th>
            <th class="p-4 font-medium">Duration</th>
            <th class="p-4 font-medium">Source</th>
            <th class="p-4 font-medium hidden xl:table-cell">Status</th>
            <th class="p-4 font-medium">Recorded</th>
            <th class="p-4 w-12"></th>
          </tr></thead>
          <tbody>${data.items.map((f) => `
            <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
              <td class="p-4"><input type="checkbox" class="rowSel accent-[#4C7438] w-4 h-4" value="${f.id}"></td>
              <td class="p-4">${playBtn(f)}</td>
              <td class="p-4 max-w-[18rem]">
                <a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${labelCell(f)}</a>
                <div class="text-xs text-ink-muted truncate">${clipNote(f) || esc(f.filename)}${f.location_name ? ` · ${esc(f.location_name)}` : ''}</div>
              </td>
              <td class="p-4">${reviewBadge(f.review_status)}</td>
              <td class="p-4 tabular-nums">${fmtDuration(f.duration)}</td>
              <td class="p-4">${sourceBadge(f.source)}</td>
              <td class="p-4 hidden xl:table-cell">${statusBadge(f.status)}</td>
              <td class="p-4 text-ink-secondary whitespace-nowrap">${fmtDate(f.recorded_at || f.uploaded_at)}</td>
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
    <div class="flex items-center justify-between gap-3 mt-4 text-sm text-ink-secondary">
      <div>${data.total} file${data.total === 1 ? '' : 's'} · ${state.page}/${pages}</div>
      <div class="flex gap-2">
        <button id="prevBtn" class="inline-flex items-center gap-1 px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40 hover:border-brand hover:text-brand transition-colors" ${state.page <= 1 ? 'disabled' : ''} aria-label="Previous page">
          ${icon('chevronLeft', { size: 15 })}<span class="hidden sm:inline">Previous</span></button>
        <button id="nextBtn" class="inline-flex items-center gap-1 px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40 hover:border-brand hover:text-brand transition-colors" ${state.page >= pages ? 'disabled' : ''} aria-label="Next page">
          <span class="hidden sm:inline">Next</span>${icon('chevronRight', { size: 15 })}</button>
      </div>
    </div>`;

  results.querySelector('#prevBtn').addEventListener('click', () => { state.page--; loadResults(el); window.scrollTo(0, 0); });
  results.querySelector('#nextBtn').addEventListener('click', () => { state.page++; loadResults(el); window.scrollTo(0, 0); });

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
      refreshCounts(el);
      loadResults(el);
    } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
  }));

  // Selection. Phone cards and desktop rows are both in the DOM (one hidden),
  // so only the visible copy of each checkbox counts.
  const visible = (sel) => [...results.querySelectorAll(sel)].filter((c) => c.offsetParent !== null);
  const selectedIds = () => [...new Set(visible('.rowSel:checked').map((c) => c.value))];
  const bulkbar = el.querySelector('#bulkbar');
  const refreshBulk = () => {
    const n = selectedIds().length;
    bulkbar.classList.toggle('hidden', !n);
    bulkbar.classList.toggle('flex', !!n);
    el.querySelector('#selCount').textContent = `${n} selected`;
  };
  results.querySelectorAll('.rowSel').forEach((c) => c.addEventListener('change', refreshBulk));
  results.querySelectorAll('.selAll').forEach((all) => all.addEventListener('change', (e) => {
    results.querySelectorAll('.rowSel').forEach((c) => { c.checked = e.target.checked; });
    refreshBulk();
  }));

  // Bulk approve keeps each file's *own* label (a human label if it has one,
  // otherwise its prediction), so a mixed selection never shares one blanket class.
  el.querySelector('#approveSel').onclick = async () => {
    const ids = selectedIds();
    if (!confirm(`Approve ${ids.length} file${ids.length === 1 ? '' : 's'}?\n\n`
                 + "Each keeps its own label. Check any you are unsure of first — "
                 + 'approving marks them as human-verified in every export.')) return;
    try {
      const r = await api.json('/audio/review', 'POST', { audio_file_ids: ids, review_status: 'approved' });
      toast(`Approved ${r.updated} file${r.updated === 1 ? '' : 's'}`, 'success');
      refreshCounts(el);
      loadResults(el);
    } catch (e) { toast(e.message, 'error'); }
  };

  const dsSelect = el.querySelector('#dsSelect');
  el.querySelector('#addToDs').onclick = async () => {
    const ids = selectedIds();
    if (!dsSelect.value) { toast('Create a folder first on the Datasets page', 'error'); return; }
    try {
      const r = await api.json(`/datasets/${dsSelect.value}/items`, 'POST', { audio_file_ids: ids });
      toast(`Added ${r.added} file${r.added === 1 ? '' : 's'} to the folder`, 'success');
      results.querySelectorAll('.rowSel:checked, .selAll:checked').forEach((c) => { c.checked = false; });
      refreshBulk();
    } catch (e) { toast(e.message, 'error'); }
  };

  // Merge joins the selection in the order it is listed — what the person sees.
  el.querySelector('#mergeSel').onclick = async () => {
    const ids = selectedIds();
    if (ids.length < 2) { toast('Select at least two sounds to merge', 'error'); return; }
    const label = prompt(`Merge ${ids.length} sounds into one, in list order.

Label for the merged sound (optional):`, '');
    if (label === null) return;
    try {
      const row = await api.json('/audio/merge', 'POST', { audio_ids: ids, label: label.trim() || null });
      toast('Merged into one sound — it is marked as edited and left out of training exports', 'success');
      location.hash = `#/audio/${row.id}`;
    } catch (e) { toast(e.message, 'error'); }
  };

  el.querySelector('#deleteSel').onclick = async () => {
    const ids = selectedIds();
    if (!confirm(`Delete ${ids.length} file${ids.length === 1 ? '' : 's'} permanently?\n\n`
                 + 'Their classifications and dataset links are removed too. This cannot be undone.')) return;

    const outcomes = await Promise.allSettled(
      ids.map((id) => api(`/audio/${id}`, { method: 'DELETE' })));
    const failed = outcomes.filter((r) => r.status === 'rejected').length;

    if (failed) toast(`Deleted ${ids.length - failed} of ${ids.length}; ${failed} failed`, 'error');
    else toast(`Deleted ${ids.length} file${ids.length === 1 ? '' : 's'}`, 'success');

    state.page = 1;  // the current page may no longer exist
    refreshCounts(el);
    loadResults(el);
  };
}

// A clip says where it came from instead of its generated filename.
function clipNote(f) {
  if (!f.parent_id) return '';
  const t = (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, '0')}`;
  return `${icon('clip', { size: 11 })} Clip ${t(f.clip_start)}–${t(f.clip_end)} of ${esc(f.parent_filename || 'a recording')}`;
}
