import { api, upload } from '../api.js';
import { createFolderSheet } from '../folders.js';
import { icon } from '../icons.js';
import { esc, toast, statusBadge, pageHeader, INPUT } from '../ui.js';

const ACCEPT = '.wav,.mp3,.flac,.ogg';
const POLL_MS = 2500;

export async function renderUpload(el) {
  el.innerHTML = `
    ${pageHeader('Upload audio',
      'WAV, MP3, FLAC or OGG — files are standardized to 16 kHz mono and classified automatically with YAMNet.')}

    <div class="bg-white rounded-xl2 shadow-card p-4 mb-3 flex flex-wrap items-end gap-2">
      <div class="flex-1 min-w-[200px]">
        <label class="block text-xs text-ink-muted mb-1.5" for="folderSel">Add uploads to folder</label>
        <select id="folderSel" class="${INPUT}"><option value="">No folder (Library only)</option></select>
      </div>
      <button id="newFolderBtn" class="inline-flex items-center gap-1.5 px-4 py-3 sm:py-2.5 rounded-full border border-line text-sm text-ink-secondary hover:border-brand hover:text-brand transition-colors">
        ${icon('plus', { size: 16 })} New folder</button>
    </div>

    <div id="dropzone"
         class="bg-white border-2 border-dashed border-line rounded-xl3 p-8 sm:p-14 text-center cursor-pointer
                transition-colors hover:border-brand hover:bg-brand-tint/30">
      <div class="w-16 h-16 rounded-full bg-page text-brand grid place-items-center mx-auto mb-4">
        ${icon('upload', { size: 26 })}
      </div>
      <div class="font-medium text-lg"><span class="hidden sm:inline">Drag and drop audio files here</span><span class="sm:hidden">Choose audio files</span></div>
      <div class="text-sm text-ink-muted mt-1.5">
        <span class="hidden sm:inline">or </span><span class="text-brand font-medium">browse your device</span> · up to 50 MB per file
      </div>
      <input id="fileInput" type="file" accept="${ACCEPT},audio/*" multiple class="hidden">
    </div>
    <p class="text-sm text-ink-muted text-center mt-3">Want to capture a sound right now?
      <a href="#/record" class="text-brand font-medium hover:underline">Record it instead</a></p>

    <div id="uploads" class="mt-5 space-y-3"></div>`;

  const dropzone = el.querySelector('#dropzone');
  const input = el.querySelector('#fileInput');
  const list = el.querySelector('#uploads');
  const folderSel = el.querySelector('#folderSel');
  const HOVER = ['border-brand', 'bg-brand-tint/30'];

  const folders = await api('/datasets');
  const paintFolders = (selected) => {
    folderSel.innerHTML = '<option value="">No folder (Library only)</option>'
      + folders.map((d) => `<option value="${d.id}" ${d.id === selected ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  };
  paintFolders();
  el.querySelector('#newFolderBtn').addEventListener('click', async () => {
    const ds = await createFolderSheet();
    if (ds) { folders.unshift(ds); paintFolders(ds.id); }
  });

  dropzone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
  dropzone.addEventListener('dragover', (e) => { e.preventDefault(); dropzone.classList.add(...HOVER); });
  dropzone.addEventListener('dragleave', () => dropzone.classList.remove(...HOVER));
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove(...HOVER);
    handleFiles(e.dataTransfer.files);
  });

  function handleFiles(files) {
    [...files].forEach((file) => {
      const ext = '.' + file.name.split('.').pop().toLowerCase();
      if (!ACCEPT.includes(ext)) { toast(`${file.name}: unsupported file type`, 'error'); return; }
      uploadOne(file);
    });
  }

  function uploadOne(file) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-xl2 shadow-card p-4 sm:p-5 fade-in';
    card.innerHTML = `
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-3 min-w-0">
          <span class="w-9 h-9 rounded-full bg-page text-brand grid place-items-center shrink-0">
            ${icon('clip', { size: 16 })}
          </span>
          <div class="min-w-0">
            <div class="font-medium truncate">${esc(file.name)}</div>
            <div class="text-xs text-ink-muted">${(file.size / 1024 / 1024).toFixed(2)} MB</div>
          </div>
        </div>
        <div class="text-sm shrink-0 text-ink-secondary" data-role="state">
          <span data-role="pct" class="tabular-nums">0%</span>
        </div>
      </div>
      <div class="h-1.5 bg-page rounded-full mt-3.5 overflow-hidden">
        <div class="h-full bg-brand rounded-full transition-all" style="width:0%" data-role="bar"></div>
      </div>
      <div class="mt-2.5 text-sm" data-role="result"></div>`;
    list.prepend(card);

    const bar = card.querySelector('[data-role=bar]');
    const state = card.querySelector('[data-role=state]');
    const result = card.querySelector('[data-role=result]');

    const form = new FormData();
    form.append('file', file);
    if (folderSel.value) form.append('dataset_id', folderSel.value);

    upload('/upload', form, (pct) => {
      bar.style.width = pct + '%';
      const p = card.querySelector('[data-role=pct]');
      if (p) p.textContent = pct + '%';
    }).then((row) => {
      bar.style.width = '100%';
      state.innerHTML = statusBadge(row.status);
      result.innerHTML = '<span class="text-ink-muted">Classifying with YAMNet…</span>';
      poll(row.id);
    }).catch((e) => {
      state.innerHTML = statusBadge('error');
      result.innerHTML = `<span class="text-red-600">${esc(e.message)}</span>`;
    });

    async function poll(id) {
      try {
        const d = await api(`/audio/${id}`);
        state.innerHTML = statusBadge(d.status);
        if (d.status === 'done') {
          const top = d.top_classes[0];
          result.innerHTML = `
            <span class="text-ink-secondary">Classified —
              top class <span class="font-medium text-ink">${esc(top ? top.class_name : 'n/a')}</span>
              ${top ? `<span class="text-ink-muted">(${(top.mean_confidence * 100).toFixed(0)}% mean confidence)</span>` : ''}
            </span>
            <a class="text-brand hover:underline ml-1.5 inline-flex items-center gap-1" href="#/audio/${id}">
              Review label ${icon('arrowRight', { size: 14 })}</a>`;
        } else if (d.status === 'error') {
          result.innerHTML = '<span class="text-red-600">Classification failed — check the server logs.</span>';
        } else {
          setTimeout(() => poll(id), POLL_MS);
        }
      } catch { if (card.isConnected) setTimeout(() => poll(id), POLL_MS); }
    }
  }
}
