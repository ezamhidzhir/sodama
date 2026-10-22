# Sound Data Management System for Machine Learning Trainers

Final Year Project (FYP) — Muhammad Ezamuddin Bin Hidzhir (24000202), Universiti Teknologi PETRONAS.

A centralized, mobile-friendly web system for collecting, labelling, organizing, exporting and sharing audio datasets for machine learning training. Audio is recorded on a phone inside the app, uploaded, or sent by any registered device — an ESP32 + INMP441 sensor or a program on another computer; it is automatically classified with YAMNet, labelled by people, and managed per user account through a searchable dashboard backed by Supabase. Finished datasets can be exported as HuggingFace-ready ZIPs or published to the in-app Community.

## Repository Structure

```
/backend    FastAPI server — audio upload, YAMNet inference, metadata, dataset APIs
/frontend   Mobile-first web app (HTML/CSS/JS) — record, library, datasets, community, profile
/client     Reference device client (Python) — send files, watch a folder, or stream the mic
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
| `POST /audio/{id}/segments` | Preview where a recording would be cut (`auto` / `fixed`) |
| `POST /audio/{id}/clips` | Cut a recording into virtual clips |
| `GET /audio/{id}/file` | WAV of any item (incl. clips) through a signed link |
| `POST /audio/{id}/loop`, `POST /audio/merge` | Extend a sound by looping; join several sounds |
| `GET /community/clips` (+ `/{id}`, `/{id}/save`) | Search single public sounds; save a credited copy |
| `POST /community/datasets/{id}/report` | Report a dataset; three reports hide it |
| `POST /audio/review` | Same verdict applied to many files at once |
| `POST /datasets` + `/items` | Curate datasets (folders; many-to-many with audio files) with a class list |
| `PATCH /datasets/{id}` | Edit, or publish to Community (`visibility`, `license`, `share_location`) |
| `GET /datasets/{id}/export` | ZIP of audio + `metadata.csv`/`metadata.json` + `README.md`, optional train/val/test split |
| `GET /community/datasets` | Browse/search public datasets (sort: popular, newest, likes, clips) |
| `GET /community/datasets/{id}` (+ `/download`, `/like`) | Public dataset card, sample player, download, like |
| `GET /community/users/{username}` | A contributor's public page |
| `GET/PATCH/DELETE /me`, `POST /me/avatar` | Own profile, avatar, account deletion |
| `POST /ingest` | Device upload (audio file or raw PCM) — `X-API-Key` auth; returns a receipt; idempotent with `X-Client-Id`; stream chunks with `session_id` + `chunk_index` |
| `POST /ingest/sessions/{id}/close` | Finish a stream session; with `join=true` its chunks become one recording |
| `POST /devices` | Register a device; API key returned once |

Classification runs as a FastAPI background task: `audio_files.status` goes
`pending → processing → done` (or `error`), and per-0.96s-window top-3 YAMNet
classes land in the `classifications` table.

## Limits and storage

| | Limit |
|---|---|
| Upload | 10 minutes per file (checked from the file header before decoding) |
| Recording in the app | 5 minutes per take |
| Device chunk | 10 minutes |
| Storage per user | 30 minutes of stored audio (`profiles.quota_seconds`) |

Audio is stored as **FLAC** — the same 16 kHz 16-bit samples as WAV, losslessly
compressed to roughly half the size. Downloads and exports are always WAV. Clips
cut from a recording are virtual and use no storage or quota.

## Privacy: human speech is muted before storage

Every recording, upload and device clip passes through YAMNet *before* it is
stored. Windows where a speech class (Speech, Conversation, Narration, Whispering,
Shout, Chatter, Hubbub …) scores ≥ 0.3 are muted, with 0.5 s padding either side,
and only the muted audio is written to Supabase. `privacy_redactions` records the
muted stretches and the player shades them. An upload or recording that is ≥ 80 %
speech is refused; a device keeps the muted version so its receipt flow is not
broken. Detection is best effort — Community has a Report button for anything
that slips through.

## Splitting recordings into clips

A long recording with several sounds is cut into short clips that each get
their own label and review — the step that turns "a recording" into training
data. On the audio page, **Split into clips** offers three ways to cut:

- **Follow the sound** — cut where YAMNet's top class changes; stretches shorter
  than a minimum fold into a neighbour, and silence can be left out
- **Every N seconds** — equal-length clips, what most models train on
- **Select by hand** — drag on the waveform

Clips are virtual (`parent_id`, `clip_start`, `clip_end`): no audio is copied and
no audio is re-analysed — each clip takes the recording's classification windows
that fall inside it. Clips replace the recording in its folders so an export
never holds the same audio twice, and **clips from one recording always land in
the same train/validation/test split**, so test accuracy is never measured on
seconds the model trained on.

## Editing sounds

**Edit** on any sound (or **Use** on a Community sound) opens the editor: select
a stretch, label it, and optionally **make it longer by looping** it with a short
crossfade. The Library's **Merge** joins several selected sounds. Looped and
merged audio is marked `edit_kind` and left out of exports unless
`include_edited=true` — repeated audio would make a dataset look bigger than the
sound it holds. A sound saved from someone else's public dataset keeps the
author and licence in `attribution`, and exports credit them.

## Sending audio from a device

Anything that records can feed SODAMA — an ESP32, or a program on another
laptop. Register it on the **Devices** page to get an API key, then every
client follows the same loop:

```
record -> POST /ingest -> receipt -> delete the local copy -> record again
```

The receipt carries the SHA-256 of what the server stored. The client deletes
its copy **only** when that matches its own hash, so a dropped connection never
loses a recording — it is simply sent again. The client tags each recording
with `X-Client-Id`; a repeat is answered with the original receipt (200 instead
of 201), so retries never create duplicates.

**Stream mode** sends ~10 s chunks as they are recorded, under a `session_id`
with a `chunk_index`. Closing the session (`POST /ingest/sessions/{id}/close?chunks=N`)
reports any chunk that never arrived. With `join=true` the chunks stay out of
the Library and are stitched into one continuous recording on close.

```powershell
pip install sounddevice numpy        # only needed for mic mode
$env:SODAMA_SERVER = "http://127.0.0.1:8000"; $env:SODAMA_API_KEY = "<key>"
python client/sodama_client.py send take1.wav take2.wav   # upload, delete each once confirmed
python client/sodama_client.py watch C:\recordings         # upload whatever lands in a folder
python client/sodama_client.py mic --chunk 10 --join       # stream the microphone, one recording
```

Chunks are written to a `spool/` folder before upload; if the client crashes or
the network is down, the next run finishes sending them.

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

**Continue with Google** signs in or signs up in one step through Supabase's
Google provider (Authentication → Providers → Google, with the app's URL in
*Redirect URLs*). Google accounts need no email confirmation.

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
