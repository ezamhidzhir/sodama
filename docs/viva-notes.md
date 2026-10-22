# SODAMA — Nota Study untuk VIVA

Nota ini ditulis daripada code yang sebenar ada dalam repo ini (bukan dari proposal), supaya
apa yang anda cakap depan examiner sama dengan apa yang sistem betul-betul buat.

**Cara guna nota ni:**
1. Baca **Bahagian 1–3** dulu — itu yang anda kena boleh cerita tanpa tengok nota.
2. **Bahagian 4–8** = logic dalaman. Examiner suka korek sini ("kenapa macam ni?").
3. **Bahagian 10** = bank soalan. Latih jawab kuat-kuat, jangan baca je.
4. **Bahagian 11** = kelemahan sistem + jawapan jujur. **Ini paling penting** — examiner
   akan jumpa kelemahan ini sendiri. Kalau anda yang sebut dulu, anda nampak matang. Kalau
   anda cuba tutup dan dia jumpa, semua jawapan lain jadi mencurigakan.

---

## 0. Cheat sheet — nombor & fakta yang kena hafal

| Perkara | Nilai | Kalau ditanya "kenapa?" |
|---|---|---|
| Nama penuh | Sound Data Management System for Machine Learning Trainers | SODAMA = nama pendek |
| Format audio standard | **WAV, 16 kHz, mono, 16-bit PCM** | YAMNet hanya terima 16 kHz mono |
| Model AI | **YAMNet** (Google, TensorFlow Hub), ~17 MB | Ringan vs PANNs (~300 MB+) |
| Bilangan kelas | **521** kelas AudioSet | Ontologi AudioSet Google |
| Window YAMNet | **0.96 s**, hop **0.48 s** (overlap 50%) | Tetap dalam arkitektur YAMNet |
| Simpan berapa tekaan/window | **top-3** (rank 2 & 3 hanya jika confidence ≥ **0.1**) | Elak silence banjirkan table |
| Waveform peaks | **600** titik (jsonb) | UI lukis gelombang tanpa download audio |
| Had saiz fail | **50 MB** | Sama dengan limit bucket Supabase |
| Rakaman dalam app | min **0.5 s**, max **300 s** (5 minit) | |
| Upload | max **10 minit** setiap fail | Disemak dari header sebelum decode (elak RAM meletup) |
| Kuota | **30 minit** audio tersimpan setiap user | Clip maya tidak dikira |
| Format simpanan | **FLAC** (download/export = WAV) | Lossless, ~separuh saiz |
| Penapis privasi | skor suara ≥ **0.3**, padding **0.5 s**, tolak jika ≥ **80 %** suara | Disenyapkan **sebelum** simpan |
| Signed URL | sah **3600 s** (1 jam) | Bucket private |
| Cache token JWT (backend) | **60 s** | Elak round-trip setiap request |
| Split default | **70 / 15 / 15** | Stratified per kelas + seeded |
| Min confidence carta dashboard | **0.3** | Elak tekaan lemah naik ranking |
| Table dalam DB | **10** — audio_files, classifications, metadata, datasets, dataset_items, dataset_likes, devices, profiles, ingest_sessions, ingest_chunks | Semua RLS enabled |
| RPC (function SQL) | **2** — `dashboard_stats`, `community_datasets` | Agregat satu round-trip |
| Sumber audio (`source`) | `upload`, `recording`, `device` | 3 cara audio masuk (`device` = mana-mana klien ber-API key; dulu `esp32`) |
| Status pipeline (`status`) | `pending → processing → done \| error` | Keadaan **mesin** |
| Status semakan (`review_status`) | `unreviewed \| approved \| rejected` | Keputusan **manusia** |
| Asal label (`label_source`) | `human_annotated`, `human_confirmed`, `human_corrected`, `auto` | 4 tahap kepercayaan |
| Lesen untuk publish | CC-BY-4.0, CC-BY-SA-4.0, CC-BY-NC-4.0, CC0-1.0 | Wajib pilih satu |
| Hosting | Railway — satu service (API + frontend), **1 worker** | 1 worker = 1 salinan YAMNet dalam RAM |
| DB / Storage / Auth | Supabase (PostgreSQL + Storage + Auth) | ref `tfbroxaxzhrcniwrobrg` |
| Hardware | ESP32 DevKit + INMP441 (I2S) | Firmware **belum** ditulis — aliran device didemo dengan `client/sodama_client.py` di laptop |
| Panjang chunk stream | **~10 s** | Peranti mati → hilang 10 s sahaja |

**Satu ayat yang kena hafal betul-betul:**
> "SODAMA ialah sistem web berpusat untuk **kumpul, seragamkan, label, semak, susun, export
> dan kongsi** data audio bagi melatih model machine learning. AI (YAMNet) buat label
> pertama, manusia yang sahkan, dan setiap label merekod dari mana ia datang."

---

## 1. Sistem ni apa? (3 versi jawapan)

### Versi 30 saat — untuk "explain your project"
> "Orang yang nak train model AI untuk bunyi menghadapi masalah data: fail berselerak, format
> tak seragam, label kena buat manual satu-satu, dan susun dataset untuk training ambil masa.
> SODAMA satukan semua langkah itu dalam satu sistem web — audio masuk (rakam dalam app,
> upload, atau dari ESP32), auto-seragamkan ke WAV 16 kHz mono, auto-label guna YAMNet,
> manusia semak label itu, susun jadi dataset, dan export sebagai ZIP yang HuggingFace boleh
> baca terus dengan satu baris kod. Boleh juga kongsi dataset dalam Community."

### Versi 2 minit — tambah sebab teknikal
Sambung selepas ayat atas:
> "Yang penting dalam sistem ni bukan model AI — YAMNet tu model Google. Yang penting ialah
> **pipeline data dan provenance label**. Setiap klip ada dua status **berasingan**: `status`
> untuk keadaan pipeline (pending/processing/done), dan `review_status` untuk keputusan manusia
> (unreviewed/approved/rejected). Dan setiap label dalam export bawa kolum `label_source` yang
> beritahu label itu datang dari mana — manusia yang rakam dan namakan (`human_annotated`),
> manusia setuju dengan AI (`human_confirmed`), manusia betulkan AI (`human_corrected`), atau
> tiada siapa periksa lagi (`auto`). Sebab kalau train atas baris `auto`, model belajar
> kesilapan YAMNet."

### Versi 5 minit — untuk slide
Susun ikut pipeline 6 kotak (Bahagian 3). Setiap kotak sebut **masalah apa yang ia selesaikan**.

---

## 2. Masalah → Penyelesaian (jadual ini hampir pasti ditanya)

| # | Masalah pengguna | Apa SODAMA buat | Di mana dalam code |
|---|---|---|---|
| 1 | Fail audio berselerak (laptop, Drive, phone) | Satu storage berpusat + library boleh cari, per akaun | bucket `audio-files` + table `audio_files` |
| 2 | Format tak seragam (MP3/WAV, sample rate lain-lain) | Semua ditukar ke WAV 16 kHz mono 16-bit **masa masuk**, bukan masa training | `backend/app/audio.py` → `decode_to_standard()` |
| 3 | Label kena buat manual satu-satu | YAMNet beri tekaan dahulu; manusia cuma approve/betulkan | `classifier.py` + `tasks.py` |
| 4 | Susah cari klip tertentu | Search + filter: label, nama fail, tempat, kelas YAMNet, min confidence, sumber, status, review status, folder, tarikh | `GET /audio` dalam `routers/audio_files.py` |
| 5 | Susah sediakan dataset untuk training | Export ZIP siap: `audio/`, `metadata.csv`, `train/validation/test.csv`, `README.md` | `routers/datasets.py` → `build_export()` |
| 6 | (Fasa 5) Nak rakam di lapangan pakai telefon | Halaman Record: rakam → label → save, masa & GPS automatik | `frontend/js/pages/record.js` |
| 7 | (Fasa 5) Dataset tak boleh dikongsi | Community: publish dengan lesen, orang lain dengar & download | `routers/community.py` |

**Kenapa tak guna tools yang dah ada?** (soalan ini mesti datang)

| Tool | Buat apa | Kenapa tak cukup |
|---|---|---|
| **Label Studio / Audino** | Annotation tool | Tiada auto-labelling bunyi terbina, tiada ingest IoT, tiada standardisasi audio, bukan mobile-first untuk rakam di lapangan |
| **HuggingFace Hub** | Simpan & kongsi dataset | Ia **destinasi**, bukan pengumpul. Tak rakam, tak label, tak semak. Output SODAMA memang format HF |
| **AudioSet / dataset siap** | Data am (521 kelas umum) | Tiada "Honda Civic idle" atau "bunyi bearing rosak kilang X". Data domain-khusus kena kumpul sendiri |
| **Google Drive + Excel** | Apa orang buat sekarang | Tiada auto-label, tiada search by confidence, tiada split reproducible, tiada provenance |

Ayat penutup: *"SODAMA duduk di antara mikrofon dan HuggingFace — bahagian yang selalu dibuat manual."*

---

## 3. Aliran kerja penuh (pipeline) — hafal 6 kotak ini

```
   KUMPUL          SERAGAM         AUTO-LABEL        SEMAK          SUSUN          EXPORT/KONGSI
   ┌──────┐       ┌────────┐       ┌────────┐      ┌───────┐      ┌───────┐        ┌──────────┐
   │Record│       │  WAV   │       │ YAMNet │      │Manusia│      │Dataset│        │ ZIP (HF) │
   │Upload│  ───► │ 16 kHz │ ───►  │ 0.96 s │ ───► │approve│ ───► │  =    │ ───►   │   atau   │
   │ESP32 │       │  mono  │       │ window │      │correct│      │folder │        │Community │
   └──────┘       │ 16-bit │       │ top-3  │      │reject │      └───────┘        └──────────┘
                  └────────┘       └────────┘      └───────┘
                                        │              │
                               classifications     audio_files
                                 (per window)     .review_status
                                                  .verified_label
```

**Apa berlaku step demi step bila satu fail masuk** (soalan "walk me through your system"):

1. **Client hantar** — `POST /upload` (multipart), `POST /recordings` (dari telefon), atau
   `POST /ingest` (fail audio atau raw PCM dari mana-mana device dengan `X-API-Key`).
2. **Backend semak siapa** — `Depends(current_user)` → sahkan JWT Supabase → dapat `user.id`.
   (`/ingest` guna API key device, bukan JWT.)
3. **Validate** — extension (.wav/.mp3/.flac/.ogg), tidak kosong, ≤ 50 MB.
4. **Decode & seragam** — `decode_to_standard()`: soundfile baca; bukan 16 kHz → librosa
   resample; stereo → campur jadi mono.
5. **Satu laluan sama untuk semua sumber** — `clips.create_clip()`:
   - encode balik jadi WAV 16-bit
   - upload ke Storage (`uploads/<uuid>.wav`, `recordings/<user>/<uuid>.wav`, `devices/<nama>/<uuid>.wav`)
   - insert row `audio_files` dengan `status='pending'` + 600 waveform peaks
   - `background.add_task(run_classification, ...)`
6. **Background task** — `status='processing'` → YAMNet jalan → insert ke `classifications`
   (batch 500) → `status='done'` (atau `'error'`).
