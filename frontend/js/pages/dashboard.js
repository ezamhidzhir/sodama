import { api } from '../api.js';
import { esc, fmtDuration, fmtHours, fmtDate, statusBadge, sourceBadge, spinner, emptyState } from '../ui.js';

// dataviz reference palette — categorical slots (fixed order, validated)
const CAT = ['#2a78d6', '#1baf7a', '#eda100', '#008300', '#4a3aa7', '#e34948', '#e87ba4', '#eb6834'];
const INK_SECONDARY = '#52514e', INK_MUTED = '#898781', GRID = '#e1e0d9';

const tile = (label, value, sub = '') => `
  <div class="bg-white rounded-xl border border-grid p-5">
    <div class="text-xs uppercase tracking-wide text-ink-muted">${label}</div>
    <div class="text-3xl font-semibold mt-1">${value}</div>
    ${sub ? `<div class="text-xs text-ink-muted mt-1">${sub}</div>` : ''}
  </div>`;

export async function renderDashboard(el) {
  el.innerHTML = spinner();
  const [stats, recent] = await Promise.all([
    api('/stats'),
    api('/audio?per_page=5'),
  ]);

  const st = stats.files_by_status || {};
  el.innerHTML = `
    <h1 class="text-2xl font-bold mb-6">Dashboard</h1>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      ${tile('Total audio files', stats.total_files,
             `${st.done || 0} classified · ${(st.pending || 0) + (st.processing || 0)} in queue`)}
      ${tile('Total audio', fmtHours(stats.total_duration_seconds))}
      ${tile('Datasets', stats.total_datasets)}
      ${tile('Devices', stats.total_devices)}
    </div>

    <div class="grid lg:grid-cols-3 gap-4 mb-6">
      <div class="lg:col-span-2 bg-white rounded-xl border border-grid p-5">
        <div class="font-semibold mb-1">Top classes</div>
        <div class="text-xs text-ink-muted mb-3">Number of files in which each YAMNet class appears</div>
        <div class="relative h-64">
          ${stats.class_distribution.length ? '<canvas id="classChart"></canvas>'
            : emptyState('🎧', 'No classifications yet', 'Upload audio to see class distribution')}
        </div>
      </div>
      <div class="bg-white rounded-xl border border-grid p-5">
        <div class="font-semibold mb-1">Files by source</div>
        <div class="text-xs text-ink-muted mb-3">Manual uploads vs ESP32 recordings</div>
        <div class="relative h-64 flex items-center justify-center">
          ${Object.keys(stats.files_by_source).length ? '<canvas id="sourceChart"></canvas>'
            : emptyState('📡', 'No files yet', '')}
        </div>
      </div>
    </div>

    <div class="bg-white rounded-xl border border-grid p-5">
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold">Recent uploads</div>
        <a href="#/library" class="text-sm text-brand hover:underline">View all →</a>
      </div>
      ${recent.items.length ? `
      <table class="w-full text-sm">
        <thead><tr class="text-left text-xs text-ink-muted border-b border-grid">
          <th class="py-2 pr-3 font-medium">File</th><th class="py-2 pr-3 font-medium">Duration</th>
          <th class="py-2 pr-3 font-medium">Source</th><th class="py-2 pr-3 font-medium">Status</th>
          <th class="py-2 font-medium">Uploaded</th>
        </tr></thead>
        <tbody>${recent.items.map((f) => `
          <tr class="border-b border-grid/60 last:border-0 hover:bg-gray-50">
            <td class="py-2.5 pr-3"><a class="text-brand hover:underline" href="#/audio/${f.id}">${esc(f.filename)}</a></td>
            <td class="py-2.5 pr-3 tabular-nums">${fmtDuration(f.duration)}</td>
            <td class="py-2.5 pr-3">${sourceBadge(f.source)}</td>
            <td class="py-2.5 pr-3">${statusBadge(f.status)}</td>
            <td class="py-2.5 text-ink-secondary">${fmtDate(f.uploaded_at)}</td>
          </tr>`).join('')}
        </tbody>
      </table>` : emptyState('🎵', 'No audio yet', 'Head to <a class="text-brand" href="#/upload">Upload</a> to add your first file')}
    </div>`;

  if (stats.class_distribution.length) {
    // magnitude of one measure across categories → horizontal bars, one hue
    new Chart(document.getElementById('classChart'), {
      type: 'bar',
      data: {
        labels: stats.class_distribution.map((c) => c.class_name),
        datasets: [{
          data: stats.class_distribution.map((c) => c.file_count),
          backgroundColor: '#2a78d6',
          borderRadius: { topRight: 4, bottomRight: 4 },
          barThickness: 14,
        }],
      },
      options: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: GRID }, ticks: { color: INK_MUTED, precision: 0 }, border: { display: false } },
          y: { grid: { display: false }, ticks: { color: INK_SECONDARY }, border: { color: GRID } },
        },
      },
    });
  }

  const srcEntries = Object.entries(stats.files_by_source);
  if (srcEntries.length) {
    new Chart(document.getElementById('sourceChart'), {
      type: 'doughnut',
      data: {
        labels: srcEntries.map(([k]) => k),
        datasets: [{
          data: srcEntries.map(([, v]) => v),
          backgroundColor: CAT.slice(0, srcEntries.length),
          borderColor: '#fcfcfb',
          borderWidth: 2,
        }],
      },
      options: {
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { color: INK_SECONDARY, boxWidth: 12 } } },
      },
    });
  }
}
