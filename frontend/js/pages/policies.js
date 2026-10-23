// Privacy Policy and Terms of Use — readable signed in or signed out.
// Every statement here describes what the code actually does; when the code
// changes (what is stored, who can see it, what deletion removes), update it.
import { icon } from '../icons.js';

const UPDATED = '24 October 2026';
// Set a project email here to show it as the contact; empty = name the owner instead.
const CONTACT_EMAIL = '';
const mail = CONTACT_EMAIL
  ? `<a href="mailto:${CONTACT_EMAIL}" class="text-brand hover:underline">${CONTACT_EMAIL}</a>`
  : 'the SODAMA project owner at Universiti Teknologi PETRONAS';

const P = (html) => `<p class="mb-3">${html}</p>`;
const UL = (items) => `<ul class="list-disc pl-5 space-y-1.5 mb-3">${items.map((i) => `<li>${i}</li>`).join('')}</ul>`;

const PRIVACY = {
  title: 'Privacy Policy',
  intro: `SODAMA collects sounds, not voices. This policy explains what we store about you, why, who can see it,
    and how to remove it. SODAMA is a Final Year Project at Universiti Teknologi PETRONAS and follows Malaysia's
    Personal Data Protection Act 2010 (PDPA).`,
  sections: [
    ['collect', 'What we collect', `
      ${UL([
        '<b>Account:</b> your email address, and your name if you sign in with Google. Passwords are handled by our sign-in provider; SODAMA never sees or stores them.',
        '<b>Profile:</b> the username, full name, bio, organisation, role and profile picture you choose to add.',
        '<b>Audio:</b> the sounds you record, upload or send from a device, stored as 16 kHz mono audio after speech is removed (see below).',
        '<b>Labels and reviews:</b> the labels you give, your approve/reject decisions, and the classes the YAMNet model suggests.',
        '<b>Location (optional):</b> when you allow it while recording, the GPS position and its accuracy, and a place name looked up from it.',
        '<b>Devices:</b> the names you give your devices, when each last sent audio, and a key for each.',
        '<b>Community activity:</b> datasets you publish, likes, download counts, and reports you make.',
        '<b>Technical logs:</b> our hosting provider keeps standard server logs (such as IP address, time and page requested) for security and fault-finding.',
      ])}`],
    ['speech', 'Speech is removed before anything is stored', `
      ${P('Every recording, upload and device stream is checked for human speech before it is saved. Stretches that contain talking are replaced with silence, and audio that is mostly talking is refused. Only the filtered version is kept; the original is not stored.')}
      ${P('The filter is automatic and can miss things, so please do not record private conversations. If you find a voice in a shared dataset, report it.')}`],
    ['use', 'Why we use it', `
      ${UL([
        'to run SODAMA: store your audio, suggest labels, build and export your datasets;',
        'to show the parts you choose to share in Community;',
        'to keep the service safe: sign-in, usage limits, and handling reports;',
        'to evaluate SODAMA for the Final Year Project, using anonymous, combined figures only.',
      ])}
      ${P('We do not sell your data, show advertising, or use tracking cookies or analytics.')}`],
    ['see', 'Who can see what', `
      ${UL([
        '<b>Private by default.</b> Your audio, labels, folders and devices are visible only to you.',
        '<b>Community.</b> When you publish a folder, every signed-in SODAMA user can listen to and download its sounds and labels. They see your username and profile, never your email address.',
        '<b>Location in Community.</b> Shared datasets show a place name. Exact coordinates are included only if you turn on location sharing for that dataset.',
        '<b>Reviewers.</b> In public downloads, your email is replaced by your username.',
      ])}`],
    ['third', 'Services we rely on', `
      ${UL([
        '<b>Supabase</b> — sign-in, database and file storage (servers in Australia, Sydney region).',
        '<b>Railway</b> — runs the SODAMA website and server (Southeast Asia region).',
        '<b>Google</b> — only if you choose "Continue with Google"; also used to send account emails such as password resets.',
        '<b>OpenStreetMap (Nominatim)</b> — when you record with location on, your browser sends the GPS position to OpenStreetMap to get a place name.',
      ])}
      ${P('Because Supabase stores data in Australia, your data is transferred outside Malaysia. These providers process data only to provide their service to SODAMA.')}`],
    ['browser', 'What is stored in your browser', `
      ${P('Your sign-in session and a few preferences (such as the last folder you recorded into) are kept in your browser\'s local storage. Signing out removes the session. SODAMA sets no advertising or tracking cookies.')}`],
    ['keep', 'How long we keep it, and deleting it', `
      ${UL([
        'Your data stays until you delete it. You can delete a single sound, a folder, a device, or your whole account at any time.',
        '<b>Delete account</b> (Profile page) removes your stored audio, folders, devices, likes, profile and the account itself. Your public datasets disappear from Community.',
        'Copies other users already downloaded, or saved into their own library from Community under your licence, cannot be recalled.',
        'SODAMA is a student project. It may be shut down when the project ends; we will try to give notice so you can export your datasets first.',
      ])}`],
    ['rights', 'Your rights', `
      ${P('Under the PDPA you can ask to access or correct your personal data, and withdraw your consent by deleting your account. Most of this you can do yourself on the Profile page; for anything else, contact ' + mail + '.')}`],
    ['security', 'How we protect it', `
      ${UL([
        'All traffic is encrypted with HTTPS.',
        'Audio is kept in private storage and played through links that expire after one hour.',
        'Database rules let each account reach only its own data; device keys are shown once and can be replaced at any time.',
        'Usage limits slow down automated abuse.',
      ])}
      ${P('No system is perfectly secure. If you find a security problem, please report it to ' + mail + ' and do not test it on other people\'s data.')}`],
    ['children', 'Children', P('SODAMA is meant for students, researchers and adults. It is not intended for children under 13.')],
    ['changes', 'Changes to this policy', P('If we change this policy we will update the date at the top, and tell signed-in users about important changes in the app.')],
  ],
};

