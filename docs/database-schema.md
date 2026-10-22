# Database Schema (Supabase / PostgreSQL)

Migration source of truth: [supabase/migrations/](../supabase/migrations/)

```
auth.users  1 ──1 profiles             (public username, name, role, avatar)
auth.users  1 ──< audio_files / datasets / devices   (owner: user_id)
audio_files 1 ──< classifications      (per-window YAMNet results)
audio_files 1 ──< metadata             (flexible key-value tags, e.g. notes)
datasets    >──< audio_files           (via dataset_items, many-to-many)
datasets    >──< auth.users            (via dataset_likes — Community likes)
audio_files 1 ──< audio_files          (virtual clips, parent_id)
devices     1 ──< audio_files          (device clips, device_id)
devices     1 ──< ingest_sessions 1 ──< ingest_chunks   (stream mode)
```

## Tables

### audio_files
One row per audio file (in-app recording, manual upload, or a registered device).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | `gen_random_uuid()` |
| filename | text | original filename, or `<label>_<timestamp>.wav` for recordings |
| storage_path | text unique, nullable | path in `audio-files` bucket (`.flac` since Fasa 6b); NULL for a virtual clip |
| duration | double | seconds |
| sample_rate | int | Hz — target 16000 |
| file_size | bigint | bytes |
| source | text | `upload` \| `device` \| `recording` (check constraint; `device` was `esp32` before migration 9) |
| uploaded_at | timestamptz | default `now()` |
| user_id | uuid FK → auth.users | owner; device clips take the device's owner |
| status | text | pipeline: `pending` → `processing` → `done` \| `error` |
| waveform | jsonb | 600 precomputed peaks for the player |
| review_status | text | human verdict: `unreviewed` \| `approved` \| `rejected` |
| verified_label | text | label a person gave; NULL = only YAMNet's guess |
| label_origin | text | `capture` (named while recording) \| `review` \| NULL |
| reviewed_by, reviewed_at, review_note | | who gave the verdict, when, why |
| device_id | uuid FK → devices | device clips |
| recorded_at | timestamptz | capture time (phone clock, sanity-checked; device `X-Recorded-At` or arrival) |
| latitude, longitude | double | GPS fix from the Record page, optional |
| location_accuracy | real | metres |
| location_name | text | reverse-geocoded place, e.g. "Seri Iskandar, Perak" |
| client_id | uuid | recording id chosen by the sending device; unique per `device_id` → retries are idempotent |
| sha256 | text | hash of the uploaded body, echoed in the receipt |
| session_id, chunk_index | uuid, int | stream mode; `chunk_index` only on unjoined chunks, unique per session |
| parent_id, clip_start, clip_end | uuid FK → audio_files, double | a **virtual clip**: seconds of its parent; no `storage_path` of its own; cascades with the parent |
| edit_kind | text | `loop` \| `merge` \| `copy` — stored edits; loops/merges are excluded from exports by default |
| derived_from | uuid[] | sources of an edit |
| attribution | jsonb | for copies of public sounds: author, licence, dataset, source id, stretch |
| speech_removed_seconds, privacy_redactions | real, jsonb | what the privacy filter muted before storage: total and `[[start, end], …]` |

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
Flexible key-value tags per file. Recordings store `notes` and
`recording_device` (e.g. "Android phone · Chrome") here; every key is exported
as a `meta_<key>` column. Unique on `(audio_file_id, key)`.

### datasets / dataset_items / dataset_likes
Curated collections — shown in the app as *folders* — for training export.

| Column | Notes |
|---|---|
| name, description | |
| labels | `text[]` — the classes this folder collects; offered as one-tap chips when recording |
| visibility | `private` (default) \| `public` (listed in Community) |
| license | `CC-BY-4.0` \| `CC-BY-SA-4.0` \| `CC-BY-NC-4.0` \| `CC0-1.0` — required to publish |
| share_location | include exact coordinates in public downloads (default false) |
| published_at, download_count, updated_at | |

`dataset_items` is the many-to-many join with composite PK
`(dataset_id, audio_file_id)`; `dataset_likes` has PK `(dataset_id, user_id)`.

### profiles
One row per auth user, created by the backend on the user's first request.
`username` (unique, `^[a-z0-9_]{3,30}$`, shown publicly), `full_name`, `bio`,
`organization`, `role` (student / researcher / lecturer / industry / hobbyist /
other), `avatar_path` (object in the public `avatars` bucket).

### devices
Registry of recording clients (ESP32, a script on a laptop, ...): `user_id`
(owner), `device_name` (unique per owner), `api_key` (unique — authenticates
`/ingest`), `last_seen`. No RLS policies → service-role (backend) access only.

### dataset_reports
Community reports: PK `(dataset_id, user_id)`, `reason` (`voices` / `copyright` /
`offensive` / `spam` / `other`), `note`. Three distinct reporters set
`datasets.hidden_at`, which removes the dataset from `community_datasets()` and
the clip search until someone clears it. RLS on, no policies (backend only).

`profiles.quota_seconds` (default 1800) caps the seconds of *stored* audio a user
keeps; virtual clips do not count.

### ingest_sessions / ingest_chunks
Stream mode. A session (`id` chosen by the client) starts with its first chunk:
`device_id`, `user_id`, `join_chunks`, `status` (`open` → `joining` → `closed`),
`audio_file_id` (the joined recording). Chunks of a `join_chunks` session wait
in `ingest_chunks` (PK `session_id, chunk_index`; `sha256`, `storage_path`, `privacy_redactions`,
`duration`, `recorded_at`) — outside the Library — until the session closes and
they are stitched into one `audio_files` row, then deleted. RLS on, no policies.

## RPCs

- `dashboard_stats(p_user, min_confidence)` — one user's aggregates, including
  `label_distribution` of human-given labels.
- `community_datasets(p_viewer, p_query, p_sort, p_owner, p_limit, p_offset)` —
  the public catalogue with clip counts (rejected clips excluded), likes and top labels.

## Security model

- **The backend is the access-control layer.** It uses the service-role key,
  which bypasses RLS, so it verifies the caller's Supabase JWT on every request
  and filters every query by `user_id` itself. Someone else's row is a 404.
- **RLS is enabled on all tables** as a second line for any direct client
  access: own rows, public datasets and profiles read-only.
- **Storage bucket `audio-files` is private** (50 MB/file limit, audio MIME types
  only); the browser only ever gets short-lived signed URLs.
- **Bucket `avatars` is public-read** (2 MB, JPEG/PNG/WebP); writes go through the backend.
