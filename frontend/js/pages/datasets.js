// Datasets = folders. The list page shows them as cards; each has its own page
// (#/datasets/{id}) with class balance, export, and Community sharing.
import { api, download } from '../api.js';
import { createFolderSheet, classEditor, classEditorHTML } from '../folders.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtHours, fmtDate, statusBadge, sourceBadge, reviewBadge, spinner, emptyState,
         toast, pageHeader, sheet, LICENSES, INPUT, TEXTAREA } from '../ui.js';

const visBadge = (v) => v === 'public'
  ? `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border bg-[#E4EFF6] text-[#22587A] border-[#C2DCEA]">${icon('globe', { size: 13 })}Public</span>`
  : `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border bg-white text-ink-muted border-line">${icon('lock', { size: 13 })}Private</span>`;

export async function renderDatasets(el, id) {
  if (id) return renderDatasetPage(el, id);

  el.innerHTML = `
    ${pageHeader('Datasets', 'Your folders of labelled sound. Record into them, export them for training, or share them.',
      `<button id="newBtn" class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">
         ${icon('plus', { size: 16 })} New folder</button>`)}
    <div id="dsList">${spinner()}</div>`;

  el.querySelector('#newBtn').addEventListener('click', async () => {
    const ds = await createFolderSheet();
    if (ds) location.hash = `#/datasets/${ds.id}`;
  });

  const datasets = await api('/datasets');
  const list = el.querySelector('#dsList');
  if (!datasets.length) {
    list.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState('folder', 'No folders yet',
      'Create one — e.g. “Car engines” with classes Honda, Toyota, Proton — then start recording into it.')}</div>`;
    return;
  }
  list.innerHTML = `<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">${datasets.map((d) => `
    <a href="#/datasets/${d.id}" class="block bg-white rounded-xl2 shadow-card p-4 border-2 border-transparent hover:border-line transition-colors">
      <div class="flex items-start gap-3">
        <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon('folder', { size: 18 })}</span>
        <div class="min-w-0 flex-1">
          <div class="flex items-start justify-between gap-2">
            <div class="font-semibold truncate">${esc(d.name)}</div>
            ${visBadge(d.visibility)}
          </div>
          <div class="text-xs text-ink-muted mt-0.5">${d.item_count} clip${d.item_count === 1 ? '' : 's'} · updated ${fmtDate(d.updated_at)}</div>
        </div>
      </div>
      ${d.labels?.length ? `
        <div class="flex flex-wrap gap-1.5 mt-3">
          ${d.labels.slice(0, 6).map((l) => `<span class="text-xs px-2.5 py-1 rounded-full bg-page border border-line">${esc(l)}</span>`).join('')}
          ${d.labels.length > 6 ? `<span class="text-xs text-ink-muted px-1 py-1">+${d.labels.length - 6}</span>` : ''}
        </div>` : ''}
    </a>`).join('')}</div>`;
}

// ---------------------------------------------------------------- one dataset

function exportCounts(items) {
  const approved = items.filter((f) => f.review_status === 'approved');
  return {
    approved: approved.length,
    rejected: items.filter((f) => f.review_status === 'rejected').length,
    unreviewed: items.filter((f) => f.review_status === 'unreviewed').length,
    unlabelled: items.filter((f) => f.review_status !== 'rejected' && !f.label).length,
    withApprovedOnly: approved.filter((f) => f.label).length,
    withAll: items.filter((f) => f.review_status !== 'rejected' && f.label).length,
  };
}

