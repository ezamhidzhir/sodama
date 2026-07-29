import { signIn, signUp } from '../auth.js';
import { icon } from '../icons.js';
import { esc, toast } from '../ui.js';

const MIN_PASSWORD = 6;

const field = (name, type, label, iconName, placeholder, extra = '') => `
  <label class="block">
    <span class="block text-sm font-medium text-ink-secondary mb-1.5">${label}</span>
    <span class="relative block">
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">${icon(iconName, { size: 18 })}</span>
      <input name="${name}" type="${type}" placeholder="${placeholder}" required ${extra}
             class="field w-full bg-white border border-line rounded-full pl-11 pr-4 py-3 text-[0.95rem] placeholder:text-ink-muted/70 transition-shadow">
    </span>
  </label>`;

export function renderAuth(el, mode = 'login') {
  const isLogin = mode === 'login';

  el.innerHTML = `
    <div class="min-h-screen p-3 lg:p-5">
      <div class="grid lg:grid-cols-2 gap-5 min-h-[calc(100vh-1.5rem)] lg:min-h-[calc(100vh-2.5rem)]">

        <!-- Brand panel -->
        <div class="hidden lg:flex flex-col justify-between rounded-xl3 p-10 text-white relative overflow-hidden"
             style="background:linear-gradient(150deg,#4C7438 0%,#3C5C2C 55%,#2F4A22 100%)">
          <div class="absolute -right-16 -top-16 w-72 h-72 rounded-full" style="background:rgba(255,255,255,.06)"></div>
          <div class="absolute -right-4 bottom-10 w-40 h-40 rounded-full" style="background:rgba(122,82,57,.28)"></div>

          <div class="flex items-center gap-2.5 relative">
            <span class="w-9 h-9 rounded-full bg-white/15 grid place-items-center shrink-0">${icon('waveform', { size: 18 })}</span>
            <div>
              <div class="font-bold leading-tight tracking-wide">SODAMA</div>
              <div class="text-xs text-white/70 -mt-0.5">Sound Data Management</div>
            </div>
          </div>

          <div class="relative max-w-md">
            <h1 class="text-4xl font-bold leading-[1.15] tracking-tight">
              Organise Your Audio Datasets Easily
            </h1>
            <p class="mt-4 text-white/80 leading-relaxed">
              Collect, classify and curate sound data for machine learning — automatic
              metadata from YAMNet, searchable library, and one-click dataset export.
            </p>
            <div class="mt-8 space-y-3 text-sm text-white/85">
              ${[['upload', 'Upload or stream audio from ESP32 devices'],
                 ['waveform', 'Automatic classification into 521 sound classes'],
                 ['package', 'Export training-ready datasets with manifests']]
                .map(([ic, text]) => `
                  <div class="flex items-center gap-3">
                    <span class="w-8 h-8 rounded-full bg-white/12 grid place-items-center shrink-0">${icon(ic, { size: 16 })}</span>
                    ${esc(text)}
                  </div>`).join('')}
            </div>
          </div>

          <div class="relative text-xs text-white/55">
            Final Year Project · Universiti Teknologi PETRONAS
          </div>
        </div>

        <!-- Form panel -->
        <div class="bg-white rounded-xl3 shadow-card flex items-center justify-center p-6 sm:p-10">
          <div class="w-full max-w-sm fade-in">
            <div class="lg:hidden flex items-center gap-2.5 mb-8">
              <span class="w-9 h-9 rounded-full bg-brand text-white grid place-items-center shrink-0">${icon('waveform', { size: 18 })}</span>
              <div>
                <div class="font-bold leading-tight tracking-wide">SODAMA</div>
                <div class="text-xs text-ink-muted -mt-0.5">Sound Data Management</div>
              </div>
            </div>

            <h2 class="text-2xl font-bold tracking-tight">${isLogin ? 'Welcome back' : 'Create your account'}</h2>
            <p class="text-sm text-ink-muted mt-1.5 mb-7">
              ${isLogin ? 'Sign in to manage your audio datasets.' : 'Start organising sound data for machine learning.'}
            </p>

            <form id="authForm" class="space-y-4">
              ${field('email', 'email', 'Email address', 'mail', 'you@example.com', 'autocomplete="email"')}
              <div>
                ${field('password', 'password', 'Password', 'lock', '••••••••',
                        `autocomplete="${isLogin ? 'current-password' : 'new-password'}" minlength="${MIN_PASSWORD}"`)}
                <button type="button" id="togglePw"
                        class="mt-2 ml-1 text-xs text-ink-muted hover:text-brand inline-flex items-center gap-1.5 transition-colors">
                  ${icon('eye', { size: 14 })} <span>Show password</span>
                </button>
                ${isLogin ? '' : `<p class="mt-1 ml-1 text-xs text-ink-muted">At least ${MIN_PASSWORD} characters.</p>`}
              </div>

              <button type="submit" id="submitBtn"
                      class="w-full bg-brand text-white rounded-full py-3 font-medium hover:bg-brand-dark transition-colors
                             disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <span>${isLogin ? 'Sign in' : 'Create account'}</span> ${icon('arrowRight', { size: 18 })}
              </button>
            </form>

            <div id="authMsg" class="mt-4"></div>

            <p class="text-sm text-ink-secondary text-center mt-7">
              ${isLogin ? "Don't have an account?" : 'Already have an account?'}
              <a href="#/${isLogin ? 'signup' : 'login'}" class="text-brand font-medium hover:underline">
                ${isLogin ? 'Sign up' : 'Sign in'}
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>`;

  // show / hide password
  const pw = el.querySelector('input[name=password]');
  el.querySelector('#togglePw').addEventListener('click', (e) => {
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    e.currentTarget.innerHTML =
      `${icon(showing ? 'eye' : 'eyeOff', { size: 14 })} <span>${showing ? 'Show' : 'Hide'} password</span>`;
  });

  const msg = el.querySelector('#authMsg');
  const btn = el.querySelector('#submitBtn');

  el.querySelector('#authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const { email, password } = Object.fromEntries(new FormData(e.target));
    btn.disabled = true;
    btn.innerHTML = `<span>${isLogin ? 'Signing in…' : 'Creating account…'}</span>`;
    msg.innerHTML = '';

    try {
      if (isLogin) {
        await signIn(email, password);
        location.hash = '#/dashboard';
        location.reload();
      } else {
        const res = await signUp(email, password);
        if (res.confirmed) {
          toast('Account created — welcome', 'success');
          location.hash = '#/dashboard';
          location.reload();
        } else {
          msg.innerHTML = `
            <div class="bg-brand-tint border border-brand/25 text-ink-secondary rounded-xl2 p-4 text-sm flex gap-3">
              <span class="text-brand shrink-0">${icon('mail', { size: 18 })}</span>
              <div>
                <div class="font-medium text-ink">Confirm your email</div>
                We sent a confirmation link to <span class="font-medium">${esc(res.email)}</span>.
                Click it, then sign in.
              </div>
            </div>`;
          btn.disabled = false;
          btn.innerHTML = `<span>Create account</span> ${icon('arrowRight', { size: 18 })}`;
        }
      }
    } catch (err) {
      msg.innerHTML = `
        <div class="bg-red-50 border border-red-200 text-red-700 rounded-xl2 p-3.5 text-sm flex gap-2.5">
          <span class="shrink-0">${icon('alert', { size: 18 })}</span><div>${esc(err.message)}</div>
        </div>`;
      btn.disabled = false;
      btn.innerHTML = `<span>${isLogin ? 'Sign in' : 'Create account'}</span> ${icon('arrowRight', { size: 18 })}`;
    }
  });
}
