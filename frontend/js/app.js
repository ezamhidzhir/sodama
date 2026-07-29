// Hash router: #/dashboard, #/upload, #/library, #/audio/{id}, #/datasets, #/devices
import { renderDashboard } from './pages/dashboard.js';
import { renderUpload } from './pages/upload.js';
import { renderLibrary } from './pages/library.js';
import { renderDetail } from './pages/detail.js';
import { renderDatasets } from './pages/datasets.js';
import { renderDevices } from './pages/devices.js';
import { stopAudio } from './ui.js';

const routes = {
  dashboard: renderDashboard,
  upload: renderUpload,
  library: renderLibrary,
  audio: renderDetail,     // #/audio/{id}
  datasets: renderDatasets,
  devices: renderDevices,
};

async function route() {
  stopAudio();
  const [, page = 'dashboard', arg] = location.hash.split('/');
  const render = routes[page] || renderDashboard;

  document.querySelectorAll('#nav .nav-link').forEach((a) => {
    const active = a.dataset.page === page || (page === 'audio' && a.dataset.page === 'library');
    a.classList.toggle('active', active);
  });

  const el = document.getElementById('page');
  el.className = 'flex-1 min-w-0 p-6 lg:p-8 fade-in';
  try {
    await render(el, arg);
  } catch (err) {
    el.innerHTML = `<div class="bg-red-50 border border-red-200 text-red-700 rounded-xl p-5">
      <div class="font-semibold mb-1">Something went wrong</div>
      <div class="text-sm">${err.message}</div>
    </div>`;
  }
}

window.addEventListener('hashchange', route);
if (!location.hash) location.hash = '#/dashboard';
route();
