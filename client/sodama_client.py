"""SODAMA reference client — any computer becomes a recording device.

It follows the same contract the ESP32 firmware will:

    record -> POST /ingest -> receipt -> delete the local copy -> record again

A local file is deleted only after the server's receipt carries the same
SHA-256 the client computed. Anything not yet confirmed stays on disk and is
sent again, on the next attempt or the next run; the server recognises repeats
by the recording's id, so nothing is stored twice.

Usage (the API key comes from the Devices page):

    python sodama_client.py --server https://<host> --key <API key> send a.wav b.wav
    python sodama_client.py ... watch C:\\recordings          # upload whatever lands in a folder
    python sodama_client.py ... mic --chunk 10                # stream 10 s chunks, one clip each
    python sodama_client.py ... mic --chunk 10 --join         # ... stitched into one recording

--server and --key can also come from SODAMA_SERVER and SODAMA_API_KEY.
Only `mic` needs a third-party package:  pip install sounddevice numpy
"""
import argparse
import hashlib
import json
import os
import queue
import sys
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

AUDIO_TYPES = {".wav": "audio/wav", ".flac": "audio/flac", ".mp3": "audio/mpeg", ".ogg": "audio/ogg"}
# Fixed namespace: the same file always gets the same id, across runs and machines.
ID_NAMESPACE = uuid.UUID("5d1f6a0e-6b1c-4b8e-9a51-50da3a0c1e55")
RETRY_MAX_WAIT = 30
SAMPLE_RATE = 16000


def log(msg: str) -> None:
    print(f"[{datetime.now().strftime('%H:%M:%S')}] {msg}", flush=True)


class PermanentError(Exception):
    """The server refused the request; sending it again will not help."""


