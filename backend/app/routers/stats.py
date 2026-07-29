from fastapi import APIRouter

from ..db import get_client

router = APIRouter(tags=["system"])


@router.get("/stats", summary="Dashboard aggregates (single RPC round-trip)")
def dashboard_stats():
    client = get_client()
    return client.rpc("dashboard_stats").execute().data
