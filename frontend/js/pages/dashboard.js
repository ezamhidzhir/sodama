import { api } from '../api.js';
import { icon } from '../icons.js';
import { getMe } from '../me.js';
import { esc, fmtDuration, fmtHours, fmtDate, statusBadge, sourceBadge, spinner, emptyState, pageHeader } from '../ui.js';

// Categorical palette — brand-anchored, CVD-validated (worst adjacent dE2000 27.9).
export const CAT = ['#4C7438', '#C4452E', '#2A6F97', '#7A5239', '#6B4E9E', '#9A7B12'];
// Stable per-entity colours: a filter must never repaint the survivors.
// Recording takes the red-orange slot, not the brown: brown beside the brand
// green is the one pair the palette check rejects under protanopia.
const SOURCE_COLOR = { upload: '#4C7438', device: '#2A6F97', recording: '#C4452E' };
const SOURCE_NAME = { upload: 'Upload', device: 'Device', recording: 'Recorded' };
const INK_SECONDARY = '#4A5643', INK_MUTED = '#626D58', LINE = '#DCE5CE';

const tile = (label, value, sub, iconName) => `
  <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5">
    <div class="flex items-start justify-between">
      <div class="text-[11px] sm:text-xs uppercase tracking-wider text-ink-muted">${esc(label)}</div>
      <span class="w-8 h-8 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(iconName, { size: 16 })}</span>
    </div>
    <div class="text-[1.6rem] sm:text-[2rem] leading-none font-bold mt-2 sm:mt-3">${value}</div>
    ${sub ? `<div class="text-xs text-ink-muted mt-2">${esc(sub)}</div>` : ''}
  </div>`;

const action = (href, ic, title, sub, primary = false) => `
  <a href="${href}" class="flex items-center gap-3 rounded-xl2 p-4 transition-colors ${primary
    ? 'bg-brand text-white hover:bg-brand-dark shadow-card' : 'bg-white shadow-card hover:bg-brand-soft'}">
    <span class="w-11 h-11 rounded-full grid place-items-center shrink-0 ${primary ? 'bg-white/15' : 'bg-page text-brand'}">${icon(ic, { size: 20 })}</span>
    <span class="min-w-0">
      <span class="block font-semibold">${title}</span>
      <span class="block text-xs ${primary ? 'text-white/80' : 'text-ink-muted'} truncate">${sub}</span>
    </span>
  </a>`;

function barChart(canvas, rows, valueKey, labelKey, tooltip) {
  // magnitude of one measure across categories -> horizontal bars, single hue
  new Chart(canvas, {
    type: 'bar',
    data: {
      labels: rows.map((c) => c[labelKey]),
      datasets: [{
        label: 'Files',
        data: rows.map((c) => c[valueKey]),
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
          callbacks: { label: (c) => tooltip(rows[c.dataIndex]) },
        },
      },
      scales: {
        x: { grid: { color: LINE }, ticks: { color: INK_MUTED, precision: 0 }, border: { display: false } },
        y: { grid: { display: false }, ticks: { color: INK_SECONDARY, autoSkip: false,
             callback(v) { const s = this.getLabelForValue(v); return s.length > 18 ? s.slice(0, 17) + '…' : s; } },
             border: { color: LINE } },
      },
    },
  });
}

