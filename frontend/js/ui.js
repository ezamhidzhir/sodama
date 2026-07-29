// Shared UI helpers — badges, formatting, toasts, shared audio player.

export const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

export const fmtDuration = (sec) => {
  if (sec == null) return '—';
  if (sec < 60) return `${Number(sec).toFixed(1)}s`;
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}m ${s}s`;
};

export const fmtHours = (sec) => {
  if (sec < 3600) return `${(sec / 60).toFixed(1)} min`;
  return `${(sec / 3600).toFixed(2)} hrs`;
};

export const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleString('en-MY', { dateStyle: 'medium', timeStyle: 'short' })
  : '—';

export const timeAgo = (iso) => {
  if (!iso) return 'never';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const STATUS_STYLES = {
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  done:       'bg-green-50 text-green-700 border-green-200',
  error:      'bg-red-50 text-red-700 border-red-200',
};
const STATUS_ICONS = { pending: '⏳', processing: '⚙️', done: '✅', error: '⚠️' };

export const statusBadge = (s) =>
  `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border ${STATUS_STYLES[s] || ''}">${STATUS_ICONS[s] || ''} ${esc(s)}</span>`;

export const sourceBadge = (s) => s === 'esp32'
  ? '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-violet-50 text-violet-700 border border-violet-200">📡 esp32</span>'
  : '<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-gray-100 text-ink-secondary border border-grid">⬆️ upload</span>';

export const confBar = (c) => `
  <div class="flex items-center gap-2 min-w-[90px]">
    <div class="h-1.5 w-14 bg-gray-200 rounded-full overflow-hidden">
      <div class="h-full bg-brand rounded-full" style="width:${Math.round(c * 100)}%"></div>
    </div>
    <span class="text-xs text-ink-secondary tabular-nums">${(c * 100).toFixed(0)}%</span>
  </div>`;

export const spinner = (label = 'Loading…') => `
  <div class="flex items-center justify-center gap-3 py-16 text-ink-muted">
    <svg class="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>${esc(label)}
  </div>`;

export const emptyState = (icon, title, hint) => `
  <div class="text-center py-14 text-ink-muted">
    <div class="text-4xl mb-3">${icon}</div>
    <div class="font-medium text-ink-secondary">${esc(title)}</div>
    ${hint ? `<div class="text-sm mt-1">${hint}</div>` : ''}
  </div>`;

export function toast(msg, type = 'info') {
  const colors = { info: 'bg-ink text-white', success: 'bg-green-600 text-white', error: 'bg-red-600 text-white' };
  const el = document.createElement('div');
  el.className = `${colors[type]} px-4 py-2.5 rounded-lg shadow-lg text-sm fade-in max-w-sm`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

// One shared <audio> so only one clip plays at a time across the app.
let sharedAudio = null;
let playingId = null;
export function playAudio(id, url, onStateChange) {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.addEventListener('ended', () => { playingId = null; onStateChange?.(); });
  }
  if (playingId === id) {
    sharedAudio.pause();
    playingId = null;
  } else {
    sharedAudio.src = url;
    sharedAudio.play();
    playingId = id;
  }
  onStateChange?.();
  return playingId;
}
export const currentlyPlaying = () => playingId;
export function stopAudio() {
  if (sharedAudio) sharedAudio.pause();
  playingId = null;
}
