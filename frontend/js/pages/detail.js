import { api } from '../api.js';
import { icon } from '../icons.js';
import { CAT } from './dashboard.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, toast, confBar } from '../ui.js';

const OTHER = '#626D58';

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

  el.innerHTML = `
    <a href="#/library" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} Back to Library</a>

    <div class="flex flex-wrap items-start justify-between gap-4 mb-6">
      <div class="min-w-0">
        <h1 class="text-[1.6rem] font-bold tracking-tight break-all">${esc(d.filename)}</h1>
        <div class="flex flex-wrap items-center gap-2 mt-2.5 text-sm text-ink-secondary">
          ${sourceBadge(d.source)} ${statusBadge(d.status)}
          <span class="text-ink-muted">${fmtDuration(d.duration)} · ${d.sample_rate} Hz · ${(d.file_size / 1024).toFixed(0)} KB · ${fmtDate(d.uploaded_at)}</span>
        </div>
      </div>
      <div class="flex gap-2.5 shrink-0">
        <a href="${d.download_url}" download="${esc(d.filename)}"
           class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-line bg-white text-sm text-ink-secondary hover:border-brand hover:text-brand transition-colors">
          ${icon('download', { size: 16 })} Download</a>
        <button id="deleteBtn"
           class="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-red-200 bg-white text-red-600 text-sm hover:bg-red-50 transition-colors">
          ${icon('trash', { size: 16 })} Delete</button>
      </div>
    </div>

    <div class="bg-white rounded-xl2 shadow-card p-6 mb-4">
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

    <div class="grid lg:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl2 shadow-card p-6">
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
        ${Object.keys(d.metadata).length ? `
          <div class="font-semibold mt-6 mb-2.5">Metadata</div>
          ${Object.entries(d.metadata).map(([k, v]) => `
            <div class="flex justify-between gap-3 text-sm py-2 border-b border-line/60 last:border-0">
              <span class="text-ink-muted">${esc(k)}</span><span class="text-right">${esc(v)}</span>
            </div>`).join('')}` : ''}
      </div>

      <div class="lg:col-span-2 bg-white rounded-xl2 shadow-card p-6">
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
    if (!confirm(`Delete "${d.filename}" permanently? This also removes its classifications and dataset links.`)) return;
    try {
      await api(`/audio/${id}`, { method: 'DELETE' });
      toast('Audio file deleted', 'success');
      location.hash = '#/library';
    } catch (e) { toast(e.message, 'error'); }
  });
}

const fmt = (sec) => {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
};
