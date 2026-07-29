import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, reviewBadge, spinner, emptyState, toast, pageHeader } from '../ui.js';

let selectedId = null;
const INPUT = 'field w-full bg-white border border-line rounded-2xl px-4 py-2.5 text-sm transition-shadow';

// Mirrors the server's export rule (see datasets.py): rejected clips and clips
// that never got a label are never bundled, so the count shown here is the
// count that lands in the ZIP.
function exportCounts(items) {
  const approved = items.filter((f) => f.review_status === 'approved');
  const rejected = items.filter((f) => f.review_status === 'rejected');
  const unreviewed = items.filter((f) => f.review_status === 'unreviewed');
  return {
    approved: approved.length,
    rejected: rejected.length,
    unreviewed: unreviewed.length,
    unlabelled: items.filter((f) => f.review_status !== 'rejected' && !f.label).length,
    withApprovedOnly: approved.filter((f) => f.label).length,
    withAll: items.filter((f) => f.review_status !== 'rejected' && f.label).length,
  };
}

function exportPanel(d) {
  const c = exportCounts(d.items);
  const total = d.items.length;
  const seg = (n, cls, title) => n
    ? `<div class="${cls}" style="width:${(n / total) * 100}%" title="${title}"></div>` : '';

  return `
    <div class="rounded-xl2 border border-line p-5 mb-5" id="exportPanel">
      <div class="flex items-center gap-2.5 mb-3">
        <span class="w-8 h-8 rounded-full bg-page text-brand grid place-items-center shrink-0">
          ${icon('package', { size: 16 })}</span>
        <div>
          <div class="font-semibold leading-tight">Export for training</div>
          <div class="text-xs text-ink-muted">HuggingFace-compatible bundle: audio, metadata.csv and a dataset card</div>
        </div>
      </div>

      <div class="flex h-2 rounded-full overflow-hidden bg-page mb-2">
        ${seg(c.approved, 'bg-brand', `${c.approved} approved`)}
        ${seg(c.unreviewed, 'bg-[#EBD9AE]', `${c.unreviewed} unreviewed`)}
        ${seg(c.rejected, 'bg-accent', `${c.rejected} rejected`)}
      </div>
      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-secondary mb-4">
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-brand"></span>${c.approved} approved</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-[#EBD9AE]"></span>${c.unreviewed} unreviewed</span>
        <span class="inline-flex items-center gap-1.5"><span class="w-2.5 h-2.5 rounded-full bg-accent"></span>${c.rejected} rejected</span>
        ${c.unlabelled ? `<span class="text-ink-muted">${c.unlabelled} without any label</span>` : ''}
      </div>

      <div class="space-y-2.5 text-sm">
        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" id="optApproved" class="accent-[#4C7438] w-4 h-4 mt-0.5">
          <span>
            <span class="font-medium">Approved clips only</span>
            <span class="block text-xs text-ink-muted">Leaves out anything a human has not confirmed — the safest choice for training</span>
          </span>
        </label>
        <label class="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" id="optSplit" checked class="accent-[#4C7438] w-4 h-4 mt-0.5">
          <span>
            <span class="font-medium">Split into train / validation / test</span>
            <span class="block text-xs text-ink-muted">70 / 15 / 15, balanced per class and reproducible</span>
          </span>
        </label>
        <div class="flex items-center gap-2.5 pt-0.5">
          <span class="text-xs text-ink-muted">Manifest</span>
          <select id="optFormat" class="field bg-white border border-line rounded-full px-3.5 py-1.5 text-xs">
            <option value="both">CSV and JSON</option>
            <option value="csv">CSV only</option>
            <option value="json">JSON only</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-line/70">
        <a id="exportLink" href="/datasets/${d.id}/export" download
           class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">
          ${icon('download', { size: 16 })} Download ZIP</a>
        <span class="text-sm text-ink-secondary" id="exportCount"></span>
      </div>
    </div>`;
}

function wireExport(panel, d) {
  const c = exportCounts(d.items);
  const link = panel.querySelector('#exportLink');
  const count = panel.querySelector('#exportCount');
  const opts = ['optApproved', 'optSplit', 'optFormat'].map((i) => panel.querySelector('#' + i));

  const sync = () => {
    const [approvedOnly, split, format] = opts;
    const n = approvedOnly.checked ? c.withApprovedOnly : c.withAll;
    const params = new URLSearchParams({
      manifest_format: format.value,
      only_approved: String(approvedOnly.checked),
      split: String(split.checked),
    });
    link.href = `/datasets/${d.id}/export?${params}`;

    const blocked = n === 0;
    link.classList.toggle('pointer-events-none', blocked);
    link.classList.toggle('opacity-40', blocked);
    count.innerHTML = blocked
      ? `<span class="text-accent">Nothing to export — ${approvedOnly.checked
          ? 'approve some clips first, or untick “approved only”'
          : 'every clip is rejected or unlabelled'}</span>`
      : `${n} of ${d.items.length} clip${d.items.length === 1 ? '' : 's'} will be included`;
  };

  opts.forEach((o) => o.addEventListener('change', sync));
  sync();
}

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
      <div class="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div class="min-w-0">
          <div class="text-lg font-semibold">${esc(d.name)}</div>
          ${d.description ? `<div class="text-sm text-ink-secondary mt-0.5">${esc(d.description)}</div>` : ''}
        </div>
        <div class="flex gap-2.5 shrink-0">
          <button id="delDs" class="px-3.5 py-2.5 rounded-full border border-red-200 text-red-600 hover:bg-red-50 transition-colors" title="Delete dataset">
            ${icon('trash', { size: 16 })}</button>
        </div>
      </div>

      ${d.items.length ? exportPanel(d) + `
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[680px]">
          <thead><tr class="text-left text-xs text-ink-muted border-b border-line">
            <th class="py-2.5 pr-3 font-medium">File</th><th class="py-2.5 pr-3 font-medium">Label</th>
            <th class="py-2.5 pr-3 font-medium">Review</th><th class="py-2.5 pr-3 font-medium">Duration</th>
            <th class="py-2.5 pr-3 font-medium">Source</th><th class="py-2.5 pr-3 font-medium">Status</th>
            <th class="py-2.5 font-medium"></th>
          </tr></thead>
          <tbody>${d.items.map((f) => `
            <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
              <td class="py-3 pr-3"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
              <td class="py-3 pr-3">${f.label
                ? `${esc(f.label)}${f.label_source === 'auto' ? ' <span class="text-xs text-ink-muted">(auto)</span>' : ''}`
                : '<span class="text-ink-muted">—</span>'}</td>
              <td class="py-3 pr-3">${reviewBadge(f.review_status)}</td>
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

  if (d.items.length) wireExport(panel.querySelector('#exportPanel'), d);

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