7. **User buka detail** — `GET /audio/{id}`: waveform, semua window, top-5 kelas (ikut mean
   confidence), signed URL, label semasa + `label_source`.
8. **User semak** — `PATCH /audio/{id}/review` → `review_status` + `verified_label` + siapa/bila.
9. **Masukkan dalam folder** — `dataset_items` (many-to-many).
10. **Export** — `GET /datasets/{id}/export` → bina ZIP dalam memori → stream ke browser.
11. **(Pilihan) Publish** — `PATCH /datasets/{id}` dengan `visibility='public'` + lesen →
    muncul dalam Community. Orang lain download ZIP yang sama, tapi email → `@username` dan
    koordinat tepat dibuang (kecuali owner benarkan).

---

## 4. Arkitektur sistem (layer by layer)

```
┌──────────────────────────────────────────────────────────────────────┐
│  BROWSER (telefon / desktop)                                         │
│  Vanilla JS modules + Tailwind, hash router (#/dashboard, #/record)   │
│  9 page: Dashboard, Record, Upload, Library, Detail, Datasets,        │
│          Community, Profile, Devices (+ Login/Signup/Forgot/Reset)    │
│  Tailwind, Chart.js, WaveSurfer di-vendor lokal → demo tanpa internet │
└──────────┬───────────────────────────────────────┬───────────────────┘
           │ fetch + Bearer <JWT>                  │ terus ke Supabase Auth
           │ (same origin — tiada isu CORS)        │ (login/signup/reset saja)
┌──────────▼───────────────────────────────────────▼───────────────────┐
│  FASTAPI BACKEND (satu service; juga serve folder frontend/)          │
│  Routers: upload · recordings · audio_files · datasets · community ·  │
│           profile · devices · ingest · stats                         │
│  Modul teras: auth.py (siapa) · clips.py (satu laluan simpan) ·       │
│               audio.py (seragam) · classifier.py (YAMNet) ·           │
│               labels.py (peraturan label) · tasks.py (background)     │
│  Swagger auto di /docs                                               │
└──────┬────────────────────────────────────┬──────────────────────────┘
       │ service-role key                   │ TensorFlow Hub
       │ (bypass RLS — jadi router yang     │ (cache: backend/yamnet_cache/)
       │  kena filter user_id sendiri)      ▼
┌──────▼────────────────────────────────┐  YAMNet (521 kelas)
│  SUPABASE                             │
│  • PostgreSQL — 8 table + 2 RPC + RLS │     ESP32 + INMP441
│  • Storage — audio-files (private,    │     ──────────────►  POST /ingest
│    50 MB) & avatars (public, 2 MB)    │     raw PCM 16-bit   (X-API-Key)
│  • Auth — email/password, reset email │
└───────────────────────────────────────┘
```

**Kenapa FastAPI serve frontend sekali?** Satu origin → tiada preflight CORS, satu deployment,
satu URL untuk demo. `app.mount("/", NoCacheStaticFiles(...))` di-mount **terakhir** supaya
route API menang dahulu.

**Kenapa vanilla JS, bukan React?** Tiada build step (tiada npm/webpack), fail JS disajikan
terus, senang debug depan examiner, dan saiz projek tak justify framework. Trade-off jujur:
tiada component system; DOM ditulis sebagai template string, jadi setiap output pengguna kena
di-escape manual dengan helper `esc()` untuk elak XSS.

---

## 5. Database — 8 table

```
auth.users 1──1 profiles              (username awam, nama, role, avatar)
auth.users 1──< audio_files / datasets / devices     (user_id = pemilik)
audio_files 1──< classifications      (hasil YAMNet per window)
audio_files 1──< metadata             (key-value bebas: notes, recording_device)
datasets   >──< audio_files           (melalui dataset_items — many-to-many)
datasets   >──< auth.users            (melalui dataset_likes — like Community)
devices    1──< audio_files           (klip ESP32, device_id)
```

**Kolum penting dalam `audio_files`** (table paling besar peranannya):

| Kolum | Guna |
|---|---|
| `source` | `upload` / `recording` / `esp32` |
| `status` | keadaan pipeline: pending → processing → done/error |
| `review_status` | keputusan manusia: unreviewed / approved / rejected |
| `verified_label` | label yang manusia beri (NULL = belum ada manusia sentuh) |
| `label_origin` | `capture` (ditaip masa rakam) / `review` (ditetapkan di panel semakan) |
| `reviewed_by`, `reviewed_at`, `review_note` | provenance: siapa, bila, kenapa |
| `waveform` (jsonb) | 600 peak, precompute |
| `recorded_at`, `latitude`, `longitude`, `location_accuracy`, `location_name` | metadata rakaman |
| `device_id` | FK ke `devices`, ON DELETE SET NULL (buang device, rakaman kekal) |

**Kenapa `dataset_items` table berasingan, bukan `dataset_id` dalam `audio_files`?**
Sebab hubungannya **many-to-many** — satu klip boleh masuk banyak dataset (klip "Honda idle"
boleh ada dalam "Kereta Malaysia" dan juga "Bunyi enjin"). Composite PK
`(dataset_id, audio_file_id)` juga halang duplicate secara automatik.

**Kenapa `metadata` key-value dan bukan kolum tetap?** Supaya metadata tersuai (notes, jenis
telefon, apa-apa nanti) boleh ditambah tanpa migration. Setiap key keluar dalam export sebagai
kolum `meta_<key>`. Unique on `(audio_file_id, key)`.

**2 RPC (function dalam PostgreSQL, dipanggil backend):**
- `dashboard_stats(p_user, min_confidence=0.3)` — semua nombor dashboard dalam **satu**
  round-trip: total_files, total_duration, files_by_source, files_by_status, files_by_review,
  class_distribution (top 10 kelas YAMNet), label_distribution (top 10 label manusia),
  total/public datasets, total_devices.
- `community_datasets(p_viewer, p_query, p_sort, p_owner, p_limit, p_offset)` — katalog awam
  dengan kiraan klip (tolak yang rejected), like, top labels, dan sama ada viewer sudah like.

**Kenapa RPC, bukan 8 query berasingan?** Setiap round-trip ke Supabase ada latency (~100 ms+
dari Malaysia ke region ap-southeast-2). Satu RPC = satu perjalanan, dan Postgres kira
COUNT/SUM/GROUP BY jauh lebih pantas daripada tarik semua baris ke Python.

---

## 6. Model keselamatan (soalan security mesti keluar)

### 6.1 Empat lapisan
1. **Frontend guard** — router `app.js` hantar pengguna belum log masuk ke `#/login`.
   *Ini UX, bukan security* — sesiapa boleh call API terus.
2. **Backend JWT** (lapisan sebenar) — setiap endpoint kecuali `/ingest`, `/config`, `/health`
   ada `Depends(current_user)`. Tiada/salah token → **401**.
3. **Filter pemilik pada setiap query** — backend guna **service-role key** yang **bypass RLS**,
   jadi RLS tidak melindungi API. Perlindungan sebenar ialah `.eq("user_id", user.id)` pada
   setiap query. Fail orang lain → **404** (bukan 403, supaya tak bocor bahawa fail itu wujud).
4. **RLS kekal enabled pada semua table** sebagai lapisan kedua, untuk sesiapa yang cuba akses
   Supabase terus dengan anon key: baris sendiri sahaja, plus dataset awam & profil.

### 6.2 Bagaimana JWT disahkan
```
Browser sign in ──► Supabase Auth ──► access_token + refresh_token (localStorage)
Browser call API ──► Authorization: Bearer <jwt>
Backend ──► supabase.auth.get_user(token) ──► {id, email}   ← cache 60 saat
```
**Kenapa tanya Supabase, bukan verify signature sendiri?** Sebab ia berfungsi untuk kunci lama
(HS256 secret) **dan** kunci asimetri baharu, tanpa simpan rahsia tambahan dalam env. Kos
round-trip ditutup dengan cache 60 s. **Trade-off jujur:** token yang di-revoke masih diterima
sampai 60 saat.

### 6.3 Perkara lain yang examiner suka tanya
- **Anon key didedahkan melalui `GET /config` — bahaya?** Tidak. Anon key memang direka untuk
  browser; ia hanya boleh buat apa yang RLS izinkan. **Service-role key tidak pernah keluar
  dari backend.**
- **Audio tidak public.** Bucket `audio-files` **private**. Browser hanya dapat **signed URL**
  sah 1 jam, dijana backend selepas ia sahkan pemilik.
- **API key device** — `secrets.token_hex(24)`, ditunjuk **sekali sahaja** masa register;
  selepas itu ditutup jadi `…abcd`. Boleh rotate (`regenerate_key`).
- **Password reset** — email recovery Supabase; link balik ke `#/reset`, sesi recovery dibaca
  dari URL fragment. Tukar password → `verifyPassword()` minta password lama dahulu, supaya
  telefon yang terbuka tak boleh dipakai untuk rampas akaun.
- **Delete account** — kena taip username untuk confirm; backend buang fail dari Storage,
  buang `audio_files` & `datasets` **secara eksplisit** (sebab `user_id` ialah ON DELETE SET
  NULL, jadi tak cascade), kemudian `auth.admin.delete_user()` yang cascade profiles/devices/likes.
- **Privasi Community** — email **tidak pernah** dipapar (guna `@username`); koordinat tepat
  dibuang dari download awam kecuali owner tick *share location*. Sebab rakaman di rumah =
  alamat rumah. Nama tempat (peringkat bandar) kekal.

---

## 7. LOGIC PENTING (bahagian yang examiner korek paling dalam)

### 7.1 Standardisasi audio — `audio.py`
```
decode_to_standard(bytes) → np.float32 array @ 16 kHz mono
```
- Cuba `soundfile` dahulu (laju). Stereo → `mean(axis=1)`. Sample rate lain → `librosa.resample`.
- Gagal decode (MP3/OGG) → fallback `librosa.load(sr=16000, mono=True)`.
- **librosa di-import lazily** (dalam function, bukan atas fail): import pertama librosa ambil
  beberapa saat, dan orang yang tekan "Save" pada telefon akan rasa macam app hang.
- **Kenapa 16 kHz mono?** YAMNet memang expect itu. Standardkan **masa masuk** supaya tiada
  resampling bug masa training, dan setiap fail dalam sistem identik bentuknya.
- **Kenapa 16-bit PCM (WAV), bukan MP3?** Lossless. MP3 buang maklumat frekuensi tinggi dan
  tinggalkan artifact pemampatan yang model boleh hafal sebagai corak palsu. 16 kHz mono
  16-bit = 32 KB/saat, masih munasabah.

### 7.2 Inference YAMNet — `classifier.py`
- Model di-load **sekali** (singleton + `threading.Lock`), ~2–5 s kali pertama.
- `scores = model(waveform)[0]` → matrix `(n_windows, 521)`.
- Window `w`: mula `w × 0.48`, tamat `+0.96` → **overlap 50%**.
- Setiap window simpan **top-3**: rank 1 **selalu** disimpan; rank 2 & 3 hanya jika confidence
  ≥ `0.1`. (Kalau rank 2 gagal, rank 3 terus di-`break` sebab dah tersusun turun.)
