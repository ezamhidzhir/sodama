// Hash router with an auth guard.
// Signed out -> #/login, #/signup, #/forgot.  Signed in -> the app shell routes below.
import { initAuth, isSignedIn, signOut, consumeAuthRedirect } from './auth.js';
import { icon } from './icons.js';
import { loadMe, getMe } from './me.js';
import { renderAuth } from './pages/auth.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderRecord } from './pages/record.js';
import { renderUpload } from './pages/upload.js';
import { renderLibrary } from './pages/library.js';
import { renderDetail } from './pages/detail.js';
import { renderDatasets } from './pages/datasets.js';
import { renderCommunity, renderCommunityDataset, renderUserPage } from './pages/community.js';
import { renderProfile } from './pages/profile.js';
import { renderDevices } from './pages/devices.js';
import { renderEditor } from './pages/editor.js';
import { renderPolicy } from './pages/policies.js';
import { stopAudio, avatar, esc, sheet, toast, canLeave } from './ui.js';

const routes = {
  dashboard: renderDashboard,
  record: renderRecord,
  upload: renderUpload,
  library: renderLibrary,
  audio: renderDetail,     // #/audio/{id}
  datasets: renderDatasets, // #/datasets or #/datasets/{id}
  community: (el, arg) => (arg ? renderCommunityDataset(el, arg) : renderCommunity(el)),
  u: renderUserPage,       // #/u/{username}
  profile: renderProfile,
  devices: renderDevices,
  edit: (el, id) => renderEditor(el, id),                       // #/edit/{id}
  sound: (el, id) => renderEditor(el, id, { community: true }),  // #/sound/{id}
  privacy: (el) => renderPolicy(el, 'privacy'),
  terms: (el) => renderPolicy(el, 'terms'),
};
const PUBLIC_PAGES = ['login', 'signup', 'forgot'];
const POLICY_PAGES = ['privacy', 'terms'];   // readable signed in or out
// Which nav entry lights up for pages that are not in the nav themselves.
const NAV_PARENT = { audio: 'library', edit: 'library', u: 'community', sound: 'community' };

const authView = document.getElementById('authView');
const appShell = document.getElementById('appShell');
function paintStaticIcons() {
  document.querySelectorAll('[data-icon]').forEach((n) => {
    if (!n.dataset.painted) {
      n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon, { size: n.closest('#tabBar') ? 22 : 18 }));
      n.dataset.painted = '1';
    }
  });
  document.querySelectorAll('[data-mark]').forEach((n) => {
    n.innerHTML = icon(n.dataset.mark, { size: n.dataset.mark === 'mic' ? 24 : 16 });
  });
}

let lastHash = location.hash;
async function route() {
  if (!canLeave()) {
    history.replaceState(null, '', lastHash);   // stay on the page
    return;
  }
  lastHash = location.hash;
  stopAudio();
  const [, page = 'dashboard', arg] = location.hash.split('/');

  // --- the password-reset form works with the temporary recovery session ---
  if (page === 'reset') {
    appShell.classList.add('hidden');
    authView.classList.remove('hidden');
    if (!isSignedIn()) { location.hash = '#/forgot'; return; }
    renderAuth(authView, 'reset');
    return;
  }

  // --- signed out: only the auth pages and the policies are reachable ---
  if (!isSignedIn()) {
    appShell.classList.add('hidden');
    authView.classList.remove('hidden');
    if (POLICY_PAGES.includes(page)) {
      window.scrollTo(0, 0);
      renderPolicy(authView, page, { signedIn: false });
      return;
    }
    if (!PUBLIC_PAGES.includes(page)) { location.hash = '#/login'; return; }
    renderAuth(authView, page);
    return;
  }

  // --- signed in: auth pages redirect into the app ---
  if (PUBLIC_PAGES.includes(page)) { location.hash = '#/dashboard'; return; }
  authView.classList.add('hidden');
  appShell.classList.remove('hidden');

  const navKey = NAV_PARENT[page] || page;
  document.querySelectorAll('#nav .nav-link, #tabBar .tab-link').forEach((a) => {
    a.classList.toggle('active', a.dataset.page === navKey);
  });
  document.querySelector('.nav-card')?.classList.toggle('!bg-brand-tint', navKey === 'profile');

  const main = document.getElementById('page');
  main.classList.remove('fade-in');
  void main.offsetWidth;        // restart the entry animation
  main.classList.add('fade-in');
  window.scrollTo(0, 0);
  // Every visit renders into its own fresh container. A page that is still
  // loading when the person moves on (e.g. Dashboard waiting on /stats when
  // they tap Library) then finishes into a detached node instead of
  // overwriting the new page and breaking its lookups.
  const el = document.createElement('div');
  main.replaceChildren(el);
  const render = routes[page] || renderDashboard;
  try {
    await render(el, arg && decodeURIComponent(arg));
  } catch (err) {
    if (!el.isConnected) return;   // the person already left this page
    el.innerHTML = `
      <div class="bg-white rounded-xl3 shadow-card p-8">
        <div class="w-12 h-12 rounded-full bg-red-50 text-red-600 grid place-items-center mb-4">
          ${icon('alert', { size: 22 })}
        </div>
        <div class="font-semibold text-lg">Something went wrong</div>
        <div class="text-sm text-ink-secondary mt-1.5">${esc(err.message)}</div>
      </div>`;
  }
}

