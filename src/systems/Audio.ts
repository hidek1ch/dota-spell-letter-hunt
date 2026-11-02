type Mood = 'menu' | 'training' | 'boss' | 'ending';

/** Original, entirely synthesized audio. No samples, downloads, or external assets. */
export class AudioSystem {
  private context?: AudioContext;
  private master?: GainNode;
  private ambience?: GainNode;
  private drones: OscillatorNode[] = [];
  private muted = false;
  private volume = 0.55;
  private noise?: AudioBuffer;
  private mood: Mood = 'menu';
  private lastStep = 0;
  private clock = 0;
  private nextBell = 4;

  async unlock(): Promise<void> {
    try {
      if (!this.context) {
        const ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!ctor) return;
        const context = this.context = new ctor();
        this.master = context.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        const compressor = context.createDynamicsCompressor();
        compressor.threshold.value = -12;
        compressor.knee.value = 14;
        compressor.ratio.value = 5;
        this.master.connect(compressor);
        compressor.connect(context.destination);
        this.noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const data = this.noise.getChannelData(0);
        // Deterministic, original noise; not an external sound recording.
        let seed = 0x5ea1;
        for (let i = 0; i < data.length; i++) {
          seed = (seed * 1664525 + 1013904223) >>> 0;
          data[i] = (seed / 0xffffffff) * 2 - 1;
        }
        this.startAmbience();
      }
      if (this.context.state === 'suspended') await this.context.resume();
    } catch {
      // Sound is optional on devices with restricted Web Audio. Gameplay remains usable.
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyVolume();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.applyVolume();
  }

  get isMuted(): boolean { return this.muted; }

  play(name: string): void {
    const context = this.context;
    if (!context || context.state !== 'running' || this.muted) return;
    const now = context.currentTime;
    switch (name) {
      case 'sword':
        this.burst(0.12, 0.19, 2200, 'highpass');
        this.tone(330, 90, 0.1, 0.07, 'triangle');
        break;
      case 'hit':
        this.burst(0.09, 0.25, 1500, 'bandpass');
        this.tone(175, 48, 0.13, 0.2, 'triangle');
        this.tone(910, 560, 0.09, 0.055, 'sine');
        break;
      case 'hurt':
        this.burst(0.18, 0.22, 380, 'lowpass');
        this.tone(115, 39, 0.26, 0.24, 'sawtooth');
        break;
      case 'dodge':
        this.burst(0.2, 0.12, 850, 'bandpass');
        break;
      case 'dragon':
        this.burst(0.65, 0.3, 950, 'lowpass');
        this.tone(61, 150, 0.5, 0.23, 'sawtooth');
        this.tone(99, 44, 0.7, 0.18, 'triangle');
        break;
      case 'seal':
        [220, 330, 440, 660].forEach((frequency, index) => {
          this.tone(frequency, frequency * 1.005, 1.0, 0.12 / (index + 1), 'sine', index * 0.045);
        });
        this.burst(0.45, 0.08, 2800, 'highpass');
        break;
      case 'phase':
        this.tone(42, 38, 1.8, 0.25, 'sawtooth');
        this.tone(82, 60, 1.5, 0.18, 'triangle');
        this.burst(0.7, 0.23, 500, 'lowpass');
        break;
      case 'death':
        this.tone(120, 25, 1.5, 0.24, 'sawtooth');
        this.burst(1.1, 0.28, 700, 'lowpass');
        break;
      case 'step':
        if (now - this.lastStep < 0.22) return;
        this.lastStep = now;
        this.burst(0.055, 0.07, 600, 'lowpass');
        break;
      case 'click':
        this.tone(440, 280, 0.09, 0.06, 'triangle');
        break;
    }
  }

  update(dt: number, mood: Mood): void {
    this.clock += Math.min(dt, 0.1);
    if (mood !== this.mood) {
      this.mood = mood;
      const root = mood === 'boss' ? 43.65 : mood === 'ending' ? 65.41 : 48.99;
      this.drones.forEach((oscillator, i) => {
        oscillator.frequency.setTargetAtTime(root * [1, 1.5, 2.003][i], this.context!.currentTime, 1.4);
      });
    }
    if (this.clock >= this.nextBell) {
      this.nextBell = this.clock + (mood === 'boss' ? 8 : 13);
      if (this.context?.state === 'running' && !this.muted) {
        const frequency = mood === 'ending' ? 261.63 : mood === 'boss' ? 130.81 : 146.83;
        this.tone(frequency, frequency * 0.999, 3.4, 0.025, 'sine');
        this.tone(frequency * 2.75, frequency * 2.74, 2.4, 0.01, 'sine', 0.05);
      }
    }
  }

  private applyVolume(): void {
    if (this.context && this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.context.currentTime, 0.04);
  }

  private startAmbience(): void {
    const context = this.context!;
    this.ambience = context.createGain();
    this.ambience.gain.value = 0.032;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 320;
    this.ambience.connect(filter);
    filter.connect(this.master!);
    const root = this.mood === 'boss' ? 43.65 : this.mood === 'ending' ? 65.41 : 48.99;
    [root, root * 1.5, root * 2.003].forEach((frequency, i) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = i === 0 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.value = [0.8, 0.4, 0.2][i];
      oscillator.connect(gain);
      gain.connect(this.ambience!);
      oscillator.start();
      this.drones.push(oscillator);
    });
  }

  private tone(from: number, to: number, duration: number, amplitude: number, type: OscillatorType, delay = 0): void {
    const context = this.context!;
    const start = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(1, from), start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, to), start + duration);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(amplitude, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain);
    gain.connect(this.master!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  private burst(duration: number, amplitude: number, frequency: number, type: BiquadFilterType): void {
    if (!this.noise) return;
    const context = this.context!;
    const start = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = this.noise;
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = type === 'bandpass' ? 0.7 : 1;
    gain.gain.setValueAtTime(amplitude, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.master!);
    source.start(start);
    source.stop(start + duration + 0.02);
  }
}

export const audio = new AudioSystem();
