"""Sound Data Management System — FastAPI backend.

Run from the backend/ directory:
    .venv/Scripts/uvicorn app.main:app --reload
Swagger UI: http://127.0.0.1:8000/docs
"""
import logging
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .routers import audio_files, datasets, devices, ingest, stats, upload

FRONTEND_DIR = Path(__file__).resolve().parents[2] / "frontend"


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

app = FastAPI(
    title="Sound Data Management System",
    version="0.2.0",
    description=(
        "Centralized audio dataset management for ML trainers — upload, "
        "automatic YAMNet classification, search, dataset curation and export. "
        "FYP — Muhammad Ezamuddin Bin Hidzhir, Universiti Teknologi PETRONAS."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten to the dashboard origin when frontend deploys
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(upload.router)
app.include_router(audio_files.router)
app.include_router(datasets.router)
app.include_router(devices.router)
app.include_router(ingest.router)
app.include_router(stats.router)


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}


# dashboard SPA — mounted last so API routes take precedence
app.mount("/", NoCacheStaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
