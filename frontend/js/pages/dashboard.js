import { api } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtHours, fmtDate, statusBadge, sourceBadge, spinner, emptyState, pageHeader } from '../ui.js';

// Categorical palette — brand-anchored, CVD-validated (worst adjacent dE2000 27.9).
export const CAT = ['#4C7438', '#C4452E', '#2A6F97', '#7A5239', '#6B4E9E', '#9A7B12'];
// Stable per-entity colours: a filter must never repaint the survivors.
const SOURCE_COLOR = { upload: '#4C7438', esp32: '#2A6F97' };
const INK_SECONDARY = '#4A5643', INK_MUTED = '#626D58', LINE = '#DCE5CE';

const tile = (label, value, sub, iconName) => `
  <div class="bg-white rounded-xl2 shadow-card p-5">
    <div class="flex items-start justify-between">
      <div class="text-xs uppercase tracking-wider text-ink-muted">${esc(label)}</div>
      <span class="w-8 h-8 rounded-full bg-page text-brand grid place-items-center">${icon(iconName, { size: 16 })}</span>
    </div>
    <div class="text-[2rem] leading-none font-bold mt-3">${value}</div>
    ${sub ? `<div class="text-xs text-ink-muted mt-2">${esc(sub)}</div>` : ''}
  </div>`;

export async function renderDashboard(el) {
  el.innerHTML = spinner();
  const [stats, recent] = await Promise.all([api('/stats'), api('/audio?per_page=5')]);
  const st = stats.files_by_status || {};

  el.innerHTML = `
    ${pageHeader('Dashboard', 'Overview of your audio collection and classification activity.')}

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
      ${tile('Audio files', stats.total_files,
             `${st.done || 0} classified · ${(st.pending || 0) + (st.processing || 0)} in queue`, 'waveform')}
      ${tile('Total audio', fmtHours(stats.total_duration_seconds), '', 'clock')}
      ${tile('Datasets', stats.total_datasets, '', 'folder')}
      ${tile('Devices', stats.total_devices, '', 'device')}
    </div>

    <div class="grid lg:grid-cols-3 gap-4 mb-5">
      <div class="lg:col-span-2 bg-white rounded-xl2 shadow-card p-6">
        <div class="font-semibold">Top classes</div>
        <div class="text-xs text-ink-muted mt-1 mb-4">Number of files in which each YAMNet class appears</div>
        <div class="relative h-64">
          ${stats.class_distribution.length ? '<canvas id="classChart"></canvas>'
            : emptyState('waveform', 'No classifications yet', 'Upload audio to see the class distribution')}
        </div>
      </div>
      <div class="bg-white rounded-xl2 shadow-card p-6">
        <div class="font-semibold">Files by source</div>
        <div class="text-xs text-ink-muted mt-1 mb-4">Manual uploads vs ESP32 recordings</div>
        <div class="relative h-64 flex items-center justify-center">
          ${Object.keys(stats.files_by_source).length ? '<canvas id="sourceChart"></canvas>'
            : emptyState('device', 'No files yet', '')}
        </div>
      </div>
    </div>

    <div class="bg-white rounded-xl2 shadow-card p-6">
      <div class="flex items-center justify-between mb-4">
        <div class="font-semibold">Recent uploads</div>
        <a href="#/library" class="text-sm text-brand hover:underline inline-flex items-center gap-1.5">
          View all ${icon('arrowRight', { size: 15 })}</a>
      </div>
      ${recent.items.length ? `
      <div class="overflow-x-auto">
        <table class="w-full text-sm min-w-[640px]">
          <thead><tr class="text-left text-xs text-ink-muted border-b border-line">
            <th class="py-2.5 pr-3 font-medium">File</th><th class="py-2.5 pr-3 font-medium">Duration</th>
            <th class="py-2.5 pr-3 font-medium">Source</th><th class="py-2.5 pr-3 font-medium">Status</th>
            <th class="py-2.5 font-medium">Uploaded</th>
          </tr></thead>
          <tbody>${recent.items.map((f) => `
            <tr class="border-b border-line/60 last:border-0 hover:bg-page/60 transition-colors">
              <td class="py-3 pr-3"><a class="text-brand font-medium hover:underline" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
              <td class="py-3 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
              <td class="py-3 pr-3">${sourceBadge(f.source)}</td>
              <td class="py-3 pr-3">${statusBadge(f.status)}</td>
              <td class="py-3 text-ink-secondary whitespace-nowrap">${fmtDate(f.uploaded_at)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : emptyState('upload', 'No audio yet', 'Go to <a class="text-brand hover:underline" href="#/upload">Upload</a> to add your first file')}
    </div>`;

  if (stats.class_distribution.length) {
    // magnitude of one measure across categories -> horizontal bars, single hue
    new Chart(document.getElementById('classChart'), {
      type: 'bar',
      data: {
        labels: stats.class_distribution.map((c) => c.class_name),
        datasets: [{
          label: 'Files',
          data: stats.class_distribution.map((c) => c.file_count),
          backgroundColor: CAT[0],
          borderRadius: { topRight: 4, bottomRight: 4 },
          barThickness: 13,
        }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },  // single series — the title names it
          tooltip: {
            backgroundColor: '#1E2A17', padding: 10, cornerRadius: 8, displayColors: false,
            callbacks: { label: (c) => `${c.parsed.x} file${c.parsed.x === 1 ? '' : 's'}` },
          },
        },
        scales: {
          x: { grid: { color: LINE }, ticks: { color: INK_MUTED, precision: 0 }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: INK_SECONDARY }, border: { color: LINE } },
        },
      },
    });
  }

  const srcEntries = Object.entries(stats.files_by_source);
  if (srcEntries.length) {
    new Chart(document.getElementById('sourceChart'), {
      type: 'doughnut',
      data: {
        labels: srcEntries.map(([k]) => (k === 'esp32' ? 'ESP32' : 'Upload')),
        datasets: [{
          data: srcEntries.map(([, v]) => v),
          backgroundColor: srcEntries.map(([k]) => SOURCE_COLOR[k] ?? CAT[4]),
          borderColor: '#fff',
          borderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '66%',
        plugins: {
          legend: { position: 'bottom', labels: { color: INK_SECONDARY, boxWidth: 10, usePointStyle: true, pointStyle: 'circle', padding: 16 } },
          tooltip: { backgroundColor: '#1E2A17', padding: 10, cornerRadius: 8 },
        },
      },
    });
  }
}
