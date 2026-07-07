import secrets

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import get_client

router = APIRouter(tags=["devices"])


class DeviceCreate(BaseModel):
    device_name: str


@router.post("/devices", status_code=201,
             summary="Register an ESP32 device (returns its API key once)")
def create_device(body: DeviceCreate):
    client = get_client()
    existing = client.table("devices").select("id") \
        .eq("device_name", body.device_name).execute().data
    if existing:
        raise HTTPException(409, "device_name already registered")

    api_key = secrets.token_hex(24)
    row = client.table("devices").insert({
        "device_name": body.device_name, "api_key": api_key,
    }).execute().data[0]
    # only time the full key is returned — flash it into the ESP32 firmware
    return row


@router.get("/devices", summary="List devices (API keys masked)")
def list_devices():
    client = get_client()
    rows = client.table("devices").select("*").order("created_at").execute().data
    for r in rows:
        r["api_key"] = "…" + r["api_key"][-4:]
    return rows