export async function renderDashboard(el) {
  el.innerHTML = spinner();
  const [stats, recent] = await Promise.all([api('/stats'), api('/audio?per_page=5')]);
  const st = stats.files_by_status || {};
  const rv = stats.files_by_review || {};
  const me = getMe();
  const first = (me?.full_name || '').split(' ')[0] || (me ? `@${me.username}` : '');
  const labels = stats.label_distribution || [];

  el.innerHTML = `
    ${pageHeader(first ? `Hi, ${first}` : 'Dashboard', 'Your sound collection at a glance.')}

    <div class="grid sm:grid-cols-3 gap-3 mb-4">
      ${action('#/record', 'mic', 'Record a sound', 'Capture and label on the spot', true)}
      ${action('#/upload', 'upload', 'Upload files', 'WAV, MP3, FLAC or OGG')}
      ${action('#/community', 'globe', 'Explore Community', 'Datasets shared by others')}
    </div>

    <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-5">
      ${tile('Audio files', stats.total_files,
             `${st.done || 0} classified · ${(st.pending || 0) + (st.processing || 0)} in queue`, 'waveform')}
      ${tile('Total audio', fmtHours(stats.total_duration_seconds), '', 'clock')}
      ${tile('Needs review', rv.unreviewed || 0, `${rv.approved || 0} approved`, 'review')}
      ${tile('Datasets', stats.total_datasets, `${stats.public_datasets || 0} shared publicly`, 'folder')}
    </div>

    <div class="grid lg:grid-cols-3 gap-3 sm:gap-4 mb-4 sm:mb-5">
      <div class="lg:col-span-2 bg-white rounded-xl2 shadow-card p-4 sm:p-6">
        <div class="flex gap-2 mb-1" id="chartTabs">
          <button data-chart="labels" class="px-3 py-1.5 rounded-full text-sm bg-brand text-white">Your labels</button>
          <button data-chart="yamnet" class="px-3 py-1.5 rounded-full text-sm text-ink-secondary hover:bg-page">YAMNet classes</button>
        </div>
        <div class="text-xs text-ink-muted mt-2 mb-4" id="chartNote"></div>
        <div class="relative h-64" id="chartBox"></div>
      </div>
      <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6">
        <div class="font-semibold">Files by source</div>
        <div class="text-xs text-ink-muted mt-1 mb-4">Recorded in the app, uploaded, or sent by a device</div>
        <div class="relative h-64 flex items-center justify-center">
          ${Object.keys(stats.files_by_source).length ? '<canvas id="sourceChart"></canvas>'
            : emptyState('device', 'No files yet', '')}
        </div>
      </div>
    </div>

    <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-6">
      <div class="flex items-center justify-between mb-3">
        <div class="font-semibold">Recent activity</div>
        <a href="#/library" class="text-sm text-brand hover:underline inline-flex items-center gap-1.5">
          View all ${icon('arrowRight', { size: 15 })}</a>
      </div>
      ${recent.items.length ? `
      <div class="divide-y divide-line/60">
        ${recent.items.map((f) => `
          <a href="#/audio/${f.id}" class="flex items-center gap-3 py-3 hover:bg-page/60 -mx-2 px-2 rounded-xl">
            <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(f.source === 'recording' ? 'mic' : f.source === 'device' ? 'device' : 'clip', { size: 17 })}</span>
            <div class="min-w-0 flex-1">
              <div class="font-medium truncate">${esc(f.verified_label || f.top_class?.class_name || f.filename)}</div>
              <div class="text-xs text-ink-muted truncate">${fmtDuration(f.duration)} · ${fmtDate(f.recorded_at || f.uploaded_at)}${f.location_name ? ` · ${esc(f.location_name)}` : ''}</div>
            </div>
            <span class="hidden sm:inline-flex">${sourceBadge(f.source)}</span>
            ${f.status !== 'done' ? statusBadge(f.status) : ''}
          </a>`).join('')}
      </div>` : emptyState('mic', 'No audio yet', '<a class="text-brand hover:underline" href="#/record">Record</a> or <a class="text-brand hover:underline" href="#/upload">upload</a> your first sound')}
    </div>`;

  const box = el.querySelector('#chartBox');
  const note = el.querySelector('#chartNote');
  const showChart = (kind) => {
    el.querySelectorAll('#chartTabs button').forEach((b) => {
      b.className = `px-3 py-1.5 rounded-full text-sm ${b.dataset.chart === kind ? 'bg-brand text-white' : 'text-ink-secondary hover:bg-page'}`;
    });
    if (kind === 'labels') {
      note.textContent = 'Clips per label a person gave — recorded, confirmed or corrected. This is what you would train on.';
      if (!labels.length) {
        box.innerHTML = emptyState('tag', 'No human labels yet', 'Record a sound and name it, or approve labels in the Library');
        return;
      }
      box.innerHTML = '<canvas></canvas>';
      barChart(box.firstChild, labels, 'file_count', 'label', (r) => `${r.file_count} clip${r.file_count === 1 ? '' : 's'}`);
    } else {
      note.textContent = `Files containing each YAMNet class, counting only predictions above ${Math.round((stats.min_confidence ?? 0.3) * 100)}% confidence`;
      if (!stats.class_distribution.length) {
        box.innerHTML = emptyState('waveform', 'No classifications yet', 'Add audio to see what YAMNet hears');
        return;
      }
      box.innerHTML = '<canvas></canvas>';
      barChart(box.firstChild, stats.class_distribution, 'file_count', 'class_name', (row) => [
        `${row.file_count} file${row.file_count === 1 ? '' : 's'}`,
        `mean confidence ${(row.avg_confidence * 100).toFixed(0)}%`,
        `peak ${(row.max_confidence * 100).toFixed(0)}%`,
      ]);
    }
  };
  el.querySelectorAll('#chartTabs button').forEach((b) => b.addEventListener('click', () => showChart(b.dataset.chart)));
  showChart(labels.length || !stats.class_distribution.length ? 'labels' : 'yamnet');

  const srcEntries = Object.entries(stats.files_by_source);
  if (srcEntries.length) {
    new Chart(document.getElementById('sourceChart'), {
      type: 'doughnut',
      data: {
        labels: srcEntries.map(([k]) => SOURCE_NAME[k] ?? k),
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
