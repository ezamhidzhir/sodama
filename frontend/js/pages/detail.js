import { api } from '../api.js';
import { esc, fmtDuration, fmtDate, statusBadge, sourceBadge, spinner, toast, confBar } from '../ui.js';

// dataviz reference palette — categorical slots in fixed order
const CAT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const OTHER = '#898781';

export async function renderDetail(el, id) {
  el.innerHTML = spinner();
  const d = await api(`/audio/${id}`);

  // color per class: assigned by top_classes order (mean confidence), never cycled
  const classColor = {};
  d.top_classes.forEach((c, i) => { classColor[c.class_name] = CAT[i] ?? OTHER; });
  const colorOf = (name) => classColor[name] ?? OTHER;

  // top-1 class per window (windows overlap: 0.96s span, 0.48s hop)
  const byWindow = {};
  for (const c of d.classifications) {
    const key = c.window_start;
    if (!byWindow[key] || c.confidence > byWindow[key].confidence) byWindow[key] = c;
  }
  const windows = Object.values(byWindow).sort((a, b) => a.window_start - b.window_start);

  el.innerHTML = `
    <a href="#/library" class="text-sm text-brand hover:underline">← Back to Library</a>
    <div class="flex items-start justify-between gap-4 mt-2 mb-6">
      <div>
        <h1 class="text-2xl font-bold break-all">${esc(d.filename)}</h1>
        <div class="flex flex-wrap items-center gap-2 mt-2 text-sm text-ink-secondary">
          ${sourceBadge(d.source)} ${statusBadge(d.status)}
          <span>· ${fmtDuration(d.duration)} · ${d.sample_rate} Hz · ${(d.file_size / 1024).toFixed(0)} KB</span>
          <span>· ${fmtDate(d.uploaded_at)}</span>
        </div>
      </div>
      <div class="flex gap-2 shrink-0">
        <a href="${d.download_url}" download="${esc(d.filename)}"
           class="px-4 py-2 rounded-lg border border-grid text-sm hover:bg-gray-50">⬇ Download</a>
        <button id="deleteBtn" class="px-4 py-2 rounded-lg border border-red-200 text-red-600 text-sm hover:bg-red-50">🗑 Delete</button>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-grid p-5 mb-4">
      <div class="flex items-center gap-4 mb-3">
        <button id="playBtn" class="w-11 h-11 rounded-full bg-brand text-white text-lg hover:bg-brand-dark shrink-0">▶</button>
        <div class="text-sm text-ink-secondary tabular-nums" id="timeLabel">0:00 / ${fmt(d.duration)}</div>
      </div>
      <div id="waveform"></div>
      <div class="mt-4">
        <div class="text-xs text-ink-muted mb-1.5">Classification timeline — top class per 0.96s window</div>
        <div id="timeline" class="flex h-7 rounded-md overflow-hidden border border-grid"></div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-ink-secondary" id="legend"></div>
      </div>
    </div>

    <div class="grid lg:grid-cols-3 gap-4">
      <div class="bg-white rounded-xl border border-grid p-5">
        <div class="font-semibold mb-3">Top classes <span class="text-xs font-normal text-ink-muted">(mean over windows)</span></div>
        ${d.top_classes.length ? d.top_classes.map((c) => `
          <div class="flex items-center justify-between gap-2 py-1.5">
            <div class="flex items-center gap-2 min-w-0">
              <span class="w-3 h-3 rounded-sm shrink-0" style="background:${colorOf(c.class_name)}"></span>
              <span class="truncate">${esc(c.class_name)}</span>
            </div>
            ${confBar(c.mean_confidence)}
          </div>`).join('') : '<div class="text-sm text-ink-muted">Not classified yet.</div>'}
        ${Object.keys(d.metadata).length ? `
          <div class="font-semibold mt-5 mb-2">Metadata</div>
          ${Object.entries(d.metadata).map(([k, v]) => `
            <div class="flex justify-between text-sm py-1 border-b border-grid/60 last:border-0">
              <span class="text-ink-muted">${esc(k)}</span><span>${esc(v)}</span>
            </div>`).join('')}` : ''}
      </div>

      <div class="lg:col-span-2 bg-white rounded-xl border border-grid p-5">
        <div class="font-semibold mb-3">Per-window results <span class="text-xs font-normal text-ink-muted">(${d.classifications.length} rows)</span></div>
        <div class="max-h-96 overflow-y-auto">
          <table class="w-full text-sm">
            <thead class="sticky top-0 bg-white"><tr class="text-left text-xs text-ink-muted border-b border-grid">
              <th class="py-2 pr-3 font-medium">Window</th>
              <th class="py-2 pr-3 font-medium">Class</th>
              <th class="py-2 font-medium">Confidence</th>
            </tr></thead>
            <tbody>${d.classifications.map((c) => `
              <tr class="border-b border-grid/50 last:border-0">
                <td class="py-1.5 pr-3 tabular-nums text-ink-secondary">${c.window_start.toFixed(2)}–${c.window_end.toFixed(2)}s</td>
                <td class="py-1.5 pr-3">
                  <span class="inline-block w-2.5 h-2.5 rounded-sm mr-1.5" style="background:${colorOf(c.class_name)}"></span>${esc(c.class_name)}
                </td>
                <td class="py-1.5">${confBar(c.confidence)}</td>
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
    height: 84,
    waveColor: '#9ec5f4',
    progressColor: '#2a78d6',
    cursorColor: '#0b0b0b',
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
  });
  const playBtn = el.querySelector('#playBtn');
  const timeLabel = el.querySelector('#timeLabel');
  playBtn.addEventListener('click', () => ws.playPause());
  ws.on('play', () => { playBtn.textContent = '⏸'; });
  ws.on('pause', () => { playBtn.textContent = '▶'; });
  ws.on('timeupdate', (t) => { timeLabel.textContent = `${fmt(t)} / ${fmt(d.duration)}`; });

  // ---- timeline strip: segment per window (hop-sized), click to seek ----
  const timeline = el.querySelector('#timeline');
  if (windows.length && d.duration) {
    windows.forEach((w, i) => {
      const end = i === windows.length - 1 ? Math.min(w.window_end, d.duration) : windows[i + 1].window_start;
      const seg = document.createElement('div');
      seg.className = 'h-full cursor-pointer hover:opacity-75 transition-opacity';
      seg.style.width = `${((end - w.window_start) / d.duration) * 100}%`;
      seg.style.background = colorOf(w.class_name);
      seg.title = `${w.window_start.toFixed(2)}–${w.window_end.toFixed(2)}s — ${w.class_name} (${(w.confidence * 100).toFixed(0)}%)`;
      seg.addEventListener('click', () => { ws.seekTo(w.window_start / d.duration); ws.play(); });
      timeline.appendChild(seg);
    });
    el.querySelector('#legend').innerHTML = d.top_classes.map((c) => `
      <span class="inline-flex items-center gap-1.5">
        <span class="w-2.5 h-2.5 rounded-sm" style="background:${colorOf(c.class_name)}"></span>${esc(c.class_name)}
      </span>`).join('');
  } else {
    timeline.innerHTML = '<div class="w-full flex items-center justify-center text-xs text-ink-muted bg-gray-50">No classification data yet</div>';
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