// Clips per class, including declared classes that have none yet — those are
// the gaps to go and record.
function classBalance(d) {
  const counts = new Map(d.labels.map((l) => [l, 0]));
  d.items.filter((f) => f.review_status !== 'rejected' && f.label)
    .forEach((f) => counts.set(f.label, (counts.get(f.label) || 0) + 1));
  const rows = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((r) => r[1]));
  const nonzero = rows.filter((r) => r[1] > 0).map((r) => r[1]);
  const skew = nonzero.length > 1 && Math.max(...nonzero) >= 3 * Math.min(...nonzero);
  const empty = rows.filter((r) => r[1] === 0).map((r) => r[0]);

  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5 mb-4">
      <div class="flex items-center justify-between gap-2 mb-3">
        <div>
          <div class="font-semibold">Classes</div>
          <div class="text-xs text-ink-muted">Clips per label that would be exported</div>
        </div>
        <a href="#/record" data-record class="inline-flex items-center gap-1.5 text-sm text-brand hover:underline">${icon('mic', { size: 15 })} Record more</a>
      </div>
      <div class="space-y-2">
        ${rows.map(([label, n]) => `
          <div class="flex items-center gap-3 text-sm">
            <div class="w-28 sm:w-40 truncate shrink-0 ${n ? '' : 'text-ink-muted'}">${esc(label)}</div>
            <div class="flex-1 h-2.5 bg-page rounded-full overflow-hidden">
              <div class="h-full rounded-full bg-brand" style="width:${(n / max) * 100}%"></div>
            </div>
            <div class="w-8 text-right tabular-nums ${n ? '' : 'text-ink-muted'}">${n}</div>
          </div>`).join('')}
      </div>
      ${empty.length ? `<p class="text-xs text-accent-dark bg-accent-tint/50 rounded-xl2 p-2.5 mt-3">No clips yet for ${empty.map(esc).join(', ')} — a model cannot learn a class it has never heard.</p>`
        : skew ? '<p class="text-xs text-ink-muted mt-3">Classes are unbalanced (the largest has 3× the smallest). Recording more of the small classes gives a fairer model.</p>' : ''}
    </div>`;
}

function exportPanel(d) {
  const c = exportCounts(d.items);
  const total = d.items.length;
  const seg = (n, cls, title) => n
    ? `<div class="${cls}" style="width:${(n / total) * 100}%" title="${title}"></div>` : '';

  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5 mb-4" id="exportPanel">
      <div class="flex items-center gap-2.5 mb-3">
        <span class="w-9 h-9 rounded-full bg-page text-brand grid place-items-center shrink-0">
          ${icon('package', { size: 17 })}</span>
        <div>
          <div class="font-semibold leading-tight">Export for training</div>
          <div class="text-xs text-ink-muted">HuggingFace-compatible ZIP: audio, metadata.csv and a dataset card</div>
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

      <div class="space-y-3 text-sm">
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" id="optApproved" class="accent-[#4C7438] w-5 h-5 mt-0.5 shrink-0">
          <span>
            <span class="font-medium">Approved clips only</span>
            <span class="block text-xs text-ink-muted">Leaves out anything a human has not confirmed — the safest choice for training</span>
          </span>
        </label>
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" id="optSplit" checked class="accent-[#4C7438] w-5 h-5 mt-0.5 shrink-0">
          <span>
            <span class="font-medium">Split into train / validation / test</span>
            <span class="block text-xs text-ink-muted">70 / 15 / 15, balanced per class and reproducible</span>
          </span>
        </label>
        <div class="flex items-center gap-2.5 pt-0.5">
          <span class="text-xs text-ink-muted">Manifest</span>
          <select id="optFormat" class="field bg-white border border-line rounded-full px-3.5 py-2 text-xs">
            <option value="both">CSV and JSON</option>
            <option value="csv">CSV only</option>
            <option value="json">JSON only</option>
          </select>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-3 mt-4 pt-4 border-t border-line/70">
        <button id="exportBtn"
           class="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand text-white text-sm px-5 py-3 sm:py-2.5 rounded-full hover:bg-brand-dark transition-colors disabled:opacity-40">
          ${icon('download', { size: 16 })} Download ZIP</button>
        <span class="text-sm text-ink-secondary" id="exportCount"></span>
      </div>
    </div>`;
}

function wireExport(panel, d) {
  const c = exportCounts(d.items);
  const btn = panel.querySelector('#exportBtn');
  const count = panel.querySelector('#exportCount');
  const [approvedOnly, split, format] = ['optApproved', 'optSplit', 'optFormat'].map((i) => panel.querySelector('#' + i));

  const sync = () => {
    const n = approvedOnly.checked ? c.withApprovedOnly : c.withAll;
    btn.disabled = n === 0;
    count.innerHTML = n === 0
      ? `<span class="text-accent">Nothing to export — ${approvedOnly.checked
          ? 'approve some clips first, or untick “approved only”'
          : 'every clip is rejected or unlabelled'}</span>`
      : `${n} of ${d.items.length} clip${d.items.length === 1 ? '' : 's'} will be included`;
  };
  [approvedOnly, split, format].forEach((o) => o.addEventListener('change', sync));
  sync();

  btn.addEventListener('click', async () => {
    const params = new URLSearchParams({
      manifest_format: format.value, only_approved: String(approvedOnly.checked), split: String(split.checked),
    });
    btn.disabled = true;
    const label = btn.innerHTML;
    btn.innerHTML = 'Preparing ZIP…';
    try {
      const name = await download(`/datasets/${d.id}/export?${params}`, `${d.name}.zip`);
      toast(`Downloaded ${name}`, 'success');
    } catch (e) { toast(e.message, 'error'); }
    btn.innerHTML = label;
    sync();
  });
}

