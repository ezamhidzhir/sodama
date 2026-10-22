// Supabase Auth via its REST endpoints — no extra client library needed.
// The session (access + refresh token) is kept in localStorage.

const STORAGE_KEY = 'sdms.session';
let cfg = null;      // { url, anonKey } from the backend
let session = null;  // { access_token, refresh_token, expires_at, user }
let refreshing = null;

export async function initAuth() {
  cfg = await (await fetch('/config')).json();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try { session = JSON.parse(raw); } catch { session = null; }
    if (session && session.expires_at * 1000 < Date.now() + 60_000) {
      await refresh().catch(() => clearSession());
    }
  }
  return session;
}

const save = (s) => {
  session = s;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
};
const clearSession = () => {
  session = null;
  localStorage.removeItem(STORAGE_KEY);
};

export const getSession = () => session;
export const getUser = () => session?.user ?? null;
export const isSignedIn = () => !!session?.access_token;

async function authFetch(path, body, { method = 'POST', token } = {}) {
  const headers = { 'Content-Type': 'application/json', apikey: cfg.anonKey };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(friendly(data.error_code, data.error_description || data.msg || data.message));
    err.status = res.status;
    throw err;
  }
  return data;
}

// Supabase's raw messages are written for developers; these are for people.
function friendly(code, fallback) {
  const map = {
    invalid_credentials: 'Wrong email or password.',
    email_not_confirmed: 'Confirm your email first — check your inbox for the link.',
    user_already_exists: 'An account with this email already exists. Sign in instead.',
    weak_password: 'That password is too weak — use at least 6 characters.',
    same_password: 'The new password must be different from the current one.',
    over_email_send_rate_limit: 'Too many emails sent. Wait a few minutes and try again.',
    over_request_rate_limit: 'Too many attempts. Wait a minute and try again.',
  };
  return map[code] || fallback || 'Authentication failed';
}

const toSession = (d) => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: Number(d.expires_at) || Math.floor(Date.now() / 1000) + Number(d.expires_in ?? 3600),
  user: d.user,
});

export async function signUp(email, password, fullName) {
  const d = await authFetch(`signup?redirect_to=${encodeURIComponent(location.origin + '/')}`,
    { email, password, data: fullName ? { full_name: fullName } : undefined });
  // With email confirmation enabled Supabase returns a user but no session.
  if (d.access_token) { save(toSession(d)); return { confirmed: true }; }
  return { confirmed: false, email };
}

// Sign in (or sign up — same thing on first use) with Google. Supabase runs the
// OAuth dance and returns to this app with the session in the URL fragment,
// which consumeAuthRedirect picks up exactly as it does for email links.
// The app's URL must be listed in Supabase → Authentication → Redirect URLs.
export function signInWithGoogle() {
  const back = encodeURIComponent(location.origin + '/');
  location.href = `${cfg.url}/auth/v1/authorize?provider=google&redirect_to=${back}`;
}

export async function signIn(email, password) {
  const d = await authFetch('token?grant_type=password', { email, password });
  save(toSession(d));
  return getUser();
}

export async function refresh() {
  const d = await authFetch('token?grant_type=refresh_token',
    { refresh_token: session.refresh_token });
  save(toSession(d));
}

// A valid access token, refreshed first if it is about to expire. Concurrent
// callers share one refresh — two would race and the loser's refresh token
// would already be spent.
export async function getAccessToken() {
  if (!session) return null;
  if (session.expires_at * 1000 < Date.now() + 60_000) {
    refreshing ??= refresh().finally(() => { refreshing = null; });
    try { await refreshing; } catch { clearSession(); return null; }
  }
  return session.access_token;
}

export async function forceRefresh() {
  if (!session) return false;
  refreshing ??= refresh().finally(() => { refreshing = null; });
  try { await refreshing; return true; } catch { clearSession(); return false; }
}

export async function signOut() {
  if (session) {
    fetch(`${cfg.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  clearSession();
}

export function signOutLocal() { clearSession(); }

// ------------------------------------------------------------ password reset

// Sends the "reset your password" email. The link lands back on this app with
// the recovery session in the URL fragment (see consumeAuthRedirect).
export async function requestPasswordReset(email) {
  await authFetch(`recover?redirect_to=${encodeURIComponent(location.origin + '/')}`, { email });
}

export async function updatePassword(password) {
  const token = await getAccessToken();
  const d = await authFetch('user', { password }, { method: 'PUT', token });
  if (session) save({ ...session, user: d });
}

// Re-check the current password before a sensitive change, so a borrowed
// unlocked phone cannot be used to take over the account.
export async function verifyPassword(password) {
  const email = getUser()?.email;
  const d = await authFetch('token?grant_type=password', { email, password });
  save(toSession(d));
}

// Links in Supabase emails (reset password, confirm signup) redirect to
//   https://app/#access_token=…&refresh_token=…&type=recovery
// or, when the link is stale, to #error=…&error_description=…
// That fragment would otherwise be read by the hash router as a page name.
export async function consumeAuthRedirect() {
  const h = location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error)=/.test(h)) return null;
  const p = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search);

  if (p.get('error')) {
    return { error: (p.get('error_description') || p.get('error')).replaceAll('+', ' ') };
  }
  const d = Object.fromEntries(p);
  const user = await authFetch('user', null, { method: 'GET', token: d.access_token });
  save(toSession({ ...d, user }));
  return { type: p.get('type') || 'signin' };
}
