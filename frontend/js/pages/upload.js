import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, toast, statusBadge, pageHeader } from '../ui.js';

const ACCEPT = '.wav,.mp3,.flac,.ogg';
const POLL_MS = 2500;

export async function renderUpload(el) {
  el.innerHTML = `
    ${pageHeader('Upload audio',
      'WAV, MP3, FLAC or OGG — files are standardized to 16 kHz mono and classified automatically with YAMNet.')}

    <div id="dropzone"
         class="bg-white border-2 border-dashed border-line rounded-xl3 p-14 text-center cursor-pointer
                transition-colors hover:border-brand hover:bg-brand-tint/30">
      <div class="w-16 h-16 rounded-full bg-page text-brand grid place-items-center mx-auto mb-4">
        ${icon('upload', { size: 26 })}
      </div>
      <div class="font-medium text-lg">Drag and drop audio files here</div>
      <div class="text-sm text-ink-muted mt-1.5">
        or <span class="text-brand font-medium">browse from your computer</span> · up to 50 MB per file
      </div>
      <input id="fileInput" type="file" accept="${ACCEPT}" multiple class="hidden">
    </div>

    <div id="uploads" class="mt-5 space-y-3"></div>`;

  const dropzone = el.querySelector('#dropzone');
  const input = el.querySelector('#fileInput');
  const list = el.querySelector('#uploads');
  const HOVER = ['border-brand', 'bg-brand-tint/30'];

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
    card.className = 'bg-white rounded-xl2 shadow-card p-5 fade-in';
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
          Uploading <span data-role="pct" class="tabular-nums">0%</span>
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

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const pct = Math.round((e.loaded / e.total) * 100);
      bar.style.width = pct + '%';
      card.querySelector('[data-role=pct]').textContent = pct + '%';
    };
    xhr.onerror = () => {
      state.innerHTML = statusBadge('error');
      result.innerHTML = '<span class="text-red-600">Network error — the upload did not reach the server.</span>';
    };
    xhr.onload = () => {
      if (xhr.status !== 201) {
        let msg = xhr.statusText;
        try { msg = JSON.parse(xhr.responseText).detail; } catch { /* keep statusText */ }
        state.innerHTML = statusBadge('error');
        result.innerHTML = `<span class="text-red-600">${esc(msg)}</span>`;
        return;
      }
      bar.style.width = '100%';
      const row = JSON.parse(xhr.responseText);
      state.innerHTML = statusBadge(row.status);
      result.innerHTML = '<span class="text-ink-muted">Classifying with YAMNet…</span>';
      poll(row.id);
    };
    xhr.send(form);

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
              View details ${icon('arrowRight', { size: 14 })}</a>`;
        } else if (d.status === 'error') {
          result.innerHTML = '<span class="text-red-600">Classification failed — check the server logs.</span>';
        } else {
          setTimeout(() => poll(id), POLL_MS);
        }
      } catch { setTimeout(() => poll(id), POLL_MS); }
    }
  }
}
