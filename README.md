# Sound Data Management System for Machine Learning Trainers

Final Year Project (FYP) — Muhammad Ezamuddin Bin Hidzhir (24000202), Universiti Teknologi PETRONAS.

A centralized, mobile-friendly web system for collecting, labelling, organizing, exporting and sharing audio datasets for machine learning training. Audio is recorded on a phone inside the app, uploaded, or streamed from an ESP32 + INMP441 sensor; it is automatically classified with YAMNet, labelled by people, and managed per user account through a searchable dashboard backed by Supabase. Finished datasets can be exported as HuggingFace-ready ZIPs or published to the in-app Community.

## Repository Structure

```
/backend    FastAPI server — audio upload, YAMNet inference, metadata, dataset APIs
/frontend   Mobile-first web app (HTML/CSS/JS) — record, library, datasets, community, profile
/firmware   ESP32 + INMP441 firmware (I2S capture, WAV encode, HTTP chunked upload)
/docs       Project documentation, decision log, database schema
```

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, TensorFlow + YAMNet (TF Hub) |
| Database / Storage | Supabase (PostgreSQL + Storage) |
| Frontend | HTML, CSS, JavaScript |
| Hardware | ESP32 DevKit + INMP441 I2S microphone |
| Audio format | WAV, 16 kHz, mono, 16-bit PCM |

See [docs/decision-log.md](docs/decision-log.md) for the rationale behind each technical decision.

## Backend Setup

```powershell
cd backend
uv venv --python 3.12 .venv          # TensorFlow requires Python <= 3.13
uv pip install --python .venv/Scripts/python.exe -r requirements.txt
copy .env.example .env               # fill in Supabase credentials
```

### Verify YAMNet works locally (Fasa 0 deliverable)

```powershell
.venv/Scripts/python test_yamnet.py            # generates a test tone and classifies it
.venv/Scripts/python test_yamnet.py path\to\audio.wav
```

### Verify Supabase storage round-trip (Fasa 1 deliverable)

```powershell
.venv/Scripts/python test_supabase_storage.py
```

### Run the API server (Fasa 2)

```powershell
cd backend
.venv/Scripts/python -m uvicorn app.main:app --reload
```

Dashboard: http://127.0.0.1:8000 · Swagger UI: http://127.0.0.1:8000/docs

