import os

from fastapi import APIRouter, Depends

from .. import config
from ..auth import User, current_user
from ..db import get_client

router = APIRouter(tags=["system"])


@router.get("/config", summary="Public client config (Supabase URL + anon key)")
def client_config():
    """The anon key is designed to be published to browsers — RLS is what
    protects the data. The service-role key never leaves the backend."""
    return {
        "url": config.SUPABASE_URL,
        "anonKey": os.environ.get("SUPABASE_ANON_KEY", ""),
    }


@router.get("/stats", summary="Your dashboard aggregates (single RPC round-trip)")
def dashboard_stats(user: User = Depends(current_user)):
    client = get_client()
    return client.rpc("dashboard_stats", {"p_user": user.id}).execute().data
