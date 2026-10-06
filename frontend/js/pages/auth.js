import { signIn, signUp, requestPasswordReset, updatePassword, signOut } from '../auth.js';
import { icon } from '../icons.js';
import { esc, toast } from '../ui.js';

const MIN_PASSWORD = 6;

const field = (name, type, label, iconName, placeholder, extra = '') => `
  <label class="block">
    <span class="block text-sm font-medium text-ink-secondary mb-1.5">${label}</span>
    <span class="relative block">
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted">${icon(iconName, { size: 18 })}</span>
      <input name="${name}" type="${type}" placeholder="${placeholder}" ${extra}
             class="field w-full bg-white border border-line rounded-full pl-11 pr-4 py-3 text-[16px] sm:text-[0.95rem] placeholder:text-ink-muted/70 transition-shadow">
    </span>
  </label>`;

const passwordField = (name, label, autocomplete, hint = '') => `
  <div>
    ${field(name, 'password', label, 'lock', '••••••••',
            `required autocomplete="${autocomplete}" minlength="${MIN_PASSWORD}"`)}
    ${hint ? `<p class="mt-1.5 ml-1 text-xs text-ink-muted">${hint}</p>` : ''}
  </div>`;

const MODES = {
  login: {
    title: 'Welcome back',
    sub: 'Sign in to manage your audio datasets.',
    button: 'Sign in', busy: 'Signing in…',
    fields: () => `
      ${field('email', 'email', 'Email address', 'mail', 'you@example.com', 'required autocomplete="email"')}
      <div>
        ${field('password', 'password', 'Password', 'lock', '••••••••', `required autocomplete="current-password"`)}
        <div class="flex items-center justify-between mt-2 px-1">
          <button type="button" class="togglePw text-xs text-ink-muted hover:text-brand inline-flex items-center gap-1.5 py-1 transition-colors">
            ${icon('eye', { size: 14 })} <span>Show password</span></button>
          <a href="#/forgot" class="text-xs text-brand font-medium hover:underline py-1">Forgot password?</a>
        </div>
      </div>`,
    footer: `Don't have an account? <a href="#/signup" class="text-brand font-medium hover:underline">Sign up</a>`,
  },
  signup: {
    title: 'Create your account',
    sub: 'Start recording and organising sound data for machine learning.',
    button: 'Create account', busy: 'Creating account…',
    fields: () => `
      ${field('full_name', 'text', 'Full name', 'user', 'e.g. Nur Aisyah', 'required maxlength="80" autocomplete="name"')}
      ${field('email', 'email', 'Email address', 'mail', 'you@example.com', 'required autocomplete="email"')}
      <div>
        ${passwordField('password', 'Password', 'new-password', `At least ${MIN_PASSWORD} characters.`)}
        <button type="button" class="togglePw mt-1 ml-1 text-xs text-ink-muted hover:text-brand inline-flex items-center gap-1.5 py-1 transition-colors">
          ${icon('eye', { size: 14 })} <span>Show password</span></button>
      </div>`,
    footer: `Already have an account? <a href="#/login" class="text-brand font-medium hover:underline">Sign in</a>`,
  },
  forgot: {
    title: 'Reset your password',
    sub: "Enter the email you signed up with. We'll send you a link to choose a new password.",
    button: 'Send reset link', busy: 'Sending…',
    fields: () => field('email', 'email', 'Email address', 'mail', 'you@example.com', 'required autocomplete="email"'),
    footer: `Remembered it? <a href="#/login" class="text-brand font-medium hover:underline">Back to sign in</a>`,
  },
  reset: {
    title: 'Choose a new password',
    sub: 'You opened a password-reset link. Set a new password for your account.',
    button: 'Save new password', busy: 'Saving…',
    fields: () => `
      ${passwordField('password', 'New password', 'new-password', `At least ${MIN_PASSWORD} characters.`)}
      ${passwordField('confirm', 'Confirm new password', 'new-password')}
      <button type="button" class="togglePw ml-1 text-xs text-ink-muted hover:text-brand inline-flex items-center gap-1.5 py-1 transition-colors">
        ${icon('eye', { size: 14 })} <span>Show passwords</span></button>`,
    footer: `<button id="cancelReset" class="text-brand font-medium hover:underline">Cancel and sign out</button>`,
  },
};

const notice = (kind, iconName, title, body) => {
  const cls = kind === 'error' ? 'bg-red-50 border-red-200 text-red-700'
    : 'bg-brand-tint border-brand/25 text-ink-secondary';
  return `
    <div class="${cls} border rounded-xl2 p-4 text-sm flex gap-3 fade-in">
      <span class="${kind === 'error' ? '' : 'text-brand'} shrink-0">${icon(iconName, { size: 18 })}</span>
      <div>${title ? `<div class="font-medium ${kind === 'error' ? '' : 'text-ink'}">${title}</div>` : ''}${body}</div>
    </div>`;
};

