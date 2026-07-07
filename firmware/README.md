# ESP32 Firmware — Sound Collection

**Status: waiting for hardware** (ESP32 DevKit + INMP441 — order via Shopee ~RM15-25).

## Planned behaviour (per proposal Slide 14 & 20)

1. Capture audio via I2S from INMP441 (16 kHz, mono, 16-bit PCM).
2. Record 10-second clips.
3. Encode as WAV and upload to backend via **HTTP chunked POST**
   (fallback: WebSocket), authenticated with the device `api_key`
   registered in the `devices` table.

## Wiring (INMP441 → ESP32)

| INMP441 | ESP32 |
|---|---|
| VDD | 3V3 |
| GND | GND |
| SD  | GPIO 32 (I2S data in) |
| SCK | GPIO 26 (I2S bit clock) |
| WS  | GPIO 25 (I2S word select) |
| L/R | GND (left channel) |
