/** Tiny procedural audio — no asset downloads, just short synth gestures. */
class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  enabled = true;

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType = 'sine',
    gain = 0.15,
    slide?: number,
    delay = 0,
  ) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain = 0.08, freq = 1200) {
    if (!this.enabled || !this.ctx || !this.master) return;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start();
  }

  harvest() {
    this.noise(0.18, 0.06, 900);
    this.tone(210, 0.12, 'triangle', 0.1, 150);
  }

  chop() {
    this.noise(0.12, 0.05, 600);
    this.tone(160, 0.1, 'square', 0.05, 110);
  }

  craft() {
    this.tone(520, 0.09, 'triangle', 0.08);
    this.tone(780, 0.14, 'triangle', 0.07, undefined, 0.06);
  }

  place() {
    this.noise(0.1, 0.05, 500);
    this.tone(300, 0.1, 'sine', 0.12, 180);
  }

  remove() {
    this.tone(420, 0.12, 'sine', 0.08, 180);
  }

  error() {
    this.tone(150, 0.18, 'square', 0.06, 110);
  }

  click() {
    this.tone(880, 0.04, 'square', 0.03);
  }

  goal() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.22, 'triangle', 0.07, undefined, i * 0.07));
  }

  discover() {
    this.tone(392, 0.2, 'sine', 0.08);
    this.tone(587, 0.3, 'sine', 0.06, undefined, 0.08);
  }
}

export const sfx = new Sfx();
