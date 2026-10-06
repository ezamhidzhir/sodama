// Runs on the audio thread: copies raw microphone samples out in ~4096-frame
// blocks. Capturing PCM directly (rather than MediaRecorder's webm/opus or
// mp4/aac) means no lossy codec touches the training data, and the server never
// needs ffmpeg to decode what a phone produced.
class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.n = 0;
    // On stop, hand over the partly filled last block so no tail is lost.
    this.port.onmessage = (e) => {
      if (e.data === 'flush') {
        this.port.postMessage({ last: this.buf.slice(0, this.n) });
        this.n = 0;
      }
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        this.buf[this.n++] = ch[i];
        if (this.n === this.buf.length) {
          this.port.postMessage(this.buf);
          this.buf = new Float32Array(4096);
          this.n = 0;
        }
      }
    }
    return true;   // output stays silent: nothing is played back
  }
}

registerProcessor('pcm-capture', PcmCapture);