const TERMS = {
  title: 'Terms of Use',
  intro: `These terms apply when you use SODAMA, a free sound data management system built as a Final Year Project at
    Universiti Teknologi PETRONAS. By creating an account you agree to them and to the Privacy Policy.`,
  sections: [
    ['account', 'Your account', `
      ${UL([
        'Use your own account and keep your password safe.',
        'Device keys work like passwords: anyone holding one can send audio into your account. Keep them private and replace a key if it leaks.',
        'You are responsible for what is done with your account and your devices.',
      ])}`],
    ['allowed', 'What you may upload', `
      ${UL([
        'Only sounds you recorded yourself, or have the right to use and share.',
        'No recordings of people\'s private conversations, even though speech is filtered.',
        'No copyrighted music, film or broadcast audio unless you hold the rights.',
        'Nothing illegal, hateful, harassing or sexually explicit.',
      ])}`],
    ['conduct', 'What you must not do', `
      ${UL([
        'Try to access other users\' data, accounts or private audio.',
        'Attack, overload, scan or bypass the limits of SODAMA, or automate it beyond its device API.',
        'Upload malware, or misuse reports to hide other people\'s work.',
        'Pretend to be someone else.',
      ])}`],
    ['ownership', 'Your content stays yours', `
      ${P('You keep ownership of your recordings and labels. You give SODAMA permission to store, convert, analyse and display them only as needed to run the service for you.')}`],
    ['licences', 'Sharing in Community', `
      ${P('When you publish a dataset, you choose a Creative Commons licence, and other users may use your sounds under it:')}
      ${UL([
        '<b>CC0</b> — anyone may use it for anything, with no credit needed.',
        '<b>CC BY</b> — any use, as long as you are credited.',
        '<b>CC BY-SA</b> — any use with credit, and changed versions must be shared under the same licence.',
        '<b>CC BY-NC</b> — credit required, and no commercial use.',
      ])}
      ${P('Making a dataset private stops new downloads, but a licence already granted to people who downloaded it cannot be taken back.')}
      ${P('When you use someone else\'s sound, follow its licence. SODAMA keeps the author and licence with every copy you save.')}`],
    ['ai', 'Automatic labels', P('Labels suggested by the YAMNet model are guesses and can be wrong. Check them before you rely on a dataset; SODAMA makes no promise about their accuracy.')],
    ['moderation', 'Reports and removal', `
      ${P('Anyone can report a public dataset for voices, copyright, offensive content or spam. A dataset reported by three different people is hidden until it is reviewed. We may remove content or close accounts that break these terms.')}`],
    ['limits', 'Limits', `
      ${UL([
        'Each account can store up to 30 minutes of audio.',
        'One upload can be up to 10 minutes and 50 MB; one recording up to 5 minutes.',
        'Requests are rate-limited; if you hit a limit, wait a few minutes and try again.',
      ])}`],
    ['service', 'The service is provided as is', `
      ${P('SODAMA is a free student project. It may be slow, unavailable, changed or shut down, and it comes with no warranty. Keep your own copy of anything important and export your datasets regularly. To the extent the law allows, the project is not liable for any loss arising from using SODAMA.')}`],
    ['law', 'Changes and governing law', P('We may update these terms; the date at the top shows the latest version. These terms are governed by the laws of Malaysia. For questions, contact ' + mail + '.')],
  ],
};

export function renderPolicy(el, kind, { signedIn = true } = {}) {
  const doc = kind === 'terms' ? TERMS : PRIVACY;
  const other = kind === 'terms' ? ['#/privacy', 'Privacy Policy'] : ['#/terms', 'Terms of Use'];
  const body = `
    <article class="bg-white rounded-xl3 shadow-card p-5 sm:p-10 max-w-3xl ${signedIn ? '' : 'mx-auto'} text-[15px] leading-relaxed text-ink-secondary">
      <div class="flex flex-wrap items-center justify-between gap-3 mb-6">
        ${signedIn
          ? '<span></span>'
          : `<a href="#/login" class="inline-flex items-center gap-1.5 text-sm hover:text-brand">${icon('arrowLeft', { size: 15 })} Sign in</a>`}
        <a href="${other[0]}" class="text-sm text-brand hover:underline">${other[1]}</a>
      </div>
      <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-ink">${doc.title}</h1>
      <p class="text-sm text-ink-muted mt-1 mb-5">Last updated ${UPDATED}</p>
      <p class="mb-6">${doc.intro}</p>
      <nav class="flex flex-wrap gap-2 mb-8" aria-label="Sections">
        ${doc.sections.map(([id, h]) => `<a href="#${kind}-${id}" data-jump="${kind}-${id}" class="text-xs border border-line rounded-full px-3 py-1.5 hover:border-brand hover:text-brand">${h}</a>`).join('')}
      </nav>
      ${doc.sections.map(([id, h, html]) => `
        <section id="${kind}-${id}" class="mb-7 scroll-mt-24">
          <h2 class="text-lg font-semibold text-ink mb-2">${h}</h2>
          ${html}
        </section>`).join('')}
    </article>`;
  el.innerHTML = signedIn ? body : `<div class="min-h-screen p-3 sm:p-6">${body}</div>`;
  // The section chips scroll within the page instead of changing the route.
  el.querySelectorAll('[data-jump]').forEach((a) => a.addEventListener('click', (e) => {
    e.preventDefault();
    el.querySelector(`#${a.dataset.jump}`)?.scrollIntoView({ behavior: 'smooth' });
  }));
}
