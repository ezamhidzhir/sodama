# Project Decision Log

Keputusan teknikal yang di-lock sebelum development bermula. Setiap keputusan ada justifikasi untuk rujukan examiner semasa VIVA.

| # | Keputusan | Pilihan | Justifikasi |
|---|---|---|---|
| 1 | Backend framework | **FastAPI** (bukan Flask) | Async support untuk ESP32 streaming; auto Swagger docs (`/docs`) untuk demo; selari dengan Slide 20 (Future Work) proposal defence. |
| 2 | Model klasifikasi | **YAMNet** (bukan PANNs) | Lebih ringan (~17MB vs ~300MB+); 521 AudioSet classes cukup untuk use case; TensorFlow Hub mudah deploy. |
| 3 | Mikrofon ESP32 | **INMP441 (I2S digital)** | Analog mic (MAX4466) noise tinggi; I2S bagi PCM bersih terus, tak perlu ADC calibration. |
| 4 | Format audio | **WAV 16kHz mono 16-bit** | YAMNet expect 16kHz mono; standardkan dari awal elak resampling bugs. |
| 5 | Streaming protocol ESP32 → server | **HTTP chunked POST** (fallback: WebSocket) | Lebih mudah debug dari WebSocket; ESP32 HTTPClient stabil. |
| 6 | Hosting backend | Local/ngrok untuk dev; **Railway/Render free tier** untuk demo | Vercel tak sesuai untuk TensorFlow backend (serverless timeout + size limit). |
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
