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
| 8 | Supabase project | **Project berasingan `sound-data-mgmt`** (jangan campur godsplan-store) | Isolation data FYP dari projek lain; RLS policies sendiri. **Status: blocked — free tier limit 2 active projects sudah penuh (godsplan-store, gps-dashboard). Perlu pause/delete satu, atau upgrade.** |

## Fasa Log

### Fasa 0 — Project Setup (target: 1 minggu)
- [x] Setup repo `sound-data-mgmt` dengan struktur `/backend`, `/frontend`, `/firmware`, `/docs`
- [ ] Create Supabase project baru — **blocked oleh free tier limit (lihat #8)**
- [x] Setup Python venv (3.12 via uv), install FastAPI, TensorFlow, tensorflow-hub, librosa/soundfile
- [x] Test load YAMNet locally — 440Hz test tone classified (top class: Telephone 0.996; 521 classes; per-window output confirmed)
- [ ] Order/confirm hardware: ESP32 DevKit + INMP441 (**tindakan manual — Shopee ~RM15-25, order awal**)

### Fasa 1 — Database & Storage Schema (target: 1 minggu)
- [ ] Create tables + RLS policies (migration SQL siap di `supabase/migrations/`)
- [ ] Setup Supabase Storage bucket `audio-files` dengan policy
- [ ] Test upload/download file guna Supabase Python client (`backend/test_supabase_storage.py`)
