# Project Decision Log

Keputusan teknikal yang di-lock sebelum development bermula. Setiap keputusan ada justifikasi untuk rujukan examiner semasa VIVA.

| # | Keputusan | Pilihan | Justifikasi |
|---|---|---|---|
| 1 | Backend framework | **FastAPI** (bukan Flask) | Async support untuk ESP32 streaming; auto Swagger docs (`/docs`) untuk demo; selari dengan Slide 20 (Future Work) proposal defence. |
| 2 | Model klasifikasi | **YAMNet** (bukan PANNs) | Lebih ringan (~17MB vs ~300MB+); 521 AudioSet classes cukup untuk use case; TensorFlow Hub mudah deploy. |
| 3 | Mikrofon ESP32 | **INMP441 (I2S digital)** | Analog mic (MAX4466) noise tinggi; I2S bagi PCM bersih terus, tak perlu ADC calibration. |
| 4 | Format audio | **WAV 16kHz mono 16-bit** | YAMNet expect 16kHz mono; standardkan dari awal elak resampling bugs. |
| 5 | Streaming protocol ESP32 → server | **HTTP chunked POST** (fallback: WebSocket) | Lebih mudah debug dari WebSocket; ESP32 HTTPClient stabil. |
| 6 | Hosting backend | Local/ngrok untuk dev; **Railway** untuk demo | Vercel tak sesuai untuk TensorFlow backend (serverless timeout + size limit). **Railway dipilih atas Render** (dikunci 29 Julai 2026): Render free hanya 512MB RAM — TensorFlow sahaja hampir capai had itu, risiko OOM tinggi; Render juga tidur selepas ~15 min, yang memutuskan request pertama ESP32 ke `/ingest` dan melambatkan demo. Railway kekal jaga, jadi projek Supabase pun tak auto-pause. Lihat `docs/deployment.md`. |
| 7 | Python version (backend) | **Python 3.12 (via uv)** | Sistem ada Python 3.14, tapi TensorFlow belum support 3.14. venv 3.12 dibuat dengan `uv venv --python 3.12`. *(Ditambah semasa Fasa 0, 8 Julai 2026.)* |
| 8 | Supabase project | **Project berasingan `sound-data-mgmt`** (jangan campur godsplan-store) | Isolation data FYP dari projek lain; RLS policies sendiri. Akaun lama capai free tier limit, jadi project dibuat di **akaun Supabase baru** (org godsplan.my@gmail.com, ref `tfbroxaxzhrcniwrobrg`, region ap-southeast-2). |

## Fasa Log