- Ada recovery: kalau cache TF Hub rosak (download separuh), ia `rmtree` dan download semula.
  Cache diletak dalam `backend/yamnet_cache/`, bukan OS temp — sebab Windows cleanup pernah
  padam isinya dan tinggalkan folder kosong yang TF Hub anggap "sah tapi tak boleh load".

**Kenapa simpan per-window, bukan satu label sahaja per fail?**
1. Timeline dalam detail page boleh diklik → seek ke saat itu.
2. Boleh kira agregat dengan peraturan berbeza kemudian **tanpa run YAMNet semula**.
3. Search `min_confidence` perlukan nilai per window.
4. Data mentah = bukti. Collapse awal = maklumat hilang selamanya.
   *Kos:* ~2 window/saat × sampai 3 baris = sampai ~6 baris per saat audio. Klip 20 s ≈ 120 baris.

### 7.3 Pipeline simpan — `clips.create_clip()` + `privacy.py`
```
kuota → YAMNet (skor penuh) → senyapkan window suara → (jika ada suara) YAMNet semula
      → FLAC → Storage → baris audio_files (status 'done') → baris classifications (batch 500)
```
- **Kenapa segerak, bukan background task lagi?** Penapis privasi **perlukan** skor YAMNet
  *sebelum* fail disimpan — suara tak boleh sampai ke storan langsung. Bila skor dah ada,
  klasifikasi siap sekali. Ia dijalankan dalam threadpool supaya request lain tak tersekat.
- **Kesan sampingan baik:** tiada lagi status tersangkut `processing` bila server restart.
- **Kenapa YAMNet dijalankan semula selepas senyap?** Supaya timeline menunjukkan "Silence"
  di tempat suara, bukan label "Speech" yang menunjuk kepada bunyi yang dah tiada.

### 7.4 Waveform peaks — kenapa 600 titik
`np.array_split(|waveform|, 600)` → ambil `max` setiap chunk → simpan jsonb. Sebab UI nak lukis
gelombang **tanpa** download fail audio (hemat data telefon), dan bentuk gelombang tak berubah,
jadi kira sekali sahaja.

### 7.5 Dari 120 baris → satu label (ini "algoritma" anda) — `labels.py`
```
class_ranking():  untuk setiap fail →
   N = bilangan window dalam fail
   skor kelas = JUMLAH confidence kelas itu ÷ N   (window tanpa kelas itu dikira 0)
   kelas dengan skor tertinggi = predicted_label
```
- **Kenapa mean, bukan max?** Kelas yang sederhana yakin **sepanjang** klip lebih mewakili
  bunyi itu daripada kelas yang spike sekali sahaja.
- **Tapi `GET /audio` (senarai) guna PEAK confidence**, bukan mean. Itu **sengaja**: senarai
  itu hint untuk browsing, bukan label rekod. Label rekod hanya ada satu peraturan: `labels.py`.
- **Kenapa satu modul dikongsi panel semakan dan export?** Kalau panel kira label dengan satu
  cara dan export cara lain, penyemak approve "Pump (liquid)" tapi manifest hantar benda lain.
  Satu peraturan = apa yang diluluskan itulah yang dieksport.
- **Kenapa dibahagi dengan SEMUA window?** Peraturan lama ambil purata hanya atas window di
  mana kelas itu muncul — satu salakan anjing (0.9, 1 window) mengalahkan kereta (0.5, 120
  window). Sekarang kelas mesti yakin **dan** hadir lama untuk menang. (Diuji: kes kereta vs
  anjing.)

### 7.6 Empat asal label — `label_source` (idea teras projek)
```python
if not verified_label:                    -> (prediksi YAMNet, "auto")
elif label_origin == 'capture':           -> "human_annotated"
elif verified_label == predicted_label:   -> "human_confirmed"
else:                                     -> "human_corrected"
```
| Nilai | Maksud | Tahap percaya |
|---|---|---|
| `human_annotated` | Perakam namakan bunyi itu masa merakam | Paling tinggi (dia ada di situ) |
| `human_confirmed` | Penyemak setuju dengan tekaan YAMNet | Tinggi |
| `human_corrected` | Penyemak tukar label | Tinggi |
| `auto` | **Tiada siapa periksa** — tekaan YAMNet | Lemah (weak label) |

**Kenapa `human_annotated` dipisahkan dari `human_corrected`?** Orang yang rakam Honda dan taip
"Honda" **tidak membetulkan** tekaan YAMNet "Vehicle" — dia tak pernah lihat tekaan itu. Kalau
dikira "corrected", setiap export akan **menggelembungkan** kadar ralat model yang dilaporkan.
(Convention ini ikut cara dataset terbitan buat — cth NVIDIA Nemotron rekod `human` vs
`llm_jury` — tapi kes manusia dipecahkan lagi halus.)

### 7.7 Dua paksi status — `status` vs `review_status`
| | `status` | `review_status` |
|---|---|---|
| Milik | mesin / pipeline | manusia |
| Nilai | pending, processing, done, error | unreviewed, approved, rejected |

**Kenapa tak gabung jadi satu kolum?** Kalau digabung, fail yang **gagal diklasifikasi**
(`error`) tak dapat dibezakan daripada fail yang **ditolak penyemak** (`rejected`). Dua masalah
berbeza, dua tindakan berbeza.

### 7.8 Logic panel semakan — `_review_patch()`
- **Approve tanpa taip label** → simpan prediksi YAMNet sebagai `verified_label`
  (`label_origin='review'`). Sebab "YAMNet betul" mesti jadi label **konkrit** dalam DB, bukan
  NULL yang kena teka semula masa export.
- **Approve klip yang dah ada label manusia** → label lama **dikekalkan** (tak ditimpa
  "Vehicle" YAMNet).
- **Taip label sama seperti sedia ada** → `label_origin` kekal (masih `capture` kalau asalnya
  ditaip masa rakam).
- **Reopen (`unreviewed`)** → kosongkan `verified_label`, `label_origin`, `reviewed_by`,
  `reviewed_at`, `review_note` — supaya export jujur jadi `auto` balik.
- **Bulk review** → resolve label **setiap fail sendiri**, jadi 20 fail terpilih tetap dapat
  20 label masing-masing (bukan satu label dipaksa pada semua).
- `reviewed_by` diambil **dari token**, bukan dihantar client. Kalau client hantar, sesiapa
  boleh tulis nama orang lain sebagai penyemak dan provenance jadi tak bermakna. (Fasa 4 dulu
  memang hantar dari client — had yang direkod dalam decision log; Fasa 5 membetulkannya.)

### 7.9 Ejaan kelas — `canonical_label()`
"honda", "Honda " dan "HONDA" = **tiga kelas berbeza** kepada model. Jadi label baharu dipadan
tanpa kira huruf besar/kecil dengan kelas yang sudah ada dalam folder; kalau padan, guna ejaan
lama. Kelas betul-betul baharu ditambah ke `datasets.labels` supaya rakaman seterusnya dapat
butang satu-tap.

### 7.9b Potong jadi clip — `segments.py` + `POST /audio/{id}/clips`
- **Clip maya:** baris `audio_files` dengan `parent_id`, `clip_start`, `clip_end`, **tanpa**
  `storage_path`. Tiada audio disalin → tiada storan & kuota. Main/export: baca bahagian itu
  dari fail induk (`soundfile` seek, bukan decode penuh).
- **Klasifikasi clip:** window induk yang **tengahnya** jatuh dalam clip, masa dianjak ke 0.
  Tiada YAMNet semula → potong 100 clip pun serta-merta.
- **Auto (ikut bunyi):** top-1 setiap window → gabung window berturut sama kelas → bahagian
  < min (default 1 s) dilipat ke jiran yang lebih panjang → Silence boleh dibuang.
- **Clip ganti induk dalam folder** → export tak bawa audio sama dua kali.

### 7.10 Train/validation/test split — `_stratified_split()`
```python
for setiap label:
    ids = sorted(ids)                                      # susunan stabil dulu
    random.Random(f"{dataset_id}:{label}").shuffle(ids)     # seeded!
    n_train = min(n, max(1, round(n * 0.7)))               # satu contoh sahaja → train
    n_val   = round((n - n_train) * val_share)
```
Tiga keputusan, tiga sebab:
1. **Stratified (per kelas)** — kalau random buta, kelas jarang (3 klip) boleh jatuh **semua**
   dalam test → train tak pernah nampak kelas itu.
2. **Seeded dari `dataset.id`** — export semula beri **partition yang sama**. Tanpa ini, test
   set bertukar senyap antara eksperimen dan nombor accuracy tak boleh dibanding lagi. *(Ini
   titik "research rigour" yang patut anda tonjolkan.)*
3. **Kelas dengan satu contoh → train** — lebih baik model pernah nampak sekali daripada tak
   pernah nampak.
4. **Clip dari rakaman yang sama = satu kumpulan, satu split** ⭐ — kalau saat 0–3 dalam train
   dan saat 3–6 dalam test, model "ingat" rakaman itu dan accuracy jadi palsu tinggi (**data
   leakage**). Kumpulan diagih ke split yang paling banyak kekurangan, supaya test tak kosong
   walaupun kumpulan besar. *(Titik rigour kedua yang patut ditonjolkan.)*

### 7.11 Export ZIP — `build_export()`
```
metadata.csv      file_name, label, label_source, split, + ~20 kolum teknikal
metadata.json     baris yang sama dalam JSON
train.csv / validation.csv / test.csv     (kalau split dihidupkan)
README.md         dataset card
audio/<uuid>.wav  WAV 16 kHz mono 16-bit
```
- **Kolum WAJIB bernama `file_name`** — itu nama tepat yang loader `audiofolder` HuggingFace
  cari untuk padankan baris dengan fail audio. Nama lain → ia load **kosong tanpa error**.
  (Dulu fail ini bernama `manifest.csv` dengan kolum `file` — itu sebab ia tak berfungsi.)
- **Peraturan tapisan:** `rejected` **selalu** dibuang; klip tanpa label dibuang; kalau
  *approved only* ditick, yang belum approve dibuang. `README.md` senaraikan apa yang
  dikecualikan **dan sebabnya**.
- **Dataset card (`README.md`)** ada: penerangan, lesen, jumlah klip & minit, jadual
  **provenance label**, agihan kelas, agihan split, senarai klip dikecualikan, penerangan
  setiap kolum, dan snippet Python untuk load.
- Ada **amaran automatik**: kalau ada baris `auto`, README tulis berapa % baris belum disemak
  dan cadang `filter on label_source != 'auto'`.
- Kolum `channels=1`, `bit_depth=16`, `audio_format=wav` ditulis walaupun ia tetap — supaya
  trainer tak perlu buka fail untuk tahu.

### 7.12 Community — publish, ranking, privasi
- **Syarat publish** (semua wajib): penerangan **+** lesen **+** sekurang-kurangnya satu klip
  berlabel & tidak rejected. Kalau tak cukup, backend pulangkan mesej yang senaraikan apa yang
  kurang.
- **Unit yang dikongsi = dataset, bukan klip tunggal** (macam HuggingFace Hub). Yang dikongsi
  ialah data latihan lengkap: kelas, penerangan, lesen — bukan timbunan fail.
- **Ranking "popular"** = `download_count + 2 × like_count` (like lebih berat sebab ia niat
  sedar; download boleh jadi tersalah klik). Sort lain: newest, likes, clips.
