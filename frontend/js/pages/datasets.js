import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, emptyState, toast, pageHeader } from '../ui.js';

let selectedId = null;
const INPUT = 'field w-full bg-white border border-line rounded-2xl px-4 py-2.5 text-sm transition-shadow';

export async function renderDatasets(el) {
  el.innerHTML = `
    ${pageHeader('Datasets', 'Group audio files into training-ready collections and export them.')}

    <div class="grid lg:grid-cols-3 gap-4 items-start">
      <div class="space-y-4">
        <form id="createForm" class="bg-white rounded-xl2 shadow-card p-5 space-y-3">
          <div class="font-semibold">Create dataset</div>
          <input name="name" required placeholder="Dataset name, e.g. bird-calls-v1" class="${INPUT} rounded-full">
          <textarea name="description" rows="2" placeholder="Description (optional)" class="${INPUT}"></textarea>
          <button class="w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-2.5 text-sm hover:bg-brand-dark transition-colors">
            ${icon('plus', { size: 16 })} Create dataset
          </button>
        </form>
        <div id="dsList" class="space-y-2.5">${spinner()}</div>
      </div>

      <div class="lg:col-span-2" id="dsDetail">
        <div class="bg-white rounded-xl2 shadow-card">
          ${emptyState('folder', 'Select a dataset',
            'Or create one, then add files from the <a class="text-brand hover:underline" href="#/library">Library</a>')}
        </div>
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
    list.innerHTML = '<div class="text-sm text-ink-muted text-center py-5">No datasets yet</div>';
    return;
  }
  list.innerHTML = datasets.map((d) => `
    <button data-id="${d.id}"
            class="dsItem w-full text-left bg-white rounded-xl2 shadow-card border-2 p-4 transition-colors
                   ${d.id === selectedId ? 'border-brand' : 'border-transparent hover:border-line'}">
      <div class="flex items-start gap-3">
        <span class="w-9 h-9 rounded-full ${d.id === selectedId ? 'bg-brand text-white' : 'bg-page text-brand'} grid place-items-center shrink-0">
          ${icon('folder', { size: 16 })}
        </span>
        <div class="min-w-0">
          <div class="font-medium truncate">${esc(d.name)}</div>
          <div class="text-xs text-ink-muted mt-0.5">${d.item_count} file${d.item_count === 1 ? '' : 's'} · ${fmtDate(d.created_at)}</div>
        </div>
      </div>
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
    <div class="bg-white rounded-xl2 shadow-card p-6">
      <div class="flex flex-wrap items-start justify-between gap-3 mb-1.5">
        <div class="min-w-0">
          <div class="text-lg font-semibold">${esc(d.name)}</div>
          ${d.description ? `<div class="text-sm text-ink-secondary mt-0.5">${esc(d.description)}</div>` : ''}
        </div>
        <div class="flex gap-2.5 shrink-0">
          <a href="/datasets/${id}/export" download
             class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors
                    ${d.items.length ? '' : 'pointer-events-none opacity-40'}">
            ${icon('package', { size: 16 })} Export ZIP</a>
          <button id="delDs" class="px-3.5 py-2.5 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors" title="Delete dataset">
            ${icon('trash', { size: 16 })}</button>
        </div>
      </div>
      <div class="text-xs text-ink-muted mb-5">
        The export bundles every WAV plus <span class="font-medium">manifest.csv</span> and
        <span class="font-medium">manifest.json</span> with auto-labels — ready for model training.
      </div>

      ${d.items.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[560px]">
          <thead><tr class="text-left text-xs text-ink-muted border-b border-line">
            <th class="py-2.5 pr-3 font-medium">File</th><th class="py-2.5 pr-3 font-medium">Duration</th>
            <th class="py-2.5 pr-3 font-medium">Source</th><th class="py-2.5 pr-3 font-medium">Status</th>
            <th class="py-2.5 font-medium"></th>
          </tr></thead>
          <tbody>${d.items.map((f) => `
            <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
              <td class="py-3 pr-3"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
              <td class="py-3 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
              <td class="py-3 pr-3">${sourceBadge(f.source)}</td>
              <td class="py-3 pr-3">${statusBadge(f.status)}</td>
              <td class="py-3 text-right">
                <button class="rmItem inline-flex items-center gap-1 text-ink-muted hover:text-red-600 text-xs transition-colors"
                        data-id="${f.id}" title="Remove from dataset">${icon('close', { size: 13 })} Remove</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>`
      : emptyState('folder', 'This dataset is empty',
          'Select files in the <a class="text-brand hover:underline" href="#/library">Library</a> and use “Add to dataset”')}
    </div>`;

  panel.querySelectorAll('.rmItem').forEach((b) => b.addEventListener('click', async () => {
    await api(`/datasets/${id}/items/${b.dataset.id}`, { method: 'DELETE' });
    toast('Removed from dataset', 'success');
    refreshList(el); showDetail(el, id);
  }));
  panel.querySelector('#delDs').addEventListener('click', async () => {
    if (!confirm(`Delete dataset "${d.name}"? The audio files themselves are kept.`)) return;
    await api(`/datasets/${id}`, { method: 'DELETE' });
    toast('Dataset deleted', 'success');
    selectedId = null;
    refreshList(el);
    panel.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState('folder', 'Select a dataset', '')}</div>`;
  });
}
