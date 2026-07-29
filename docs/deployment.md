# Deploying to Railway

The whole repository deploys as **one service**: FastAPI serves both the API and
the dashboard in `frontend/`. Supabase stays where it is — Railway only runs the
Python backend.

## Why Railway rather than Render

| | Render free | Railway |
|---|---|---|
| RAM | 512 MB — TensorFlow alone approaches that, so the process risks being OOM-killed | sized to usage |
| Idle behaviour | sleeps after ~15 min; first request pays a cold start | stays awake |

The sleeping matters twice over: an ESP32 posting to `/ingest` would lose its
first request after each idle period, and a demo would open on a cold start.
Staying awake also keeps the Supabase project from auto-pausing, since the
backend keeps querying it.

*(Free-tier limits change — check both providers' current pricing before
committing.)*

## Files that make the deploy work

| File | Purpose |
|---|---|
| `requirements.txt` (root) | Nixpacks looks for it at the repo root; it just includes `backend/requirements.txt` |
| `Procfile` | Start command — binds `$PORT`, uses `--app-dir backend`, **one worker** |
| `.python-version` | Pins Python 3.12; TensorFlow does not support 3.13+ |
| `backend/requirements.txt` | Uses `tensorflow-cpu` — the plain wheel adds ~600 MB of unused CUDA libraries on Linux |

**One worker is deliberate.** Each uvicorn worker loads its own copy of YAMNet,
so `--workers 2` doubles the memory and is the usual cause of an OOM kill.

## Steps

### 1. Push the repository to GitHub

```powershell
cd C:\Users\Jave\Documents\sodama
gh repo create sodama --private --source=. --push
```

Or create the repo on github.com and:

```powershell
git remote add origin https://github.com/<your-username>/sodama.git
git push -u origin main
```

`backend/.env` and `.mcp.json` are gitignored, so no keys are published.

### 2. Create the Railway project

1. Sign in at [railway.com](https://railway.com) with GitHub.
2. **New Project → Deploy from GitHub repo → sodama**.
3. Railway builds automatically. The first build takes a while — TensorFlow is a
   large download.

### 3. Set environment variables

In the service → **Variables**, add the same values as `backend/.env`:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | same page — **secret**, backend only |
| `SUPABASE_ANON_KEY` | same page — safe to expose to browsers |
| `AUDIO_BUCKET` | `audio-files` |

Railway supplies `PORT` itself; do not set it.

### 4. Generate a public URL

Service → **Settings → Networking → Generate Domain**. The dashboard is then at
`https://<name>.up.railway.app`, and Swagger at `/docs`.

### 5. Point the ESP32 at the deployed URL

Replace the local address in the firmware with the Railway domain; the
`X-API-Key` header stays the same.

## After deploying

- **First classification is slow.** YAMNet (~17 MB) downloads on first use.
  Railway's filesystem is ephemeral, so this repeats after every deploy. To
  avoid it, attach a Volume mounted at `/app/backend/yamnet_cache`.
- **Watch memory** under Metrics. If the service is OOM-killed, confirm only one
  worker is running before anything else.
- **Tighten CORS.** `backend/app/main.py` allows every origin, which was fine
  while the dashboard was same-origin on localhost. Restrict it to the Railway
  domain once the URL is known.
- **Turn email confirmation back on** for anything beyond a demo: Supabase →
  Authentication → Providers → Email → Confirm email. It was disabled so signup
  works without a mail round-trip (see decision #14 in the decision log).