- **Transformasi privasi untuk download awam:** `reviewed_by` (email) → `@username`;
  `latitude`/`longitude` dibuang kecuali `share_location = true`; `location_name` kekal.
- `download_count` di-increment dengan read-then-write (ada race kecil). **Diterima dengan
  sedar**: kehilangan satu kiraan popularity tak merosakkan apa-apa. *(Kalau ditanya: jawapan
  betul ialah RPC increment atomik di Postgres.)*

### 7.13 Rakaman dalam app — `recorder.js` + `recorder-worklet.js`
```
getUserMedia({echoCancellation:false, noiseSuppression:false, autoGainControl:false})
   → AudioWorklet 'pcm-capture' (thread audio, blok 4096 frame)
   → Float32 chunks di main thread
   → OfflineAudioContext resample ke 16 kHz (band-limited, guna engine browser)
   → encodeWav() tulis header RIFF 44 bait + sampel 16-bit
   → POST /recordings (multipart)
```
**Empat keputusan yang mesti anda boleh jelaskan:**
1. **Kenapa matikan echo cancellation / noise suppression / AGC?** Sebab tiga-tiga itu betul
   untuk **panggilan telefon**, salah untuk **data latihan**: noise suppression padam tekstur
   latar yang model sepatutnya belajar hadapi, dan AGC ubah kekuatan bunyi pertengahan klip.
   Fail mesti simpan apa yang mikrofon **betul-betul** dengar.
2. **Kenapa AudioWorklet + PCM mentah, bukan `MediaRecorder`?** MediaRecorder keluarkan
   webm/opus atau mp4/aac — **lossy**, dan server perlukan ffmpeg untuk decode. PCM mentah =
   tiada codec lossy sentuh data latihan, server tak perlu ffmpeg.
3. **Kenapa resample dalam browser, bukan server?** Kurangkan saiz upload (48 kHz → 16 kHz ≈
   1/3 saiz) pada rangkaian mudah alih. Kalau browser tolak OfflineAudioContext 16 kHz, ia
   hantar rate asal — server resample juga, jadi tetap selamat.
4. **Kenapa klip rakaman terus `approved` + `human_annotated`?** Orang yang rakam **tahu** bunyi
   apa itu. YAMNet tetap dijalankan sebagai *sanity check*: klip "Honda" yang YAMNet dengar
   sebagai "Speech" patut didengar semula.

**UX yang berbaloi disebut:** label terakhir jadi default untuk take seterusnya (rakam 20 klip
Honda = 20 kali tekan rakam/save); amaran automatik kalau klip hampir senyap (peak < 0.01) atau
clipping (peak > 0.99); leave-guard supaya rakaman belum save tak hilang bila tersentuh tab bar;
masa, tempoh dan GPS diisi automatik; `navigator.vibrate(30)` bila stop.

**Lokasi:** Geolocation API (boleh dimatikan) → koordinat; kemudian **OpenStreetMap Nominatim**
reverse geocode → "Seri Iskandar, Perak". Best-effort: gagal → klip kekal dengan koordinat
sahaja. Nominatim dipilih sebab free & tiada API key (trade-off: ada rate limit, jadi hasil
di-cache dalam `Map`).

### 7.14 Auth di frontend — `auth.js` + `api.js`
- Session (`access_token`, `refresh_token`, `expires_at`) dalam **localStorage**.
- `getAccessToken()` auto-refresh kalau tinggal < 60 s. **Concurrent callers share one refresh**
  (`refreshing ??= refresh()`) — kalau dua refresh serentak, refresh token yang kalah dah
  terpakai dan session mati.
