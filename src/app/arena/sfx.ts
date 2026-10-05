import type { SoundName } from './game';

/**
 * Synthesised sound effects through the Web Audio API. No audio files, so
 * nothing to host and nothing for the plugin CSP to block. The context is
 * created lazily on the first user gesture, which browsers require.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Call from a user gesture (keydown, click) so the browser lets audio start. */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume().catch(() => {});
    }
  }

  get available(): boolean {
    return this.ctx !== null && this.ctx.state === 'running';
  }

  play(name: SoundName): void {
    const ctx = this.ctx;
    if (!ctx || this.muted || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    switch (name) {
      case 'whoosh':
        this.noise(t, 0.12, 900, 0.18, 'bandpass');
        break;
      case 'hit':
        this.tone(t, 'square', 160, 60, 0.12, 0.35);
        this.noise(t, 0.08, 500, 0.2, 'lowpass');
        break;
      case 'heavy':
        this.tone(t, 'sawtooth', 110, 30, 0.3, 0.45);
        this.noise(t, 0.18, 300, 0.35, 'lowpass');
        break;
      case 'kick':
        this.tone(t, 'triangle', 420, 180, 0.14, 0.3);
        break;
      case 'block':
        this.tone(t, 'square', 1200, 900, 0.05, 0.15);
        break;
      case 'armour':
        this.tone(t, 'sine', 880, 660, 0.12, 0.25);
        this.tone(t + 0.05, 'sine', 1320, 990, 0.12, 0.15);
        break;
      case 'jump':
        this.tone(t, 'sine', 300, 700, 0.16, 0.2);
        break;
      case 'charge':
        this.tone(t, 'sawtooth', 200, 600, 0.4, 0.12);
        break;
      case 'combo':
        this.tone(t, 'square', 660, 660, 0.06, 0.15);
        this.tone(t + 0.07, 'square', 880, 880, 0.06, 0.15);
        this.tone(t + 0.14, 'square', 1100, 1100, 0.1, 0.15);
        break;
      case 'bell':
        this.tone(t, 'sine', 1500, 1480, 0.5, 0.25);
        this.tone(t, 'sine', 2250, 2230, 0.4, 0.1);
        break;
      case 'ko':
        this.tone(t, 'sawtooth', 400, 40, 0.9, 0.4);
        this.noise(t, 0.6, 250, 0.4, 'lowpass');
        this.tone(t + 0.5, 'square', 220, 220, 0.15, 0.2);
        this.tone(t + 0.68, 'square', 330, 330, 0.15, 0.2);
        this.tone(t + 0.86, 'square', 440, 440, 0.4, 0.25);
        break;
    }
  }

  private tone(at: number, type: OscillatorType, from: number, to: number, dur: number, gain: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + dur);
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + dur + 0.02);
  }

  private noise(at: number, dur: number, freq: number, gain: number, type: BiquadFilterType): void {
    const ctx = this.ctx!;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(at);
    src.stop(at + dur + 0.02);
  }
}
