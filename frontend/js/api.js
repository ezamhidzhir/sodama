// Same-origin API wrapper — the FastAPI backend also serves this frontend.
// Every call carries the Supabase access token; on a 401 the token is
// refreshed once and the call retried, and only then is the user signed out.
import { getAccessToken, forceRefresh, signOutLocal } from './auth.js';

async function authHeaders(extra = {}) {
  const token = await getAccessToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

function sessionExpired() {
  signOutLocal();
  location.hash = '#/login';
  location.reload();
}

async function errorMessage(res) {
  let msg;
  try { msg = (await res.json()).detail; } catch { msg = res.statusText; }
  if (Array.isArray(msg)) msg = msg.map((m) => m.msg?.replace(/^Value error, /, '')).join('; ');
  return typeof msg === 'string' ? msg : JSON.stringify(msg);
}

async function send(path, opts, retry = true) {
  const res = await fetch(path, { ...opts, headers: await authHeaders(opts.headers) });
  if (res.status === 401 && retry && await forceRefresh()) return send(path, opts, false);
  if (res.status === 401) { sessionExpired(); throw new Error('Session expired — sign in again'); }
  if (!res.ok) throw new Error(await errorMessage(res));
  return res;
}

export async function api(path, opts = {}) {
  const res = await send(path, opts);
  return res.status === 204 ? null : res.json();
}

// JSON body shorthand: api.json('/x', 'PATCH', { a: 1 })
api.json = (path, method, body) => api(path, {
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

// Downloads can't use a plain <a href>: the link would not carry the token.
// Fetch the file, then hand the browser a blob URL to save.
export async function download(path, fallbackName = 'download.zip') {
  const res = await send(path, {});
  const cd = res.headers.get('Content-Disposition') || '';
  const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return name;
}

// Multipart upload with progress (fetch cannot report upload progress).
export async function upload(path, form, onProgress) {
  const token = await getAccessToken();
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', path);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Network error — the upload did not reach the server.'));
    xhr.onload = () => {
      if (xhr.status === 401) { sessionExpired(); return reject(new Error('Session expired')); }
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) return resolve(body);
      let msg = body?.detail ?? xhr.statusText;
      if (Array.isArray(msg)) msg = msg.map((m) => m.msg).join('; ');
      reject(new Error(typeof msg === 'string' ? msg : JSON.stringify(msg)));
    };
    xhr.send(form);
  });
}

export const qs = (params) => {
  const clean = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return clean.length ? '?' + new URLSearchParams(clean) : '';
};