- `api()` dapat 401 → cuba refresh **sekali** → retry → kalau masih 401, sign out & redirect.
- Mesej error Supabase ditukar jadi bahasa manusia (`invalid_credentials` → "Wrong email or
  password.").
- **Kenapa localStorage, bukan httpOnly cookie?** Frontend guna Supabase Auth terus dari
  browser (tiada server session), token dihantar dalam header Authorization. Trade-off jujur:
  terdedah kepada XSS — itu sebab semua output di-escape dengan `esc()`.
- Download ZIP tak boleh guna `<a href>` biasa sebab link tak bawa token — jadi fetch dulu,
  kemudian bagi browser blob URL.
- Upload guna `XMLHttpRequest`, bukan fetch, sebab **fetch tak boleh report upload progress**.

### 7.15 Device ingest — `routers/ingest.py` (aliran peranti-agnostik)

Supervisor: aliran mesti **tidak bergantung pada device**. Satu peraturan untuk semua klien
(ESP32, program di laptop, ...):

```
DEVICE                                         SERVER
1. rakam 10 s, simpan dalam storan sendiri
2. POST /ingest  ───────────────────────────►  3. simpan, kira SHA-256
   X-API-Key, X-Client-Id, X-Content-SHA256
5. hash resit == hash sendiri?  ◄────────────  4. resit {status, sha256, audio_id}
   ya → PADAM salinan sendiri
   tidak / tiada jawapan → simpan, hantar semula
```

1. Cari device ikut `api_key` → tiada → **401**.
2. Saiz < 3200 bait → 400; > 50 MB → 413.
3. Kira SHA-256 badan. Klien hantar hash lain → **422** (rosak dalam perjalanan, hantar semula).
4. `X-Client-Id` sudah wujud untuk device ini → **200 + resit asal** (bukan simpan dua kali).
   Id sama tapi audio lain → 409. Ini dijamin juga oleh *unique index* `(device_id, client_id)`.
5. Badan = fail audio (WAV/FLAC/MP3/OGG, dikesan ikut `Content-Type` atau *magic bytes*) atau
   raw PCM 16-bit (serasi dengan reka bentuk ESP32 asal).
6. Masuk laluan `create_clip()` yang **sama** dengan upload; `source='device'`,
   `recorded_at` = `X-Recorded-At` (jam device) atau masa tiba. **201 + resit.**

**Mod stream:** `?session_id=<uuid>&chunk_index=0,1,2…` — setiap chunk ~10 s dihantar sebaik siap.
- `join=false` → setiap chunk jadi satu klip dalam Library.
- `join=true` → chunk disimpan dalam `ingest_chunks` (**tidak** muncul dalam Library).
  `POST /ingest/sessions/{id}/close?chunks=N` → semak 0..N-1 lengkap (hilang → **409** dengan
  senarai `missing`, klien hantar semula) → cantum ikut urutan → satu rakaman → padam chunk.
  Status `open → joining → closed`; `joining` ialah kunci supaya dua *close* serentak tidak
  menghasilkan dua rakaman. Panggil *close* semula = jawapan sama (idempoten).

**Klien rujukan** `client/sodama_client.py` (Python stdlib): `send`, `watch <folder>`,
`mic --chunk 10 [--join]`. Chunk ditulis ke folder `spool/` dahulu dan hanya dipadam selepas
resit sah — kalau program crash atau internet putus, larian seterusnya sambung hantar.

**Kenapa API key, bukan JWT?** Device tiada UI untuk login, tiada tempat selamat untuk simpan
refresh token, dan tak boleh renew token. API key setiap device = boleh revoke satu device
tanpa sentuh yang lain.
**Kenapa client yang pilih id, bukan server?** Kalau balasan server hilang, client tak tahu id
yang server beri. Id dari client wujud *sebelum* upload, jadi cubaan semula boleh dikenali.
**Kenapa padam hanya selepas hash sepadan, bukan selepas HTTP 200?** 200 hanya bermaksud
server terima *sesuatu*. Hash yang sama membuktikan server simpan bait yang **sama**.

---

## 8. Setiap page buat apa (untuk demo)

| Page | Route | Isi penting |
|---|---|---|
| **Dashboard** | `#/dashboard` | 4 tile (fail, jumlah audio, perlu semak, dataset); carta **2 tab** — "Your labels" (label manusia) dan "YAMNet classes" (≥30% confidence); doughnut sumber; aktiviti terkini |
| **Record** | `#/record` | Pilih folder → rakam → review (waveform, masa, tempoh, lokasi) → pilih/taip label → save; "Record another Honda" |
| **Upload** | `#/upload` | Drag & drop WAV/MP3/FLAC/OGG, progress bar, boleh terus masuk folder |
| **Library** | `#/library` | Search (label/nama fail/tempat) + filter (folder, kelas YAMNet, min confidence, sumber, tarikh) + **tab semakan** (All / Needs review / Approved / Rejected) dengan kiraan; play dalam senarai; **bulk** approve / reject / delete; kad di telefon, table di desktop |
| **Audio detail** | `#/audio/{id}` | **Panel semakan** (approve / correct / reject / reopen); waveform WaveSurfer; timeline klasifikasi per window boleh diklik; top-5 kelas; metadata; folder; download |
| **Datasets** | `#/datasets`, `#/datasets/{id}` | Folder = dataset; imbangan kelas (amaran kalau kelas terbesar ≥3× terkecil); **panel export** (approved only / split / format + kiraan hidup "N of M clips"); **panel share** |
| **Community** | `#/community`, `#/community/{id}`, `#/u/{username}` | Browse/search/sort; kad dataset; sample player; like; download ZIP; halaman penyumbang |
| **Profile** | `#/profile` | Username, nama, role, organisasi, bio, avatar, statistik, tukar password, delete account |
| **Devices** | `#/devices` | Register ESP32 (API key sekali), rename, rotate key, delete, `last_seen` |

**Mobile:** bar tab bawah 5 butang dengan **Record di tengah** (tempat ibu jari berehat); kad
ganti table; input 16 px (elak iOS zoom automatik); PWA manifest (boleh "Add to Home screen").

---

## 9. Demo script untuk VIVA

### Checklist SEBELUM masuk bilik (buat 30 minit awal)
- [ ] **Buka sistem dahulu** — Supabase free tier **auto-pause** selepas ~1 minggu tak aktif;
      restore ambil ~3 minit. Jangan jumpa masalah ini depan examiner.
- [ ] Backend jalan: `cd backend; .venv/Scripts/python -m uvicorn app.main:app --reload`
      (atau buka URL Railway).
- [ ] **Mikrofon perlukan `https://` atau `localhost`** — kalau demo dari IP LAN
      (`192.168.x.x`), Record **tidak akan** berfungsi. Guna `127.0.0.1:8000` atau URL Railway.
- [ ] Sediakan 2–3 fail audio dalam desktop (plan B kalau WiFi/mic bermasalah).
- [ ] Sediakan satu dataset yang **sudah** ada klip berlabel, supaya Export boleh terus ditunjuk.
- [ ] Buka tab kedua pada `/docs` (Swagger) — untuk tunjuk `/ingest` tanpa hardware.
- [ ] Charge telefon + buka app di telefon (tunjuk mobile UI = markah UX).
- [ ] **Commit kerja Fasa 5** supaya repo yang examiner lihat = sistem yang anda demo.

### Urutan demo (8–10 minit)
1. **Login** → Dashboard. Tunjuk tile & dua carta. *"Carta kiri ialah label manusia — itu yang
   anda akan train. Carta kanan ialah tekaan YAMNet."*
2. **Record** (pada telefon kalau boleh) — pilih folder, rakam 5 saat, tunjuk masa/tempoh/GPS
   auto, tap chip label, Save. Tunjuk "YAMNet is listening to it…" bertukar jadi kelas.
   *Ini bahagian paling "wow" — buat awal.*
3. **Upload** satu fail → tunjuk status `pending → done`.
4. **Library** → tab **Needs review** → tunjuk search & filter → pilih 3 fail → **bulk approve**.
5. **Audio detail** satu fail — tunjuk waveform, klik satu window pada timeline, kemudian
   **Correct label** → tunjuk badge bertukar jadi `human_corrected`.
6. **Datasets** → buka folder → tunjuk imbangan kelas → **Export** → buka ZIP → **buka
   `metadata.csv` dan `README.md`**. Tunjuk kolum `label_source` dan jadual provenance.
   *Ini bukti teknikal paling kuat dalam keseluruhan demo.*
7. **Publish** dataset (pilih lesen) → **Community** → tunjuk kad, dengar sample, download.
8. **Swagger `/docs`** → tunjuk `/ingest` dan terangkan ESP32 (jujur: firmware belum siap).

### Ayat rangka kalau ada yang gagal
> "Ini disebabkan [Supabase auto-pause / mikrofon perlukan https / device belum ada]. Ini yang
> sepatutnya berlaku: … Boleh saya tunjuk melalui [Swagger / fail yang sudah ada]?"

Jangan panik, jangan repair lama-lama depan examiner — teruskan dengan plan B.

---

## 10. BANK SOALAN VIVA + jawapan

> Latih dengan: baca soalan, **tutup jawapan**, cakap kuat-kuat, baru semak.

### A. Kefahaman & skop

**A1. Terangkan projek anda dalam 1 minit.**
→ Guna versi 30 saat (Bahagian 1), kemudian tambah pipeline 6 kotak.

**A2. Apa objektif projek anda?**
→ (1) Satukan pengumpulan audio dari berbilang sumber (telefon, upload, IoT) ke satu tempat
berpusat; (2) hapuskan kerja manual seragamkan format dan label awal melalui auto-klasifikasi;
(3) pastikan kualiti label melalui semakan manusia yang **direkod provenance**-nya; (4)
keluarkan dataset yang **terus boleh dilatih** (format HuggingFace, split reproducible); (5)
benarkan dataset dikongsi dengan lesen yang jelas.

**A3. Siapa pengguna sasaran?**
→ Pelajar/penyelidik ML audio; jurutera industri (kesan bunyi mesin rosak); penyelidik alam
sekitar (bioakustik/pencemaran bunyi); pensyarah/lab yang perlu satu tempat berpusat. Bukan
pengguna am — sistem ini untuk orang yang **akan** train model.

**A4. Apa yang BUKAN skop projek ini?**
→ Melatih atau fine-tune model klasifikasi; inference masa nyata atas device; annotation
peringkat segmen (start–end dalam satu fail); kolaborasi banyak orang atas satu dataset; mobile
app native. Sistem ini **penghasil dataset**, bukan penghasil model.

**A5. Apa deliverable akhir sistem ini?**
→ Satu ZIP: `audio/*.wav` (16 kHz mono), `metadata.csv` (kolum `file_name`, `label`,
`label_source`, `split` + ~20 kolum teknikal), `metadata.json`, `train/validation/test.csv`, dan
`README.md` dataset card. Boleh terus `load_dataset("audiofolder", data_dir="./")`.

**A6. Berapa fasa projek ini?**
→ Fasa 0 setup + verify YAMNet · Fasa 1 database & storage · Fasa 2 backend + pipeline YAMNet ·
Fasa 3 frontend dashboard · Fasa 3b tema + authentication · Fasa 4 label review + export HF ·
Fasa 5 akaun per-pengguna, rakaman dalam app, Community, mobile. Semua bertarikh dalam
`docs/decision-log.md` dengan justifikasi setiap keputusan.

### B. Kenapa pilih teknologi ini

**B1. Kenapa FastAPI, bukan Flask/Django?**
→ (1) Async — penting untuk chunked upload dari ESP32; (2) Swagger UI **automatik** di `/docs`
(berguna untuk demo & test tanpa frontend); (3) validation automatik melalui Pydantic (setiap
Query/Form ada constraint, cth `latitude: float = Form(None, ge=-90, le=90)`); (4)
`BackgroundTasks` terbina — tak perlu Celery untuk skala ini. Django terlalu berat (ORM + admin
+ template) untuk API yang tak perlukan semua itu.

**B2. Kenapa YAMNet, bukan PANNs / AST / Whisper?**
→ Saiz: ~17 MB vs PANNs ~300 MB+ (penting untuk hosting free tier dengan had RAM). 521 kelas
AudioSet cukup sebagai **tekaan awal**. TensorFlow Hub = satu baris `hub.load()`. Whisper untuk
**speech-to-text**, bukan klasifikasi bunyi am — salah alat. AST lebih tepat tapi jauh lebih
berat dan perlukan lebih banyak setup.

**B3. Kenapa Supabase, bukan Firebase / MySQL / Postgres sendiri?**
→ Supabase = PostgreSQL + Storage + Auth dalam satu, free tier, dan **RLS** terbina. Data kita
**relasional** (many-to-many `datasets ↔ audio_files`) dan perlukan agregat SQL
(`dashboard_stats`) — Firebase NoSQL menyusahkan untuk kedua-duanya. Postgres self-host
bermakna urus backup/patch/auth sendiri, tiada nilai tambah untuk FYP.

**B4. Kenapa vanilla JavaScript, bukan React/Vue?**
→ Tiada build step (tiada npm, webpack, node_modules) → demo jalan terus, senang review code.
Saiz app tak justify framework. Semua library (Tailwind, Chart.js, WaveSurfer) **di-vendor**
dalam `frontend/vendor/` supaya demo berfungsi **tanpa internet**. Trade-off jujur: tiada
component/state management; DOM ditulis sebagai template string.

**B5. Kenapa Railway, bukan Render / Vercel / Heroku?**
→ Vercel serverless: ada had saiz & timeout — TensorFlow tak sesuai. Render free: 512 MB RAM
(TensorFlow seorang hampir capai had itu → risiko OOM) dan **tidur selepas ~15 minit**, yang
akan memutuskan request pertama ESP32 dan melambatkan demo. Railway kekal jaga — dan sebab
backend terus query Supabase, projek Supabase pun tak auto-pause.

**B6. Kenapa satu worker sahaja?**
→ Setiap uvicorn worker load **salinan YAMNet sendiri** dalam RAM. `--workers 2` = dua kali
memori = punca biasa OOM kill. Skala mendatar yang betul ialah pisahkan worker inference
(lihat future work).

**B7. Kenapa WAV, bukan MP3 (saiz lebih kecil)?**
→ MP3 lossy: ia buang maklumat frekuensi (terutamanya tinggi) yang model patut belajar, dan
artifact pemampatan boleh jadi corak palsu yang model hafal. Untuk data latihan, lossless lebih
penting daripada saiz.

### C. YAMNet & machine learning (paling kerap dikorek)

**C1. Anda tak train model sendiri — jadi mana kontribusi anda?** ⭐ *(soalan paling mungkin)*
→ "Betul, YAMNet model Google — saya guna ia sebagai **komponen**, bukan sebagai projek.
Kontribusi saya ialah **pipeline data dan integriti label** di sekelilingnya: standardisasi
automatik setiap fail masuk, tiga laluan pengumpulan (telefon, upload, IoT) yang berkumpul pada
satu laluan simpan, lapisan semakan manusia yang **merekod asal setiap label dalam empat
tahap**, export reproducible yang HuggingFace boleh baca, dan lapisan perkongsian berlesen.
YAMNet di sini berfungsi sebagai **weak labeller** untuk kurangkan kerja manual — sistem saya
yang memastikan apa yang keluar boleh dipercayai. Label Studio pun tidak mencipta model;
nilainya pada workflow."

**C2. Kenapa tak fine-tune YAMNet dengan data yang dikumpul?**
→ Dua sebab: (1) **Skop** — sistem ini *menghasilkan* dataset; melatih model ialah langkah
selepas itu, dan pengguna mungkin nak arkitektur lain sepenuhnya. (2) **Ayam dan telur** — pada
permulaan projek tiada data berlabel untuk fine-tune; sistem inilah yang menghasilkannya.
Laluan semula jadi untuk future work: guna **embedding 1024-dimensi** YAMNet dan latih
classifier kecil di atasnya (transfer learning) — itu sebab data per-window disimpan.

**C3. Apa accuracy sistem anda?**
→ Jawab tepat, jangan reka nombor: "Sistem ini tidak mengeluarkan nombor accuracy kerana ia
bukan pengelas — ia sistem pengurusan data. Accuracy YAMNet ialah accuracy Google yang
diterbitkan pada AudioSet (rujuk model card TF Hub). Metrik yang **relevan untuk sistem saya**
ialah: peratusan klip yang sudah disemak manusia, agihan `label_source` (berapa % `auto` vs
manusia), dan berapa banyak kerja manual dijimatkan. Dashboard dan dataset card memaparkan
kedua-dua nombor itu."
*Kalau anda nak sebut nombor YAMNet, semak model card TF Hub dahulu — jangan hafal nombor yang
anda tak boleh buktikan.*

**C4. Kenapa window 0.96 saat?**
→ Itu **tetap** dalam arkitektur YAMNet: ia ambil patch log-mel spectrogram 96 frame × 64 mel
bin pada hop 10 ms = 0.96 s. Bukan pilihan saya. Hop 0.48 s (overlap 50%) supaya bunyi yang
jatuh di sempadan window tidak terbelah, dan liputan masa lebih lancar.

**C5. Kenapa simpan top-3, bukan top-1 atau semua 521?**
→ 521 × bilangan window = terlalu banyak baris (dan hampir semua skor hampir sifar). Top-1
sahaja hilang maklumat berguna — bunyi bertindih (cth "Speech" + "Vehicle" serentak) dan tekaan
kedua sering yang betul. Top-3 dengan ambang 0.1 untuk rank 2–3 ialah kompromi; rank 1 selalu
disimpan supaya setiap window tetap ada rekod.

**C6. Bagaimana dapat SATU label untuk satu fail daripada banyak window?**
→ Terangkan 7.5 (mean confidence per kelas; satu modul dikongsi review panel & export).
Kemudian **sebut sendiri** kelemahannya (mean tak ditimbang bilangan window) dan pembaikannya.
Ini buat examiner percaya anda faham code sendiri.

**C7. Macam mana kalau bunyi itu tiada dalam 521 kelas AudioSet?** ⭐
→ "Itu memang kes biasa, dan itulah sebab lapisan manusia wujud. AudioSet ada 'Vehicle' dan
'Car', tapi tiada 'Honda Civic' atau 'bunyi bearing rosak di kilang X'. Jadi untuk label halus,
YAMNet hanya berfungsi sebagai **sanity check** — halaman Record benarkan perakam taip ground
truth terus (`human_annotated`), dan panel semakan benarkan penyemak taip label di luar 521
kelas itu. Export merekod kedua-duanya: `predicted_label` (YAMNet) dan `label` (apa manusia
kata) — jadi pembaca boleh lihat sejauh mana model am tersasar untuk domain itu."

**C8. Macam mana anda pastikan label betul?**
→ Empat mekanisme: (1) setiap klip ada `review_status` eksplisit, default `unreviewed`; (2)
`label_source` merekod asal setiap label — pembaca boleh tapis `label_source != 'auto'`; (3)
klip `rejected` **tidak pernah** dieksport; (4) `README.md` ZIP beri amaran berapa % baris belum
disemak. Jujur: **tiada inter-annotator agreement** kerana satu dataset satu pemilik — itu
future work (dua penyemak + Cohen's kappa).

**C9. Kenapa ada amaran clipping/senyap masa rakam?**
→ Data rosak lebih buruk daripada tiada data. Klip clipped (peak > 0.99) dah hilang bentuk
gelombang puncaknya, dan klip hampir senyap (peak < 0.01) tiada isi untuk dipelajari. Lebih
baik tahu **masa berdiri di lokasi** daripada jumpa masa training.

**C10. Class imbalance macam mana ditangani?**
→ Halaman dataset papar imbangan kelas dan beri amaran bila kelas terbesar ≥3× terkecil. Split
adalah **stratified** supaya imbalance tidak bertambah buruk antara split. Sistem **tidak** buat
oversampling/class weights — itu keputusan masa training, bukan masa pengumpulan. Tapi dataset
card sertakan agihan kelas supaya trainer boleh putuskan.

**C11. Confidence yang ditunjuk itu probability?**
→ Skor sigmoid per-kelas dari YAMNet, 0–1, **multi-label** (bukan softmax) — jadi jumlah semua
kelas tidak sama dengan 1, dan dua kelas boleh tinggi serentak. Itu betul untuk audio: bunyi
kereta dan orang bercakap boleh berlaku serentak. Ia **bukan** probability terkalibrasi — itu
sebab ia dipanggil "hint", bukan kebenaran.

**C12. Kenapa dashboard tapis pada 0.3 confidence?**
→ Ini pembetulan bug sebenar (migration 5). Dulu carta "Top classes" disusun
`file_count desc, class_name` — tapi sebab YAMNet simpan top-3 setiap window, setiap fail juga
bawa banyak tekaan lemah (Aircraft 11%, Boat 12%…). Dengan koleksi kecil semua kelas seri pada
`file_count` yang sama dan **tiebreak alfabet** yang menang, jadi kelas yang betul-betul
menggambarkan audio tertimbus. Sekarang tekaan lemah dibuang (≥0.3) dan seri diselesaikan
dengan mean confidence.

### D. Backend & database

**D1. Kenapa ada `dataset_items` — tak boleh letak `dataset_id` dalam `audio_files`?**
→ Sebab hubungannya **many-to-many**: satu klip boleh berada dalam beberapa dataset. Composite
PK `(dataset_id, audio_file_id)` juga menghalang duplicate (`upsert` dengan `on_conflict`).

**D2. Kenapa klasifikasi dibuat sebagai background task?**
→ YAMNet ambil masa (load model + inference). Dalam request, user tercegat dan request boleh
timeout. Dengan background task: 201 serta-merta, `status='pending'`, UI poll sampai `done`.
**Kelemahan (sebut sendiri):** kalau process restart masa `processing`, status tersangkut —
tiada retry. Pembaikan betul: queue sebenar (Celery/RQ) + sweeper yang re-queue baris
`processing` lebih 10 minit.

**D3. Kenapa RPC PostgreSQL, bukan kira di Python?**
→ Agregat dilakukan di tempat data berada: satu round-trip, bukan lapan; Postgres kira
COUNT/SUM/GROUP BY jauh lebih pantas daripada tarik semua baris ke Python. Kelemahan: logik
tersebar antara SQL dan Python, jadi RPC dikekalkan hanya untuk agregat pembacaan.

**D4. `status` vs `review_status` — tak boleh satu?**
→ Lihat 7.7: `error` (mesin gagal) mesti boleh dibezakan daripada `rejected` (manusia tolak).

**D5. Ada index tak? Yang mana?**
→ Ada: `audio_files` pada `user_id`, `uploaded_at desc`, `source`, `status`, `review_status`,
`device_id`, `verified_label`; `classifications` pada `audio_file_id` dan `class_name`;
`metadata` pada `audio_file_id`, `key`; `datasets` pada `user_id` dan
`(visibility, published_at desc)`; `dataset_likes` pada `user_id`. Semuanya mengikut pola query
sebenar (senarai disusun ikut masa terbaru, ditapis ikut pemilik).

**D6. Apa berlaku bila user delete fail?**
→ Backend sahkan pemilik (404 kalau bukan), buang objek dari Storage, kemudian delete baris.
`classifications`, `metadata` dan `dataset_items` **cascade** dari `audio_files`. Device
**tidak** cascade (ON DELETE SET NULL) — buang device, rakaman kekal dalam library.

**D7. Kenapa `supabase-py` dipaksa guna HTTP/1.1 dalam `db.py`?**
→ supabase-py buka satu sambungan HTTP/2 dan multiplex semua request. FastAPI jalankan endpoint
sync dalam thread pool, jadi beberapa request guna sambungan itu serentak; bila Supabase edge
tamatkan sambungan (GOAWAY), **semua** request yang sedang berjalan gagal dengan
`RemoteProtocolError: ConnectionTerminated`. Pool HTTP/1.1 beri setiap request sambungan sendiri
dan gantikan yang basi secara telus. *(Ini bug sebenar yang ditemui dan diperbaiki — contoh
bagus untuk tunjuk kemahiran debugging.)*

**D8. Apa itu migration dan kenapa ada 8 fail?**
→ Setiap fail SQL = satu perubahan skema bertarikh, disimpan dalam repo supaya skema boleh
dibina semula dari kosong dan setiap perubahan ada sejarah + sebab (komen dalam fail). Fail 1
skema asal · 2 bucket · 3 status+waveform · 4 RPC dashboard · 5 pembetulan ranking · 6 label
review · 7 kiraan review · 8 akaun+rakaman+community.

**D9. Kenapa migration 8 `DROP FUNCTION` dahulu?**
→ Sebab senarai argumen berubah (`dashboard_stats(real)` → `dashboard_stats(uuid, real)`).
`create or replace` dengan argumen berbeza akan **tambah overload**, bukan ganti — dan PostgREST
gagal dengan `PGRST203 "could not choose the best candidate function"`. Itu memang pernah
berlaku, jadi migration 7 sengaja mengekalkan signature yang sama.

**D10. Kenapa `predicted_labels` chunk 200 ID?**
→ Filter PostgREST `in.(...)` masuk ke dalam **URL**, dan URL ada had panjang. 200 UUID setiap
batch kekal selamat.

### E. Keselamatan & privasi

**E1. Kalau saya tahu ID fail orang lain, boleh saya baca?**
→ Tidak. Setiap query ada `.eq("user_id", user.id)`; fail orang lain pulangkan **404** (sengaja
bukan 403 — 403 mengesahkan fail itu wujud).

**E2. Backend guna service-role key yang bypass RLS. Jadi RLS tak berguna?**
→ RLS bukan penguat kuasa untuk API — **filter dalam router** itulah penguat kuasa. RLS ialah
lapisan kedua untuk sebarang akses terus ke Supabase dengan anon key (cth dari console browser):
dia hanya dapat baris sendiri, dataset awam dan profil.

**E3. Anon key didedahkan di `/config`. Itu bukan kebocoran?**
→ Tidak — anon key memang direka untuk browser (setiap app Supabase hantar ia ke client). Ia
tak beri kuasa melebihi apa yang RLS izinkan. Yang rahsia ialah **service-role key**, dan ia
hanya dalam environment variable backend.

**E4. Token dalam localStorage — tak selamat?**
→ Trade-off yang disedari. localStorage terdedah kepada XSS; httpOnly cookie terdedah kepada
CSRF dan perlukan sesi sisi server (yang app ini tiada sebab ia guna Supabase Auth terus).
Mitigasi: semua teks dipapar melalui `esc()`, token berumur pendek dengan auto-refresh, dan
tiada data mentah masuk `innerHTML` tanpa escape.

**E5. Bagaimana ESP32 disahkan? Kenapa tak JWT?**
→ Lihat 7.15: API key per device, boleh revoke satu-satu, ditunjuk sekali sahaja, boleh rotate.
ESP32 tiada UI login dan tak boleh renew token dengan selamat.

**E6. Kalau API key ESP32 dicuri?**
→ Penyerang boleh hantar audio palsu **ke akaun pemilik device itu** (tiada akses baca ke
apa-apa). Mitigasi ada: `last_seen` menunjukkan aktiviti pelik, dan owner boleh
`regenerate_key` atau delete device (klip lama kekal). Yang belum ada: rate limit per device
dan HMAC per mesej.

**E7. Apa risiko privasi merakam bunyi?**
→ Rakaman boleh mengandungi perbualan orang lain dan mendedahkan lokasi. Sebab itu: koordinat
tepat **dibuang** dari download awam kecuali owner benarkan; email tidak pernah dipapar (guna
`@username`); bucket audio **private** dengan signed URL 1 jam; lokasi boleh dimatikan
sepenuhnya di halaman Record; dan publish memerlukan lesen eksplisit supaya hak guna jelas.
Yang perlu ditambah untuk kegunaan sebenar: notis persetujuan/etika, dan pilihan kabur
pertuturan.

**E8. Kenapa `reviewed_by` diambil dari token, bukan dihantar client?**
→ Kalau client hantar, sesiapa boleh tulis nama orang lain sebagai penyemak — provenance jadi
tak bermakna. Fasa 4 memang hantar dari client (had yang direkod dalam decision log); Fasa 5
membetulkannya.

**E9. CORS `allow_origins=["*"]` — tak bahaya?**
→ Ia kelemahan yang **saya tahu dan rekod** dalam `docs/deployment.md`. Impaknya terhad kerana
token dihantar dalam header Authorization (browser tak lampirkan ia automatik, jadi bukan kes
CSRF), tapi ia patut dihadkan kepada domain dashboard selepas URL production tetap.

**E10. Password requirement apa?**
→ Dikawal Supabase Auth (minimum 6 aksara secara default); mesej `weak_password` ditunjuk
kepada user. Confirm email **dimatikan** untuk demo (had emel free tier + `site_url` masih
localhost) — dan ini **direkod** sebagai perkara yang kena dihidupkan semula untuk production
(decision #14).

### F. Frontend & UX

**F1. Kenapa hash router (`#/page`), bukan path biasa?**
→ Hash routing berfungsi tanpa konfigurasi server (tiada rewrite rule) — refresh pada
`#/library` tetap load `index.html`. Bonus: link email Supabase pulang dengan token dalam URL
**fragment**, dan `consumeAuthRedirect()` memang perlu baca fragment itu.

**F2. Kenapa `Cache-Control: no-cache` pada fail statik?**
→ Tanpa header eksplisit, browser guna heuristic caching dan terus jalankan modul JS lama
selepas edit — pernah menyebabkan guard sign-in terlangkau secara senyap. `no-cache` masih
benarkan 304 melalui ETag, jadi ia tetap murah.

**F3. Kenapa library di-vendor secara lokal?**
→ Demo mesti berfungsi walaupun WiFi bilik VIVA mati atau CDN diblok. Juga versi terkunci —
CDN yang update boleh pecahkan UI pada hari yang salah.

**F4. Macam mana anda handle XSS?**
→ Semua data pengguna yang masuk ke HTML melalui helper `esc()` (escape `& < > " '`). Nama
folder, label, bio, nama fail — semua di-escape. Ini penting sebab UI dibina dengan template
string.

**F5. Kenapa butang Record di tengah bar tab?**
→ Itu tempat ibu jari berehat pada telefon, dan Record ialah tindakan paling kerap untuk
pengumpul data di lapangan. Input pula 16 px supaya iOS tidak zoom automatik bila di-tap.

**F6. Kenapa ada leave-guard pada halaman Record?**
→ Supaya rakaman yang belum di-save tidak hilang bila ibu jari tersentuh bar tab atau user tekan
back. Dua lapisan: guard router dalaman, dan `onbeforeunload` untuk tutup tab.

**F7. Aksesibiliti / dark mode?**
→ Dark mode tiada — tema eco (hijau `#4C7438`, krim `#F1F5E8`, coklat `#7A5239`) dipilih sebagai
satu tema. Tapi palette carta **divalidasi untuk colour-blindness**: worst adjacent ΔE2000 = 27.9
(sasaran ≥12), dan coklat sengaja tidak diletak bersebelahan hijau sebab pasangan itu hanya
8.1 ΔE bawah protanopia. Ada juga `prefers-reduced-motion` untuk matikan animasi. *(Ini jawapan
kuat kalau aksesibiliti ditanya.)*

### G. Hardware / ESP32 — jawab dengan JUJUR

**G1. Tunjukkan bahagian ESP32 berfungsi.** ⭐ *(soalan paling berisiko)*
→ **Jawapan jujur:** "Aliran device siap dan **tidak bergantung pada perkakasan**: mana-mana
klien ikut kontrak yang sama — hantar, dapat resit, padam hanya bila hash sepadan. Saya
demo dengan program di laptop kedua (`sodama_client.py mic --chunk 10 --join`): anda boleh
lihat fail hilang dari laptop itu dan muncul dalam Library. Yang **belum siap ialah
firmware ESP32** — hardware (ESP32 DevKit + INMP441) belum dibeli, jadi kod I2S capture belum
ditulis. Pendawaian dan reka bentuk firmware sudah didokumenkan dalam `firmware/README.md`
(SD→GPIO32, SCK→GPIO26, WS→GPIO25, L/R→GND), dan ia tidak memerlukan perubahan pada server
sebab kontrak endpoint sudah tetap."
**JANGAN** cakap ESP32 sudah berfungsi. Kalau examiner tangkap over-claim, semua jawapan lain
jadi mencurigakan.

**G2. Kenapa INMP441, bukan mikrofon analog (MAX4466)?**
→ INMP441 ialah mikrofon **I2S digital**: ia beri PCM bersih terus kepada ESP32 — tiada
kalibrasi ADC, tiada noise analog dari papan. Mikrofon analog perlukan ADC ESP32 yang noisy dan
hasilnya tidak konsisten antara unit.

**G3. Kenapa HTTP chunked POST, bukan WebSocket/MQTT?**
→ Lebih mudah debug (boleh test dengan `curl`), `HTTPClient` ESP32 stabil dan matang, dan model
"satu klip = satu POST" sepadan dengan cara sistem memproses (satu fail = satu baris + satu
task). WebSocket disimpan sebagai fallback kalau perlu streaming berterusan. MQTT perlukan
broker tambahan — infrastruktur lebih untuk faedah yang tiada di sini.

**G4. Berapa lama klip ESP32, dan kenapa?**
→ Reka bentuk: 10 saat per klip. Cukup panjang untuk ada konteks (beberapa window YAMNet),
cukup pendek supaya satu klip = satu peristiwa dan muat dalam memori ESP32 sebelum dihantar.

**G5. ESP32 buat inference sendiri?**
→ Tidak. ESP32 hanya **sensor** — ia rakam dan hantar. Inference di server sebab (1) YAMNet
penuh tidak praktikal atas ESP32, (2) semua audio kena disimpan untuk dataset, jadi ia perlu
sampai ke server juga. (Kalau perlu penapisan di device nanti: TFLite Micro + VAD sederhana
supaya hanya hantar bila ada bunyi — future work.)

**G6. Kalau WiFi terputus masa hantar?**
→ Sekarang: klip itu hilang (tiada buffer/retry pada device) — jujur akui. Reka bentuk yang
betul: simpan ke SD card/SPIFFS dan retry dengan exponential backoff, plus ID klip supaya
server boleh de-duplicate.

### H. Testing & validasi

**H1. Macam mana anda test sistem ini?**
→ Jujur dan tepat: "Ada dua skrip pengesahan dalam repo: `backend/test_yamnet.py` (jana tone
440 Hz, load YAMNet, cetak top-5 keseluruhan dan per window — deliverable Fasa 0) dan
`backend/test_supabase_storage.py` (round-trip upload → insert → download → query → cleanup —
deliverable Fasa 1). Selain itu, setiap endpoint diuji manual melalui Swagger UI `/docs`, dan
setiap aliran UI diuji end-to-end dalam browser pada setiap fasa. **Tiada automated test suite**
(pytest/Playwright) di-commit — itu jurang yang saya tahu, dan keutamaan pertama kalau projek
diteruskan."
*Nota: decision log menyebut "77 semakan API + 36 semakan UI" — itu semakan yang dijalankan
semasa pembangunan, bukan suite yang boleh dijalankan semula hari ini. Jangan janji anda boleh
`pytest` depan examiner.*

**H2. Apa test case paling penting yang anda jalankan?**
→ (1) Upload → klasifikasi: chirp → "Sine wave/Synthesizer" (pipeline hidup end-to-end).
(2) `/ingest` tanpa API key sah → 401 (auth device berfungsi).
(3) ZIP dibuka dan `metadata.csv` dibaca oleh `pandas` (format betul).
(4) Split 70/15/15 pada 300 klip 4 kelas tak seimbang — disahkan stratified dan **reproducible**
(export dua kali, partition sama).
(5) Fail user lain → 404 (pengasingan data).

**H3. Macam mana anda tahu YAMNet betul-betul jalan, bukan pulangkan rawak?**
→ Uji dengan input yang **diketahui**: tone 440 Hz sepatutnya jatuh dalam keluarga Sine wave /
Tuning fork / Music, dan chirp memang keluar "Sine wave/Synthesizer". Menarik: tone 440 Hz juga
dilabel "Telephone" dengan 0.996 confidence — dan **itu** contoh hidup yang saya guna untuk
jelaskan kenapa lapisan semakan manusia wajib ada.

**H4. Anda uji dengan berapa banyak data?**
→ Buka Dashboard semasa demo dan baca nombor sebenar. Jangan reka. Tambah: logic split diuji
pada 300 klip sintetik 4 kelas tak seimbang.

### I. Reka bentuk & senibina (soalan "senior")

**I1. Kenapa `clips.py` ada — kenapa tak setiap router buat sendiri?**
→ Tiga sumber (upload/recording/esp32) dulu mengulang lima langkah yang sama (encode, store,
insert, queue). Satu laluan bermakna rakaman dari telefon mendarat dalam **bentuk yang sama**
dengan fail yang diupload: standard WAV sama, waveform peaks sama, pipeline klasifikasi sama.
Kalau berasingan: tiga tempat untuk bug bersembunyi dan tiga tempat untuk lupa kemas kini.

**I2. Kalau sistem ada 100,000 fail, apa yang pecah dahulu?** ⭐
→ Jawab berturutan — ini menunjukkan kematangan:
1. **Export** — ZIP dibina dalam **memori** (`io.BytesIO`) dan setiap fail didownload
   berturut-turut. Dataset besar akan makan RAM dan timeout. Pembaikan: stream ZIP ke disk/
   object storage, atau hantar manifest + presigned URL supaya client download sendiri.
2. **Klasifikasi** — `BackgroundTasks` jalan dalam process yang sama, satu worker. Perlukan
   queue sebenar + worker berasingan (dan batching kalau nak pantas).
3. **`predicted_labels`** — chunk 200 ID bermakna N/200 round-trip; patut jadi satu agregat SQL,
   atau kolum cache yang dikira sekali selepas klasifikasi.
4. **Carta dashboard** — top 10 masih murah sebab agregat di Postgres, tapi `count(distinct)`
   atas `classifications` akan jadi berat; perlukan jadual ringkasan.
5. **Library** sendiri OK — bertindan pada index dan pagination range.

**I3. Kalau anda mula semula, apa anda buat lain?**
→ Pilih 2–3: (1) Simpan `predicted_label` sebagai kolum yang dikira sekali selepas klasifikasi,
bukan diagregat semula setiap kali. (2) Guna queue sebenar untuk inference dari awal supaya
status tak boleh tersangkut. (3) Tulis automated test suite seiring dengan feature, bukan
semakan manual. (4) Ikut spesifikasi HuggingFace **dari awal** — pernah tersilap nama kolum
(`file` vs `file_name`) dan ia gagal secara senyap.

**I4. Apa keputusan reka bentuk yang anda paling bangga?**
→ Pilih satu dan cerita dengan sebab: **`label_source` empat tahap**. Nampak kecil (satu kolum
teks) tapi ia menyelesaikan masalah sebenar: tanpa ia, export menghantar tekaan YAMNet
seolah-olah kebenaran, dan sesiapa yang train atas data itu belajar kesilapan YAMNet **tanpa
tahu**. Dengan ia, pembaca boleh tapis satu baris kod (`df[df.label_source != "auto"]`) dan
dataset card memberi amaran automatik.

**I5. Kenapa "folder" dan "dataset" benda yang sama?**
→ Supaya aliran rakam → susun → export/kongsi jadi **satu** laluan. Kalau ada "folder" untuk
rakaman dan "dataset" untuk export secara berasingan, pengguna kena kumpul klip yang sama dua
kali dan dua konsep itu akan tak sinkron. Satu konsep: `datasets` dengan senarai kelas
(`labels text[]`) yang jadi butang satu-tap masa merakam.

### J. Soalan perangkap / bertekanan

**J1. "Ini hanya CRUD app dengan model orang lain. Mana kerja kejuruteraannya?"**
→ Jangan defensif. "Dari luar ia nampak CRUD, tapi kerja kejuruteraan ada pada tiga tempat yang
tidak kelihatan pada UI: **(1) integriti data** — satu laluan simpan untuk tiga sumber supaya
setiap klip identik bentuknya, dan satu peraturan label dikongsi antara panel semakan dan export
supaya keduanya tak bercanggah; **(2) sistem provenance** — dua paksi status dan empat asal
label, supaya tiada siapa train atas tekaan tanpa sadar; **(3) reproducibility** — split
stratified yang di-seed dari ID dataset, supaya nombor eksperimen boleh dibandingkan. Ada juga
masalah kejuruteraan nyata yang perlu dinyahpepijat: HTTP/2 multiplexing pecah dengan thread
pool FastAPI, cache TF Hub rosak dalam OS temp, dan PGRST203 bila signature RPC berubah.
Semuanya direkod dalam decision log."

**J2. "Kenapa tak guna HuggingFace + Label Studio je? Siap."**
→ "Kedua-duanya alat bagus, tapi kedua-duanya berada di **hujung** proses. Label Studio tidak
mengumpul audio dari IoT, tidak seragamkan format, dan bukan mobile-first untuk orang yang
berdiri di tepi jalan dengan telefon. HuggingFace ialah destinasi, bukan pengumpul. Jurang yang
sebenarnya ialah antara mikrofon dan dataset — dan itulah yang sistem saya isi. Dan saya sengaja
**tidak** mencipta format baharu: output saya ialah format `audiofolder` HuggingFace, supaya ia
masuk terus ke ekosistem yang ada."

**J3. "Macam mana kalau YAMNet salah pada semua fail?"**
→ "Maka setiap baris akan bertanda `auto` dengan prediksi yang salah, dan **itu memang
kelihatan**: dashboard tunjuk berapa yang belum disemak, dataset card tulis amaran peratusan,
dan penyemak yang betulkan akan menghasilkan `human_corrected` — jadi selisih antara
`predicted_label` dan `label` dalam export menjadi ukuran sejauh mana YAMNet tersasar untuk
domain itu. Sistem tidak bergantung pada YAMNet betul; ia bergantung pada YAMNet
**mengurangkan kerja**, dan ia jujur bila ia gagal."

**J4. "Data user siapa yang punya? Kalau user delete akaun?"**
→ Setiap baris ada `user_id`; user hanya nampak sendiri. Delete akaun: kena taip username untuk
confirm, kemudian backend buang fail dari Storage, buang `audio_files` dan `datasets` secara
eksplisit (sebab `user_id` ON DELETE SET NULL tak cascade), lalu `auth.admin.delete_user()` yang
cascade `profiles`, `devices`, `dataset_likes`. Dataset awam hilang dari Community sekali. Yang
belum: eksport data sendiri sebelum delete (hak portability) — patut ditambah.

**J5. "Kalau dua orang publish dataset yang sama, atau publish data cetak rompak?"**
→ Sekarang tiada pengesanan duplicate dan tiada moderation — jujur akui. Yang **ada**: lesen
wajib (owner mengaku hak), identiti `@username` yang boleh dijejak, dan syarat penerangan. Untuk
sistem sebenar: audio fingerprint untuk duplicate, butang report, dan moderation queue.

**J6. "Kenapa graf ni? Kenapa tak pie chart je semua?"**
→ Pilihan bentuk ada sebab: **bar mendatar** untuk membandingkan magnitud satu ukuran merentas
banyak kategori (nama kelas panjang — mendatar boleh dibaca). **Doughnut** hanya untuk 3 kategori
sumber di mana bahagian-daripada-keseluruhan yang penting. Pie dengan 10 kelas tidak boleh
dibaca. Warna dipetakan **per-entiti** yang tetap (upload=hijau, esp32=biru, recording=merah),
bukan ikut ranking — supaya menapis tidak menukar warna kategori yang tinggal.

**J7. "Apa limitation terbesar projek anda?"** ⭐
→ Jawab dengan yang **benar**, jangan cair: "Firmware ESP32 belum ditulis kerana hardware belum
ada — jadi laluan IoT siap di sisi server tetapi belum pernah diuji dengan device sebenar. Kedua,
tiada automated test suite; pengesahan dibuat manual. Ketiga, klasifikasi berjalan dalam process
web yang sama, jadi ia tidak akan berskala melebihi satu server dan job boleh tersangkut kalau
process restart. Ketiga-tiga ini saya tahu, ada dalam dokumentasi, dan ada rancangan pembaikan
yang jelas."

**J8. Kalau anda TAK TAHU jawapan.**
→ Jangan reka. Guna salah satu:
- "Saya tak pasti nombor itu — yang saya pasti ialah [fakta berkaitan yang anda tahu]. Boleh
  saya semak dalam code sekarang?" *(dan buka fail itu — ini sebenarnya beri impresi baik)*
- "Saya tak pertimbangkan itu. Kalau saya kena buat sekarang, pendekatan saya ialah …"
- "Itu di luar skop yang saya tetapkan, sebab … tapi ia ada dalam senarai future work saya."

---

## 11. Kelemahan sistem & jawapan jujur (hafal senarai ini)

| # | Kelemahan | Jawapan bila ditanya | Pembaikan yang betul |
|---|---|---|---|
| 1 | **Firmware ESP32 belum ada** | Kontrak `/ingest` siap; didemo dengan klien Python di laptop kedua; hardware belum dibeli | Beli ESP32+INMP441, tulis I2S capture + kontrak yang sama |
| 1b | **Sesi stream yang tak pernah ditutup** | Chunk `join` kekal dalam `ingest_chunks` (dibuang bila device/akaun dipadam) | Sweeper: tutup automatik sesi tanpa chunk baru > 1 jam |
| 2 | **Tiada automated test suite** | Ada 2 skrip pengesahan + ujian manual setiap fasa | pytest untuk endpoint, Playwright untuk UI, CI |
| 3 | **Upload panjang buat request lambat** (YAMNet + privasi segerak) | 10 min audio ≈ beberapa saat; had 10 min menjaga ia munasabah | Queue kerja inference berasingan |
| 3b | **Penapis privasi best-effort** | Bisikan / suara di bawah bunyi kuat mungkin terlepas; ada Report + review manusia | Model VAD khusus + semakan manusia sebelum publish |
| 4 | **Export bina ZIP dalam memori** | OK untuk saiz demo, tidak untuk 100k fail | Stream ZIP, atau manifest + presigned URL |
| 5 | ~~Label mean tak ditimbang~~ **DIBAIKI (Fasa 6b)** | Kini purata atas semua window | — |
| 6 | **Cache token 60 s** | Token di-revoke masih sah ≤60 s | Verify JWKS lokal + senarai revocation |
| 7 | **CORS `*`** | Direkod dalam `deployment.md`; token dalam header, bukan cookie | Hadkan kepada domain dashboard |
| 8 | **Confirm email dimatikan** | Untuk demo (had emel free tier) — decision #14 | Hidupkan + SMTP sendiri |
| 9 | **`download_count` ada race** | Sengaja diterima; kehilangan satu kiraan tak memudaratkan | RPC increment atomik |
| 10 | **Tiada inter-annotator agreement** | Satu dataset satu pemilik | Dua penyemak + Cohen's kappa |
| 11 | ~~Tiada annotation peringkat segmen~~ **DIBAIKI (Fasa 6b)** | Split into clips — setiap clip label & semakan sendiri | — |
| 11b | **Loop/merge ialah audio sintetik** | Ditanda `edit_kind`, dikecualikan dari export secara default | — (reka bentuk sengaja) |
| 12 | **Nominatim ada rate limit** | Best-effort; gagal → koordinat sahaja kekal | Cache sisi server, atau geocoder berbayar |
| 13 | **Bergantung pada free tier Supabase** | Auto-pause selepas ~1 minggu idle | Tier berbayar, atau cron ping |
| 14 | **1 worker sahaja** | YAMNet satu salinan per worker = risiko OOM | Pisahkan worker inference dari web |

**Dua perkara housekeeping sebelum VIVA:**
- **`what is sodama.pdf` sudah lapuk** — ia tiada Record, Community, dan akaun per-pengguna
  (Fasa 5). Kalau anda serahkan dokumen itu, sebut secara lisan bahawa Fasa 5 datang selepas
  dokumen itu ditulis, atau kemas kini ia dahulu.

---

## 12. Future work (sebut 3–4 sahaja, dengan sebab)

1. **Firmware ESP32** + buffer SD card & retry — melengkapkan laluan IoT.
2. **Transfer learning terbina** — guna embedding 1024-dim YAMNet, latih classifier kecil atas
   data yang disemak, dan **beri semula** cadangan label yang lebih baik ke review queue
   (*active learning*: sistem tanya klip yang ia paling tak pasti dahulu).
3. **Queue + worker berasingan** untuk inference, supaya boleh berskala dan job tak tersangkut.
4. **Kolaborasi** — satu dataset, banyak penyemak, dengan ukuran persetujuan antara penyemak.
5. **Annotation peringkat segmen** (label span dalam satu fail panjang) — data per-window sudah
   ada untuk menyokongnya.
6. **Push langsung ke HuggingFace Hub** melalui API, bukan download-upload manual.

---

## 13. Glossary (kalau examiner guna istilah dan anda blank)

| Istilah | Maksud ringkas |
|---|---|
| **YAMNet** | Model Google (MobileNet-v1 atas log-mel spectrogram) yang klasifikasi bunyi ke 521 kelas AudioSet |
| **AudioSet** | Dataset/ontologi label bunyi Google (500+ kelas) yang YAMNet dilatih atasnya |
| **Log-mel spectrogram** | Perwakilan audio sebagai imej: masa × frekuensi (skala mel, magnitud log) — input kepada model |
| **Window / hop** | Potongan masa yang dianalisa (0.96 s) dan jarak antara potongan (0.48 s) |
| **Confidence** | Skor sigmoid 0–1 per kelas; multi-label, bukan probability terkalibrasi |
| **Weak label** | Label yang tidak disemak manusia (di sini: `label_source = auto`) |
| **Provenance** | Rekod dari mana satu data datang / siapa yang menentukannya |
| **Stratified split** | Bahagi train/test sambil mengekalkan nisbah setiap kelas dalam setiap bahagian |
| **RLS (Row Level Security)** | Peraturan PostgreSQL yang menapis baris ikut siapa yang bertanya |
| **Service-role key** | Kunci Supabase yang **memintas** RLS — hanya untuk backend |
| **JWT** | Token bertandatangan yang membuktikan identiti pengguna pada setiap request |
| **Signed URL** | URL sementara untuk fail dalam bucket private |
| **RPC** | Function dalam PostgreSQL yang dipanggil seperti endpoint (di sini untuk agregat) |
| **Migration** | Fail SQL bertarikh yang merekod satu perubahan skema |
| **`audiofolder`** | Loader HuggingFace yang padankan `metadata.csv` (kolum `file_name`) dengan folder audio |
| **AudioWorklet** | API browser yang jalan atas thread audio — dipakai untuk tangkap PCM mentah |
| **PCM** | Sampel audio mentah tanpa pemampatan (di sini 16-bit little-endian) |
| **AGC** | Automatic Gain Control — auto-laras kekuatan; dimatikan supaya kekuatan asal terpelihara |
| **I2S** | Protokol digital untuk audio antara cip (INMP441 → ESP32) |
| **PWA** | Progressive Web App — web app yang boleh ditambah ke home screen telefon |

---

## 14. Tiga ayat penutup untuk VIVA

Kalau examiner tanya "apa yang anda nak kami ingat tentang projek ini?":

> "Satu: masalah sebenar dalam ML audio bukan model — model dah banyak dan mudah didapati.
> Masalahnya **data**: kumpul, seragam, label, dan tahu label mana boleh dipercayai.
>
> Dua: sistem saya menganggap AI sebagai **pembantu, bukan kebenaran**. Setiap label membawa
> asal-usulnya, dan sesiapa yang train atas data ini boleh menapis apa yang belum disemak
> manusia.
>
> Tiga: output sistem ini bukan format saya sendiri — ia format HuggingFace, siap dengan split
> yang boleh dihasilkan semula. Jadi kerja pengumpulan boleh terus masuk ke training tanpa satu
> langkah manual lagi."

---

*Nota ini dijana daripada code dalam repo pada 28 September 2026. Kalau code diubah selepas ini,
semak semula nombor dalam Bahagian 0.*
