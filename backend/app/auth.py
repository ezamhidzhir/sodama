"""Who is calling — Supabase JWT verification for every dashboard endpoint.

The browser signs in against Supabase Auth directly and sends the access token
as `Authorization: Bearer <jwt>`. The backend asks Supabase who that token
belongs to rather than checking the signature itself: that works whichever
signing scheme the project uses (legacy HS256 secret or the newer asymmetric
keys) and needs no extra secret in the environment.

A short in-memory cache keeps that from costing a round-trip on every request.
The backend still talks to the database as the service role, so *every* query
it makes on a user's behalf must filter on `user.id` — this module only answers
"who", the routers enforce "whose".
"""
import re
import secrets
import threading
import time
from dataclasses import dataclass

from fastapi import Header, HTTPException

from .db import get_client

CACHE_TTL = 60          # seconds a verified token is trusted without re-checking
CACHE_MAX = 1000

_cache: dict[str, tuple[float, "User"]] = {}
_lock = threading.Lock()
_profiled: set[str] = set()   # user ids whose profile row is known to exist


@dataclass(frozen=True)
class User:
    id: str
    email: str
    full_name: str | None = None


def _verify(token: str) -> User:
    now = time.monotonic()
    with _lock:
        hit = _cache.get(token)
        if hit and hit[0] > now:
            return hit[1]

    try:
        res = get_client().auth.get_user(token)
    except Exception:
        raise HTTPException(401, "session expired — sign in again")
    if not res or not res.user:
        raise HTTPException(401, "session expired — sign in again")

    meta = res.user.user_metadata or {}
    user = User(id=res.user.id, email=res.user.email or "", full_name=meta.get("full_name"))
    with _lock:
        if len(_cache) >= CACHE_MAX:
            _cache.clear()
        _cache[token] = (now + CACHE_TTL, user)
    return user


def current_user(authorization: str | None = Header(
        None, description="`Bearer <Supabase access token>`")) -> User:
    """FastAPI dependency: the signed-in user, or 401."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "not signed in")
    user = _verify(authorization[7:].strip())
    if user.id not in _profiled:
        ensure_profile(user)
    return user


def forget_token(authorization: str | None) -> None:
    """Drop a token from the cache (after sign-out or account deletion)."""
    if authorization and authorization.lower().startswith("bearer "):
        with _lock:
            _cache.pop(authorization[7:].strip(), None)


# ------------------------------------------------------------------ profiles

USERNAME_RE = re.compile(r"^[a-z0-9_]{3,30}$")


def _username_base(user: User) -> str:
    base = re.sub(r"[^a-z0-9_]", "_", (user.email.split("@")[0] or "user").lower())
    base = re.sub(r"_+", "_", base).strip("_")[:24]
    return base if len(base) >= 3 else f"user_{base}".strip("_")


def ensure_profile(user: User) -> None:
    """Create the profile row on a user's first authenticated request.

    Lazily, from the backend, so no trigger on the `auth` schema is needed and
    accounts that existed before profiles did get one the first time they sign in.
    """
    client = get_client()
    if client.table("profiles").select("id").eq("id", user.id).execute().data:
        _profiled.add(user.id)
        return

    base = _username_base(user)
    candidate = base
    for _ in range(8):
        taken = client.table("profiles").select("id").eq("username", candidate).execute().data
        if not taken:
            break
        candidate = f"{base[:25]}_{secrets.token_hex(2)}"
    try:
        client.table("profiles").insert({
            "id": user.id, "username": candidate,
            "full_name": (user.full_name or "")[:80] or None,
        }).execute()
    except Exception:
        # A concurrent first request created it — that is fine.
        if not client.table("profiles").select("id").eq("id", user.id).execute().data:
            raise
    _profiled.add(user.id)
