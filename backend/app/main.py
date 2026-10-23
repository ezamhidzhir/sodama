"""Sound Data Management System — FastAPI backend.

Run from the backend/ directory:
    .venv/Scripts/uvicorn app.main:app --reload
Swagger UI: http://127.0.0.1:8000/docs
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import backfill
from .security import BodySizeLimit, SecurityHeaders
from .routers import (audio_files, community, datasets, devices, edits, ingest, profile,
                      recordings, stats, upload)

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"
CLIENT_SCRIPT = Path(__file__).resolve().parents[2] / "client" / "sodama_client.py"


class NoCacheStaticFiles(StaticFiles):
    """Serve the dashboard with revalidation forced.

    Without an explicit Cache-Control, browsers fall back to heuristic caching
    and keep running stale JS modules after an edit — which silently skipped the
    sign-in guard once. `no-cache` still allows 304s via ETag, so it stays cheap.
    """

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp

logging.basicConfig(level=logging.INFO)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    backfill.start_in_background()   # repairs class names stored truncated before Oct 2026
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Sound Data Management System",
    version="0.3.0",
    description=(
        "Centralized audio dataset management for ML trainers — record or upload, "
        "automatic YAMNet classification, labelling, dataset curation, export and "
        "community sharing. Every endpoint except `/ingest`, `/config` and `/health` "
        "needs `Authorization: Bearer <Supabase access token>`. "
        "FYP — Muhammad Ezamuddin Bin Hidzhir, Universiti Teknologi PETRONAS."
    ),
)

# The dashboard is served from this same origin, and devices are not browsers,
# so cross-origin browser calls are only needed for local development.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "ALLOWED_ORIGINS",
    "https://sodama.up.railway.app,http://127.0.0.1:8000,http://localhost:8000").split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(BodySizeLimit)
app.add_middleware(SecurityHeaders)

app.include_router(upload.router)
app.include_router(recordings.router)
app.include_router(edits.router)        # before audio_files: /audio/merge vs /audio/{id}
app.include_router(audio_files.router)
app.include_router(datasets.router)
app.include_router(community.router)
app.include_router(profile.router)
app.include_router(devices.router)
app.include_router(ingest.router)
app.include_router(stats.router)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


@app.get("/client/sodama_client.py", tags=["system"],
         summary="Download the reference device client (Python script)")
def download_client():
    return FileResponse(CLIENT_SCRIPT, media_type="text/x-python",
                        filename="sodama_client.py")


# dashboard SPA — mounted last so API routes take precedence
app.mount("/", NoCacheStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
