# Database Schema (Supabase / PostgreSQL)

Migration source of truth: [supabase/migrations/](../supabase/migrations/)

```
audio_files 1 ──< classifications      (per-window YAMNet results)
audio_files 1 ──< metadata             (flexible key-value tags)
datasets    >──< audio_files           (via dataset_items, many-to-many)
devices                                 (ESP32 registry, standalone)
```

## Tables

### audio_files
One row per audio file (manual upload or ESP32 stream).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| filename | text | original filename |
| storage_path | text unique | path in `audio-files` bucket |
| duration | double | seconds |
| sample_rate | int | Hz — target 16000 |
| file_size | bigint | bytes |
| source | text | `upload` \| `esp32` (check constraint) |
| uploaded_at | timestamptz | default `now()` |
| user_id | uuid FK → auth.users | null for ESP32 uploads |

### classifications
YAMNet classifies per 0.96s window (hop 0.48s) — one row per window per class kept.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| audio_file_id | uuid FK → audio_files | cascade delete |
| class_name | text | AudioSet class (521 classes) |
| confidence | real | 0–1 (check constraint) |
| window_start / window_end | double | seconds |

### metadata
Flexible key-value tags per file (e.g. `location=lab-3`, `session=morning`).
Unique on `(audio_file_id, key)`.

### datasets / dataset_items
Curated collections for ML training export. `dataset_items` is the many-to-many
join table with composite PK `(dataset_id, audio_file_id)`.

### devices
ESP32 registry: `device_name`, `api_key` (unique — used to authenticate chunked
POST uploads), `last_seen`. No RLS policies → service-role (backend) access only.

## Security model

- **RLS enabled on all tables.** Dashboard users (authenticated) see their own
  rows plus ESP32-sourced files (`user_id is null`).
- **Backend uses the service-role key** and bypasses RLS; it is the only writer
  for `classifications` and `devices`.
- **Storage bucket `audio-files` is private** (50 MB/file limit, audio MIME types
  only); authenticated users have read policy, writes go through the backend.
