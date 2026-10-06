// The signed-in user's profile, loaded once and shared by every page.
import { api } from './api.js';
import { avatar, esc, ROLES } from './ui.js';

let me = null;
const listeners = new Set();

export const getMe = () => me;

export async function loadMe() {
  me = await api('/me');
  listeners.forEach((fn) => fn(me));
  return me;
}

export function setMe(next) {
  me = next;
  listeners.forEach((fn) => fn(me));
}

export const onMe = (fn) => { listeners.add(fn); if (me) fn(me); };

// Sidebar card and top-bar avatar follow the profile wherever it changes.
onMe((p) => {
  const side = document.getElementById('sideAvatar');
  if (side) side.innerHTML = avatar(p, 36);
  const top = document.getElementById('topAvatar');
  if (top) top.innerHTML = avatar(p, 28);
  const name = document.getElementById('sideName');
  if (name) name.textContent = p.full_name || `@${p.username}`;
  const sub = document.getElementById('sideSub');
  if (sub) sub.innerHTML = esc(p.full_name ? `@${p.username}` : (ROLES[p.role] || p.email));
});
