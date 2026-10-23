import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..auth import User, current_user
from ..db import get_client
from .ingest import discard_pending_chunks

router = APIRouter(tags=["devices"])


class DeviceCreate(BaseModel):
    device_name: str = Field(min_length=1, max_length=64)
    kind: Literal["computer", "api"] = Field(
        "computer", description="computer = runs client/sodama_client.py; "
                                "api = an ESP32 or a program that calls /ingest itself")


class DeviceUpdate(BaseModel):
    device_name: str | None = Field(default=None, min_length=1, max_length=64)
    regenerate_key: bool = False


def _get_device_or_404(client, device_id: str, user: User) -> dict:
    rows = (client.table("devices").select("*")
            .eq("id", device_id).eq("user_id", user.id).execute().data)
    if not rows:
        raise HTTPException(404, "device not found")
    return rows[0]


@router.post("/devices", status_code=201,
             summary="Register a recording device or client (returns its API key once)")
def create_device(body: DeviceCreate, user: User = Depends(current_user)):
    client = get_client()
    name = body.device_name.strip()
    existing = (client.table("devices").select("id")
                .eq("device_name", name).eq("user_id", user.id).execute().data)
    if existing:
        raise HTTPException(409, "device_name already registered")

    row = client.table("devices").insert({
        "device_name": name, "api_key": secrets.token_hex(24), "user_id": user.id,
        "kind": body.kind,
    }).execute().data[0]
    # only time the full key is returned — put it in the firmware or client config
    return row


@router.get("/devices", summary="List devices (API keys masked) with recording stats")
def list_devices(user: User = Depends(current_user)):
    client = get_client()
    rows = (client.table("devices").select("*")
            .eq("user_id", user.id).order("created_at").execute().data)
    stats = {s["device_id"]: s for s in
             client.rpc("device_stats", {"p_user": user.id}).execute().data or []}
    for r in rows:
        r["api_key"] = "…" + r["api_key"][-4:]
        s = stats.get(r["id"], {})
        r["recordings"] = s.get("recordings", 0)
        r["total_seconds"] = s.get("total_seconds", 0)
        r["last_recording"] = s.get("last_recording")
    return rows


@router.patch("/devices/{device_id}", summary="Rename a device or rotate its API key")
def update_device(device_id: str, body: DeviceUpdate, user: User = Depends(current_user)):
    client = get_client()
    device = _get_device_or_404(client, device_id, user)

    patch: dict = {}
    if body.device_name is not None:
        name = body.device_name.strip()
        if name != device["device_name"]:
            clash = (client.table("devices").select("id")
                     .eq("device_name", name).eq("user_id", user.id).execute().data)
            if clash:
                raise HTTPException(409, "device_name already registered")
            patch["device_name"] = name
    if body.regenerate_key:
        patch["api_key"] = secrets.token_hex(24)

    if not patch:
        raise HTTPException(400, "nothing to update")

    row = client.table("devices").update(patch).eq("id", device_id).execute().data[0]
    if not body.regenerate_key:
        row["api_key"] = "…" + row["api_key"][-4:]  # only reveal a freshly issued key
    return row


@router.delete("/devices/{device_id}", status_code=204,
               summary="Delete a device (its recordings are kept)")
def delete_device(device_id: str, user: User = Depends(current_user)):
    """Removes the device registration and invalidates its API key. Audio the
    device already uploaded stays in the library — those rows are not linked to
    `devices`, so nothing cascades."""
    client = get_client()
    _get_device_or_404(client, device_id, user)
    discard_pending_chunks(client, [device_id])
    client.table("devices").delete().eq("id", device_id).execute()
