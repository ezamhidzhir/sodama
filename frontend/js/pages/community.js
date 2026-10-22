// Community — public datasets other trainers have published.
// #/community            browse + search
// #/community/{id}       dataset card: stats, sample player, download, like
// #/u/{username}         a contributor's public page
import { api, download, qs } from '../api.js';
import { icon } from '../icons.js';
import { esc, fmtDuration, fmtHours, fmtDate, spinner, emptyState, toast, pageHeader, avatar,
         playAudio, currentlyPlaying, labelSourceBadge, sheet, LICENSES, ROLES, SOURCE_LABEL, INPUT } from '../ui.js';

const state = { q: '', sort: 'popular', page: 1, tab: 'datasets' };
const PER_PAGE = 24;

const SORTS = [['popular', 'Popular'], ['newest', 'Newest'], ['likes', 'Most liked'], ['clips', 'Most clips']];

// Inside a card the whole card is already a link, so the byline is plain text
// there (anchors cannot nest); elsewhere it links to the contributor's page.
const byline = (d, link = true) => {
  const inner = `${avatar(d, 22)}<span class="truncate">${esc(d.full_name || '@' + d.username)}</span>`;
  return link
    ? `<a href="#/u/${encodeURIComponent(d.username)}" class="inline-flex items-center gap-2 min-w-0 hover:text-brand">${inner}</a>`
    : `<span class="inline-flex items-center gap-2 min-w-0">${inner}</span>`;
};

function card(d) {
  const labels = [...new Set([...(d.labels || []), ...(d.top_labels || [])])];
  return `
    <a href="#/community/${d.id}" class="group block bg-white rounded-xl2 shadow-card p-4 border-2 border-transparent hover:border-line transition-colors">
      <div class="flex items-start justify-between gap-3">
        <div class="font-semibold leading-snug group-hover:text-brand">${esc(d.name)}</div>
        <span class="inline-flex items-center gap-1 text-xs text-ink-muted shrink-0 ${d.liked ? 'text-[#C4452E]' : ''}">
          ${icon('heart', { size: 14, fill: d.liked })}${d.like_count}</span>
      </div>
      ${d.description ? `<p class="text-sm text-ink-secondary mt-1 line-clamp-2">${esc(d.description)}</p>` : ''}
      ${labels.length ? `
        <div class="flex flex-wrap gap-1.5 mt-3">
          ${labels.slice(0, 5).map((l) => `<span class="text-xs px-2.5 py-1 rounded-full bg-page border border-line">${esc(l)}</span>`).join('')}
          ${labels.length > 5 ? `<span class="text-xs text-ink-muted py-1">+${labels.length - 5}</span>` : ''}
        </div>` : ''}
      <div class="flex items-center justify-between gap-3 mt-3 pt-3 border-t border-line/60 text-xs text-ink-muted">
        <span class="min-w-0">${byline(d, false)}</span>
        <span class="shrink-0 tabular-nums">${d.clip_count} clips · ${fmtHours(d.total_duration)} · ${icon('download', { size: 12 })} ${d.download_count}</span>
      </div>
    </a>`;
}

