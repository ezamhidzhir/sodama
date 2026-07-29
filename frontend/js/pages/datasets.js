import { api } from '../api.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, emptyState, toast } from '../ui.js';

let selectedId = null;

export async function renderDatasets(el) {
  el.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">Datasets</h1>
    <div class="grid lg:grid-cols-3 gap-4 items-start">
      <div class="space-y-4">
        <form id="createForm" class="bg-white rounded-xl border border-grid p-4 space-y-3">
          <div class="font-semibold text-sm">Create dataset</div>
          <input name="name" required placeholder="Dataset name, e.g. bird-calls-v1"
                 class="w-full border border-grid rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand">
          <textarea name="description" rows="2" placeholder="Description (optional)"
                 class="w-full border border-grid rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-brand"></textarea>
          <button class="w-full bg-brand text-white rounded-lg py-2 text-sm hover:bg-brand-dark">+ Create</button>
        </form>
        <div id="dsList" class="space-y-2">${spinner()}</div>
      </div>
      <div class="lg:col-span-2" id="dsDetail">
        ${emptyState('🗂️', 'Select a dataset', 'Or create one, then add files from the <a class="text-brand" href="#/library">Library</a>')}
      </div>
    </div>`;

  el.querySelector('#createForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(e.target));
    try {
      const ds = await api('/datasets', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      toast(`Dataset "${ds.name}" created`, 'success');
      e.target.reset();
      selectedId = ds.id;
      await refreshList(el);
      await showDetail(el, ds.id);
    } catch (err) { toast(err.message, 'error'); }
  });

  await refreshList(el);
  if (selectedId) showDetail(el, selectedId).catch(() => { selectedId = null; });
}

async function refreshList(el) {
  const list = el.querySelector('#dsList');
  const datasets = await api('/datasets');
  if (!datasets.length) {
    list.innerHTML = '<div class="text-sm text-ink-muted text-center py-4">No datasets yet</div>';
    return;
  }
  list.innerHTML = datasets.map((d) => `
    <button data-id="${d.id}"
            class="dsItem w-full text-left bg-white rounded-xl border p-4 hover:border-brand transition-colors ${d.id === selectedId ? 'border-brand ring-1 ring-brand/30' : 'border-grid'}">
      <div class="font-medium">${esc(d.name)}</div>
      <div class="text-xs text-ink-muted mt-0.5">${d.item_count} file${d.item_count === 1 ? '' : 's'} · ${fmtDate(d.created_at)}</div>
    </button>`).join('');
  list.querySelectorAll('.dsItem').forEach((b) => b.addEventListener('click', () => {
    selectedId = b.dataset.id;
    refreshList(el);
    showDetail(el, b.dataset.id);
  }));
}

async function showDetail(el, id) {
  const panel = el.querySelector('#dsDetail');
  panel.innerHTML = spinner();
  const d = await api(`/datasets/${id}`);

  panel.innerHTML = `
    <div class="bg-white rounded-xl border border-grid p-5">
      <div class="flex items-start justify-between gap-3 mb-1">
        <div>
          <div class="text-lg font-semibold">${esc(d.name)}</div>
          ${d.description ? `<div class="text-sm text-ink-secondary">${esc(d.description)}</div>` : ''}
        </div>
        <div class="flex gap-2 shrink-0">
          <a href="/datasets/${id}/export" download
             class="bg-brand text-white text-sm px-4 py-2 rounded-lg hover:bg-brand-dark ${d.items.length ? '' : 'pointer-events-none opacity-40'}">
            📦 Export ZIP</a>
          <button id="delDs" class="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">🗑</button>
        </div>
      </div>
      <div class="text-xs text-ink-muted mb-4">
        Export bundles the WAV files plus <code>manifest.csv</code>/<code>manifest.json</code> with auto-labels — ready for ML training.
      </div>

      ${d.items.length ? `
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-ink-muted border-b border-grid">
          <th class="py-2 pr-3 font-medium">File</th><th class="py-2 pr-3 font-medium">Duration</th>
          <th class="py-2 pr-3 font-medium">Source</th><th class="py-2 pr-3 font-medium">Status</th>
          <th class="py-2 font-medium"></th>
        </tr></thead>
        <tbody>${d.items.map((f) => `
          <tr class="border-b border-grid/60 last:border-0 hover:bg-gray-50">
            <td class="py-2.5 pr-3"><a class="text-brand hover:underline" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
            <td class="py-2.5 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
            <td class="py-2.5 pr-3">${sourceBadge(f.source)}</td>
            <td class="py-2.5 pr-3">${statusBadge(f.status)}</td>
            <td class="py-2.5 text-right">
              <button class="rmItem text-ink-muted hover:text-red-600 text-xs" data-id="${f.id}" title="Remove from dataset">✕ remove</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`
      : emptyState('📁', 'Dataset is empty', 'Select files in the <a class="text-brand" href="#/library">Library</a> and use “Add to dataset”')}
    </div>`;

  panel.querySelectorAll('.rmItem').forEach((b) => b.addEventListener('click', async () => {
    await api(`/datasets/${id}/items/${b.dataset.id}`, { method: 'DELETE' });
    toast('Removed from dataset', 'success');
    refreshList(el); showDetail(el, id);
  }));
  panel.querySelector('#delDs').addEventListener('click', async () => {
    if (!confirm(`Delete dataset "${d.name}"? Audio files themselves are kept.`)) return;
    await api(`/datasets/${id}`, { method: 'DELETE' });
    toast('Dataset deleted', 'success');
    selectedId = null;
    refreshList(el);
    panel.innerHTML = emptyState('🗂️', 'Select a dataset', '');
  });
}
