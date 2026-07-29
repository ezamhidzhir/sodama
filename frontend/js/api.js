// Same-origin API wrapper — the FastAPI backend also serves this frontend.
export async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  if (!res.ok) {
    let msg;
    try { msg = (await res.json()).detail; } catch { msg = res.statusText; }
    throw new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return res.status === 204 ? null : res.json();
}

export const qs = (params) => {
  const clean = Object.entries(params).filter(([, v]) => v !== '' && v != null);
  return clean.length ? '?' + new URLSearchParams(clean) : '';
};