async function doSignOut() {
  await signOut();
  location.hash = '#/login';
  location.reload();
}

// Phone "more" menu — everything that does not fit in the five-tab bar.
function openMoreMenu() {
  const p = getMe();
  const item = (href, ic, label, extra = '') => `
    <a href="${href}" ${extra} class="flex items-center gap-3.5 px-2 py-3.5 rounded-xl2 hover:bg-page">
      <span class="w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0">${icon(ic, { size: 18 })}</span>
      <span class="font-medium">${label}</span>
    </a>`;
  const s = sheet('Menu', `
    ${p ? `
    <a href="#/profile" class="flex items-center gap-3 p-3 rounded-xl2 bg-page mb-3">
      ${avatar(p, 44)}
      <div class="min-w-0">
        <div class="font-semibold truncate">${esc(p.full_name || '@' + p.username)}</div>
        <div class="text-sm text-ink-muted truncate">${esc(p.email)}</div>
      </div>
    </a>` : ''}
    <div class="divide-y divide-line/60">
      ${item('#/profile', 'user', 'My profile')}
      ${item('#/upload', 'upload', 'Upload files')}
      ${item('#/devices', 'device', 'Devices')}
      ${p ? item(`#/u/${encodeURIComponent(p.username)}`, 'globe', 'My public page') : ''}
      ${item('/docs', 'external', 'API documentation', 'target="_blank"')}
      ${item('#/privacy', 'lock', 'Privacy policy')}
      ${item('#/terms', 'review', 'Terms of use')}
    </div>
    <button id="menuLogout" class="mt-4 w-full flex items-center justify-center gap-2 border border-line rounded-full py-3 text-ink-secondary hover:border-accent hover:text-accent">
      ${icon('logout', { size: 18 })} Sign out
    </button>`);
  s.el.querySelectorAll('a').forEach((a) => a.addEventListener('click', () => s.close()));
  s.el.querySelector('#menuLogout').addEventListener('click', doSignOut);
}

async function start() {
  await initAuth();

  // Arriving from an email link (reset password / confirm signup)?
  let redirect = null;
  try { redirect = await consumeAuthRedirect(); }
  catch (e) { redirect = { error: e.message }; }

  paintStaticIcons();
  document.getElementById('logoutBtn').addEventListener('click', doSignOut);
  document.getElementById('moreBtn').addEventListener('click', openMoreMenu);

  if (isSignedIn()) {
    try { await loadMe(); }
    catch (e) { if (isSignedIn()) toast(`Could not load your profile: ${e.message}`, 'error'); }
  }

  let target = location.hash;
  if (redirect?.type === 'recovery') target = '#/reset';
  else if (redirect?.type) target = '#/dashboard';
  else if (redirect?.error) {
    target = '#/forgot';
    setTimeout(() => toast(`That link is no longer valid — ${redirect.error}. Request a new one.`, 'error'), 50);
  } else if (!target) target = isSignedIn() ? '#/dashboard' : '#/login';

  window.addEventListener('hashchange', route);
  if (location.hash !== target) location.hash = target;   // hashchange renders it
  else route();
}

start();
