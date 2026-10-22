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

// The human verdict, a separate axis from the pipeline `status` above. Both can
// show in one table row, so each carries its own icon and word — the column
// header plus the label is what tells them apart, never the colour.
const REVIEW = {
  unreviewed: { cls: 'bg-white text-ink-muted border-line', ic: 'helpCircle', text: 'Unreviewed' },
  approved:   { cls: 'bg-brand-tint text-brand-dark border-brand/25', ic: 'checkCircle', text: 'Approved' },
  rejected:   { cls: 'bg-accent-tint text-accent-dark border-accent/30', ic: 'closeCircle', text: 'Rejected' },
};

export const reviewBadge = (s) => {
  const v = REVIEW[s] ?? REVIEW.unreviewed;
  return `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border ${v.cls}">
    ${icon(v.ic, { size: 13 })}${v.text}</span>`;
};

// Where a label came from. `auto` is deliberately the loudest: an unverified
// YAMNet guess is the one thing a trainer must not mistake for ground truth.
const LABEL_SOURCE = {
  human_annotated: { cls: 'bg-brand-tint text-brand-dark border-brand/25', text: 'Labelled when recorded' },
  human_confirmed: { cls: 'bg-brand-tint text-brand-dark border-brand/25', text: 'Confirmed by reviewer' },
  human_corrected: { cls: 'bg-brand-tint text-brand-dark border-brand/25', text: 'Corrected by reviewer' },
  auto:            { cls: 'bg-[#FBF3E0] text-[#8A6208] border-[#EBD9AE]', text: 'Unverified auto-label' },
};

export const labelSourceBadge = (s) => {
  const v = LABEL_SOURCE[s] ?? LABEL_SOURCE.auto;
  return `<span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border ${v.cls}">${v.text}</span>`;
};

const SOURCE = {
  device:    { cls: 'bg-[#E4EFF6] text-[#22587A] border-[#C2DCEA]', ic: 'device', text: 'Device' },
  recording: { cls: 'bg-accent-tint text-accent-dark border-accent/30', ic: 'mic', text: 'Recorded' },
  upload:    { cls: 'bg-brand-tint text-brand-dark border-brand/25', ic: 'upload', text: 'Upload' },
};
export const SOURCE_LABEL = { device: 'Device', recording: 'Recorded', upload: 'Upload' };

export const sourceBadge = (s) => {
  const v = SOURCE[s] ?? SOURCE.upload;
  return `<span class="inline-flex items-center gap-1.5 pl-2 pr-2.5 py-1 rounded-full text-xs border whitespace-nowrap ${v.cls}">${icon(v.ic, { size: 13 })}${v.text}</span>`;
};

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
  <div class="flex flex-wrap items-end justify-between gap-3 sm:gap-4 mb-5 sm:mb-6">
    <div class="min-w-0">
      <h1 class="text-[1.35rem] sm:text-[1.6rem] font-bold tracking-tight">${esc(title)}</h1>
      ${subtitle ? `<p class="text-sm text-ink-muted mt-1">${subtitle}</p>` : ''}
    </div>
    ${actions ? `<div class="flex flex-wrap gap-2.5">${actions}</div>` : ''}
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
  el.className = `${styles[type]} pl-4 pr-5 py-3 rounded-full shadow-lift text-sm fade-in max-w-sm flex items-center gap-2.5 pointer-events-auto`;
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

// ------------------------------------------------------------------ people

const initials = (name) => (name || '?').split(/[\s_.]+/).filter(Boolean).slice(0, 2)
  .map((w) => w[0].toUpperCase()).join('');