### Fasa 0 — Project Setup (target: 1 minggu)
- [x] Setup repo `sound-data-mgmt` dengan struktur `/backend`, `/frontend`, `/firmware`, `/docs`
- [x] Create Supabase project baru — `sound-data-mgmt` di akaun baru (lihat #8)
- [x] Setup Python venv (3.12 via uv), install FastAPI, TensorFlow, tensorflow-hub, librosa/soundfile
- [x] Test load YAMNet locally — 440Hz test tone classified (top class: Telephone 0.996; 521 classes; per-window output confirmed)
- [ ] Order/confirm hardware: ESP32 DevKit + INMP441 (**tindakan manual — Shopee ~RM15-25, order awal**)

### Fasa 1 — Database & Storage Schema (target: 1 minggu) — **SIAP 8 Julai 2026**
- [x] Create tables + RLS policies — 6 tables applied dari `supabase/migrations/20260708000001_initial_schema.sql`
- [x] Setup Supabase Storage bucket `audio-files` dengan policy (private, 50MB limit, audio MIME sahaja)
- [x] Test upload/download file guna Supabase Python client — `backend/test_supabase_storage.py` lulus (upload → insert → download → query → cleanup)

### Fasa 2 — Backend Core + YAMNet Inference (target: 2-3 minggu) — **SIAP 8 Julai 2026**
- [x] `POST /upload` — validate WAV/MP3/FLAC/OGG, convert ke 16kHz mono 16-bit, upload Storage, insert row
- [x] Pipeline klasifikasi background task — status `pending → processing → done/error`; YAMNet 0.96s windows (hop 0.48s), top-3 per window + confidence dalam `classifications`
- [x] `GET /audio` — pagination, filter by class (inner join), min_confidence, source, status, date range
- [x] `GET /audio/{id}` — detail + waveform peaks (600 points, precomputed) + per-window classifications + top-5 aggregate + signed download URL
- [x] `POST /datasets`, `GET /datasets`, `POST /datasets/{id}/items`, `DELETE` items/dataset
- [x] `GET /datasets/{id}/export` — ZIP audio + manifest.csv/json dengan auto-label (top mean-confidence class)
- [x] `POST /ingest` — raw PCM 16-bit dari ESP32, API key auth (`devices` table), auto resample, update `last_seen`
- [x] `POST /devices` / `GET /devices` — device registration, API key generated sekali
- [x] Migration 3: column `status` + `waveform` (jsonb) dalam `audio_files`
- [x] E2E tested: upload → classify (chirp → Sine wave/Synthesizer ✓), filter search, ingest + 401 auth, dataset export zip

### Fasa 3 — Frontend Web App — **SIAP**
- [x] Vanilla JS + Tailwind SPA (hash router) di `frontend/`, disajikan oleh FastAPI `StaticFiles` — satu origin, tiada isu CORS
- [x] Semua library (Tailwind, Chart.js, WaveSurfer) di-vendor ke `frontend/vendor/` — demo berfungsi tanpa internet
- [x] 6 page: Dashboard, Upload, Library, Audio Detail, Datasets, Devices
- [x] Migration 4: RPC `dashboard_stats()` untuk agregat dashboard dalam satu round-trip

### Fasa 3b — Theme redesign + Authentication (29 Julai 2026)
| # | Keputusan | Pilihan | Justifikasi |
|---|---|---|---|
| 9 | Theme warna | Hijau `#4C7438`, krim `#F1F5E8`, coklat `#7A5239` | Pilihan pengguna, gaya eco/natural mengikut rujukan reka bentuk |
| 10 | Ikon | Inline SVG stroke (`frontend/js/icons.js`) | Pengguna minta **tiada emoji**; SVG inline elak kebergantungan icon-font/CDN |
| 11 | Palette carta | `#4C7438, #C4452E, #2A6F97, #7A5239, #6B4E9E, #9A7B12` | Susunan dipilih melalui carian permutasi untuk maksimumkan pemisahan CVD; disahkan: semua slot lulus band/chroma/contrast, worst adjacent ΔE2000 = **27.9** (sasaran ≥12). Coklat sengaja **tidak** bersebelahan hijau (pasangan itu hanya 8.1 ΔE bawah protanopia) |
| 12 | Warna sumber (doughnut) | upload → hijau, esp32 → biru | Pemetaan tetap per-entiti (bukan ikut rank); ΔE 22.3 lulus. Coklat kekal sebagai aksen UI, bukan warna data bersebelahan hijau |
| 13 | Authentication | Supabase Auth melalui REST (`frontend/js/auth.js`), token dalam localStorage | Tiada library tambahan perlu; anon key disajikan oleh `GET /config` (selamat untuk browser — RLS yang lindungi data) |
| 14 | `mailer_autoconfirm` | **Diaktifkan** (True) | Free tier ada had hantar emel + `site_url` masih localhost, jadi pengesahan emel akan memutuskan demo. **Untuk production, matikan semula** di Supabase Dashboard → Authentication → Providers → Email → Confirm email |

- [x] Login & signup page (`frontend/js/pages/auth.js`) — panel jenama + borang, tunjuk/sembunyi password, ralat inline
- [x] Auth guard dalam router: belum log masuk → `#/login`; sudah log masuk → auth page redirect ke dashboard
- [x] Sign-out + papar emel pengguna dalam sidebar
- [x] **Semua feature sedia ada kekal** — hanya lapisan UI/UX yang ditukar; tiada endpoint atau logik backend diubah selain menambah `GET /config`

**Had yang diketahui:** guard auth berada di lapisan frontend sahaja. Endpoint API masih terbuka (backend guna service-role key dan memintas RLS seperti sebelum ini) — ini kekalkan aliran ESP32 `/ingest` dan data sedia ada berfungsi. Menguatkuasakan JWT pada setiap endpoint ialah kerja susulan.

### Fasa 4 — Label Review + Dataset Export (29 Julai 2026)

Menutup jurang antara aliran kerja dalam proposal (Slide 14) dan sistem sebenar: kotak **"ML Trainer Review"** dan **"Approve Dataset"** memang dilukis dalam cadangan tetapi tidak pernah dilaksanakan. Sebelum ini eksport menghantar tekaan YAMNet sebagai kebenaran — model yang dilatih atasnya belajar kesilapan YAMNet.

| # | Keputusan | Pilihan | Justifikasi |
|---|---|---|---|
| 15 | Semakan manusia | Lajur `review_status` **berasingan** daripada `status` | `status` ialah keadaan *pipeline* (pending → done); `review_status` ialah keputusan *manusia* (unreviewed / approved / rejected). Menggabungkan keduanya akan menyebabkan fail yang gagal diklasifikasi tidak dapat dibezakan daripada fail yang ditolak penyemak. |
| 16 | Asal-usul label | `label_source`: `human_confirmed` / `human_corrected` / `auto` | Meniru konvensyen dataset terbitan (NVIDIA Nemotron merekod `human` vs `llm_jury`), tetapi memecahkan kes manusia supaya pembaca boleh bezakan label yang disahkan begitu sahaja daripada label yang benar-benar dibetulkan. Melatih atas baris `auto` = melatih atas tekaan. |
| 17 | Meluluskan tanpa menaip label | Simpan ramalan sebagai `verified_label` | "YAMNet betul" mesti menghasilkan label konkrit dalam pangkalan data, bukan NULL yang perlu diteka semula semasa eksport. |
| 18 | Nama fail manifest | `metadata.csv` dengan lajur **`file_name`** (dahulu `manifest.csv` / `file`) | HuggingFace `audiofolder` mencari nama tepat itu untuk memadankan baris dengan audio — dengan nama lain ia memuatkan **kosong** tanpa ralat. |
| 19 | Train/validation/test | Stratified per kelas, di-seed dari `dataset.id` | Stratified supaya kelas jarang tidak jatuh sepenuhnya ke satu split. Di-seed supaya eksport semula menghasilkan partition sama — tanpa itu set ujian berubah senyap antara eksperimen dan nombor ketepatan tidak lagi boleh dibandingkan. Kelas dengan satu contoh pergi ke `train`. |
| 20 | Apa yang ditapis daripada eksport | Buang `rejected` sentiasa; buang klip tanpa label | Bundle latihan tidak sepatutnya membawa baris yang perlu dibersihkan semula. `README.md` di dalam ZIP menyenaraikan apa yang dikecualikan dan sebabnya. |
| 21 | `reviewed_by` dihantar oleh klien | Emel dari sesi frontend | Backend masih tiada auth (lihat had di atas), jadi ini rekod *provenance*, bukan kawalan akses. Perlu diganti dengan JWT apabila endpoint dikuatkuasakan. |

- [x] Migration 6: `review_status`, `verified_label`, `reviewed_by`, `reviewed_at`, `review_note`, `device_id` (FK ke `devices`)
- [x] Migration 7: `files_by_review` ditambah ke RPC `dashboard_stats` — **signature dikekalkan** supaya `create or replace` benar-benar mengganti (menukar argumen akan menambah overload dan mencetuskan PGRST203, seperti berlaku sebelum ini)
- [x] `PATCH /audio/{id}/review` + `POST /audio/review` (pukal) + penapis `review_status` pada `GET /audio`
- [x] `backend/app/labels.py` — satu peraturan label dikongsi panel semakan dan eksport, supaya apa yang diluluskan penyemak ialah apa yang dieksport
- [x] Panel semakan pada halaman Audio Detail: luluskan / betulkan (dengan cadangan kelas) / tolak / buka semula
- [x] Library: tab **Needs review / Approved / Rejected** dengan kiraan, lajur Review, dan **Approve labels** pukal (setiap fail kekal label sendiri)
- [x] Datasets: panel eksport dengan bar kesediaan, pilihan (approved sahaja, split, format), dan kiraan langsung "N of M clips will be included"
- [x] Eksport: `metadata.csv`/`.json` HF-compatible, `train/validation/test.csv`, `README.md` dataset card, lajur teknikal penuh (channels, bit depth, format, saiz, device, metadata tersuai)
- [x] Diuji: 77 semakan API/eksport + 36 semakan UI (Playwright) lulus; split disahkan 70/15/15 pada 300 klip 4 kelas tak seimbang

### Fasa 5 — Akaun per-pengguna, Rakam & Label, Community, Mobile (26 September 2026)

Empat keperluan baharu: (1) antara muka mesra telefon pintar, (2) rakam bunyi terus dalam sistem dan labelkan di tempat, (3) berkongsi dataset seperti HuggingFace, (4) setiap pengguna ada akaun, profil dan *forgot password* sendiri.

| # | Keputusan | Pilihan | Justifikasi |
|---|---|---|---|
| 22 | Pengesahan backend | Setiap endpoint (kecuali `/ingest`, `/config`, `/health`) wajib `Authorization: Bearer <JWT Supabase>`; backend tanya Supabase `GET /auth/v1/user` dan cache 60 s | Menutup had yang diketahui dari Fasa 3b — sebelum ini sesiapa boleh padam data orang lain melalui API. Bertanya Supabase (bukan sahkan tandatangan sendiri) berfungsi untuk kunci HS256 lama dan kunci asimetri baharu tanpa rahsia tambahan. |
| 23 | Pengasingan data | Backend kekal guna service role, tetapi **setiap** query ditapis `user_id`; fail milik orang lain → 404, bukan 403 | RLS tidak terpakai pada service role, jadi penapis di router ialah kawalan akses sebenar. 404 tidak membocorkan kewujudan fail. `reviewed_by` kini diambil dari token, bukan dihantar klien (menggantikan #21). |
| 24 | Folder = dataset | Tiada konsep "folder" berasingan; folder rakaman ialah `datasets` dengan senarai kelas (`labels text[]`) | Rakam → folder → eksport/kongsi menjadi satu aliran. Konsep tunggal mengelak dua cara berbeza untuk mengumpul klip yang sama. |
| 25 | Format rakaman | PCM mentah melalui AudioWorklet → resample 16 kHz dalam browser → WAV. Echo cancellation, noise suppression, AGC **dimatikan** | MediaRecorder menghasilkan webm/opus atau mp4/aac (lossy) yang perlukan ffmpeg di server. Pemprosesan suara telefon memadam bunyi latar dan mengubah kekuatan — betul untuk panggilan, salah untuk data latihan. |
| 26 | Asal-usul label keempat | `human_annotated` (lajur `label_origin = 'capture'`) | Perakam yang menaip "Honda" tidak *membetulkan* ramalan "Vehicle" YAMNet — dia tidak pernah melihatnya. Melabelkannya `human_corrected` akan menggelembungkan kadar ralat model dalam setiap eksport. |
| 27 | Ejaan kelas | Label dipadankan tanpa kira huruf besar/kecil dengan kelas sedia ada; kelas baharu ditambah ke folder | "honda", "Honda" dan "HONDA" menjadi tiga kelas berbeza kepada model. |
| 28 | Lokasi | Geolocation API (dengan kebenaran, boleh dimatikan) + nama tempat melalui OpenStreetMap Nominatim | Metadata lokasi berguna untuk model sedar-lokasi; nama tempat lebih mudah dibaca. Gagal → klip kekal dengan koordinat sahaja. |
| 29 | Unit perkongsian | **Dataset**, bukan klip tunggal (seperti HuggingFace Hub) | Yang dikongsi ialah data latihan lengkap dengan kelas, penerangan dan lesen — bukan timbunan fail. Muat turun = ZIP HF-compatible yang sama dengan eksport. |
| 30 | Syarat publish | Wajib penerangan + lesen (CC BY / BY-SA / BY-NC / CC0) + ≥1 klip berlabel tidak ditolak | Dataset awam mesti boleh difahami orang asing dan jelas dari segi hak penggunaan. |
| 31 | Privasi Community | Emel tidak pernah dipaparkan (guna `@username`); koordinat tepat dibuang dari muat turun awam kecuali pemilik benarkan | Rakaman di rumah mendedahkan alamat. Nama tempat (tahap bandar) kekal. |
| 32 | Profil | Jadual `profiles` dicipta secara *lazy* oleh backend pada permintaan pertama | Tiada trigger pada skema `auth`; akaun lama automatik dapat profil. |
| 33 | Forgot password | Supabase `/auth/v1/recover` → pautan emel → `#/reset` guna sesi pemulihan | Aliran standard Supabase. **Perlu:** URL aplikasi dalam *Redirect URLs*, dan SMTP sendiri untuk pengguna sebenar (SMTP terbina dalam hanya menghantar kepada ahli pasukan projek, dengan had kadar yang rendah). |
| 34 | Mobile | Bar tab bawah (Home, Library, **Record** di tengah, Datasets, Community) + menu; kad menggantikan jadual pada skrin kecil; input 16 px (elak zum iOS); PWA manifest | Kebanyakan pengguna guna telefon; butang Record di tempat ibu jari berehat. |
| 35 | Data sedia ada | Baris tanpa pemilik diserahkan kepada akaun `ezamhidzhir09@gmail.com` dalam migration 8 | Data demo lama kekal kelihatan kepada pemilik projek, tidak terdedah kepada pengguna lain. |

- [x] Migration 8: `profiles`, `dataset_likes`, lajur rakaman (`recorded_at`, `latitude`, `longitude`, `location_accuracy`, `location_name`, `label_origin`), `datasets` (`labels`, `visibility`, `license`, `share_location`, `published_at`, `download_count`), `devices.user_id`, bucket `avatars`, RPC `dashboard_stats(p_user)` dan `community_datasets()`
- [x] `backend/app/auth.py` (JWT + profil), `clips.py` (satu laluan simpan untuk upload/ESP32/rakaman)
- [x] Router baharu: `recordings`, `community`, `profile`; semua router lama diskop per pengguna
- [x] Frontend: halaman Record, Community (senarai, dataset, pengguna), Profile, Forgot/Reset password; Datasets menjadi halaman per-folder dengan imbangan kelas dan panel kongsi; shell mobile

### Fasa 6a — Aliran upload peranti-agnostik (6 Oktober 2026)

Maklum balas supervisor: aliran ESP32 → server sukar difahami kerana ia "bergantung pada peranti". Kini ada **satu kontrak** untuk mana-mana klien yang memegang API key peranti.

| # | Keputusan | Pilihan | Sebab |
|---|---|---|---|
| 36 | Kontrak upload | rakam → `POST /ingest` → resit → klien padam salinan sendiri **hanya** jika `sha256` dalam resit sama dengan hash yang dikira sendiri | Storan peranti tidak penuh, dan rakaman tidak hilang jika rangkaian putus: tiada resit sah = tiada padam = hantar semula. |
| 37 | Idempotensi | `X-Client-Id` (UUID dari klien), unik per peranti; chunk stream juga unik pada `(session_id, chunk_index)` | Jika fail sampai tetapi balasan hilang, cubaan semula dijawab dengan resit asal (200) — tiada salinan berganda. |
| 38 | Integriti | `X-Content-SHA256` pilihan; tidak sepadan → 422, klien hantar semula | Mengesan badan yang rosak semasa penghantaran sebelum ia disimpan. |
| 39 | Mod stream | Chunk ~10 s di bawah `session_id`; `join=true` → chunk disimpan di luar Library (`ingest_chunks`) dan dicantum menjadi satu rakaman apabila sesi ditutup | Peranti mati di tengah jalan hanya kehilangan chunk terakhir. Library tidak pernah menunjukkan separuh rakaman. |
| 40 | Tutup sesi | `POST /ingest/sessions/{id}/close?chunks=N`; chunk hilang → 409 dengan senarai indeks; status `joining` sebagai kunci | Rakaman bercantum tidak pernah mempunyai lubang senyap; dua panggilan serentak tidak menghasilkan dua rakaman. |
| 41 | Nama sumber | `esp32` → `device` (data lama dikemas kini) | Laptop yang menghantar data bukan ESP32; label sumber menggambarkan saluran, bukan perkakasan. |
| 42 | Klien rujukan | `client/sodama_client.py` — stdlib sahaja (`sounddevice` untuk mic); mod `send`, `watch`, `mic --chunk 10 [--join]`; chunk ditulis ke folder *spool* dahulu | Demo aliran penuh tanpa menunggu perkakasan; spool bermakna crash pun tidak kehilangan data — larian seterusnya menyambung. |

- [x] Migration 9: `audio_files.client_id/sha256/session_id/chunk_index`, indeks unik, jadual `ingest_sessions` + `ingest_chunks` (RLS tanpa polisi), `source` `esp32` → `device`
- [x] `/ingest` terima fail audio (WAV/FLAC/MP3/OGG) atau PCM mentah (serasi ke belakang)
- [x] Halaman Devices: kad "How a device sends audio"

### Fasa 6b — Clip, privasi, kuota, editor, Google, Report (23 Oktober 2026)

Daripada maklum balas supervisor dan soalan pengguna: sistem mesti mengurus data bunyi (potong → label → semak), melindungi privasi, dan selamat dibuka kepada orang awam.

| # | Keputusan | Pilihan | Sebab |
|---|---|---|---|
| 43 | Label fail | Purata confidence atas **semua** window (window tanpa kelas = 0) | Peraturan lama (purata atas window di mana kelas muncul) membiarkan satu salakan anjing 0.9 mengalahkan bunyi kereta 60 s. |
| 44 | Potong rakaman | Clip **maya**: `parent_id` + `clip_start/end`, tiada fail baru | Tiada storan/kuota tambahan; klasifikasi diambil dari window induk, jadi tiada inferens semula. |
| 45 | Cara potong | Ikut bunyi (tukar kelas top-1, lipat < min ke jiran) / setiap N saat / manual | Tiga keperluan berbeza: peristiwa semula jadi, model yang perlukan panjang sama, dan pilihan manusia. |
| 46 | Clip dalam folder | Clip **menggantikan** rakaman induk dalam folder (pilihan, default ON) | Export tidak membawa audio yang sama dua kali. |
| 47 | Split tanpa kebocoran | Clip dari rakaman yang sama sentiasa dalam split yang sama; kumpulan diagih ke split yang paling berkurangan | Saat bersebelahan dari rakaman yang sama dalam train dan test = data leakage; accuracy palsu tinggi. |
| 48 | Privasi | **Sentiasa ON**: YAMNet → senyapkan window suara (≥ 0.3, padding 0.5 s) → baru simpan. ≥ 80 % suara → upload/rakaman ditolak; device simpan versi senyap | Suara tidak pernah sampai ke storan. Disenyapkan, bukan dipotong, supaya timeline kekal sejajar. Nyanyian/ketawa tidak disenyapkan (bukan perkataan). |
| 49 | Klasifikasi | Segerak dalam request (threadpool), bukan background task | Penapis privasi perlukan skor YAMNet sebelum simpan, jadi klasifikasi berlaku dalam laluan yang sama; tiada status tersangkut lagi. |
| 50 | Had | Upload 10 min, rakaman 5 min, chunk device 10 min; semak header sebelum decode | MP3 50 MB boleh mengandungi ~1 jam → >1 GB RAM bila didekod; satu fail boleh menjatuhkan server untuk semua orang. |
| 51 | Kuota | 30 min audio tersimpan setiap pengguna (`profiles.quota_seconds`) | Storan Supabase free 1 GB ≈ 8.7 jam WAV; kuota menjadikan kapasiti boleh diramal untuk user testing. |
| 52 | Format simpanan | **FLAC** 16 kHz 16-bit; download/export tetap WAV | Lossless, ~separuh saiz WAV → hampir dua kali ganda audio dalam storan yang sama. |
| 53 | Editor | Loop (crossfade linear) dan merge = fail baru bertanda `edit_kind`, dikecualikan dari export secara default | Audio berulang menggelembungkan dataset; crossfade linear elak clipping bila bunyi serupa bertindih. |
| 54 | Salin dari Community | Salinan dengan `attribution` (pengarang, lesen, dataset); export ada bahagian Credits | Semua lesen yang ditawarkan membenarkan suntingan dengan syarat kredit. |
| 55 | Main clip | Pautan backend bertandatangan HMAC (`/audio/{id}/file`), luput 1 jam | Elemen `<audio>` tidak boleh hantar header Authorization; kontrak sama dengan signed URL Supabase. |
| 56 | Report | 3 pelapor berbeza → `datasets.hidden_at`; pemilik nampak sebab, bukan siapa | Penapis privasi boleh terlepas; komuniti perlu cara untuk menanda. |
| 57 | Google | Supabase OAuth (implicit flow) → fragmen URL yang sama dengan pautan emel | Tiada perpustakaan tambahan; tiada pengesahan emel diperlukan untuk akaun Google. |

- [x] Migration 10: clip maya, `edit_kind`/`derived_from`/`attribution`, `speech_removed_seconds`/`privacy_redactions`, `profiles.quota_seconds`, `dataset_reports` + `datasets.hidden_at`, RPC `dashboard_stats` & `community_datasets` dikemas kini
- [x] Modul baharu: `privacy.py`, `segments.py`, `media.py`, `routers/edits.py`; `tasks.py` dibuang
- [x] Frontend: panel Split + senarai clip, editor bunyi (`#/edit`, `#/sound`), tab Single sounds + Report di Community, Merge di Library, kuota di Upload/Profile, butang Google
