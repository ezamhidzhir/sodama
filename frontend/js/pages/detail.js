import { api } from '../api.js';
import { icon } from '../icons.js';
import { CAT } from './dashboard.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, toast, confBar,
         reviewBadge, labelSourceBadge } from '../ui.js';

const OTHER = '#626D58';

const BTN = 'inline-flex items-center gap-2 px-4 py-2.5 rounded-full text-sm transition-colors';

// ---------------------------------------------------------------- review panel
// The step between "YAMNet guessed something" and "this is training data".
// Until a person acts here the label stays flagged as unverified, and the
// dataset export says so in every row.

function reviewPanel(d) {
  const reviewed = d.review_status !== 'unreviewed';
  const pred = d.predicted_label
    ? `${esc(d.predicted_label)} <span class="text-ink-muted text-sm tabular-nums">${(d.predicted_confidence * 100).toFixed(0)}%</span>`
    : '<span class="text-ink-muted">no prediction</span>';

  const summary = reviewed ? `
    <div class="rounded-xl2 ${d.review_status === 'approved' ? 'bg-brand-tint/50' : 'bg-accent-tint/50'} p-4 mb-4">
      ${d.review_status === 'rejected' ? `
        <div class="text-sm">This clip was rejected and will be left out of every dataset export.</div>`
      : `
        <div class="text-xs text-ink-muted mb-1.5">Final label</div>
        <div class="flex flex-wrap items-center gap-2.5">
          <span class="text-lg font-semibold">${esc(d.label ?? '—')}</span>
          ${labelSourceBadge(d.label_source)}
        </div>
        ${d.label_source === 'human_corrected' && d.predicted_label
          ? `<div class="text-xs text-ink-muted mt-2">Model had predicted ${pred}</div>` : ''}`}
      <div class="text-xs text-ink-muted mt-2.5">
        ${d.label_source === 'human_annotated' ? 'Named while recording' : 'Reviewed'} by ${esc(d.reviewed_by || 'unknown')} · ${fmtDate(d.reviewed_at)}
      </div>
      ${d.label_source === 'human_annotated' && d.predicted_label ? `
        <div class="text-xs text-ink-muted mt-1">YAMNet hears it as ${pred}</div>` : ''}
      ${d.review_note ? `<div class="text-sm mt-2 pt-2 border-t border-line/70">${esc(d.review_note)}</div>` : ''}
    </div>` : `
    <div class="rounded-xl2 bg-page p-4 mb-4">
      <div class="text-xs text-ink-muted mb-1.5">Model prediction</div>
      <div class="flex flex-wrap items-center gap-3">
        <span class="text-lg font-semibold">${pred}</span>
        ${labelSourceBadge('auto')}
      </div>
    </div>`;

  const actions = reviewed ? `
    <button id="correctBtn" class="${BTN} border border-line bg-white text-ink-secondary hover:border-brand hover:text-brand">
      ${icon('pencil', { size: 16 })} Change label</button>
    <button id="reopenBtn" class="${BTN} border border-line bg-white text-ink-secondary hover:border-accent hover:text-accent">
      ${icon('helpCircle', { size: 16 })} Reopen for review</button>`
  : `
    <button id="approveBtn" class="${BTN} bg-brand text-white hover:bg-brand-dark ${d.predicted_label ? '' : 'hidden'}">
      ${icon('check', { size: 16 })} Approve this label</button>
    <button id="correctBtn" class="${BTN} border border-line bg-white text-ink-secondary hover:border-brand hover:text-brand">
      ${icon('pencil', { size: 16 })} ${d.predicted_label ? 'Correct label' : 'Set label'}</button>
    <button id="rejectBtn" class="${BTN} border border-accent/40 bg-white text-accent hover:bg-accent-tint/50">
      ${icon('closeCircle', { size: 16 })} Reject clip</button>`;

  // Suggestions: every class YAMNet saw in *this* clip, strongest first — those
  // are the plausible alternatives when the top guess is wrong.
  const folderClasses = [...new Set((d.datasets || []).flatMap((x) => x.labels || []))];
  const seen = [...new Set([...folderClasses, ...d.classifications.map((c) => c.class_name)])];
  const quick = [...new Set([...folderClasses.slice(0, 8), ...d.top_classes.slice(0, 5).map((c) => c.class_name)])];

  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4" id="reviewPanel">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div class="flex items-center gap-2.5">
          <span class="w-9 h-9 rounded-full bg-page text-brand grid place-items-center shrink-0">
            ${icon('review', { size: 17 })}</span>
          <div>
            <div class="font-semibold leading-tight">Label review</div>
            <div class="text-xs text-ink-muted">Confirm the model, or set the correct label</div>
          </div>
        </div>
        ${reviewBadge(d.review_status)}
      </div>

      ${summary}
      <div class="flex flex-wrap gap-2.5">${actions}</div>

      <form id="correctForm" class="hidden mt-4 rounded-xl2 border border-line p-4 space-y-3">
        <div>
          <label class="block text-xs text-ink-muted mb-1.5" for="labelInput">Correct label</label>
          <input id="labelInput" name="verified_label" list="labelOptions" required
                 value="${esc(d.verified_label || d.predicted_label || '')}"
                 placeholder="Type the class this clip really is"
                 class="field w-full bg-white border border-line rounded-full px-4 py-2.5 text-sm transition-shadow">
          <datalist id="labelOptions">${seen.map((c) => `<option value="${esc(c)}">`).join('')}</datalist>
        </div>
        ${quick.length ? `
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs text-ink-muted mr-1">Suggestions</span>
            ${quick.map((c) => `
              <button type="button" class="quickPick text-xs px-3 py-1.5 rounded-full border border-line bg-white hover:border-brand hover:text-brand transition-colors"
                      data-label="${esc(c)}">${esc(c)}</button>`).join('')}
          </div>` : ''}
        <input name="note" maxlength="500" placeholder="Note (optional) — why this label?"
               value="${esc(d.review_note || '')}"
               class="field w-full bg-white border border-line rounded-full px-4 py-2.5 text-sm transition-shadow">
        <div class="flex gap-2.5 justify-end">
          <button type="button" id="cancelCorrect" class="${BTN} border border-line bg-white text-ink-secondary hover:border-accent hover:text-accent">Cancel</button>
          <button type="submit" class="${BTN} bg-brand text-white hover:bg-brand-dark">
            ${icon('check', { size: 16 })} Save label</button>
        </div>
      </form>

      <p class="text-xs text-ink-muted mt-4 pt-3 border-t border-line/60">
        Exports mark every row with where its label came from. Unreviewed clips ship as
        <span class="font-medium">unverified auto-labels</span>; rejected clips are left out entirely.
      </p>
    </div>`;
}

function wireReview(el, d, refresh) {
  const panel = el.querySelector('#reviewPanel');
  const form = panel.querySelector('#correctForm');

  const send = async (body, msg) => {
    try {
      await api(`/audio/${d.id}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      toast(msg, 'success');
      refresh();
    } catch (e) { toast(e.message, 'error'); }
  };

  panel.querySelector('#approveBtn')?.addEventListener('click',
    () => send({ review_status: 'approved' }, `Approved as "${d.predicted_label}"`));

  panel.querySelector('#rejectBtn')?.addEventListener('click', () => {
    if (!confirm('Reject this clip?\n\nIt stays in the Library but is excluded from every dataset export.')) return;
    send({ review_status: 'rejected' }, 'Clip rejected');
  });

  panel.querySelector('#reopenBtn')?.addEventListener('click',
    () => send({ review_status: 'unreviewed' }, 'Reopened — the label is unverified again'));

  panel.querySelector('#correctBtn')?.addEventListener('click', () => {
    form.classList.remove('hidden');
    form.querySelector('#labelInput').focus();
  });
  panel.querySelector('#cancelCorrect')?.addEventListener('click', () => form.classList.add('hidden'));
  panel.querySelectorAll('.quickPick').forEach((b) => b.addEventListener('click', () => {
    form.querySelector('#labelInput').value = b.dataset.label;
  }));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(form));
    send({ review_status: 'approved', verified_label: f.verified_label, note: f.note },
         `Label set to "${f.verified_label}"`);
  });
}

