"""Community — trainers publishing labelled datasets for others to train on.

The unit of sharing is a *dataset*, as on HuggingFace: a set of labelled clips
with a description, a class list and a licence, not a loose pile of files. That
keeps the purpose of the system intact — what people share is training data,
and what others take away is the same HF-compatible ZIP the owner can export.

Only datasets whose owner set `visibility = public` are reachable here. Every
response is built for a stranger: usernames instead of emails, and no precise
coordinates unless the owner chose to share them.
"""
from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, Query

from .. import config
from ..auth import User, current_user
from ..db import get_client
from .datasets import LICENSES, build_export, dataset_rows, exportable
from .profile import avatar_url, public_profile

router = APIRouter(prefix="/community", tags=["community"])

SAMPLE_LIMIT = 60
SIGNED_URL_TTL = 3600


def _card(item: dict) -> dict:
    item["avatar_url"] = avatar_url(item.pop("avatar_path", None))
    item.pop("user_id", None)
    return item


def _public_dataset(client, dataset_id: str, user: User) -> dict:
    """A public dataset — or the caller's own, so owners can preview theirs."""
    rows = client.table("datasets").select("*").eq("id", dataset_id).execute().data
    if not rows or (rows[0]["visibility"] != "public" and rows[0]["user_id"] != user.id):
        raise HTTPException(404, "dataset not found or not public")
    return rows[0]


def _owner(client, user_id: str) -> dict:
    rows = client.table("profiles").select("*").eq("id", user_id).execute().data
    return rows[0] if rows else {"username": "unknown"}


@router.get("/datasets", summary="Browse public datasets")
def browse(q: str | None = Query(None, max_length=100),
           sort: str = Query("popular", pattern="^(popular|newest|likes|clips)$"),
           page: int = Query(1, ge=1), per_page: int = Query(24, ge=1, le=60),
           user: User = Depends(current_user)):
    res = get_client().rpc("community_datasets", {
        "p_viewer": user.id, "p_query": (q or "").strip() or None, "p_sort": sort,
        "p_limit": per_page, "p_offset": (page - 1) * per_page,
    }).execute().data
    return {"items": [_card(i) for i in res["items"]], "total": res["total"],
            "page": page, "per_page": per_page}


@router.get("/datasets/{dataset_id}", summary="A public dataset's card, stats and samples")
def dataset_detail(dataset_id: str, user: User = Depends(current_user)):
    client = get_client()
    d = _public_dataset(client, dataset_id, user)
    rows = exportable(dataset_rows(client, dataset_id))

    likes = (client.table("dataset_likes").select("user_id").eq("dataset_id", dataset_id)
             .execute().data)
    samples = rows[:SAMPLE_LIMIT]

    # Signed URLs in one call for the sample player.
    urls: dict[str, str] = {}
    if samples:
        paths = {r["id"]: r["storage_path"] for r in client.table("audio_files")
                 .select("id, storage_path").in_("id", [s["id"] for s in samples])
                 .execute().data}
        signed = client.storage.from_(config.AUDIO_BUCKET).create_signed_urls(
            list(paths.values()), SIGNED_URL_TTL)
        by_path = {s.get("path"): s.get("signedURL") or s.get("signedUrl") for s in signed}
        urls = {aid: by_path.get(path) for aid, path in paths.items()}

    return {
        "id": d["id"], "name": d["name"], "description": d["description"],
        "labels": d["labels"], "license": d["license"],
        "license_name": LICENSES.get(d["license"] or "", None),
        "visibility": d["visibility"], "published_at": d["published_at"],
        "updated_at": d["updated_at"], "download_count": d["download_count"],
        "share_location": d["share_location"],
        "is_owner": d["user_id"] == user.id,
        "like_count": len(likes),
        "liked": any(l["user_id"] == user.id for l in likes),
        "owner": public_profile(_owner(client, d["user_id"])),
        "stats": {
            "clip_count": len(rows),
            "total_duration": round(sum(r["duration"] or 0 for r in rows), 1),
            "class_distribution": Counter(r["label"] for r in rows).most_common(),
            "label_sources": dict(Counter(r["label_source"] for r in rows)),
            "sources": dict(Counter(r["source"] for r in rows)),
        },
        "samples": [{
            "id": r["id"], "label": r["label"], "label_source": r["label_source"],
            "duration": r["duration"], "source": r["source"],
            "recorded_at": r.get("recorded_at") or r["uploaded_at"],
            "location_name": r.get("location_name"),
            "url": urls.get(r["id"]),
        } for r in samples],
    }


@router.post("/datasets/{dataset_id}/like", summary="Like a public dataset")
def like(dataset_id: str, user: User = Depends(current_user)):
    client = get_client()
    d = _public_dataset(client, dataset_id, user)
    if d["visibility"] != "public":
        raise HTTPException(400, "only public datasets can be liked")
    client.table("dataset_likes").upsert(
        {"dataset_id": dataset_id, "user_id": user.id},
        on_conflict="dataset_id,user_id").execute()
    return {"liked": True}


@router.delete("/datasets/{dataset_id}/like", summary="Remove your like")
def unlike(dataset_id: str, user: User = Depends(current_user)):
    get_client().table("dataset_likes").delete() \
        .eq("dataset_id", dataset_id).eq("user_id", user.id).execute()
    return {"liked": False}


@router.get("/datasets/{dataset_id}/download",
            summary="Download a public dataset as a training-ready ZIP")
def download(dataset_id: str,
             split: bool = Query(True),
             only_approved: bool = Query(False),
             user: User = Depends(current_user)):
    client = get_client()
    d = _public_dataset(client, dataset_id, user)
    owner = _owner(client, d["user_id"])
    response = build_export(client, d, split=split, only_approved=only_approved,
                            public_author=owner["username"])
    if d["user_id"] != user.id:
        # Read-then-write is racy, but a lost increment on a popularity counter
        # is harmless; a transaction per download is not worth it here.
        client.table("datasets").update({"download_count": d["download_count"] + 1}) \
            .eq("id", dataset_id).execute()
    return response


@router.get("/users/{username}", summary="A contributor's public profile and datasets")
def user_page(username: str, user: User = Depends(current_user)):
    client = get_client()
    rows = client.table("profiles").select("*").eq("username", username.lower()).execute().data
    if not rows:
        raise HTTPException(404, "user not found")
    p = rows[0]
    res = client.rpc("community_datasets", {
        "p_viewer": user.id, "p_owner": p["id"], "p_sort": "newest", "p_limit": 60,
    }).execute().data
    items = [_card(i) for i in res["items"]]
    return {
        **public_profile(p),
        "is_me": p["id"] == user.id,
        "datasets": items,
        "totals": {
            "datasets": res["total"],
            "clips": sum(i["clip_count"] for i in items),
            "downloads": sum(i["download_count"] for i in items),
            "likes": sum(i["like_count"] for i in items),
        },
    }
