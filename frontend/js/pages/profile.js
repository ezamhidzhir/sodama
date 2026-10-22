// My profile — identity shown in Community, account security, and the
// right to leave (delete everything).
import { api, upload } from '../api.js';
import { verifyPassword, updatePassword, signOutLocal } from '../auth.js';
import { icon } from '../icons.js';
import { loadMe, setMe } from '../me.js';
import { esc, fmtDate, toast, pageHeader, avatar, spinner, quotaBar, ROLES, INPUT, TEXTAREA } from '../ui.js';

const label = (text, forId, extra = '') =>
  `<label for="${forId}" class="block text-sm font-medium text-ink-secondary mb-1.5">${text}${extra}</label>`;

export async function renderProfile(el) {
  el.innerHTML = spinner();
  const p = await loadMe();
  const st = p.stats;

  el.innerHTML = `
    ${pageHeader('My profile', 'How you appear in Community, and your account settings.')}

    <div class="max-w-3xl">
      <div class="bg-white rounded-xl3 shadow-card p-5 sm:p-6 mb-4">
        <div class="flex flex-col sm:flex-row sm:items-center gap-4">
          <div class="relative self-start">
            <div id="bigAvatar">${avatar(p, 88)}</div>
            <label class="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-brand text-white grid place-items-center shadow-lift cursor-pointer hover:bg-brand-dark" title="Change photo">
              ${icon('camera', { size: 16 })}
              <input id="avatarInput" type="file" accept="image/jpeg,image/png,image/webp" class="hidden">
            </label>
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xl font-bold truncate">${esc(p.full_name || '@' + p.username)}</div>
            <div class="text-sm text-ink-muted truncate">@${esc(p.username)} · ${esc(p.email)}</div>
            <div class="flex flex-wrap gap-2 mt-3">
              <a href="#/u/${encodeURIComponent(p.username)}" class="inline-flex items-center gap-1.5 text-sm border border-line rounded-full px-4 py-2 hover:border-brand hover:text-brand">
                ${icon('globe', { size: 15 })} View public page</a>
              ${p.avatar_url ? `<button id="rmAvatar" class="text-sm text-ink-muted hover:text-accent px-3 py-2">Remove photo</button>` : ''}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 sm:grid-cols-6 gap-2 mt-5">
          ${[['Audio', st.audio_files], ['Recorded', st.recordings], ['Datasets', st.datasets],
             ['Public', st.public_datasets], ['Downloads', st.downloads_received], ['Likes', st.likes_received]]
            .map(([k, v]) => `<div class="bg-page rounded-xl2 py-2.5 text-center"><div class="font-bold">${v}</div><div class="text-[10px] uppercase tracking-wider text-ink-muted">${k}</div></div>`).join('')}
        </div>
        <div class="mt-4 border border-line rounded-xl2">${quotaBar(p.quota)}</div>
        ${p.quota ? `<p class="text-xs text-ink-muted mt-2">Uploads up to ${p.quota.max_upload_seconds / 60} min each · recordings up to ${p.quota.max_recording_seconds / 60} min each. Clips you cut from a recording use no extra storage.</p>` : ''}
        <div class="text-xs text-ink-muted mt-3">Member since ${fmtDate(p.joined_at)}</div>
      </div>

      <form id="profileForm" class="bg-white rounded-xl2 shadow-card p-5 sm:p-6 mb-4 space-y-4">
        <div class="font-semibold text-lg">Profile details</div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>${label('Full name', 'pName')}
            <input id="pName" name="full_name" maxlength="80" value="${esc(p.full_name || '')}" autocomplete="name" class="${INPUT}"></div>
          <div>${label('Username', 'pUser', ' <span class="font-normal text-ink-muted">(public)</span>')}
            <div class="relative">
              <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">@</span>
              <input id="pUser" name="username" required minlength="3" maxlength="30" pattern="[a-z0-9_]{3,30}"
                     value="${esc(p.username)}" autocapitalize="none" autocomplete="username" class="${INPUT} pl-9">
            </div>
            <p class="text-xs text-ink-muted mt-1">Lowercase letters, numbers and _ only.</p></div>
          <div>${label('I am a…', 'pRole')}
            <select id="pRole" name="role" class="${INPUT}">
              <option value="">Prefer not to say</option>
              ${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${v}</option>`).join('')}
            </select></div>
          <div>${label('Organisation', 'pOrg', ' <span class="font-normal text-ink-muted">(optional)</span>')}
            <input id="pOrg" name="organization" maxlength="100" value="${esc(p.organization || '')}"
                   placeholder="e.g. Universiti Teknologi PETRONAS" class="${INPUT}"></div>
        </div>
        <div>${label('Bio', 'pBio', ' <span class="font-normal text-ink-muted">(optional)</span>')}
          <textarea id="pBio" name="bio" rows="3" maxlength="300" class="${TEXTAREA}"
                    placeholder="What kind of sounds do you collect, and what are you training?">${esc(p.bio || '')}</textarea>
          <p class="text-xs text-ink-muted mt-1 text-right"><span id="bioCount">${(p.bio || '').length}</span>/300</p></div>
        <button class="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full px-6 py-3 sm:py-2.5 text-sm font-medium hover:bg-brand-dark">
          ${icon('check', { size: 16 })} Save profile</button>
      </form>

      <form id="pwForm" class="bg-white rounded-xl2 shadow-card p-5 sm:p-6 mb-4 space-y-4">
        <div>
          <div class="font-semibold text-lg">Password</div>
          <p class="text-sm text-ink-muted">Signed in as <span class="font-medium text-ink-secondary">${esc(p.email)}</span>.
            Forgot the current one? Sign out and use “Forgot password?”.</p>
        </div>
        <div>${label('Current password', 'pwOld')}
          <input id="pwOld" name="current" type="password" required autocomplete="current-password" class="${INPUT}"></div>
        <div class="grid sm:grid-cols-2 gap-4">
          <div>${label('New password', 'pwNew')}
            <input id="pwNew" name="password" type="password" required minlength="6" autocomplete="new-password" class="${INPUT}"></div>
          <div>${label('Confirm new password', 'pwConfirm')}
            <input id="pwConfirm" name="confirm" type="password" required minlength="6" autocomplete="new-password" class="${INPUT}"></div>
        </div>
        <button class="w-full sm:w-auto inline-flex items-center justify-center gap-2 border border-line rounded-full px-6 py-3 sm:py-2.5 text-sm font-medium hover:border-brand hover:text-brand">
          ${icon('key', { size: 16 })} Change password</button>
      </form>

      <div class="bg-white rounded-xl2 shadow-card p-5 sm:p-6 border border-red-100">
        <div class="font-semibold text-lg text-red-700">Delete account</div>
        <p class="text-sm text-ink-secondary mt-1">Permanently removes your account, all ${st.audio_files} audio file${st.audio_files === 1 ? '' : 's'},
          ${st.datasets} dataset${st.datasets === 1 ? '' : 's'} (including public ones) and devices. This cannot be undone —
          export anything you want to keep first.</p>
        <form id="delForm" class="flex flex-col sm:flex-row gap-2 mt-4">
          <input name="confirm" required autocomplete="off" autocapitalize="none" placeholder="Type ${esc(p.username)} to confirm" class="${INPUT} sm:max-w-xs">
          <button class="inline-flex items-center justify-center gap-2 bg-red-600 text-white rounded-full px-6 py-3 sm:py-2.5 text-sm font-medium hover:bg-red-700">
            ${icon('trash', { size: 16 })} Delete my account</button>
        </form>
      </div>
    </div>`;

  // ---- avatar
  el.querySelector('#avatarInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { toast('Choose an image under 2 MB', 'error'); return; }
    const form = new FormData();
    form.append('file', file);
    try {
      await upload('/me/avatar', form);
      toast('Photo updated', 'success');
      renderProfile(el);
    } catch (err) { toast(err.message, 'error'); }
  });
  el.querySelector('#rmAvatar')?.addEventListener('click', async () => {
    await api('/me/avatar', { method: 'DELETE' });
    toast('Photo removed', 'success');
    renderProfile(el);
  });

  // ---- profile details
  const bio = el.querySelector('#pBio');
  bio.addEventListener('input', () => { el.querySelector('#bioCount').textContent = bio.value.length; });
  const user = el.querySelector('#pUser');
  user.addEventListener('input', () => { user.value = user.value.toLowerCase().replace(/[^a-z0-9_]/g, ''); });

  el.querySelector('#profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const next = await api.json('/me', 'PATCH', { ...f, role: f.role || null });
      setMe(next);
      toast('Profile saved', 'success');
      renderProfile(el);
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---- password
  el.querySelector('#pwForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.password !== f.confirm) { toast('The new passwords do not match', 'error'); return; }
    try {
      await verifyPassword(f.current);
    } catch { toast('Your current password is incorrect', 'error'); return; }
    try {
      await updatePassword(f.password);
      e.target.reset();
      toast('Password changed', 'success');
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---- delete account
  el.querySelector('#delForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const confirmText = new FormData(e.target).get('confirm').trim();
    if (confirmText.toLowerCase() !== p.username) { toast(`Type ${p.username} exactly to confirm`, 'error'); return; }
    if (!confirm('Last check: delete your account and every file in it, permanently?')) return;
    try {
      await api.json('/me', 'DELETE', { confirm: confirmText });
      signOutLocal();
      alert('Your account and all of its data have been deleted.');
      location.hash = '#/login';
      location.reload();
    } catch (err) { toast(err.message, 'error'); }
  });
}
