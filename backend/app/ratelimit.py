"""Per-caller request limits for the endpoints that cost real CPU or storage.

Uploads run YAMNet and exports build ZIPs, so without a limit one account (or
one leaked device key) could keep the single server busy for everyone. Each
limit counts requests per caller in a sliding window and answers 429 with a
Retry-After header once it is used up.

In memory, which is right for the one Uvicorn worker this app runs (Procfile:
--workers 1). Several workers or instances would each keep their own counts.
"""
import threading
import time
from collections import deque

from fastapi import HTTPException


class RateLimit:
    def __init__(self, what: str, limit: int, window_seconds: int):
        self.what, self.limit, self.window = what, limit, window_seconds
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    def hit(self, key: str) -> None:
        """Count one request for `key`; raise 429 if the window is already full."""
        now = time.monotonic()
        with self._lock:
            q = self._hits.setdefault(key, deque())
            while q and q[0] <= now - self.window:
                q.popleft()
            if len(q) >= self.limit:
                retry = int(q[0] + self.window - now) + 1
                raise HTTPException(
                    429, f"too many {self.what} — try again in {retry} s",
                    headers={"Retry-After": str(retry)})
            q.append(now)
            if len(self._hits) > 10_000:      # forget idle callers
                for k in [k for k, v in self._hits.items() if not v or v[-1] <= now - self.window]:
                    del self._hits[k]


# Generous for a person working by hand; tight enough to stop a script.
AUDIO_IN = RateLimit("uploads", 60, 600)            # /upload, /recordings
DEVICE_IN = RateLimit("device uploads", 300, 600)   # /ingest, per device (a 10 s stream = 60)
EDITS = RateLimit("edits", 60, 600)                 # clips, loop, merge, save from Community
EXPORTS = RateLimit("downloads", 20, 600)           # dataset ZIPs
REPORTS = RateLimit("reports", 20, 3600)
ACCOUNT = RateLimit("account changes", 30, 3600)    # devices, keys, avatar
