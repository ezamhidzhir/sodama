"""The signed-in user's own profile and account."""
import uuid
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, File, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field, field_validator

from .. import clips, config, ratelimit
from ..auth import USERNAME_RE, User, _profiled, current_user, forget_token
from ..db import get_client
from .ingest import discard_pending_chunks

router = APIRouter(tags=["profile"])

AVATAR_BUCKET = "avatars"
AVATAR_TYPES = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}
AVATAR_MAX = 2 * 1024 * 1024
Role = Literal["student", "researcher", "lecturer", "industry", "hobbyist", "other"]


def avatar_url(path: str | None) -> str | None:
    if not path:
        return None
    return f"{config.SUPABASE_URL}/storage/v1/object/public/{AVATAR_BUCKET}/{path}"


def public_profile(p: dict) -> dict:
    """The fields anyone in Community may see — never the email."""
    return {
        "username": p["username"], "full_name": p.get("full_name"), "bio": p.get("bio"),
        "organization": p.get("organization"), "role": p.get("role"),
        "avatar_url": avatar_url(p.get("avatar_path")), "joined_at": p.get("created_at"),
    }


def _load(client, user: User) -> dict:
    return client.table("profiles").select("*").eq("id", user.id).execute().data[0]


class ProfileUpdate(BaseModel):
    username: str | None = None
    full_name: str | None = Field(default=None, max_length=80)
    bio: str | None = Field(default=None, max_length=300)
    organization: str | None = Field(default=None, max_length=100)
    role: Role | None = None

    @field_validator("username")
    @classmethod
    def _username(cls, v):
        if v is None:
            return v
        v = v.strip().lower()
        if not USERNAME_RE.match(v):
            raise ValueError("3-30 characters: lowercase letters, numbers and underscores")
        return v


@router.get("/me", summary="Your profile, account email and activity summary")
def get_me(user: User = Depends(current_user)):
    client = get_client()
    p = _load(client, user)

    def count(table, **eq):
        q = client.table(table).select("id", count="exact").eq("user_id", user.id)
        for k, v in eq.items():
            q = q.eq(k, v)
        return q.limit(1).execute().count or 0

    public = (client.table("datasets").select("id, download_count")
              .eq("user_id", user.id).eq("visibility", "public").execute().data)
    likes = (client.table("dataset_likes").select("user_id", count="exact")
             .in_("dataset_id", [d["id"] for d in public]).limit(1).execute().count
             if public else 0)

    return {
        **public_profile(p),
        "id": user.id,
        "email": user.email,
        "updated_at": p.get("updated_at"),
        "stats": {
            "audio_files": count("audio_files"),
            "recordings": count("audio_files", source="recording"),
            "datasets": count("datasets"),
            "public_datasets": len(public),
            "downloads_received": sum(d["download_count"] for d in public),
            "likes_received": likes or 0,
        },
        "quota": {
            **clips.quota(client, user.id),
            "max_upload_seconds": config.MAX_UPLOAD_SECONDS,
            "max_recording_seconds": config.MAX_RECORDING_SECONDS,
        },
    }


@router.patch("/me", summary="Edit your profile")
def update_me(body: ProfileUpdate, user: User = Depends(current_user)):
    client = get_client()
    patch = body.model_dump(exclude_unset=True)
    for k in ("full_name", "bio", "organization"):
        if k in patch:
            patch[k] = (patch[k] or "").strip() or None
    if not patch:
        raise HTTPException(400, "nothing to update")

    if "username" in patch:
        clash = (client.table("profiles").select("id").eq("username", patch["username"])
                 .neq("id", user.id).execute().data)
        if clash:
            raise HTTPException(409, "that username is taken")

    patch["updated_at"] = datetime.now(timezone.utc).isoformat()
    client.table("profiles").update(patch).eq("id", user.id).execute()
    return get_me(user)


def _looks_like(ext: str, data: bytes) -> bool:
    if ext in ("jpg", "jpeg"):
        return data[:3] == b"\xff\xd8\xff"
    if ext == "png":
        return data[:8] == b"\x89PNG\r\n\x1a\n"
    if ext == "webp":
        return data[:4] == b"RIFF" and data[8:12] == b"WEBP"
    return False


@router.post("/me/avatar", summary="Upload a profile picture (JPEG/PNG/WebP, 2 MB)")
async def upload_avatar(file: UploadFile = File(...), user: User = Depends(current_user)):
    ratelimit.ACCOUNT.hit(user.id)
    ext = AVATAR_TYPES.get(file.content_type or "")
    if not ext:
        raise HTTPException(415, "use a JPEG, PNG or WebP image")
    data = await file.read()
    if len(data) > AVATAR_MAX:
        raise HTTPException(413, "image is larger than 2 MB")
    # The bucket is public, so check the bytes, not just the type the browser claims.
    if not _looks_like(ext, data):
        raise HTTPException(415, "that file is not a valid JPEG, PNG or WebP image")

    client = get_client()
    old = _load(client, user).get("avatar_path")
    # A fresh name per upload, so browsers and CDNs never show a stale picture.
    path = f"{user.id}/{uuid.uuid4().hex[:12]}.{ext}"
    client.storage.from_(AVATAR_BUCKET).upload(path, data, {"content-type": file.content_type})
    client.table("profiles").update({"avatar_path": path}).eq("id", user.id).execute()
    if old:
        client.storage.from_(AVATAR_BUCKET).remove([old])
    return {"avatar_url": avatar_url(path)}


@router.delete("/me/avatar", status_code=204, summary="Remove your profile picture")
def delete_avatar(user: User = Depends(current_user)):
    client = get_client()
    old = _load(client, user).get("avatar_path")
    if old:
        client.storage.from_(AVATAR_BUCKET).remove([old])
        client.table("profiles").update({"avatar_path": None}).eq("id", user.id).execute()


class DeleteAccount(BaseModel):
    confirm: str = Field(description="Your username, typed to confirm")


@router.delete("/me", status_code=204, summary="Delete your account and all of your data")
def delete_me(body: DeleteAccount, user: User = Depends(current_user),
              authorization: str | None = Header(None)):
    """Removes every file, dataset, device and like the user owns, then the
    account itself. Public datasets disappear from Community with it."""
    client = get_client()
    profile = _load(client, user)
    if body.confirm.strip().lower() != profile["username"]:
        raise HTTPException(400, "type your username exactly to confirm")

    # Paged: one request returns at most 1000 rows, and every stored file must go.
    paths, start = [], 0
    while True:
        page = (client.table("audio_files").select("storage_path").eq("user_id", user.id)
                .order("id").range(start, start + 999).execute().data)
        paths += [r["storage_path"] for r in page if r["storage_path"]]  # clips own none
        if len(page) < 1000:
            break
        start += 1000
    for i in range(0, len(paths), 100):
        client.storage.from_(config.AUDIO_BUCKET).remove(paths[i:i + 100])
    if profile.get("avatar_path"):
        client.storage.from_(AVATAR_BUCKET).remove([profile["avatar_path"]])
    discard_pending_chunks(client, [d["id"] for d in client.table("devices").select("id")
                                    .eq("user_id", user.id).execute().data])

    # audio_files.user_id is ON DELETE SET NULL, so rows must go explicitly;
    # classifications, metadata and dataset links cascade from them.
    client.table("audio_files").delete().eq("user_id", user.id).execute()
    client.table("datasets").delete().eq("user_id", user.id).execute()
    client.auth.admin.delete_user(user.id)   # cascades profiles, devices, likes

    _profiled.discard(user.id)
    forget_token(authorization)