export function renderAuth(el, mode = 'login') {
  const m = MODES[mode] ?? MODES.login;

  el.innerHTML = `
    <div class="min-h-screen p-3 lg:p-5" style="padding-top:max(.75rem, env(safe-area-inset-top))">
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
              Record, classify and curate sound data for machine learning — automatic
              metadata from YAMNet, on-the-spot labelling, and datasets you can export or share.
            </p>
            <div class="mt-8 space-y-3 text-sm text-white/85">
              ${[['mic', 'Record and label sounds right from your phone'],
                 ['waveform', 'Automatic classification into 521 sound classes'],
                 ['package', 'Export training-ready datasets with manifests'],
                 ['globe', 'Share datasets with the community']]
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

            ${mode === 'forgot' ? `
              <a href="#/login" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand mb-4">
                ${icon('arrowLeft', { size: 15 })} Sign in</a>` : ''}
            <h2 class="text-2xl font-bold tracking-tight">${m.title}</h2>
            <p class="text-sm text-ink-muted mt-1.5 mb-7">${m.sub}</p>

            <form id="authForm" class="space-y-4" novalidate>
              ${m.fields()}
              <button type="submit" id="submitBtn"
                      class="w-full bg-brand text-white rounded-full py-3.5 font-medium hover:bg-brand-dark transition-colors
                             disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                <span>${m.button}</span> ${icon('arrowRight', { size: 18 })}
              </button>
            </form>

            <div id="authMsg" class="mt-4"></div>

            <p class="text-sm text-ink-secondary text-center mt-7">${m.footer}</p>
          </div>
        </div>
      </div>
    </div>`;

  // show / hide password(s)
  el.querySelectorAll('.togglePw').forEach((t) => t.addEventListener('click', () => {
    const pws = el.querySelectorAll('input[type=password], input[data-pw]');
    const showing = pws[0]?.type === 'text';
    pws.forEach((p) => { p.dataset.pw = '1'; p.type = showing ? 'password' : 'text'; });
    el.querySelectorAll('.togglePw').forEach((b) => {
      b.innerHTML = `${icon(showing ? 'eye' : 'eyeOff', { size: 14 })} <span>${showing ? 'Show' : 'Hide'} password${mode === 'reset' ? 's' : ''}</span>`;
    });
  }));

  el.querySelector('#cancelReset')?.addEventListener('click', async () => {
    await signOut();
    location.hash = '#/login';
    location.reload();
  });

  const msg = el.querySelector('#authMsg');
  const btn = el.querySelector('#submitBtn');
  const form = el.querySelector('#authForm');
  const idle = () => {
    btn.disabled = false;
    btn.innerHTML = `<span>${m.button}</span> ${icon('arrowRight', { size: 18 })}`;
  };
  const fail = (text) => { msg.innerHTML = notice('error', 'alert', '', esc(text)); idle(); };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.checkValidity()) {
      const bad = form.querySelector(':invalid');
      bad.focus();
      return fail(bad.validationMessage);
    }
    const f = Object.fromEntries(new FormData(form));
    btn.disabled = true;
    btn.innerHTML = `<span>${m.busy}</span>`;
    msg.innerHTML = '';

    try {
      if (mode === 'login') {
        await signIn(f.email.trim(), f.password);
        location.hash = '#/dashboard';
        location.reload();
      } else if (mode === 'signup') {
        const res = await signUp(f.email.trim(), f.password, f.full_name.trim());
        if (res.confirmed) {
          toast('Account created — welcome', 'success');
          location.hash = '#/dashboard';
          location.reload();
        } else {
          msg.innerHTML = notice('info', 'mail', 'Confirm your email',
            `We sent a confirmation link to <span class="font-medium">${esc(res.email)}</span>. Open it on this device to finish signing up.`);
          idle();
        }
      } else if (mode === 'forgot') {
        await requestPasswordReset(f.email.trim());
        // Same message whether or not the address has an account, so this form
        // cannot be used to find out who is registered.
        form.classList.add('hidden');
        msg.innerHTML = notice('info', 'mail', 'Check your email',
          `If an account exists for <span class="font-medium">${esc(f.email.trim())}</span>, a reset link is on its way.
           Open it on this device — it expires after one hour. Check your spam folder if it doesn't arrive.`);
      } else if (mode === 'reset') {
        if (f.password !== f.confirm) return fail('The two passwords do not match.');
        await updatePassword(f.password);
        toast('Password updated — you are signed in', 'success');
        location.hash = '#/dashboard';
        location.reload();
      }
    } catch (err) {
      fail(err.message);
    }
  });
}