function sharePanel(d) {
  const pub = d.visibility === 'public';
  const lic = d.license || 'CC-BY-4.0';
  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5 mb-4" id="sharePanel">
      <div class="flex items-center gap-2.5 mb-3">
        <span class="w-9 h-9 rounded-full ${pub ? 'bg-[#E4EFF6] text-[#22587A]' : 'bg-page text-brand'} grid place-items-center shrink-0">
          ${icon('globe', { size: 17 })}</span>
        <div class="min-w-0">
          <div class="font-semibold leading-tight">Share with the community</div>
          <div class="text-xs text-ink-muted">${pub
            ? `Public since ${fmtDate(d.published_at)} · ${d.download_count} download${d.download_count === 1 ? '' : 's'} · ${d.like_count} like${d.like_count === 1 ? '' : 's'}`
            : 'Let other trainers find, listen to and download this dataset'}</div>
        </div>
      </div>

      ${pub ? '' : `
        <ul class="text-xs text-ink-secondary space-y-1 mb-4 bg-page rounded-xl2 p-3">
          <li>• Others get the same ZIP you export — rejected clips are never included.</li>
          <li>• Your email is never shown; clips are credited to your username.</li>
          <li>• Exact GPS coordinates stay private unless you allow them below. Place names are shown.</li>
        </ul>`}

      <div class="space-y-3 text-sm">
        <div>
          <label class="block text-xs text-ink-muted mb-1.5" for="licSel">Licence — what others may do with it</label>
          <select id="licSel" class="${INPUT}">
            ${Object.entries(LICENSES).map(([k, v]) => `<option value="${k}" ${k === lic ? 'selected' : ''}>${v.name} — ${v.hint}</option>`).join('')}
          </select>
        </div>
        <label class="flex items-start gap-3 cursor-pointer">
          <input type="checkbox" id="shareLoc" ${d.share_location ? 'checked' : ''} class="accent-[#4C7438] w-5 h-5 mt-0.5 shrink-0">
          <span><span class="font-medium">Include exact GPS coordinates</span>
            <span class="block text-xs text-ink-muted">Useful for location-aware models; leave off if recordings were made at home</span></span>
        </label>
      </div>
      <div id="shareErr" class="mt-3"></div>
      <div class="flex flex-wrap gap-2 mt-4 pt-4 border-t border-line/70">
        ${pub ? `
          <button id="saveShare" class="inline-flex items-center gap-2 border border-line bg-white text-sm px-5 py-2.5 rounded-full hover:border-brand hover:text-brand">${icon('check', { size: 16 })} Save</button>
          <a href="#/community/${d.id}" class="inline-flex items-center gap-2 border border-line bg-white text-sm px-5 py-2.5 rounded-full hover:border-brand hover:text-brand">${icon('external', { size: 16 })} View public page</a>
          <button id="unpublish" class="inline-flex items-center gap-2 text-sm px-4 py-2.5 rounded-full text-accent hover:bg-accent-tint/50 sm:ml-auto">${icon('lock', { size: 16 })} Make private</button>`
        : `
          <button id="publish" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-[#22587A] text-white text-sm px-5 py-3 sm:py-2.5 rounded-full hover:opacity-90">${icon('globe', { size: 16 })} Publish to Community</button>`}
      </div>
    </div>`;
}

function wireShare(panel, d, reload) {
  const err = panel.querySelector('#shareErr');
  const send = async (patch, msg) => {
    err.innerHTML = '';
    try {
      await api.json(`/datasets/${d.id}`, 'PATCH', patch);
      toast(msg, 'success');
      reload();
    } catch (e) {
      err.innerHTML = `<div class="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl2 p-3 flex gap-2">${icon('alert', { size: 16 })}<span>${esc(e.message)}</span></div>`;
    }
  };
  const settings = () => ({
    license: panel.querySelector('#licSel').value,
    share_location: panel.querySelector('#shareLoc').checked,
  });
  panel.querySelector('#publish')?.addEventListener('click', () => {
    if (!confirm(`Publish “${d.name}” to the community?\n\nEvery signed-in SODAMA user will be able to listen to and download it. You can make it private again at any time.`)) return;
    send({ ...settings(), visibility: 'public' }, 'Published — it is now in Community');
  });
  panel.querySelector('#saveShare')?.addEventListener('click', () => send(settings(), 'Sharing settings saved'));
  panel.querySelector('#unpublish')?.addEventListener('click', () => {
    if (!confirm('Make this dataset private? It disappears from Community; likes are kept.')) return;
    send({ visibility: 'private' }, 'Dataset is private again');
  });
}

function editSheet(d, reload) {
  const s = sheet('Edit folder', `
    <form id="editForm" class="space-y-4 pb-2">
      <div>
        <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="eName">Name</label>
        <input id="eName" name="name" required maxlength="80" value="${esc(d.name)}" class="${INPUT}">
      </div>
      <div>
        <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="eDesc">Description</label>
        <textarea id="eDesc" name="description" rows="3" maxlength="2000" class="${TEXTAREA}"
                  placeholder="What was recorded, where, with what, and what it is for">${esc(d.description || '')}</textarea>
      </div>
      ${classEditorHTML('Removing a class here does not change clips that already use it.')}
      <button class="w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-3 font-medium hover:bg-brand-dark">
        ${icon('check', { size: 18 })} Save changes</button>
    </form>`);
  const editor = classEditor(s.el.querySelector('.classEditor'), d.labels);
  s.el.querySelector('#editForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      await api.json(`/datasets/${d.id}`, 'PATCH', { name: f.name, description: f.description, labels: editor.get() });
      toast('Folder updated', 'success');
      s.close();
      reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function renderDatasetPage(el, id) {
  el.innerHTML = spinner();
  const d = await api(`/datasets/${id}`);
  const reload = () => renderDatasetPage(el, id);
  const totalSec = d.items.reduce((a, f) => a + (f.duration || 0), 0);
  const nClasses = new Set(d.items.filter((f) => f.label && f.review_status !== 'rejected').map((f) => f.label)).size;

  el.innerHTML = `
    <a href="#/datasets" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} All datasets</a>

    <div class="flex flex-wrap items-start justify-between gap-3 mb-4">
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-2">
          <h1 class="text-[1.35rem] sm:text-[1.6rem] font-bold tracking-tight break-words">${esc(d.name)}</h1>
          ${visBadge(d.visibility)}
        </div>
        ${d.description ? `<p class="text-sm text-ink-secondary mt-1 whitespace-pre-line">${esc(d.description)}</p>`
          : '<p class="text-sm text-ink-muted mt-1">No description yet.</p>'}
      </div>
      <div class="flex gap-2 w-full sm:w-auto">
        <a href="#/record" data-record class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark">
          ${icon('mic', { size: 16 })} Record into folder</a>
        <button id="editDs" class="px-3.5 py-2.5 rounded-full border border-line bg-white text-ink-secondary hover:border-brand hover:text-brand" title="Edit folder" aria-label="Edit folder">
          ${icon('pencil', { size: 16 })}</button>
        <button id="delDs" class="px-3.5 py-2.5 rounded-full border border-red-200 bg-white text-red-600 hover:bg-red-50" title="Delete folder" aria-label="Delete folder">
          ${icon('trash', { size: 16 })}</button>
      </div>
    </div>

    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
      ${[['Clips', d.items.length], ['Audio', fmtHours(totalSec)], ['Classes', nClasses], ['Exportable', d.exportable]]
        .map(([k, v]) => `<div class="bg-white rounded-xl2 shadow-card p-3.5"><div class="text-[11px] uppercase tracking-wider text-ink-muted">${k}</div><div class="text-xl font-bold mt-1">${v}</div></div>`).join('')}
    </div>

    ${classBalance(d)}

    <div class="grid lg:grid-cols-2 gap-x-4 items-start">
      ${d.items.length ? exportPanel(d) : ''}
      ${sharePanel(d)}
    </div>

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5">
      <div class="font-semibold mb-3">Clips</div>
      ${d.items.length ? `
        <div class="md:hidden divide-y divide-line/60">
          ${d.items.map((f) => `
            <div class="flex items-center gap-3 py-3">
              <a href="#/audio/${f.id}" class="min-w-0 flex-1">
                <div class="font-medium truncate">${f.label ? esc(f.label) : '<span class="text-ink-muted">No label</span>'}
                  ${f.label_source === 'auto' ? '<span class="text-xs text-ink-muted font-normal">(auto)</span>' : ''}</div>
                <div class="text-xs text-ink-muted mt-0.5 flex flex-wrap items-center gap-1.5">${reviewBadge(f.review_status)} ${fmtDuration(f.duration)} · ${fmtDate(f.recorded_at || f.uploaded_at)}</div>
              </a>
              <button class="rmItem w-10 h-10 rounded-full grid place-items-center text-ink-muted hover:text-red-600 hover:bg-red-50" data-id="${f.id}" aria-label="Remove from folder">${icon('close', { size: 16 })}</button>
            </div>`).join('')}
        </div>
        <div class="hidden md:block overflow-x-auto">
          <table class="w-full text-sm">
            <thead><tr class="text-left text-xs text-ink-muted border-b border-line">
              <th class="py-2.5 pr-3 font-medium">Label</th>
              <th class="py-2.5 pr-3 font-medium">Review</th><th class="py-2.5 pr-3 font-medium">Duration</th>
              <th class="py-2.5 pr-3 font-medium">Source</th><th class="py-2.5 pr-3 font-medium">Status</th>
              <th class="py-2.5 pr-3 font-medium">Recorded</th><th class="py-2.5 font-medium"></th>
            </tr></thead>
            <tbody>${d.items.map((f) => `
              <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
                <td class="py-3 pr-3"><a class="text-brand hover:underline font-medium" href="#/audio/${f.id}">${f.label
                  ? `${esc(f.label)}${f.label_source === 'auto' ? ' <span class="text-xs text-ink-muted">(auto)</span>' : ''}`
                  : '<span class="text-ink-muted">—</span>'}</a>
                  <div class="text-xs text-ink-muted truncate max-w-[16rem]">${esc(f.filename)}</div></td>
                <td class="py-3 pr-3">${reviewBadge(f.review_status)}</td>
                <td class="py-3 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
                <td class="py-3 pr-3">${sourceBadge(f.source)}</td>
                <td class="py-3 pr-3">${statusBadge(f.status)}</td>
                <td class="py-3 pr-3 whitespace-nowrap text-ink-secondary">${fmtDate(f.recorded_at || f.uploaded_at)}</td>
                <td class="py-3 text-right">
                  <button class="rmItem inline-flex items-center gap-1 text-ink-muted hover:text-red-600 text-xs transition-colors"
                          data-id="${f.id}" title="Remove from folder">${icon('close', { size: 13 })} Remove</button>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`
      : emptyState('folder', 'This folder is empty',
          '<a class="text-brand hover:underline" href="#/record" data-record>Record</a> into it, or select files in the <a class="text-brand hover:underline" href="#/library">Library</a> and use “Add”')}
    </div>`;

  // "Record into folder" preselects this folder on the Record page.
  el.querySelectorAll('[data-record]').forEach((a) => a.addEventListener('click', () => {
    try { localStorage.setItem('sodama.recordFolder', JSON.stringify(d.id)); } catch { /* private mode */ }
  }));
  if (d.items.length) wireExport(el.querySelector('#exportPanel'), d);
  wireShare(el.querySelector('#sharePanel'), d, reload);
  el.querySelector('#editDs').addEventListener('click', () => editSheet(d, reload));

  el.querySelectorAll('.rmItem').forEach((b) => b.addEventListener('click', async () => {
    try {
      await api(`/datasets/${id}/items/${b.dataset.id}`, { method: 'DELETE' });
      toast('Removed from folder — the clip stays in your Library', 'success');
      reload();
    } catch (e) { toast(e.message, 'error'); }
  }));
  el.querySelector('#delDs').addEventListener('click', async () => {
    if (!confirm(`Delete folder “${d.name}”?${d.visibility === 'public' ? '\n\nIt will also disappear from Community.' : ''}\n\nThe audio files themselves are kept in your Library.`)) return;
    await api(`/datasets/${id}`, { method: 'DELETE' });
    toast('Folder deleted', 'success');
    location.hash = '#/datasets';
  });
}
