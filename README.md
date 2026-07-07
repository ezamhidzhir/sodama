# Sound Data Management System for Machine Learning Trainers

Final Year Project (FYP) — Muhammad Ezamuddin Bin Hidzhir (24000202), Universiti Teknologi PETRONAS.

A centralized web-based system for collecting, classifying, organizing, and exporting audio datasets for machine learning training. Audio is collected via ESP32 + INMP441 sound sensor or manual upload, automatically classified with YAMNet, and managed through a searchable dashboard backed by Supabase.

## Repository Structure

```
/backend    FastAPI server — audio upload, YAMNet inference, metadata, dataset APIs
/frontend   Web dashboard (HTML/CSS/JS) for ML trainers
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

Swagger UI: http://127.0.0.1:8000/docs

| Endpoint | Purpose |
|---|---|
| `POST /upload` | Upload WAV/MP3/FLAC/OGG → standardized to 16kHz mono → classified in background |
| `GET /audio` | List/search: pagination, `class_name`, `min_confidence`, `source`, `status`, date range |
| `GET /audio/{id}` | Detail: waveform peaks, per-window classifications, top classes, signed download URL |
| `POST /datasets` + `/items` | Curate datasets (many-to-many with audio files) |
| `GET /datasets/{id}/export` | ZIP of audio + `manifest.csv`/`manifest.json` with auto-labels |
| `POST /ingest` | ESP32 raw PCM ingest — `X-API-Key` auth against `devices` table |
| `POST /devices` | Register a device; API key returned once |

Classification runs as a FastAPI background task: `audio_files.status` goes
`pending → processing → done` (or `error`), and per-0.96s-window top-3 YAMNet
classes land in the `classifications` table.

## Database

Schema lives in [docs/database-schema.md](docs/database-schema.md); the applied migration is mirrored in [supabase/migrations/](supabase/migrations/). Tables: `audio_files`, `classifications`, `metadata`, `datasets`, `dataset_items`, `devices` — all with Row Level Security enabled.
