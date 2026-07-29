// Supabase Auth via its REST endpoints — no extra client library needed.
// The session (access + refresh token) is kept in localStorage.

const STORAGE_KEY = 'sdms.session';
let cfg = null;      // { url, anonKey } from the backend
let session = null;  // { access_token, refresh_token, expires_at, user }

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

async function authFetch(path, body) {
  const res = await fetch(`${cfg.url}/auth/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: cfg.anonKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error_description || data.msg || data.message || 'Authentication failed');
  }
  return data;
}

const toSession = (d) => ({
  access_token: d.access_token,
  refresh_token: d.refresh_token,
  expires_at: d.expires_at ?? Math.floor(Date.now() / 1000) + (d.expires_in ?? 3600),
  user: d.user,
});

export async function signUp(email, password) {
  const d = await authFetch('signup', { email, password });
  // With email confirmation enabled Supabase returns a user but no session.
  if (d.access_token) { save(toSession(d)); return { confirmed: true }; }
  return { confirmed: false, email };
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

export async function signOut() {
  if (session) {
    fetch(`${cfg.url}/auth/v1/logout`, {
      method: 'POST',
      headers: { apikey: cfg.anonKey, Authorization: `Bearer ${session.access_token}` },
    }).catch(() => {});
  }
  clearSession();
}
