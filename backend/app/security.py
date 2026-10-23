"""HTTP-level protections that apply to every request.

BodySizeLimit — refuses a request body over the limit while it streams in, so a
huge upload is cut off before it fills memory or disk. A declared
Content-Length over the limit is refused before any byte is read; a chunked
body is counted as it arrives.

SecurityHeaders — browser hardening on every response: no MIME sniffing, the app
may not be framed by another site (clickjacking), referrers carry only the
origin, and only this site may ask for the microphone and location.
"""
from starlette.exceptions import HTTPException

MAX_BODY_BYTES = 60 * 1024 * 1024   # 50 MB audio limit plus multipart overhead

_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"content-security-policy", b"frame-ancestors 'none'"),
    (b"referrer-policy", b"strict-origin-when-cross-origin"),
    (b"permissions-policy", b"microphone=(self), geolocation=(self), camera=()"),
    (b"strict-transport-security", b"max-age=31536000"),
]


async def _too_large(send) -> None:
    body = b'{"detail":"request is larger than 60 MB"}'
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"),
                            (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class BodySizeLimit:
    def __init__(self, app, max_bytes: int = MAX_BODY_BYTES):
        self.app, self.max = app, max_bytes

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        declared = dict(scope.get("headers") or []).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > self.max:
            return await _too_large(send)

        seen = 0

        async def counted_receive():
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > self.max:
                    # Surfaces as a normal 413 through FastAPI's error handling.
                    raise HTTPException(413, "request is larger than 60 MB")
            return message

        await self.app(scope, counted_receive, send)


class SecurityHeaders:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def send_with_headers(message):
            if message["type"] == "http.response.start":
                present = {k.lower() for k, _ in message.get("headers", [])}
                message["headers"] = list(message.get("headers", [])) + [
                    (k, v) for k, v in _HEADERS if k not in present]
            await send(message)

        await self.app(scope, receive, send_with_headers)
