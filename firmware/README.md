# ESP32 Firmware — Sound Collection

**Status: waiting for hardware** (ESP32 DevKit + INMP441 — order via Shopee ~RM15-25).

## Planned behaviour

The firmware follows the same upload contract as every other client — see
"Sending audio from a device" in the main README, and `client/sodama_client.py`
for a working reference implementation.

1. Capture audio via I2S from INMP441 (16 kHz, mono, 16-bit PCM).
2. Record 10-second chunks to the SD card (or a RAM buffer).
3. `POST /ingest?session_id=…&chunk_index=…[&join=true]` with headers
   `X-API-Key`, `X-Client-Id`, `X-Content-SHA256` (mbedTLS SHA-256);
   body = raw PCM (`application/octet-stream`) or WAV.
4. Delete the chunk only when the receipt's `sha256` equals the local hash;
   otherwise keep it and retry with backoff.
5. On stop: `POST /ingest/sessions/{id}/close?chunks=N`.

## Wiring (INMP441 → ESP32)

| INMP441 | ESP32 |
|---|---|
| VDD | 3V3 |
| GND | GND |
| SD  | GPIO 32 (I2S data in) |
| SCK | GPIO 26 (I2S bit clock) |
| WS  | GPIO 25 (I2S word select) |
| L/R | GND (left channel) |
