from functools import lru_cache

import httpx
from supabase import Client, create_client

from . import config


def _http1(old: httpx.Client) -> httpx.Client:
    """Same settings as supabase-py's own client, minus HTTP/2.

    supabase-py opens one HTTP/2 connection and multiplexes every request over
    it. FastAPI runs sync endpoints on a thread pool, so several requests share
    that connection at once; when Supabase's edge ends it (GOAWAY after a
    stream limit or idle period) every request in flight fails with
    `RemoteProtocolError: ConnectionTerminated`. An HTTP/1.1 pool gives each
    request its own connection and transparently replaces stale ones.
    """
    return httpx.Client(base_url=old.base_url, headers=old.headers, timeout=old.timeout,
                        follow_redirects=True)


@lru_cache(maxsize=1)
def get_client() -> Client:
    """Service-role client — bypasses RLS; backend is the trusted writer."""
    client = create_client(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY)
    pg = client.postgrest
    pg.session = _http1(pg.session)
    st = client.storage
    st.session = st._client = _http1(st.session)
    return client
