import os

from fastapi import APIRouter

from .. import config
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


@router.get("/stats", summary="Dashboard aggregates (single RPC round-trip)")
def dashboard_stats():
    client = get_client()
    return client.rpc("dashboard_stats").execute().data