class Server:
    def __init__(self, base_url: str, api_key: str):
        self.base = base_url.rstrip("/")
        self.key = api_key

    def _post(self, path: str, body: bytes = b"", headers: dict | None = None) -> tuple[int, dict]:
        req = urllib.request.Request(self.base + path, data=body, method="POST",
                                     headers={"X-API-Key": self.key, **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, json.load(resp)
        except urllib.error.HTTPError as e:
            try:
                detail = json.load(e).get("detail")
            except Exception:
                detail = e.reason
            return e.code, {"detail": detail}

    def _post_retrying(self, path: str, body: bytes = b"", headers: dict | None = None,
                       retry_on: tuple[int, ...] = ()) -> tuple[int, dict]:
        """Network errors, 5xx and `retry_on` statuses are retried with backoff."""
        wait = 1
        while True:
            try:
                status, data = self._post(path, body, headers)
            except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
                status, data = None, {"detail": str(e)}
            if status is not None and status < 500 and status not in retry_on:
                return status, data
            log(f"  server unreachable or busy ({status or 'no response'}: {data.get('detail')}) "
                f"- retrying in {wait}s, the local copy is kept")
            time.sleep(wait)
            wait = min(wait * 2, RETRY_MAX_WAIT)

    def ingest(self, body: bytes, content_type: str, client_id: str, recorded_at: str | None,
               params: str = "") -> dict:
        """Upload until the server has it; returns the receipt after checking its hash."""
        sha = hashlib.sha256(body).hexdigest()
        headers = {"Content-Type": content_type, "X-Client-Id": client_id,
                   "X-Content-SHA256": sha}
        if recorded_at:
            headers["X-Recorded-At"] = recorded_at
        # 422 = corrupted in transit: worth sending again as it is.
        status, receipt = self._post_retrying("/ingest" + params, body, headers, retry_on=(422,))
        if status not in (200, 201):
            raise PermanentError(f"{status}: {receipt.get('detail')}")
        if receipt.get("sha256") != sha:
            raise PermanentError("receipt hash does not match the local file")
        return receipt

    def close_session(self, session_id: str, chunks: int) -> tuple[int, dict]:
        return self._post_retrying(f"/ingest/sessions/{session_id}/close?chunks={chunks}")


def upload_file(server: Server, path: Path, keep: bool = False) -> bool:
    """One file -> one recording. True when the server confirmed it."""
    body = path.read_bytes()
    client_id = str(uuid.uuid5(ID_NAMESPACE, hashlib.sha256(body).hexdigest()))
    recorded_at = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc).isoformat()
    content_type = AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream")
    try:
        receipt = server.ingest(body, content_type, client_id, recorded_at)
    except PermanentError as e:
        log(f"FAILED {path.name}: {e} - kept")
        return False
    what = "already on the server" if receipt["status"] == "duplicate" else "stored"
    if keep:
        log(f"OK {path.name} {what} (hash verified)")
    else:
        path.unlink()
        log(f"OK {path.name} {what} (hash verified) -> local copy deleted")
    return True


# ---------------------------------------------------------------- send / watch

def cmd_send(server: Server, args) -> int:
    failed = [p for p in map(Path, args.files) if not upload_file(server, p, keep=args.keep)]
    return 1 if failed else 0


def cmd_watch(server: Server, args) -> int:
    folder = Path(args.folder)
    folder.mkdir(parents=True, exist_ok=True)
    log(f"watching {folder.resolve()} - drop audio files in; Ctrl+C to stop")
    skipped: set[Path] = set()
    while True:
        now = time.time()
        for p in sorted(folder.iterdir(), key=lambda p: p.stat().st_mtime):
            # A file modified in the last 2 s may still be being written.
            if (p.suffix.lower() in AUDIO_TYPES and p not in skipped
                    and now - p.stat().st_mtime > 2):
                if not upload_file(server, p):
                    skipped.add(p)
        time.sleep(args.interval)


# ---------------------------------------------------------------- mic (stream mode)
#
# Each chunk is written to a spool folder first and deleted only after its
# receipt, so a crash or a dropped connection loses nothing: the next run
# finds the leftovers and finishes sending them.
#
#   spool/<session id>/session.json             {"join": true}
#   spool/<session id>/00003_<recorded at>.wav

def _chunk_name(index: int, recorded_at: datetime) -> str:
    return f"{index:05d}_{recorded_at.strftime('%Y%m%dT%H%M%S%fZ')}.wav"


def _parse_chunk_name(name: str) -> tuple[int, str]:
    index, stamp = Path(name).stem.split("_", 1)
    ts = datetime.strptime(stamp, "%Y%m%dT%H%M%S%fZ").replace(tzinfo=timezone.utc)
    return int(index), ts.isoformat()


def send_chunk(server: Server, session_dir: Path, path: Path, join: bool) -> bool:
    session_id = session_dir.name
    index, recorded_at = _parse_chunk_name(path.name)
    client_id = str(uuid.uuid5(uuid.UUID(session_id), str(index)))
    params = f"?session_id={session_id}&chunk_index={index}&join={'true' if join else 'false'}"
    try:
        receipt = server.ingest(path.read_bytes(), "audio/wav", client_id, recorded_at, params)
    except PermanentError as e:
        log(f"FAILED chunk {index}: {e} - kept in {session_dir}")
        return False
    path.unlink()
    note = "waiting to be joined" if join else f"clip {receipt['audio_id'][:8]}"
    log(f"OK chunk {index} ({receipt['duration']:.1f} s, {note}) -> local copy deleted")
    return True


def finish_session(server: Server, session_dir: Path, chunks: int) -> None:
    """Close once every chunk is confirmed; the spool folder goes with it."""
    if chunks == 0:
        _remove_session_dir(session_dir)
        return
    status, result = server.close_session(session_dir.name, chunks)
    if status == 200:
        if result["joined"]:
            log(f"session closed - {chunks} chunks joined into one recording "
                f"({result['audio_ids'][0][:8]})")
        else:
            log(f"session closed - {chunks} clips")
        _remove_session_dir(session_dir)
    else:
        log(f"could not close session {session_dir.name}: {status} {result.get('detail')} "
            "- run the client again to retry")


def _remove_session_dir(session_dir: Path) -> None:
    (session_dir / "session.json").unlink(missing_ok=True)
    try:
        session_dir.rmdir()
    except OSError:
        pass  # unconfirmed chunks are still in it


def drain_spool(server: Server, spool: Path) -> None:
    """Finish sessions an earlier run left behind (crash, no network, Ctrl+C twice)."""
    for session_dir in sorted(p for p in spool.iterdir() if p.is_dir()) if spool.exists() else []:
        meta = session_dir / "session.json"
        if not meta.exists():
            continue
        info = json.loads(meta.read_text())
        pending = sorted(session_dir.glob("*.wav"))
        log(f"resuming session {session_dir.name}: {len(pending)} unsent chunk(s)")
        if all([send_chunk(server, session_dir, p, info["join"]) for p in pending]):
            finish_session(server, session_dir, info["chunks"])


def cmd_mic(server: Server, args) -> int:
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError:
        print("mic mode needs:  pip install sounddevice numpy", file=sys.stderr)
        return 2

    spool = Path(args.spool)
    drain_spool(server, spool)

    session_dir = spool / str(uuid.uuid4())
    session_dir.mkdir(parents=True)
    meta = {"join": args.join, "chunks": 0}
    (session_dir / "session.json").write_text(json.dumps(meta))

    # Uploads run beside the recording so a slow network never drops audio.
    outbox: queue.Queue[Path | None] = queue.Queue()
    failures: list[Path] = []

    def uploader():
        while (path := outbox.get()) is not None:
            if not send_chunk(server, session_dir, path, args.join):
                failures.append(path)

    worker = threading.Thread(target=uploader, daemon=True)
    worker.start()

    rate = SAMPLE_RATE
    try:
        sd.check_input_settings(samplerate=rate, channels=1, dtype="int16")
    except Exception:
        rate = int(sd.query_devices(kind="input")["default_samplerate"])  # server resamples
    frames: queue.Queue = queue.Queue()
    chunk_len = int(args.chunk * rate)

    def write_chunk(samples) -> None:
        index = meta["chunks"]
        started = datetime.now(timezone.utc).timestamp() - len(samples) / rate
        path = session_dir / _chunk_name(index, datetime.fromtimestamp(started, timezone.utc))
        with wave.open(str(path), "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(samples.tobytes())
        meta["chunks"] = index + 1
        (session_dir / "session.json").write_text(json.dumps(meta))
        outbox.put(path)

    mode = "joined into one recording" if args.join else "one clip per chunk"
    log(f"recording {args.chunk:g} s chunks at {rate} Hz ({mode}) - Ctrl+C to stop")
    buffer = np.empty(0, dtype=np.int16)
    deadline = time.time() + args.duration if args.duration else None
    try:
        with sd.InputStream(samplerate=rate, channels=1, dtype="int16",
                            callback=lambda data, *_: frames.put(data[:, 0].copy())):
            while deadline is None or time.time() < deadline:
                try:
                    buffer = np.concatenate([buffer, frames.get(timeout=0.5)])
                except queue.Empty:
                    continue
                while buffer.size >= chunk_len:
                    write_chunk(buffer[:chunk_len])
                    buffer = buffer[chunk_len:]
    except KeyboardInterrupt:
        pass
    if buffer.size >= rate // 2:  # keep a final partial chunk of at least 0.5 s
        write_chunk(buffer)

    log("stopped recording - finishing uploads")
    outbox.put(None)
    worker.join()
    if failures:
        log(f"{len(failures)} chunk(s) refused by the server - kept in {session_dir}")
        return 1
    finish_session(server, session_dir, meta["chunks"])
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Send recordings to SODAMA.")
    parser.add_argument("--server", default=os.environ.get("SODAMA_SERVER"),
                        help="e.g. https://sodama.up.railway.app (env SODAMA_SERVER)")
    parser.add_argument("--key", default=os.environ.get("SODAMA_API_KEY"),
                        help="device API key from the Devices page (env SODAMA_API_KEY)")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("send", help="upload audio files, deleting each once confirmed")
    p.add_argument("files", nargs="+")
    p.add_argument("--keep", action="store_true", help="do not delete after upload")
    p.set_defaults(run=cmd_send)

    p = sub.add_parser("watch", help="upload every audio file that appears in a folder")
    p.add_argument("folder")
    p.add_argument("--interval", type=float, default=2.0, help="seconds between scans")
    p.set_defaults(run=cmd_watch)

    p = sub.add_parser("mic", help="record from the microphone and stream chunks")
    p.add_argument("--chunk", type=float, default=10.0, help="chunk length in seconds")
    p.add_argument("--join", action="store_true", help="server stitches chunks into one recording")
    p.add_argument("--duration", type=float, help="stop after this many seconds")
    p.add_argument("--spool", default="spool", help="where unconfirmed chunks wait")
    p.set_defaults(run=cmd_mic)

    args = parser.parse_args()
    if not args.server or not args.key:
        parser.error("--server and --key are required (or set SODAMA_SERVER / SODAMA_API_KEY)")
    try:
        return args.run(Server(args.server, args.key), args)
    except KeyboardInterrupt:
        log("stopped")
        return 130


if __name__ == "__main__":
    sys.exit(main())