Keep that terminal open — closing it (or `Ctrl+C`) stops the server and
`127.0.0.1:8000` becomes unreachable.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Browser: "can't connect" / connection refused | uvicorn is not running | Start the server (above) |
| UI loads but shows "Internal Server Error"; log says `httpx.ConnectError: getaddrinfo failed` | **Supabase free project auto-paused** after ~1 week idle — its hostname stops resolving | Restore it in the Supabase dashboard (project → Restore), or `POST /v1/projects/{ref}/restore` on the Management API. Takes a few minutes; data is preserved |
| Upload succeeds but the card shows "Classification failed"; log says `contains neither 'saved_model.pb' nor 'saved_model.pbtxt'` | The cached YAMNet download is incomplete or was wiped (TF Hub's default cache lives in the OS temp directory) | Handled automatically — the loader clears the cache and re-downloads. The cache now lives in `backend/yamnet_cache/` instead of temp, so OS cleanup can't break it again |
| `ModuleNotFoundError: pkg_resources` | setuptools ≥ 81 removed `pkg_resources`, which tensorflow-hub imports | `uv pip install --python .venv/Scripts/python.exe "setuptools<81"` |

> **Before a demo or VIVA:** open the dashboard a few minutes early. If the
> Supabase project has auto-paused, restoring it takes several minutes — not
> something you want to discover in front of an examiner. Any activity on the
> project resets the inactivity timer.

Every endpoint except `/ingest`, `/config` and `/health` requires
`Authorization: Bearer <Supabase access token>`; the backend verifies it with
Supabase and scopes every query to that user's own rows.

| Endpoint | Purpose |
|---|---|
| `POST /upload` | Upload WAV/MP3/FLAC/OGG → standardized to 16kHz mono → classified in background (optional `dataset_id`) |
| `POST /recordings` | Save a clip recorded in the app, with label, folder, time and location |
| `GET /audio` | List/search: pagination, `class_name`, `min_confidence`, `source`, `status`, `review_status`, date range |
| `GET /audio/{id}` | Detail: waveform peaks, per-window classifications, top classes, signed download URL |
| `PATCH /audio/{id}/review` | Approve, correct or reject a label |
| `POST /audio/review` | Same verdict applied to many files at once |
| `POST /datasets` + `/items` | Curate datasets (folders; many-to-many with audio files) with a class list |
| `PATCH /datasets/{id}` | Edit, or publish to Community (`visibility`, `license`, `share_location`) |
| `GET /datasets/{id}/export` | ZIP of audio + `metadata.csv`/`metadata.json` + `README.md`, optional train/val/test split |
| `GET /community/datasets` | Browse/search public datasets (sort: popular, newest, likes, clips) |
| `GET /community/datasets/{id}` (+ `/download`, `/like`) | Public dataset card, sample player, download, like |
| `GET /community/users/{username}` | A contributor's public page |
| `GET/PATCH/DELETE /me`, `POST /me/avatar` | Own profile, avatar, account deletion |
| `POST /ingest` | ESP32 raw PCM ingest — `X-API-Key` auth; clips belong to the device's owner |
| `POST /devices` | Register a device; API key returned once |

Classification runs as a FastAPI background task: `audio_files.status` goes
`pending → processing → done` (or `error`), and per-0.96s-window top-3 YAMNet
classes land in the `classifications` table.

## Recording in the app

The **Record** page (centre button of the phone tab bar) captures audio from the
phone's microphone and saves it straight into a folder:

1. Pick or create a folder once — e.g. *Car engines* with classes Honda, Toyota, Proton.
2. Tap record, tap stop. Date, time, duration and (if allowed) GPS location plus
   a place name are captured automatically.
3. Listen back, tap a class chip or type a label, save. The next take defaults to
   the same label, so collecting twenty Honda clips is twenty record/save taps.

Audio is captured as raw PCM through an AudioWorklet with echo cancellation,
noise suppression and auto-gain **switched off** (they alter the sound a model
should learn), resampled to 16 kHz in the browser and uploaded as WAV. The
microphone only works on `https://` pages or `localhost`.

A recorded clip arrives already labelled and approved with
`label_source = human_annotated`; YAMNet still classifies it as a sanity check.

## Accounts, profiles and password reset

Each user sees only their own audio, datasets and devices. Profiles
(`profiles` table) hold a public username, name, role, organisation, bio and
avatar, created automatically on first sign-in. Password reset uses Supabase's
recovery email: **Forgot password?** on the sign-in page → email link → back to
`#/reset` to choose a new password. For this to work the app's URL must be in
Supabase → Authentication → URL Configuration → *Redirect URLs*, and real users
need a custom SMTP provider (the built-in one only mails project team members).

## Community

Publishing a dataset (its page → *Share with the community*) makes it
browsable by every signed-in user, like a small HuggingFace Hub. Publishing
requires a description, a licence (CC BY, CC BY-SA, CC BY-NC or CC0) and at
least one labelled, non-rejected clip. Downloads are the same HF-compatible ZIP
as an export, except reviewer emails become the author's `@username` and exact
coordinates are dropped unless the owner opts in.

## Label review

YAMNet's output is a starting point, not ground truth — it labels a 440 Hz test
tone "Telephone". Every clip therefore carries a second, independent state:
`review_status` is `unreviewed` until a person approves, corrects, or rejects it
on the audio detail page.

That verdict is what the export reports. Each manifest row carries a
`label_source` of `human_annotated` (named while recording), `human_confirmed`,
`human_corrected`, or `auto`, so whoever
trains on the data can tell verified labels from unchecked guesses — and filter
on it. Rejected clips are never exported.

## Dataset export

`GET /datasets/{id}/export` produces a ZIP laid out the way HuggingFace's
`audiofolder` loader expects:

```
metadata.csv     file_name, label, label_source, split, + audio and review columns
metadata.json    the same rows
train.csv        pre-filtered subsets, when splitting is on
validation.csv
test.csv
README.md        dataset card: class distribution, splits, label provenance
audio/*.wav      16 kHz mono 16-bit
```

The column **must** be named `file_name` — that is how the loader pairs a row
with its audio, and it loads nothing if the name differs. Splits are stratified
per class and seeded from the dataset id, so re-exporting reproduces the same
partition instead of silently reshuffling the test set between experiments.

```python
from datasets import load_dataset
ds = load_dataset("audiofolder", data_dir="./")
```

## Database

Schema lives in [docs/database-schema.md](docs/database-schema.md); the applied migration is mirrored in [supabase/migrations/](supabase/migrations/). Tables: `audio_files`, `classifications`, `metadata`, `datasets`, `dataset_items`, `dataset_likes`, `devices`, `profiles` — all with Row Level Security enabled.
