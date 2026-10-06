// Microphone capture -> 16 kHz mono 16-bit WAV, entirely in the browser.
//
// Phones apply echo cancellation, noise suppression and automatic gain to the
// microphone by default. That is right for a phone call and wrong for training
// data: noise suppression erases exactly the background texture a model has to
// learn to cope with, and AGC changes loudness mid-clip. All three are switched
// off here so the file holds what the microphone actually heard.

const TARGET_RATE = 16000;   // project standard (YAMNet input)

export const recordingSupported = () =>
  !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));

export class Recorder {
  constructor({ onLevel } = {}) {
    this.onLevel = onLevel;
    this.chunks = [];
    this.length = 0;
  }

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const Ctx = window.AudioContext || window.webkitAudioContext;
    this.ctx = new Ctx();
    await this.ctx.resume();            // iOS starts contexts suspended
    this.rate = this.ctx.sampleRate;
    this.source = this.ctx.createMediaStreamSource(this.stream);

    if (this.ctx.audioWorklet) {
      await this.ctx.audioWorklet.addModule('/js/recorder-worklet.js');
      this.node = new AudioWorkletNode(this.ctx, 'pcm-capture');
      this.node.port.onmessage = (e) => {
        if (e.data?.last) { this._push(e.data.last); this._flushed?.(); }
        else this._push(e.data);
      };
    } else {
      // Older browsers: the deprecated but universal ScriptProcessor.
      this.node = this.ctx.createScriptProcessor(4096, 1, 1);
      this.node.onaudioprocess = (e) => this._push(new Float32Array(e.inputBuffer.getChannelData(0)));
    }
    this.source.connect(this.node);
    this.node.connect(this.ctx.destination);   // silent, but keeps the graph pulling
    this.startedAt = new Date();
  }

  _push(block) {
    this.chunks.push(block);
    this.length += block.length;
    if (this.onLevel) {
      let sum = 0, peak = 0;
      for (let i = 0; i < block.length; i++) {
        const v = block[i];
        sum += v * v;
        if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      this.onLevel(Math.sqrt(sum / block.length), peak);
    }
  }

  get seconds() { return this.rate ? this.length / this.rate : 0; }

  async stop() {
    if (this.node?.port) {
      await new Promise((resolve) => {
        this._flushed = resolve;
        this.node.port.postMessage('flush');
        setTimeout(resolve, 300);      // never hang on a lost message
      });
    }
    this._teardown();

    const all = new Float32Array(this.length);
    let off = 0;
    for (const c of this.chunks) { all.set(c, off); off += c.length; }
    const pcm = await resample(all, this.rate, TARGET_RATE);
    return {
      blob: encodeWav(pcm.data, pcm.rate),
      duration: all.length / this.rate,
      startedAt: this.startedAt,
      peak: all.reduce((m, v) => Math.max(m, Math.abs(v)), 0),
    };
  }

  cancel() { this._teardown(); this.chunks = []; this.length = 0; }

  _teardown() {
    try { this.source?.disconnect(); this.node?.disconnect(); } catch { /* already gone */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close().catch(() => {});
  }
}

// Proper band-limited resampling via the browser's own audio engine. If the
// browser refuses a 16 kHz offline context, send the native rate instead —
// the server resamples everything to 16 kHz anyway.
async function resample(samples, from, to) {
  if (from === to || !samples.length) return { data: samples, rate: from };
  try {
    const Off = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const off = new Off(1, Math.ceil(samples.length * to / from), to);
    const buf = off.createBuffer(1, samples.length, from);
    buf.getChannelData(0).set(samples);
    const src = off.createBufferSource();
    src.buffer = buf;
    src.connect(off.destination);
    src.start();
    const out = await off.startRendering();
    return { data: out.getChannelData(0), rate: to };
  } catch {
    return { data: samples, rate: from };
  }
}

export function encodeWav(samples, rate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0, o = 44; i < samples.length; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// "Android phone · Chrome" — kept as clip metadata, since microphones differ
// and a trainer may want to know which clips came from which kind of device.
export function describeDevice() {
  const ua = navigator.userAgent;
  const kind = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad'
    : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : 'Computer';
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox'
    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${kind} · ${browser}`;
}

// ---------------------------------------------------------------- location

export function getPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Location is not available on this device'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(new Error(e.code === 1 ? 'Location permission was denied' : 'Could not get your location')),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}

const placeCache = new Map();

// Coordinates -> "Seri Iskandar, Perak" via OpenStreetMap's Nominatim.
// Best effort: on any failure the clip simply keeps its coordinates.
export async function placeName(lat, lng) {
  const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  if (placeCache.has(key)) return placeCache.get(key);
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14`
      + `&lat=${lat}&lon=${lng}&accept-language=ms,en`);
    if (!res.ok) return null;
    const a = (await res.json()).address || {};
    const local = a.suburb || a.village || a.town || a.city_district || a.city || a.county;
    const region = a.state || a.region;
    const name = [local, region].filter(Boolean).join(', ') || null;
    placeCache.set(key, name);
    return name;
  } catch {
    return null;
  }
}