export async function renderDetail(el, id) {
  el.innerHTML = spinner();
  const d = await api(`/audio/${id}`);

  // Colour follows the class (assigned by mean confidence), never its rank in a filter.
  const classColor = {};
  d.top_classes.forEach((c, i) => { classColor[c.class_name] = CAT[i] ?? OTHER; });
  const colorOf = (name) => classColor[name] ?? OTHER;

  // top-1 class per window (windows overlap: 0.96s span, 0.48s hop)
  const byWindow = {};
  for (const c of d.classifications) {
    const k = c.window_start;
    if (!byWindow[k] || c.confidence > byWindow[k].confidence) byWindow[k] = c;
  }
  const windows = Object.values(byWindow).sort((a, b) => a.window_start - b.window_start);
  const { notes, recording_device, ...customMeta } = d.metadata;

  el.innerHTML = `
    <a href="#/library" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} Back to Library</a>

    <div class="flex flex-wrap items-start justify-between gap-4 mb-5 sm:mb-6">
      <div class="min-w-0">
        <h1 class="text-[1.35rem] sm:text-[1.6rem] font-bold tracking-tight break-words">${esc(d.label || d.filename)}</h1>
        ${d.label ? `<div class="text-sm text-ink-muted break-all mt-0.5">${esc(d.filename)}</div>` : ''}
        ${d.parent ? `
          <div class="text-sm text-ink-secondary mt-1.5">
            ${icon('clip', { size: 14 })} Clip ${fmt(d.clip_start)}–${fmt(d.clip_end)} of
            <a href="#/audio/${d.parent.id}" class="text-brand hover:underline break-all">${esc(d.parent.filename)}</a>
          </div>` : ''}
        <div class="flex flex-wrap items-center gap-2 mt-2.5 text-sm text-ink-secondary">
          ${sourceBadge(d.source)} ${statusBadge(d.status)}
          ${d.speech_removed_seconds > 0 ? `
            <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border bg-page border-line text-ink-secondary"
                  title="Human speech was detected and muted before this audio was stored">
              ${icon('lock', { size: 12 })} ${fmtSeconds(d.speech_removed_seconds)} of speech muted</span>` : ''}
          <span class="text-ink-muted">${fmtDuration(d.duration)} · ${d.sample_rate} Hz${d.parent ? ' · no extra storage' : ` · ${(d.file_size / 1024).toFixed(0)} KB`}</span>
        </div>
      </div>
      <div class="flex gap-2.5 shrink-0 w-full sm:w-auto">
        <a href="#/edit/${d.id}"
           class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-line bg-white text-sm text-ink-secondary hover:border-brand hover:text-brand transition-colors">
          ${icon('pencil', { size: 16 })} Edit</a>
        <a href="${d.file_url}" download
           class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-line bg-white text-sm text-ink-secondary hover:border-brand hover:text-brand transition-colors">
          ${icon('download', { size: 16 })} Download WAV</a>
        <button id="deleteBtn"
           class="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-full border border-red-200 bg-white text-red-600 text-sm hover:bg-red-50 transition-colors">
          ${icon('trash', { size: 16 })} Delete</button>
      </div>
    </div>

    ${reviewPanel(d)}
    ${infoCard(d)}

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4">
      <div class="flex items-center gap-4 mb-4">
        <button id="playBtn" class="w-12 h-12 rounded-full bg-brand text-white hover:bg-brand-dark transition-colors grid place-items-center shrink-0" aria-label="Play or pause">
          ${icon('play', { size: 18, fill: true })}
        </button>
        <div class="text-sm text-ink-secondary tabular-nums" id="timeLabel">0:00 / ${fmt(d.duration)}</div>
      </div>
      <div id="waveform"></div>
      <div class="mt-5">
        <div class="text-xs text-ink-muted mb-2">Classification timeline — top class per 0.96 s window · click a segment to jump</div>
        <div id="timeline" class="flex h-8 rounded-xl overflow-hidden border border-line"></div>
        <div class="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-xs text-ink-secondary" id="legend"></div>
      </div>
    </div>

    ${clipList(d)}
    ${splitPanel(d)}

    <div class="grid lg:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6">
        <div class="font-semibold mb-1">Top classes</div>
        <div class="text-xs text-ink-muted mb-4">Mean confidence across all windows</div>
        ${d.top_classes.length ? d.top_classes.map((c) => `
          <div class="flex items-center justify-between gap-3 py-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background:${colorOf(c.class_name)}"></span>
              <span class="truncate">${esc(c.class_name)}</span>
            </div>
            ${confBar(c.mean_confidence)}
          </div>`).join('') : '<div class="text-sm text-ink-muted">Not classified yet.</div>'}
        ${Object.keys(customMeta).length ? `
          <div class="font-semibold mt-6 mb-2.5">Metadata</div>
          ${Object.entries(customMeta).map(([k, v]) => `
            <div class="flex justify-between gap-3 text-sm py-2 border-b border-line/60 last:border-0">
              <span class="text-ink-muted">${esc(k)}</span><span class="text-right">${esc(v)}</span>
            </div>`).join('')}` : ''}
      </div>

      <div class="lg:col-span-2 bg-white rounded-xl2 shadow-card p-4 sm:p-6">
        <div class="font-semibold mb-1">Per-window results</div>
        <div class="text-xs text-ink-muted mb-4">${d.classifications.length} prediction rows logged</div>
        <div class="max-h-96 overflow-y-auto pr-1">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white"><tr class="text-left text-xs text-ink-muted border-b border-line">
              <th class="py-2.5 pr-3 font-medium">Window</th>
              <th class="py-2.5 pr-3 font-medium">Class</th>
              <th class="py-2.5 font-medium">Confidence</th>
            </tr></thead>
            <tbody>${d.classifications.map((c) => `
              <tr class="border-b border-line/50 last:border-0">
                <td class="py-2 pr-3 tabular-nums text-ink-secondary whitespace-nowrap">${c.window_start.toFixed(2)}–${c.window_end.toFixed(2)}s</td>
                <td class="py-2 pr-3">
                  <span class="inline-block w-2 h-2 rounded-full mr-2 align-middle" style="background:${colorOf(c.class_name)}"></span>${esc(c.class_name)}
                </td>
                <td class="py-2">${confBar(c.confidence)}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  // Only the panel is re-rendered after a verdict, so playback keeps running.
  const refreshReview = async () => {
    const fresh = await api(`/audio/${id}`);
    el.querySelector('#reviewPanel').outerHTML = reviewPanel(fresh);
    wireReview(el, fresh, refreshReview);
  };
  wireReview(el, d, refreshReview);

  // ---- waveform (precomputed peaks -> no audio decode needed) ----
  const ws = WaveSurfer.create({
    container: el.querySelector('#waveform'),
    url: d.download_url,
    peaks: d.waveform && d.waveform.length ? [d.waveform] : undefined,
    duration: d.duration,
    height: 88,
    waveColor: '#C5D6B2',
    progressColor: '#4C7438',
    cursorColor: '#7A5239',
    barWidth: 2,
    barGap: 1.5,
    barRadius: 3,
  });
  const regions = ws.registerPlugin(WaveSurfer.Regions.create());
  let ready = false;
  const whenReady = (fn) => { if (ready) fn(); else pending.push(fn); };
  const pending = [];
  const markReady = () => { if (ready) return; ready = true; pending.splice(0).forEach((fn) => fn()); };
  ws.once('decode', markReady);
  ws.once('ready', markReady);
  whenReady(() => (d.privacy_redactions || []).forEach(([start, end], i) => regions.addRegion({
    id: `muted-${i}`,
    start, end, drag: false, resize: false, color: 'rgba(98,109,88,0.18)',
    content: muteLabel(),
  })));
  wireSplit(el, d, ws, regions, whenReady);
  wireClipList(el, d);

  const playBtn = el.querySelector('#playBtn');
  const timeLabel = el.querySelector('#timeLabel');
  playBtn.addEventListener('click', () => ws.playPause());
  ws.on('play', () => { playBtn.innerHTML = icon('pause', { size: 18 }); });
  ws.on('pause', () => { playBtn.innerHTML = icon('play', { size: 18, fill: true }); });
  ws.on('timeupdate', (t) => { timeLabel.textContent = `${fmt(t)} / ${fmt(d.duration)}`; });

  // ---- timeline strip: segment per window, click to seek ----
  const timeline = el.querySelector('#timeline');
  if (windows.length && d.duration) {
    windows.forEach((w, i) => {
      const end = i === windows.length - 1 ? Math.min(w.window_end, d.duration) : windows[i + 1].window_start;
      const seg = document.createElement('button');
      seg.className = 'h-full cursor-pointer hover:opacity-70 transition-opacity';
      seg.style.width = `${((end - w.window_start) / d.duration) * 100}%`;
      seg.style.background = colorOf(w.class_name);
      seg.title = `${w.window_start.toFixed(2)}–${w.window_end.toFixed(2)}s — ${w.class_name} (${(w.confidence * 100).toFixed(0)}%)`;
      seg.addEventListener('click', () => { ws.seekTo(w.window_start / d.duration); ws.play(); });
      timeline.appendChild(seg);
    });
    // any window whose class falls outside the top list is drawn in the muted "other" colour
    const hasOther = windows.some((w) => !(w.class_name in classColor));
    el.querySelector('#legend').innerHTML = d.top_classes.map((c) => `
      <span class="inline-flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${colorOf(c.class_name)}"></span>${esc(c.class_name)}
      </span>`).join('') + (hasOther ? `
      <span class="inline-flex items-center gap-1.5 text-ink-muted">
        <span class="w-2.5 h-2.5 rounded-full" style="background:${OTHER}"></span>Other classes
      </span>` : '');
  } else {
    timeline.innerHTML = '<div class="w-full flex items-center justify-center text-xs text-ink-muted bg-page">No classification data yet</div>';
  }

  el.querySelector('#deleteBtn').addEventListener('click', async () => {
    const extra = d.clips.length ? `\n\nIts ${d.clips.length} clip${d.clips.length === 1 ? '' : 's'} will be deleted too.` : '';
    if (!confirm(`Delete "${d.filename}" permanently? This also removes its classifications and dataset links.${extra}`)) return;
    try {
      await api(`/audio/${id}`, { method: 'DELETE' });
      toast('Audio file deleted', 'success');
      location.hash = '#/library';
    } catch (e) { toast(e.message, 'error'); }
  });
}

