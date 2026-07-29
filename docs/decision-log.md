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