export async function renderCommunity(el) {
  el.innerHTML = `
    ${pageHeader('Community', 'Labelled sounds shared by other people. Download whole datasets, or find one sound and edit it.')}

    <div class="flex gap-2 mb-3" id="cTabs">
      ${[['datasets', 'Datasets', 'folder'], ['sounds', 'Single sounds', 'waveform']].map(([k, v, ic]) => `
        <button data-tab="${k}" class="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border text-sm transition-colors
          ${k === state.tab ? 'bg-brand text-white border-brand' : 'bg-white border-line text-ink-secondary hover:border-brand hover:text-brand'}">
          ${icon(ic, { size: 15 })} ${v}</button>`).join('')}
    </div>

    <form id="cSearch" class="relative mb-3">
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted pointer-events-none">${icon('search', { size: 17 })}</span>
      <input name="q" type="search" enterkeyhint="search" value="${esc(state.q)}"
             placeholder="${state.tab === 'sounds' ? 'Find a sound, e.g. Porsche' : 'Search datasets or sound labels, e.g. motorcycle'}" class="${INPUT} pl-11">
    </form>
    <div class="${state.tab === 'sounds' ? 'hidden' : 'flex'} gap-2 mb-4 overflow-x-auto no-scrollbar -mx-3 px-3 sm:mx-0 sm:px-0" id="sorts">
      ${SORTS.map(([k, v]) => `
        <button data-sort="${k}" class="shrink-0 px-4 py-2 rounded-full border text-sm transition-colors
          ${k === state.sort ? 'bg-brand text-white border-brand' : 'bg-white border-line text-ink-secondary hover:border-brand hover:text-brand'}">${v}</button>`).join('')}
      <a href="#/datasets" class="shrink-0 ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm text-brand hover:bg-white">${icon('plus', { size: 15 })} Share yours</a>
    </div>
    <div id="cResults">${spinner()}</div>`;

  const form = el.querySelector('#cSearch');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    state.q = form.elements.q.value.trim(); state.page = 1;
    form.elements.q.blur();
    load(el);
  });
  form.elements.q.addEventListener('search', () => { state.q = form.elements.q.value.trim(); state.page = 1; load(el); });
  el.querySelectorAll('#cTabs [data-tab]').forEach((b) => b.addEventListener('click', () => {
    state.tab = b.dataset.tab; state.page = 1;
    renderCommunity(el);
  }));
  el.querySelectorAll('#sorts [data-sort]').forEach((b) => b.addEventListener('click', () => {
    state.sort = b.dataset.sort; state.page = 1;
    renderCommunity(el);
  }));
  load(el);
}

async function load(el) {
  if (state.tab === 'sounds') { loadSounds(el); return; }
  const box = el.querySelector('#cResults');
  box.innerHTML = spinner();
  const data = await api('/community/datasets' + qs({ q: state.q, sort: state.sort, page: state.page, per_page: PER_PAGE }));
  if (!data.items.length) {
    box.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState('globe',
      state.q ? `Nothing matches “${state.q}”` : 'No public datasets yet',
      state.q ? 'Try another word — searches cover names, descriptions and labels'
        : 'Be the first: open one of your <a class="text-brand hover:underline" href="#/datasets">datasets</a> and publish it')}</div>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  box.innerHTML = `
    <div class="text-xs text-ink-muted mb-2 px-1">${data.total} dataset${data.total === 1 ? '' : 's'}</div>
    <div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">${data.items.map(card).join('')}</div>
    ${pages > 1 ? `
      <div class="flex justify-center gap-2 mt-5">
        <button id="cPrev" class="px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', { size: 15 })}</button>
        <span class="px-3 py-2.5 text-sm text-ink-secondary">${state.page} / ${pages}</span>
        <button id="cNext" class="px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40" ${state.page >= pages ? 'disabled' : ''}>${icon('chevronRight', { size: 15 })}</button>
      </div>` : ''}`;
  box.querySelector('#cPrev')?.addEventListener('click', () => { state.page--; load(el); window.scrollTo(0, 0); });
  box.querySelector('#cNext')?.addEventListener('click', () => { state.page++; load(el); window.scrollTo(0, 0); });
}

// ---------------------------------------------------------------- dataset page

export async function renderCommunityDataset(el, id) {
  el.innerHTML = spinner();
  const d = await api(`/community/datasets/${id}`);
  const s = d.stats;
  const human = (s.label_sources.human_annotated || 0) + (s.label_sources.human_confirmed || 0)
    + (s.label_sources.human_corrected || 0);
  const max = Math.max(1, ...s.class_distribution.map(([, n]) => n));
  const lic = LICENSES[d.license];

  el.innerHTML = `
    <a href="#/community" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} Community</a>

    ${d.visibility !== 'public' ? `
      <div class="bg-accent-tint/60 border border-accent/30 rounded-xl2 p-3 mb-4 text-sm text-accent-dark flex gap-2">
        ${icon('lock', { size: 16 })} Preview — this dataset is private, so only you can see this page.</div>` : ''}

    <div class="bg-white rounded-xl3 shadow-card p-5 sm:p-6 mb-4">
      <div class="flex items-center gap-2 text-sm text-ink-secondary mb-2">${byline({ ...d.owner })}
        <span class="text-ink-muted">· ${fmtDate(d.published_at || d.updated_at)}</span></div>
      <h1 class="text-[1.4rem] sm:text-[1.75rem] font-bold tracking-tight leading-tight">${esc(d.name)}</h1>
      ${d.description ? `<p class="text-sm sm:text-[0.95rem] text-ink-secondary mt-2 whitespace-pre-line">${esc(d.description)}</p>` : ''}

      <div class="grid grid-cols-3 gap-2 mt-5">
        ${[['Clips', s.clip_count], ['Audio', fmtHours(s.total_duration)], ['Classes', s.class_distribution.length]]
          .map(([k, v]) => `<div class="bg-page rounded-xl2 p-3 text-center"><div class="text-lg font-bold">${v}</div><div class="text-[11px] uppercase tracking-wider text-ink-muted">${k}</div></div>`).join('')}
      </div>

      <div class="flex flex-col sm:flex-row gap-2 mt-5">
        <button id="dlBtn" class="flex-1 inline-flex items-center justify-center gap-2 bg-brand text-white rounded-full py-3 font-medium hover:bg-brand-dark disabled:opacity-50">
          ${icon('download', { size: 18 })} Download dataset (ZIP)</button>
        <button id="likeBtn" class="inline-flex items-center justify-center gap-2 rounded-full py-3 px-6 border font-medium transition-colors
          ${d.liked ? 'border-[#C4452E]/40 text-[#C4452E] bg-[#C4452E]/5' : 'border-line text-ink-secondary hover:border-[#C4452E]/40 hover:text-[#C4452E]'}"
          ${d.is_owner ? 'disabled title="You cannot like your own dataset"' : ''} aria-pressed="${d.liked}">
          ${icon('heart', { size: 18, fill: d.liked })} <span id="likeCount">${d.like_count}</span></button>
        ${d.is_owner ? `<a href="#/datasets/${d.id}" class="inline-flex items-center justify-center gap-2 rounded-full py-3 px-6 border border-line text-ink-secondary hover:border-brand hover:text-brand">${icon('pencil', { size: 16 })} Manage</a>` : `
          <button id="reportBtn" class="inline-flex items-center justify-center gap-2 rounded-full py-3 px-5 border border-line text-ink-muted hover:border-accent hover:text-accent"
                  ${d.reported_by_me ? 'disabled title="You reported this dataset"' : ''}>
            ${icon('alert', { size: 16 })} ${d.reported_by_me ? 'Reported' : 'Report'}</button>`}
      </div>
      <div class="text-xs text-ink-muted mt-3 flex flex-wrap gap-x-4 gap-y-1">
        <span id="dlCount">${icon('download', { size: 12 })} ${d.download_count} download${d.download_count === 1 ? '' : 's'}</span>
        ${lic ? `<span>${icon('key', { size: 12 })} ${lic.name} — ${lic.hint}</span>` : ''}
        <span>WAV 16 kHz mono · HuggingFace <code>audiofolder</code> layout</span>
      </div>
    </div>

    <div class="grid lg:grid-cols-5 gap-4 items-start">
      <div class="lg:col-span-2 space-y-4">
        <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5">
          <div class="font-semibold mb-3">Classes</div>
          <div class="space-y-2">
            ${s.class_distribution.map(([label, n]) => `
              <div class="flex items-center gap-3 text-sm">
                <div class="w-28 truncate shrink-0">${esc(label)}</div>
                <div class="flex-1 h-2.5 bg-page rounded-full overflow-hidden"><div class="h-full bg-brand rounded-full" style="width:${(n / max) * 100}%"></div></div>
                <div class="w-8 text-right tabular-nums">${n}</div>
              </div>`).join('')}
          </div>
        </div>
        <div class="bg-white rounded-xl2 shadow-card p-4 sm:p-5">
          <div class="font-semibold mb-1">Label quality</div>
          <div class="text-xs text-ink-muted mb-3">${s.clip_count ? Math.round((human / s.clip_count) * 100) : 0}% of clips carry a human-given label</div>
          <div class="space-y-2 text-sm">
            ${Object.entries(s.label_sources).map(([k, n]) => `
              <div class="flex items-center justify-between gap-2">${labelSourceBadge(k)}<span class="tabular-nums">${n}</span></div>`).join('')}
          </div>
          <div class="text-xs text-ink-muted mt-3 pt-3 border-t border-line/60">
            Sources: ${Object.entries(s.sources).map(([k, n]) => `${SOURCE_LABEL[k] || k} ${n}`).join(' · ')}
          </div>
        </div>
      </div>

      <div class="lg:col-span-3 bg-white rounded-xl2 shadow-card p-4 sm:p-5">
        <div class="font-semibold">Listen</div>
        <div class="text-xs text-ink-muted mb-3">${d.samples.length < s.clip_count ? `First ${d.samples.length} of ${s.clip_count} clips` : `All ${s.clip_count} clips`}</div>
        <div class="divide-y divide-line/60">
          ${d.samples.map((c) => `
            <div class="flex items-center gap-3 py-2.5">
              <button class="sPlay w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0 hover:bg-brand hover:text-white" data-id="${c.id}" data-url="${esc(c.url || '')}" aria-label="Play ${esc(c.label)}">
                ${icon('play', { size: 14, fill: true })}</button>
              <div class="min-w-0 flex-1">
                <div class="font-medium truncate">${esc(c.label)}</div>
                <div class="text-xs text-ink-muted truncate">${fmtDuration(c.duration)} · ${fmtDate(c.recorded_at)}${c.location_name ? ` · ${esc(c.location_name)}` : ''}</div>
              </div>
              <a href="#/sound/${c.id}" class="shrink-0 inline-flex items-center gap-1 text-xs border border-line rounded-full px-3 py-1.5 text-ink-secondary hover:border-brand hover:text-brand"
                 title="Cut, label and save this sound to your library">${icon('pencil', { size: 12 })} Use</a>
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  const repaint = () => el.querySelectorAll('.sPlay').forEach((b) => {
    const on = b.dataset.id === currentlyPlaying();
    b.innerHTML = icon(on ? 'pause' : 'play', { size: 14, fill: !on });
  });
  el.querySelectorAll('.sPlay').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.url) { toast('This clip is unavailable', 'error'); return; }
    playAudio(b.dataset.id, b.dataset.url, repaint);
  }));

  const dl = el.querySelector('#dlBtn');
  dl.addEventListener('click', async () => {
    dl.disabled = true;
    const label = dl.innerHTML;
    dl.innerHTML = 'Preparing ZIP…';
    try {
      const name = await download(`/community/datasets/${id}/download`, `${d.name}.zip`);
      toast(`Downloaded ${name}`, 'success');
      if (!d.is_owner) {        // the server counts downloads by others only
        d.download_count++;
        el.querySelector('#dlCount').innerHTML = `${icon('download', { size: 12 })} ${d.download_count} download${d.download_count === 1 ? '' : 's'}`;
      }
    } catch (e) { toast(e.message, 'error'); }
    dl.innerHTML = label;
    dl.disabled = false;
  });

  el.querySelector('#reportBtn')?.addEventListener('click', () => openReport(id, el));

  const like = el.querySelector('#likeBtn');
  let liked = d.liked, count = d.like_count;
  like.addEventListener('click', async () => {
    if (d.is_owner) return;
    liked = !liked; count += liked ? 1 : -1;   // optimistic
    paintLike();
    try { await api(`/community/datasets/${id}/like`, { method: liked ? 'POST' : 'DELETE' }); }
    catch (e) { liked = !liked; count += liked ? 1 : -1; paintLike(); toast(e.message, 'error'); }
  });
  function paintLike() {
    like.setAttribute('aria-pressed', liked);
    like.className = like.className.replace(
      /border-\[#C4452E\]\/40 text-\[#C4452E\] bg-\[#C4452E\]\/5|border-line text-ink-secondary hover:border-\[#C4452E\]\/40 hover:text-\[#C4452E\]/,
      liked ? 'border-[#C4452E]/40 text-[#C4452E] bg-[#C4452E]/5' : 'border-line text-ink-secondary hover:border-[#C4452E]/40 hover:text-[#C4452E]');
    like.innerHTML = `${icon('heart', { size: 18, fill: liked })} <span id="likeCount">${count}</span>`;
  }
}

// ---------------------------------------------------------------- user page

export async function renderUserPage(el, username) {
  el.innerHTML = spinner();
  const u = await api(`/community/users/${encodeURIComponent(username)}`);
  const t = u.totals;
  el.innerHTML = `
    <a href="#/community" class="inline-flex items-center gap-1.5 text-sm text-ink-secondary hover:text-brand transition-colors mb-3">
      ${icon('arrowLeft', { size: 15 })} Community</a>
    <div class="bg-white rounded-xl3 shadow-card p-5 sm:p-6 mb-4">
      <div class="flex items-center gap-4">
        ${avatar(u, 72)}
        <div class="min-w-0">
          <h1 class="text-xl sm:text-2xl font-bold tracking-tight truncate">${esc(u.full_name || '@' + u.username)}</h1>
          <div class="text-sm text-ink-muted">@${esc(u.username)}${u.role ? ` · ${esc(ROLES[u.role] || u.role)}` : ''}</div>
          ${u.organization ? `<div class="text-sm text-ink-secondary mt-0.5">${esc(u.organization)}</div>` : ''}
        </div>
      </div>
      ${u.bio ? `<p class="text-sm text-ink-secondary mt-4 whitespace-pre-line">${esc(u.bio)}</p>` : ''}
      <div class="grid grid-cols-4 gap-2 mt-5 text-center">
        ${[['Datasets', t.datasets], ['Clips', t.clips], ['Downloads', t.downloads], ['Likes', t.likes]]
          .map(([k, v]) => `<div class="bg-page rounded-xl2 py-2.5"><div class="font-bold">${v}</div><div class="text-[10px] sm:text-[11px] uppercase tracking-wider text-ink-muted">${k}</div></div>`).join('')}
      </div>
      <div class="text-xs text-ink-muted mt-3">Member since ${fmtDate(u.joined_at)}</div>
      ${u.is_me ? `<a href="#/profile" class="mt-4 inline-flex items-center gap-2 text-sm border border-line rounded-full px-4 py-2 hover:border-brand hover:text-brand">${icon('pencil', { size: 15 })} Edit profile</a>` : ''}
    </div>
    <div class="font-semibold mb-2 px-1">Public datasets</div>
    ${u.datasets.length
      ? `<div class="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">${u.datasets.map(card).join('')}</div>`
      : `<div class="bg-white rounded-xl2 shadow-card">${emptyState('folder', 'No public datasets yet', u.is_me ? 'Publish one from its page under <a class="text-brand hover:underline" href="#/datasets">Datasets</a>' : '')}</div>`}`;
}

// ---------------------------------------------------------------- single sounds

async function loadSounds(el) {
  const box = el.querySelector('#cResults');
  box.innerHTML = spinner();
  const data = await api('/community/clips' + qs({ q: state.q, page: state.page }));
  if (!data.items.length) {
    box.innerHTML = `<div class="bg-white rounded-xl2 shadow-card">${emptyState('waveform',
      state.q ? `No sounds labelled “${state.q}”` : 'No public sounds yet',
      'Searches cover sound labels and dataset names')}</div>`;
    return;
  }
  const pages = Math.max(1, Math.ceil(data.total / data.per_page));
  box.innerHTML = `
    <div class="text-xs text-ink-muted mb-2 px-1">${data.total} sound${data.total === 1 ? '' : 's'}</div>
    <div class="bg-white rounded-xl2 shadow-card divide-y divide-line/60 px-3 sm:px-4">
      ${data.items.map((c) => `
        <div class="flex items-center gap-3 py-3">
          <button class="sPlay w-10 h-10 rounded-full bg-page text-brand grid place-items-center shrink-0 hover:bg-brand hover:text-white"
                  data-id="${c.id}" data-url="${esc(c.url || '')}" aria-label="Play ${esc(c.label)}">${icon('play', { size: 14, fill: true })}</button>
          <div class="min-w-0 flex-1">
            <div class="font-medium truncate">${esc(c.label)}</div>
            <div class="text-xs text-ink-muted truncate">${fmtDuration(c.duration)} · @${esc(c.author)} ·
              <a href="#/community/${c.dataset.id}" class="hover:text-brand">${esc(c.dataset.name)}</a>
              ${c.license ? ` · ${esc(c.license)}` : ''}</div>
          </div>
          <a href="#/sound/${c.id}" class="shrink-0 inline-flex items-center gap-1.5 text-sm bg-brand text-white rounded-full px-4 py-2 hover:bg-brand-dark">
            ${icon('pencil', { size: 14 })} <span class="hidden sm:inline">Edit &amp; save</span></a>
        </div>`).join('')}
    </div>
    ${pages > 1 ? `
      <div class="flex justify-center gap-2 mt-5">
        <button id="cPrev" class="px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40" ${state.page <= 1 ? 'disabled' : ''}>${icon('chevronLeft', { size: 15 })}</button>
        <span class="px-3 py-2.5 text-sm text-ink-secondary">${state.page} / ${pages}</span>
        <button id="cNext" class="px-4 py-2.5 rounded-full border border-line bg-white disabled:opacity-40" ${state.page >= pages ? 'disabled' : ''}>${icon('chevronRight', { size: 15 })}</button>
      </div>` : ''}`;
  const repaint = () => box.querySelectorAll('.sPlay').forEach((b) => {
    const on = b.dataset.id === currentlyPlaying();
    b.innerHTML = icon(on ? 'pause' : 'play', { size: 14, fill: !on });
  });
  box.querySelectorAll('.sPlay').forEach((b) => b.addEventListener('click', () => {
    if (!b.dataset.url) { toast('This sound is unavailable', 'error'); return; }
    playAudio(b.dataset.id, b.dataset.url, repaint);
  }));
  box.querySelector('#cPrev')?.addEventListener('click', () => { state.page--; loadSounds(el); window.scrollTo(0, 0); });
  box.querySelector('#cNext')?.addEventListener('click', () => { state.page++; loadSounds(el); window.scrollTo(0, 0); });
}

// ---------------------------------------------------------------- report

const REASONS = [
  ['voices', 'Contains people talking'],
  ['copyright', 'Copyrighted audio (music, film…)'],
  ['offensive', 'Offensive or harmful'],
  ['spam', 'Spam or not real data'],
  ['other', 'Something else'],
];

function openReport(id, el) {
  const { el: box, close } = sheet('Report this dataset', `
    <form id="reportForm" class="space-y-3">
      <p class="text-sm text-ink-muted">Reports are anonymous to the owner. After several reports the dataset is hidden from Community until it is reviewed.</p>
      ${REASONS.map(([k, v], i) => `
        <label class="flex items-center gap-2.5 text-sm"><input type="radio" name="reason" value="${k}" ${i === 0 ? 'checked' : ''}> ${v}</label>`).join('')}
      <input name="note" maxlength="300" placeholder="Details (optional)" class="${INPUT}">
      <button class="w-full bg-accent text-white rounded-full py-3 font-medium hover:opacity-90">Send report</button>
    </form>`);
  box.querySelector('#reportForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const res = await api(`/community/datasets/${id}/report`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: f.reason, note: f.note || null }),
      });
      close();
      toast(res.hidden ? 'Thanks — the dataset is now hidden pending review' : 'Thanks — report sent', 'success');
      const b = el.querySelector('#reportBtn');
      if (b) { b.disabled = true; b.innerHTML = `${icon('alert', { size: 16 })} Reported`; }
    } catch (err) { toast(err.message, 'error'); }
  });
}