// When, where and how the clip was captured, plus the folders it is in.
function infoCard(d) {
  const row = (ic, label, value) => value ? `
    <div class="flex gap-3 py-2.5 border-b border-line/60 last:border-0">
      <span class="w-8 h-8 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(ic, { size: 15 })}</span>
      <div class="min-w-0">
        <div class="text-xs text-ink-muted">${label}</div>
        <div class="text-sm break-words">${value}</div>
      </div>
    </div>` : '';
  const hasCoords = d.latitude != null && d.longitude != null;
  const where = d.location_name || (hasCoords ? `${d.latitude.toFixed(5)}, ${d.longitude.toFixed(5)}` : '');
  const map = hasCoords
    ? ` <a class="text-brand hover:underline whitespace-nowrap" target="_blank" rel="noopener"
          href="https://www.openstreetmap.org/?mlat=${d.latitude}&mlon=${d.longitude}#map=16/${d.latitude}/${d.longitude}">Open map</a>
        ${d.location_accuracy ? `<span class="text-xs text-ink-muted"> · ±${Math.round(d.location_accuracy)} m</span>` : ''}` : '';
  const folders = (d.datasets || []).map((x) =>
    `<a href="#/datasets/${x.id}" class="inline-flex items-center gap-1 text-xs px-2.5 py-1 mr-1 mb-1 rounded-full bg-page border border-line hover:border-brand hover:text-brand">${icon('folder', { size: 12 })}${esc(x.name)}</a>`).join('');
  const notes = d.metadata?.notes;
  const device = d.metadata?.recording_device;

  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4">
      <div class="font-semibold mb-1">Capture details</div>
      <div class="grid sm:grid-cols-2 gap-x-6">
        ${row('calendar', d.recorded_at ? 'Recorded' : 'Uploaded', fmtDate(d.recorded_at || d.uploaded_at))}
        ${row('pin', 'Location', where ? esc(where) + map : '')}
        ${row('mic', 'Recorded with', esc(device || ''))}
        ${row('folder', 'Folders', folders || '<span class="text-ink-muted">Not in any folder — add it from the Library</span>')}
        ${row('pencil', 'Note', esc(notes || ''))}
      </div>
    </div>`;
}

const fmt = (sec) => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};

const fmtSeconds = (sec) => (sec < 60 ? `${Math.round(sec)} s` : `${(sec / 60).toFixed(1)} min`);

function muteLabel() {
  const span = document.createElement('span');
  span.className = 'text-[10px] text-ink-muted px-1';
  span.textContent = 'speech muted';
  return span;
}

// ---------------------------------------------------------------- clips of this recording

function clipList(d) {
  if (!d.clips || !d.clips.length) return '';
  const unreviewed = d.clips.filter((c) => c.review_status === 'unreviewed' && c.label).length;
  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4" id="clipList">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div>
          <div class="font-semibold">Clips cut from this recording</div>
          <div class="text-xs text-ink-muted">${d.clips.length} clip${d.clips.length === 1 ? '' : 's'} · each has its own label and review</div>
        </div>
        ${unreviewed ? `
          <button id="approveAllClips" class="${BTN} bg-brand text-white hover:bg-brand-dark">
            ${icon('check', { size: 16 })} Approve ${unreviewed} suggested label${unreviewed === 1 ? '' : 's'}</button>` : ''}
      </div>
      <div class="divide-y divide-line/60 max-h-96 overflow-y-auto">
        ${d.clips.map((c) => `
          <a href="#/audio/${c.id}" class="flex items-center gap-3 py-2.5 hover:bg-page/60 -mx-2 px-2 rounded-xl">
            <span class="text-xs tabular-nums text-ink-muted w-20 sm:w-24 shrink-0">${fmt(c.clip_start)}–${fmt(c.clip_end)}</span>
            <span class="flex-1 min-w-0 truncate">${esc(c.label || 'No label')}</span>
            <span class="hidden sm:contents">${labelSourceBadge(c.label_source)}</span> ${reviewBadge(c.review_status)}
          </a>`).join('')}
      </div>
    </div>`;
}