// Round avatar: the uploaded picture, or initials on the brand tint.
export const avatar = (p, size = 36) => {
  const style = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px`;
  return p?.avatar_url
    ? `<img src="${esc(p.avatar_url)}" alt="" style="${style}" class="rounded-full object-cover shrink-0 bg-page">`
    : `<span style="${style}" class="rounded-full bg-accent-tint text-accent-dark font-semibold grid place-items-center shrink-0">${esc(initials(p?.full_name || p?.username))}</span>`;
};

export const ROLES = {
  student: 'Student', researcher: 'Researcher', lecturer: 'Lecturer',
  industry: 'Industry engineer', hobbyist: 'Hobbyist', other: 'Other',
};

export const LICENSES = {
  'CC-BY-4.0': { name: 'CC BY 4.0', hint: 'Anyone may use it, even commercially, if they credit you' },
  'CC-BY-SA-4.0': { name: 'CC BY-SA 4.0', hint: 'Use with credit; derived datasets must share alike' },
  'CC-BY-NC-4.0': { name: 'CC BY-NC 4.0', hint: 'Use with credit, non-commercial only' },
  'CC0-1.0': { name: 'CC0 (public domain)', hint: 'No conditions at all' },
};

// ------------------------------------------------------------------ bottom sheet

// A modal that slides up from the bottom on phones and centres on desktop.
// `body` is HTML; returns { el, close }. Clicking the backdrop or Escape closes.
export function sheet(title, body, { onClose } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'fixed inset-0 z-[60] flex items-end sm:items-center justify-center';
  wrap.innerHTML = `
    <div class="absolute inset-0 bg-ink/40 fade-in" data-close></div>
    <div role="dialog" aria-modal="true" aria-label="${esc(title)}"
         class="relative bg-white w-full sm:max-w-lg rounded-t-xl3 sm:rounded-xl3 shadow-lift max-h-[92vh] overflow-y-auto sheet-in"
         style="padding-bottom:max(1.25rem, env(safe-area-inset-bottom))">
      <div class="sticky top-0 bg-white z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-line/60">
        <span class="sm:hidden absolute left-1/2 -translate-x-1/2 top-1.5 w-10 h-1 rounded-full bg-line"></span>
        <div class="font-semibold text-lg">${esc(title)}</div>
        <button data-close class="w-10 h-10 -mr-2 rounded-full grid place-items-center text-ink-muted hover:bg-page" aria-label="Close">${icon('close', { size: 18 })}</button>
      </div>
      <div class="px-5 pt-4">${body}</div>
    </div>`;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('overflow-hidden');
    onClose?.();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  wrap.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  document.addEventListener('keydown', onKey);
  document.body.appendChild(wrap);
  document.body.classList.add('overflow-hidden');
  wrap.querySelector('input, textarea, select')?.focus({ preventScroll: true });
  return { el: wrap, close };
}

export const INPUT = 'field w-full bg-white border border-line rounded-full px-4 py-3 sm:py-2.5 text-[16px] sm:text-sm transition-shadow';
export const TEXTAREA = 'field w-full bg-white border border-line rounded-2xl px-4 py-3 sm:py-2.5 text-[16px] sm:text-sm transition-shadow';

// ------------------------------------------------------------------ leave guard

// A page holding unsaved work (a recording) registers a guard; the router asks
// it before navigating away. Returning false keeps the user on the page.
let leaveGuard = null;
export const setLeaveGuard = (fn) => { leaveGuard = fn; };
export function canLeave() {
  if (leaveGuard && !leaveGuard()) return false;
  leaveGuard = null;
  window.onbeforeunload = null;
  return true;
}

// How much of the user's storage allowance is used.
export function quotaBar(q) {
  if (!q || !q.quota_seconds) return '';
  const pct = Math.min(100, (q.used_seconds / q.quota_seconds) * 100);
  const min = (x) => (x / 60).toFixed(1);
  const tone = pct >= 90 ? 'bg-accent' : 'bg-brand';
  return `
    <div class="bg-white rounded-xl2 shadow-card px-4 py-3">
      <div class="flex justify-between text-xs text-ink-muted mb-1.5">
        <span>Storage used</span>
        <span class="tabular-nums">${min(q.used_seconds)} of ${min(q.quota_seconds)} min</span>
      </div>
      <div class="h-1.5 bg-page rounded-full overflow-hidden">
        <div class="h-full ${tone} rounded-full" style="width:${pct}%"></div>
      </div>
      ${pct >= 90 ? '<div class="text-xs text-accent-dark mt-1.5">Almost full — delete files you no longer need. Clips you cut from a recording use no extra storage.</div>' : ''}
    </div>`;
}
