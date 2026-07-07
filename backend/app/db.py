from functools import lru_cache

from supabase import Client, create_client

from . import config


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Service-role client — bypasses RLS; backend is the trusted writer."""
    return create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