function wireClipList(el, d) {
  el.querySelector('#approveAllClips')?.addEventListener('click', async () => {
    const ids = d.clips.filter((c) => c.review_status === 'unreviewed' && c.label).map((c) => c.id);
    if (!confirm(`Approve YAMNet's label for ${ids.length} clip(s)?\n\nOpen a clip first if you want to check or correct it.`)) return;
    try {
      await api('/audio/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review_status: 'approved', audio_file_ids: ids }),
      });
      toast(`${ids.length} clip(s) approved`, 'success');
      renderDetail(el, d.id);
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------- split into clips

const MODES = [
  ['auto', 'Follow the sound', 'Cut wherever YAMNet hears the sound change'],
  ['fixed', 'Every N seconds', 'Equal-length clips — what most models train on'],
  ['manual', 'Select by hand', 'Drag on the waveform to mark each clip'],
];
const SEG_COLORS = ['rgba(76,116,56,0.22)', 'rgba(42,111,151,0.22)', 'rgba(196,69,46,0.20)',
                    'rgba(122,82,57,0.22)', 'rgba(150,120,30,0.22)'];

function splitPanel(d) {
  if (d.duration < 1) return '';
  const field = 'field bg-white border border-line rounded-full px-3 py-2 text-sm';
  return `
    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6 mb-4" id="splitPanel">
      <div class="flex items-center gap-2.5 mb-1">
        <span class="w-9 h-9 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon('clip', { size: 17 })}</span>
        <div>
          <div class="font-semibold leading-tight">Split into clips</div>
          <div class="text-xs text-ink-muted">Turn one long recording into short clips that each get their own label — no extra storage used</div>
        </div>
      </div>

      <div class="flex flex-wrap gap-2 mt-4" id="modeTabs">
        ${MODES.map(([k, title], i) => `
          <button type="button" data-mode="${k}"
            class="modeTab text-sm px-4 py-2 rounded-full border ${i === 0 ? 'border-brand text-brand bg-brand-tint/40' : 'border-line text-ink-secondary'}">${title}</button>`).join('')}
      </div>
      <div class="text-xs text-ink-muted mt-2" id="modeHint">${MODES[0][2]}</div>

      <div class="flex flex-wrap items-end gap-3 mt-4">
        <label class="mode-auto text-xs text-ink-muted">Shortest clip
          <select id="minLength" class="${field} block mt-1">
            ${[0.5, 1, 2, 3, 5].map((v) => `<option value="${v}" ${v === 1 ? 'selected' : ''}>${v} s</option>`).join('')}
          </select></label>
        <label class="mode-auto inline-flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" id="skipSilence" checked> Leave out silence</label>
        <label class="mode-fixed hidden text-xs text-ink-muted">Clip length (seconds)
          <input id="fixedLength" type="number" min="0.5" max="600" step="0.5" value="3" class="${field} block mt-1 w-28"></label>
        <label class="mode-fixed hidden inline-flex items-center gap-2 text-sm pb-2">
          <input type="checkbox" id="keepShort"> Keep a shorter last clip</label>
        <button type="button" id="previewBtn" class="mode-auto mode-fixed ${BTN} border border-line bg-white text-ink-secondary hover:border-brand hover:text-brand">
          ${icon('eye', { size: 16 })} Preview cuts</button>
      </div>

      <div id="segList" class="mt-4"></div>

      <div id="splitOptions" class="hidden mt-4 pt-4 border-t border-line/60 space-y-2.5">
        ${d.verified_label ? `
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" id="inheritLabel" class="mt-1">
            <span>Give every clip this recording's label, <b>${esc(d.verified_label)}</b>, already approved
              <span class="block text-xs text-ink-muted">Only when the whole recording is that one sound. Otherwise each clip gets YAMNet's suggestion to review.</span></span>
          </label>` : ''}
        ${(d.datasets || []).length ? `
          <label class="flex items-start gap-2 text-sm">
            <input type="checkbox" id="replaceInFolders" checked class="mt-1">
            <span>Clips replace this recording in ${d.datasets.map((x) => `<b>${esc(x.name)}</b>`).join(', ')}
              <span class="block text-xs text-ink-muted">So an export never contains the same audio twice.</span></span>
          </label>` : ''}
        <div class="flex justify-end">
          <button type="button" id="createClipsBtn" class="${BTN} bg-brand text-white hover:bg-brand-dark">
            ${icon('check', { size: 16 })} <span>Create clips</span></button>
        </div>
      </div>
    </div>`;
}

function wireSplit(el, d, ws, regions, whenReady) {
  const panel = el.querySelector('#splitPanel');
  if (!panel) return;
  let mode = 'auto';
  let segs = [];          // { region, label, confidence, on }
  let dragOff = null;

  const clear = () => {
    segs.forEach((x) => x.region.remove());
    segs = [];
    renderList();
  };

  const addSeg = (start, end, label = null, confidence = null) => {
    const region = regions.addRegion({
      start, end, drag: true, resize: true,
      color: SEG_COLORS[segs.length % SEG_COLORS.length],
    });
    const seg = { region, label, confidence, on: true };
    segs.push(seg);
    region.on('update-end', renderList);
    return seg;
  };

  const setMode = (next) => {
    mode = next;
    panel.querySelectorAll('.modeTab').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('border-brand', on); b.classList.toggle('text-brand', on);
      b.classList.toggle('bg-brand-tint/40', on);
      b.classList.toggle('border-line', !on); b.classList.toggle('text-ink-secondary', !on);
    });
    panel.querySelector('#modeHint').textContent = MODES.find(([k]) => k === mode)[2];
    panel.querySelectorAll('.mode-auto, .mode-fixed').forEach((n) => n.classList.add('hidden'));
    panel.querySelectorAll(`.mode-${mode}`).forEach((n) => n.classList.remove('hidden'));
    const inherit = panel.querySelector('#inheritLabel');
    if (inherit) inherit.checked = mode === 'fixed';
    clear();
    dragOff?.();
    dragOff = null;
    if (mode === 'manual') {
      whenReady(() => {
        dragOff = regions.enableDragSelection({ color: SEG_COLORS[0] });
      });
    }
  };

  // A region drawn by dragging becomes a segment of its own.
  regions.on('region-created', (region) => {
    if (mode !== 'manual' || String(region.id).startsWith('muted-')
        || segs.some((x) => x.region === region)) return;
    region.setOptions({ color: SEG_COLORS[segs.length % SEG_COLORS.length] });
    segs.push({ region, label: null, confidence: null, on: true });
    region.on('update-end', renderList);
    renderList();
  });

  panel.querySelectorAll('.modeTab').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  panel.querySelector('#previewBtn').addEventListener('click', async () => {
    const body = mode === 'auto'
      ? { mode, min_length: +panel.querySelector('#minLength').value,
          skip_silence: panel.querySelector('#skipSilence').checked }
      : { mode, length: +panel.querySelector('#fixedLength').value,
          keep_short_last: panel.querySelector('#keepShort').checked };
    try {
      const res = await api(`/audio/${d.id}/segments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      clear();
      whenReady(() => {
        res.segments.forEach((x) => addSeg(x.start, x.end, x.label, x.confidence));
        renderList();
      });
      if (!res.segments.length) toast('No clips to make with these settings', 'error');
    } catch (e) { toast(e.message, 'error'); }
  });

  function renderList() {
    const list = panel.querySelector('#segList');
    const options = panel.querySelector('#splitOptions');
    segs.sort((a, b) => a.region.start - b.region.start);
    if (!segs.length) {
      list.innerHTML = mode === 'manual'
        ? '<div class="text-sm text-ink-muted">Drag across the waveform above to mark a clip. Drag its edges to adjust.</div>' : '';
      options.classList.add('hidden');
      return;
    }
    const chosen = segs.filter((x) => x.on).length;
    list.innerHTML = `
      <div class="text-xs text-ink-muted mb-2">${segs.length} clip${segs.length === 1 ? '' : 's'} — drag their edges on the waveform to adjust, untick any you don't want</div>
      <div class="divide-y divide-line/60 max-h-72 overflow-y-auto border border-line rounded-xl2 px-3">
        ${segs.map((x, i) => `
          <div class="flex items-center gap-3 py-2 text-sm">
            <input type="checkbox" class="segOn" data-i="${i}" ${x.on ? 'checked' : ''}>
            <span class="w-3 h-3 rounded-full shrink-0" style="background:${x.region.color}"></span>
            <span class="tabular-nums text-ink-secondary w-28 shrink-0">${fmt(x.region.start)}–${fmt(x.region.end)}</span>
            <span class="text-xs text-ink-muted tabular-nums w-12 shrink-0">${(x.region.end - x.region.start).toFixed(1)} s</span>
            <span class="flex-1 min-w-0 truncate">${esc(x.label || '')}</span>
            <button type="button" class="segPlay text-ink-muted hover:text-brand" data-i="${i}" title="Play this clip">${icon('play', { size: 14, fill: true })}</button>
            <button type="button" class="segDel text-ink-muted hover:text-red-600" data-i="${i}" title="Remove">${icon('close', { size: 14 })}</button>
          </div>`).join('')}
      </div>`;
    list.querySelectorAll('.segOn').forEach((c) => c.addEventListener('change', () => {
      segs[+c.dataset.i].on = c.checked;
      renderList();
    }));
    list.querySelectorAll('.segPlay').forEach((b) => b.addEventListener('click', () => segs[+b.dataset.i].region.play()));
    list.querySelectorAll('.segDel').forEach((b) => b.addEventListener('click', () => {
      segs[+b.dataset.i].region.remove();
      segs.splice(+b.dataset.i, 1);
      renderList();
    }));
    options.classList.remove('hidden');
    const btn = panel.querySelector('#createClipsBtn');
    btn.querySelector('span').textContent = `Create ${chosen} clip${chosen === 1 ? '' : 's'}`;
    btn.disabled = !chosen;
    btn.classList.toggle('opacity-50', !chosen);
  }

  panel.querySelector('#createClipsBtn').addEventListener('click', async (e) => {
    const chosen = segs.filter((x) => x.on);
    if (!chosen.length) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const res = await api(`/audio/${d.id}/clips`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segments: chosen.map((x) => ({ start: x.region.start, end: x.region.end })),
          inherit_label: panel.querySelector('#inheritLabel')?.checked ?? false,
          replace_in_folders: panel.querySelector('#replaceInFolders')?.checked ?? true,
        }),
      });
      toast(`${res.created} clip${res.created === 1 ? '' : 's'} created — review their labels below`, 'success');
      renderDetail(el, d.id);
      el.scrollIntoView?.({ behavior: 'smooth' });
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
    }
  });

  setMode('auto');
}
