// Hash router with an auth guard.
// Signed out -> #/login, #/signup.  Signed in -> the app shell routes below.
import { initAuth, isSignedIn, getUser, signOut } from './auth.js';
import { icon } from './icons.js';
import { renderAuth } from './pages/auth.js';
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
const PUBLIC_PAGES = ['login', 'signup'];

const authView = document.getElementById('authView');
const appShell = document.getElementById('appShell');

function paintStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((n) => {
    if (!n.dataset.painted) {
      n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon, { size: 18 }));
      n.dataset.painted = '1';
    }
  });
}

async function route() {
  stopAudio();
  const [, page = 'dashboard', arg] = location.hash.split('/');

  // --- signed out: only the auth pages are reachable ---
  if (!isSignedIn()) {
    appShell.classList.add('hidden');
    authView.classList.remove('hidden');
    if (!PUBLIC_PAGES.includes(page)) { location.hash = '#/login'; return; }
    renderAuth(authView, page);
    return;
  }

  // --- signed in: auth pages redirect into the app ---
  if (PUBLIC_PAGES.includes(page)) { location.hash = '#/dashboard'; return; }
  authView.classList.add('hidden');
  appShell.classList.remove('hidden');

  document.querySelectorAll('#nav .nav-link').forEach((a) => {
    const active = a.dataset.page === page || (page === 'audio' && a.dataset.page === 'library');
    a.classList.toggle('active', active);
  });

  const el = document.getElementById('page');
  el.className = 'flex-1 min-w-0 fade-in';
  const render = routes[page] || renderDashboard;
  try {
    await render(el, arg);
  } catch (err) {
    el.innerHTML = `
      <div class="bg-white rounded-xl3 shadow-card p-8">
        <div class="w-12 h-12 rounded-full bg-red-50 text-red-600 grid place-items-center mb-4">
          ${icon('alert', { size: 22 })}
        </div>
        <div class="font-semibold text-lg">Something went wrong</div>
        <div class="text-sm text-ink-secondary mt-1.5">${err.message}</div>
      </div>`;
  }
}

async function start() {
  await initAuth();

  if (isSignedIn()) {
    document.getElementById('userEmail').textContent = getUser()?.email ?? '';
  }
  document.getElementById('brandMark').innerHTML = icon('waveform', { size: 18 });
  document.getElementById('userMark').innerHTML = icon('user', { size: 16 });
  paintStaticIcons();

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await signOut();
    location.hash = '#/login';
    location.reload();
  });

  window.addEventListener('hashchange', route);
  if (!location.hash) location.hash = isSignedIn() ? '#/dashboard' : '#/login';
  route();
}

start();
