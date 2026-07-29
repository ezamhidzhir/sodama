// Shared UI helpers — badges, formatting, toasts, shared audio player.
import { icon } from './icons.js';

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

// Status colours are reserved and always ship with an icon + label,
// so state is never carried by colour alone.
const STATUS = {
  pending:    { cls: 'bg-[#FBF3E0] text-[#8A6208] border-[#EBD9AE]', ic: 'clock' },
  processing: { cls: 'bg-[#E4EFF6] text-[#22587A] border-[#C2DCEA]', ic: 'gear' },
  done:       { cls: 'bg-brand-tint text-brand-dark border-brand/25', ic: 'checkCircle' },
  error:      { cls: 'bg-red-50 text-red-700 border-red-200', ic: 'alert' },
};

export const statusBadge = (s) => {
  const v = STATUS[s] ?? STATUS.pending;
  return `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border ${v.cls}">
    ${icon(v.ic, { size: 13 })}${esc(s)}</span>`;
};

export const sourceBadge = (s) => s === 'esp32'
  ? `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs bg-[#E4EFF6] text-[#22587A] border border-[#C2DCEA]">${icon('device', { size: 13 })}ESP32</span>`
  : `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs bg-brand-tint text-brand-dark border border-brand/25">${icon('upload', { size: 13 })}Upload</span>`;

export const confBar = (c) => `
  <div class="flex items-center gap-2.5 min-w-[96px]">
    <div class="h-1.5 w-16 bg-page rounded-full overflow-hidden">
      <div class="h-full bg-brand rounded-full" style="width:${Math.round(c * 100)}%"></div>
    </div>
    <span class="text-xs text-ink-secondary tabular-nums">${(c * 100).toFixed(0)}%</span>
  </div>`;

export const spinner = (label = 'Loading') => `
  <div class="flex items-center justify-center gap-3 py-20 text-ink-muted text-sm">
    <svg class="animate-spin h-5 w-5 text-brand" viewBox="0 0 24 24" fill="none">
      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="3.5"/>
      <path class="opacity-80" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/>
    </svg>${esc(label)}
  </div>`;

export const emptyState = (iconName, title, hint) => `
  <div class="text-center py-16">
    <div class="w-14 h-14 rounded-full bg-page text-brand grid place-items-center mx-auto mb-4">
      ${icon(iconName, { size: 24 })}
    </div>
    <div class="font-medium text-ink">${esc(title)}</div>
    ${hint ? `<div class="text-sm text-ink-muted mt-1.5">${hint}</div>` : ''}
  </div>`;

// Page heading used across every screen.
export const pageHeader = (title, subtitle, actions = '') => `
  <div class="flex flex-wrap items-end justify-between gap-4 mb-6">
    <div>
      <h1 class="text-[1.6rem] font-bold tracking-tight">${esc(title)}</h1>
      ${subtitle ? `<p class="text-sm text-ink-muted mt-1">${subtitle}</p>` : ''}
    </div>
    ${actions ? `<div class="flex gap-2.5">${actions}</div>` : ''}
  </div>`;

export const btnPrimary = (label, iconName, attrs = '') =>
  `<button ${attrs} class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">
     ${iconName ? icon(iconName, { size: 16 }) : ''}${esc(label)}</button>`;

export const linkPrimary = (label, iconName, href, attrs = '') =>
  `<a href="${href}" ${attrs} class="inline-flex items-center gap-2 bg-brand text-white text-sm px-5 py-2.5 rounded-full hover:bg-brand-dark transition-colors">
     ${iconName ? icon(iconName, { size: 16 }) : ''}${esc(label)}</a>`;

export const btnGhost = (label, iconName, attrs = '') =>
  `<button ${attrs} class="inline-flex items-center gap-2 bg-white border border-line text-ink-secondary text-sm px-5 py-2.5 rounded-full hover:border-brand hover:text-brand transition-colors">
     ${iconName ? icon(iconName, { size: 16 }) : ''}${esc(label)}</button>`;

export function toast(msg, type = 'info') {
  const styles = {
    info: 'bg-ink text-white',
    success: 'bg-brand text-white',
    error: 'bg-red-600 text-white',
  };
  const icons = { info: 'leaf', success: 'check', error: 'alert' };
  const el = document.createElement('div');
  el.className = `${styles[type]} pl-4 pr-5 py-3 rounded-full shadow-lift text-sm fade-in max-w-sm flex items-center gap-2.5`;
  el.innerHTML = `${icon(icons[type], { size: 16 })}<span></span>`;
  el.querySelector('span').textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .25s'; }, 3600);
  setTimeout(() => el.remove(), 3900);
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
