"""Sound Data Management System — FastAPI backend.

Run from the backend/ directory:
    .venv/Scripts/uvicorn app.main:app --reload
Swagger UI: http://127.0.0.1:8000/docs
"""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .routers import audio_files, datasets, devices, ingest, upload

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


@app.get("/health", tags=["system"])
def health():
    return {"status": "ok"}
