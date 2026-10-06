// Folder = dataset. Creating one is the same everywhere (Record, Upload,
// Datasets), so the sheet lives here.
import { api } from './api.js';
import { icon } from './icons.js';
import { esc, sheet, toast, INPUT, TEXTAREA } from './ui.js';

export const splitClasses = (text) => [...new Set(
  String(text || '').split(/[,\n]/).map((s) => s.trim().replace(/\s+/g, ' ')).filter(Boolean))];

export const classChips = (labels, { removable = false } = {}) => labels.map((l) => `
  <span class="inline-flex items-center gap-1 pl-3 ${removable ? 'pr-1.5' : 'pr-3'} py-1 rounded-full bg-page border border-line text-xs">
    ${esc(l)}${removable ? `<button type="button" class="rmClass w-5 h-5 grid place-items-center rounded-full hover:bg-white text-ink-muted" data-label="${esc(l)}" aria-label="Remove ${esc(l)}">${icon('close', { size: 11 })}</button>` : ''}
  </span>`).join('');

// Editable class list: type and press Enter / comma, tap × to remove.
export function classEditor(root, initial = []) {
  let labels = [...initial];
  const box = root.querySelector('.classBox');
  const input = root.querySelector('.classInput');
  const paint = () => {
    box.innerHTML = classChips(labels, { removable: true });
    box.querySelectorAll('.rmClass').forEach((b) => b.addEventListener('click', () => {
      labels = labels.filter((l) => l !== b.dataset.label); paint();
    }));
  };
  const commit = () => {
    for (const l of splitClasses(input.value)) {
      if (!labels.some((x) => x.toLowerCase() === l.toLowerCase())) labels.push(l);
    }
    input.value = '';
    paint();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); }
  });
  input.addEventListener('blur', commit);
  paint();
  return { get: () => { commit(); return labels; } };
}

export const classEditorHTML = (hint) => `
  <div class="classEditor">
    <label class="block text-sm font-medium text-ink-secondary mb-1.5">Classes <span class="font-normal text-ink-muted">(optional)</span></label>
    <input class="classInput ${INPUT}" placeholder="Type a class, press Enter — e.g. Honda" enterkeyhint="done">
    <div class="classBox flex flex-wrap gap-1.5 mt-2"></div>
    <p class="text-xs text-ink-muted mt-1.5">${hint}</p>
  </div>`;

// Opens the "New folder" sheet; resolves with the created dataset (or null).
export function createFolderSheet({ name = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet('New folder', `
      <form id="newFolder" class="space-y-4 pb-2">
        <div>
          <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="fName">Folder name</label>
          <input id="fName" name="name" required maxlength="80" value="${esc(name)}"
                 placeholder="e.g. Malaysian car engines" class="${INPUT}">
        </div>
        <div>
          <label class="block text-sm font-medium text-ink-secondary mb-1.5" for="fDesc">What is it for? <span class="font-normal text-ink-muted">(optional)</span></label>
          <textarea id="fDesc" name="description" rows="2" maxlength="2000"
                    placeholder="e.g. Engine idle sounds to train a car-brand classifier" class="${TEXTAREA}"></textarea>
        </div>
        ${classEditorHTML('The labels you plan to record. They appear as one-tap buttons, so every clip is spelled the same way.')}
        <p class="text-xs text-ink-muted bg-page rounded-xl2 p-3">
          A folder is a <span class="font-medium text-ink-secondary">dataset</span>: you can export it for training, or share it in Community later.
        </p>
        <button class="w-full inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-3 font-medium hover:bg-brand-dark transition-colors">
          ${icon('plus', { size: 18 })} Create folder</button>
      </form>`, { onClose: () => { if (!done) resolve(null); } });

    const editor = classEditor(s.el.querySelector('.classEditor'));
    s.el.querySelector('#newFolder').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      try {
        const ds = await api.json('/datasets', 'POST',
          { name: f.name.trim(), description: f.description, labels: editor.get() });
        toast(`Folder “${ds.name}” created`, 'success');
        done = true;
        s.close();
        resolve({ ...ds, item_count: 0 });
      } catch (err) { toast(err.message, 'error'); }
    });
  });
}
