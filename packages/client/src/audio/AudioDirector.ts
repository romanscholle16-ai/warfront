/**
 * Procedural soundtrack and feedback sounds — no downloaded assets, licences or
 * battery-heavy audio files. Sound begins only after a player gesture.
 *
 * Two buses (music and effects) feed one master, so volume and muting can be
 * balanced independently from the in-match settings menu. Preferences persist.
 *
 * The soundtrack is synthesised ONCE into a short AudioBuffer and looped with a
 * single BufferSourceNode. Buffer looping is sample-accurate and glitch-free —
 * no interval drift, no node churn, nothing queued into the past. That replaces
 * the old design (dozens of WebAudio nodes re-scheduled on a setInterval every
 * ~2s), which stuttered and died on every load.
 */

interface AudioSettings {
  musicVolume: number;
  sfxVolume: number;
  musicMuted: boolean;
  sfxMuted: boolean;
}

const DEFAULT_SETTINGS: AudioSettings = {
  musicVolume: 1,
  sfxVolume: 1,
  musicMuted: false,
  sfxMuted: false,
};

const STORAGE_KEY = 'warfront.audio';

function loadSettings(): AudioSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<AudioSettings>) };
  } catch {
    // Corrupt settings are not worth a crash — start fresh.
  }
  return { ...DEFAULT_SETTINGS };
}

export type SfxKind = 'build' | 'train' | 'move' | 'research';

export class AudioDirector {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private mode: 'menu' | 'game' | null = null;
  /** The single looping source currently playing the soundtrack, if any. */
  private loopSource: AudioBufferSourceNode | null = null;
  /** Rendered phrases, cached per mode so restarts never re-synthesise. */
  private loopBuffers = new Map<'menu' | 'game', AudioBuffer>();
  /** SFX nodes still ringing — stopped when the soundtrack restarts. */
  private active = new Set<OscillatorNode | AudioBufferSourceNode>();
  private settings = loadSettings();

  get musicVolume(): number { return this.settings.musicVolume; }
  get sfxVolume(): number { return this.settings.sfxVolume; }
  get musicMuted(): boolean { return this.settings.musicMuted; }
  get sfxMuted(): boolean { return this.settings.sfxMuted; }

  unlock(): void {
    if (this.context) {
      // resume() can reject on some browsers; an unhandled rejection must never
      // surface as an error in the game console.
      void this.context.resume().catch(() => undefined);
      return;
    }
    try {
      const context = new AudioContext();
      this.context = context;
      const master = context.createGain();
      master.connect(context.destination);
      this.master = master;
      const musicBus = context.createGain();
      const sfxBus = context.createGain();
      musicBus.connect(master);
      sfxBus.connect(master);
      this.musicBus = musicBus;
      this.sfxBus = sfxBus;

      // One shared noise buffer for drum/percussion effects.
      const length = Math.floor(context.sampleRate * 0.4);
      const buffer = context.createBuffer(1, length, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
      this.noiseBuffer = buffer;

      // Warm the soundtrack caches now — a ~30s march costs a few tens of ms to
      // render, so doing it at gesture time beats paying on the match-boot hot
      // path. startLoop still falls back to a lazy render if this ever fails, so
      // a render error here must not take the whole context down with it.
      try {
        const menuLoop = this.renderLoop('menu');
        const gameLoop = this.renderLoop('game');
        if (menuLoop) this.loopBuffers.set('menu', menuLoop);
        if (gameLoop) this.loopBuffers.set('game', gameLoop);
      } catch {
        // Rendered lazily by startLoop on first use.
      }

      this.apply();
    } catch (error) {
      // Web Audio is unavailable (policy, device limit, or a broken context).
      // Degrade to silence rather than throwing into the game-boot path, but say
      // something so device-specific failures are diagnosable.
      console.warn('Warfront audio unavailable — running silent.', error);
      this.context = null;
      this.master = null;
      this.musicBus = null;
      this.sfxBus = null;
      this.noiseBuffer = null;
      this.loopSource = null;
      this.loopBuffers.clear();
      this.active.clear();
    }
  }

  playMenu(): void { this.start('menu'); }
  playGame(): void { this.start('game'); }

  /** Stop the soundtrack while the app is backgrounded (battery). */
  suspend(): void {
    this.stopLoop();
  }

  /** Restart the soundtrack for the current mode after returning to the foreground. */
  resume(): void {
    if (this.mode) this.start(this.mode);
  }

  // ── settings (shared with the in-match menu) ─────────────────────────────

  setMusicVolume(value: number): void {
    this.settings.musicVolume = Math.min(1, Math.max(0, value));
    this.save();
    this.apply();
  }

  setSfxVolume(value: number): void {
    this.settings.sfxVolume = Math.min(1, Math.max(0, value));
    this.save();
    this.apply();
  }

  setMusicMuted(muted: boolean): void {
    this.settings.musicMuted = muted;
    this.save();
    this.apply();
  }

  setSfxMuted(muted: boolean): void {
    this.settings.sfxMuted = muted;
    this.save();
    this.apply();
  }

  /** One-shot feedback sound mapped to the action that produced it. */
  effect(kind: SfxKind): void {
    switch (kind) {
      case 'build': return this.purchase();
      case 'train': return this.troops(true);
      case 'move': return this.troops(false);
      case 'research': return this.research();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Storage can be unavailable in private browsing; sound still works.
    }
  }

  private apply(): void {
    const context = this.context;
    if (!context || !this.master) return;
    const now = context.currentTime;
    this.master.gain.setTargetAtTime(
      this.settings.musicMuted && this.settings.sfxMuted ? 0 : 1, now, 0.02,
    );
    this.musicBus!.gain.setTargetAtTime(
      this.settings.musicMuted ? 0 : this.settings.musicVolume, now, 0.02,
    );
    this.sfxBus!.gain.setTargetAtTime(
      this.settings.sfxMuted ? 0 : this.settings.sfxVolume, now, 0.02,
    );
  }

  // ── soundtrack ───────────────────────────────────────────────────────────

  private start(mode: 'menu' | 'game'): void {
    // Called from the state-sync hot path (startGame) — a failure must never
    // escape and break the match; degrade to silence instead.
    try {
      this.startInternal(mode);
    } catch {
      this.stopLoop();
    }
  }

  private startInternal(mode: 'menu' | 'game'): void {
    this.unlock();
    // If Web Audio is unavailable, stay silent.
    if (!this.context || !this.master) return;
    // Always restart the loop — this also makes repeated playGame() calls after a
    // quit-and-rejoin switch the soundtrack back to match mode reliably.
    this.mode = mode;
    this.startLoop(mode);
  }

  /** Tear down the looping source (if any) — idempotent and safe to over-call. */
  private stopLoop(): void {
    if (this.loopSource) {
      try { this.loopSource.stop(); } catch { /* already stopped */ }
      try { this.loopSource.disconnect(); } catch { /* noop */ }
      this.loopSource = null;
    }
  }

  /** Start (or restart) the pre-rendered phrase for the given mode. */
  private startLoop(mode: 'menu' | 'game'): void {
    const context = this.context;
    const bus = this.musicBus;
    if (!context || !bus) return;
    this.stopLoop();
    // Silence SFX still ringing so a restart can never stack into a rumble.
    for (const node of this.active) {
      try { node.stop(); } catch { /* already stopped itself */ }
    }
    this.active.clear();

    let buffer: AudioBuffer | null = this.loopBuffers.get(mode) ?? null;
    if (!buffer) {
      buffer = this.renderLoop(mode);
      if (!buffer) return;
      this.loopBuffers.set(mode, buffer);
    }
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(bus);
    source.start();
    this.loopSource = source;
  }

  /**
   * Synthesise one full musical phrase into a loopable AudioBuffer.
   * Menu: a sombre pre-war overture. Match: a marching battle theme — drums,
   * a low brass figure and a fast minor-key motif that reads as "to war".
   */
  private renderLoop(mode: 'menu' | 'game'): AudioBuffer | null {
    const context = this.context;
    if (!context) return null;
    const sr = context.sampleRate;
    // Menu: a two-phrase pre-war overture. Match: a 16-bar march (verse / chorus /
    // bridge / finale) so the loop has real musical shape instead of a stuck riff.
    const lengthSec = mode === 'menu' ? 4.8 : 16 * 1.92;
    const length = Math.floor(sr * lengthSec);
    const buffer = context.createBuffer(1, length, sr);
    const data = buffer.getChannelData(0);

    if (mode === 'menu') {
      // Phrase one: the sombre rising line. Phrase two: a low answering figure.
      this.addTone(data, sr, 55, 0, 0.9, 'sine', 0.15);
      this.addTone(data, sr, 49, 2.4, 0.9, 'sine', 0.13);
      const phraseA = [110, 146.8, 164.8, 196, 164.8, 146.8];
      phraseA.forEach((note, index) => this.addTone(data, sr, note, index * 0.36, 0.42, 'sine', 0.11));
      const phraseB = [98, 146.8, 123.5, 164.8, 110, 98];
      phraseB.forEach((note, index) => this.addTone(data, sr, note, 2.4 + index * 0.36, 0.42, 'sine', 0.09));
    } else {
      // ── 16-bar march in A minor ────────────────────────────────────────────
      // Bar = 8 steps of 0.24s (1.92s); the loop is ~30s. Sections:
      //   bars 0-3    verse A   (drums + riff A)
      //   bars 4-7    chorus    (full kit, hi-hat drive, harmony, riff B)
      //   bars 8-11   bridge    (drops to kick + low drone, then a snare roll build)
      //   bars 12-15  finale    (riff C returns, roll-out and resolving bass)
      const step = 0.24;
      const bar = step * 8;
      const t = (b: number, s: number): number => b * bar + s * step;
      const kick = (b: number, s: number, v = 0.2): void => this.addKick(data, sr, t(b, s), 0.14, v);
      const snare = (b: number, s: number, v = 0.12): void => this.addDrum(data, sr, t(b, s), 0.1, v);
      const hat = (b: number, s: number, v = 0.07): void => this.addHat(data, sr, t(b, s), 0.05, v);
      const tone = (
        b: number, s: number, freq: number, durSteps: number,
        type: OscillatorType = 'square', v = 0.07,
      ): void => this.addTone(data, sr, freq, t(b, s), durSteps * step, type, v);

      // Verse A: drums (kick on 1&3, snare on 2&4) + riff A.
      for (let b = 0; b < 4; b++) {
        kick(b, 0); kick(b, 4);
        snare(b, 2); snare(b, 6);
      }
      // Riff A — a stepping minor motif, two call-and-answer halves.
      const riffA = [98, 110, 130.8, 98, 110, 130.8, 146.8, 130.8];
      riffA.forEach((note, s) => tone(0, s, note, 0.9));
      riffA.forEach((note, s) => tone(1, s, note, 0.9));
      riffA.slice(0, 4).forEach((note, s) => tone(2, s, note, 0.9));
      riffA.slice(4).forEach((note, s) => tone(2, 4 + s, note, 0.9));
      riffA.forEach((note, s) => tone(3, s, note * 2, 0.9, 'square', 0.05));

      // Chorus: full kit with hi-hats, riff B an octave up, harmony third above.
      for (let b = 4; b < 8; b++) {
        kick(b, 0); kick(b, 4);
        snare(b, 2); snare(b, 6);
        hat(b, 1); hat(b, 3); hat(b, 5); hat(b, 7);
      }
      const riffB = [220, 261.6, 293.7, 329.6, 293.7, 261.6, 220, 196];
      for (let b = 4; b < 8; b++) {
        riffB.forEach((note, s) => tone(b, s, note, 0.85, 'square', 0.07));
        // Harmony a minor third above (×1.19) stays inside A natural minor — a
        // major third would drag C#/F# over the riff and break the key.
        riffB.forEach((note, s) => tone(b, s, note * 1.19, 0.85, 'triangle', 0.035));
        // Brass pulse under the chorus.
        this.addTone(data, sr, 55, t(b, 0), bar * 0.95, 'sawtooth', 0.06);
      }

      // Bridge: drop to a low drone and a faint heartbeat, then a snare roll.
      for (let b = 8; b < 12; b++) kick(b, 0, 0.14);
      for (let b = 8; b < 11; b++) this.addTone(data, sr, 41.2, t(b, 0), bar * 0.9, 'sawtooth', 0.07);
      tone(8, 2, 164.8, 0.8, 'triangle', 0.04);
      tone(9, 3, 196, 0.8, 'triangle', 0.04);
      tone(10, 2, 220, 0.8, 'triangle', 0.04);
      // Crescendo roll into the finale (bar 11).
      for (let s = 0; s < 8; s++) snare(11, s, 0.06 + s * 0.02);
      this.addTone(data, sr, 55, t(11, 4), step * 4, 'sawtooth', 0.09);

      // Finale: full kit returns, riff C, then a resolving bass fall.
      for (let b = 12; b < 16; b++) {
        kick(b, 0); kick(b, 4);
        snare(b, 2); snare(b, 6);
        hat(b, 1); hat(b, 3); hat(b, 5); hat(b, 7);
      }
      const riffC = [164.8, 196, 220, 261.6, 293.7, 261.6, 220, 196];
      for (let b = 12; b < 16; b++) riffC.forEach((note, s) => tone(b, s, note, 0.85, 'square', 0.07));
      // Low brass under the finale.
      for (let b = 12; b < 16; b++) this.addTone(data, sr, 55, t(b, 0), bar * 0.9, 'sawtooth', 0.07);
      // Resolving bass figure at the very end so the loop lands back on A.
      this.addTone(data, sr, 110, t(15, 6), step * 1.6, 'sawtooth', 0.08);
    }

    // Fade the loop edges so the seam never clicks.
    const tail = Math.min(length, Math.floor(sr * 0.006));
    for (let i = length - tail; i < length; i++) {
      data[i] = (data[i] ?? 0) * ((length - i) / tail);
    }
    for (let i = 0; i < tail; i++) data[i] = (data[i] ?? 0) * (i / tail);
    return buffer;
  }

  // ── offline synthesis helpers ────────────────────────────────────────────

  /** Add an enveloped oscillator note (band-friendly, phase-continuous). */
  private addTone(
    data: Float32Array, sr: number, frequency: number, start: number,
    duration: number, type: OscillatorType, volume: number,
  ): void {
    const startIdx = Math.max(0, Math.floor(start * sr));
    const end = Math.min(data.length, Math.floor((start + duration) * sr));
    if (end <= startIdx) return;
    const attack = Math.min(0.03, duration * 0.25);
    const release = Math.min(0.04, duration * 0.3);
    const twoPi = 2 * Math.PI;
    let phase = 0;
    for (let i = startIdx; i < end; i++) {
      const t = i / sr;
      const local = t - start;
      phase += (twoPi * frequency) / sr;
      if (phase >= twoPi) phase -= twoPi;
      const sine = Math.sin(phase);
      let sample: number;
      switch (type) {
        case 'sine': sample = sine; break;
        case 'square': sample = sine >= 0 ? 1 : -1; break;
        case 'sawtooth': sample = 2 * (phase / twoPi) - 1; break;
        case 'triangle': sample = 2 * Math.abs(2 * (phase / twoPi) - 1) - 1; break;
        default: sample = sine;
      }
      let env = 1;
      if (local < attack) env = local / attack;
      else if (local > duration - release) env = Math.max(0, (duration - local) / release);
      data[i] = (data[i] ?? 0) + sample * env * volume;
    }
  }

  /** Pitched kick drum: sine with a fast 120Hz → 40Hz pitch drop. */
  private addKick(
    data: Float32Array, sr: number, start: number, duration: number, volume: number,
  ): void {
    const startIdx = Math.max(0, Math.floor(start * sr));
    const end = Math.min(data.length, Math.floor((start + duration) * sr));
    if (end <= startIdx) return;
    const twoPi = 2 * Math.PI;
    let phase = 0;
    for (let i = startIdx; i < end; i++) {
      const t = i / sr;
      const frac = Math.min(1, (t - start) / duration);
      const frequency = 120 * Math.pow(0.33, frac);
      const env = Math.pow(1 - frac, 1.6) * volume;
      phase += (twoPi * frequency) / sr;
      if (phase >= twoPi) phase -= twoPi;
      data[i] = (data[i] ?? 0) + Math.sin(phase) * env;
    }
  }

  /** Snare-ish noise burst with a 240Hz → 60Hz low-pass sweep. */
  private addDrum(
    data: Float32Array, sr: number, start: number, duration: number, volume: number,
  ): void {
    const startIdx = Math.max(0, Math.floor(start * sr));
    const end = Math.min(data.length, Math.floor((start + duration) * sr));
    if (end <= startIdx) return;
    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 16807) % 0x7fffffff;
      if (seed === 0) seed = 1;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    let lp = 0;
    for (let i = startIdx; i < end; i++) {
      const t = i / sr;
      const frac = Math.min(1, (t - start) / duration);
      const cutoff = 240 * Math.pow(0.25, frac);
      const a = Math.min(1, (2 * Math.PI * cutoff) / sr);
      lp += a * (rnd() - lp);
      data[i] = (data[i] ?? 0) + lp * Math.pow(1 - frac, 2.2) * volume;
    }
  }

  /** Hi-hat tick: bright noise, high-passed, with a very fast decay. */
  private addHat(
    data: Float32Array, sr: number, start: number, duration: number, volume: number,
  ): void {
    const startIdx = Math.max(0, Math.floor(start * sr));
    const end = Math.min(data.length, Math.floor((start + duration) * sr));
    if (end <= startIdx) return;
    let seed = 99991;
    const rnd = (): number => {
      seed = (seed * 16807) % 0x7fffffff;
      if (seed === 0) seed = 1;
      return (seed / 0x7fffffff) * 2 - 1;
    };
    // One-pole high-pass: keep the last low-passed value and subtract it, so the
    // residual is the bright (high-frequency) part of the noise. Coefficient a is
    // solved for a −3dB point at 6kHz: a = 1 − exp(−2π·6000/sr).
    let lp = 0;
    const a = 1 - Math.exp((-2 * Math.PI * 6000) / sr);
    for (let i = startIdx; i < end; i++) {
      const t = i / sr;
      const frac = Math.min(1, (t - start) / duration);
      const x = rnd();
      lp += a * (x - lp);
      data[i] = (data[i] ?? 0) + (x - lp) * Math.pow(1 - frac, 3) * volume;
    }
  }

  // ── effects ──────────────────────────────────────────────────────────────

  /** Cashier "ka-ching": a bright two-note ring plus a high sparkle. */
  private purchase(): void {
    const context = this.context;
    if (!context) return;
    this.tone(988, 0.12, 0, 'square', 0.16, this.sfxBus);
    this.tone(1319, 0.2, 0.07, 'square', 0.16, this.sfxBus);
    this.tone(2637, 0.12, 0.02, 'sine', 0.06, this.sfxBus);
  }

  /** Troop sounds: heavy drums for training, a single march thud for movement. */
  private troops(training: boolean): void {
    const context = this.context;
    if (!context) return;
    this.drum(0, 0.22, 0.24);
    if (training) {
      this.drum(0.18, 0.2, 0.18);
      this.tone(82, 0.34, 0.02, 'sawtooth', 0.09, this.sfxBus);
    } else {
      this.tone(65, 0.26, 0.04, 'triangle', 0.13, this.sfxBus);
    }
  }

  /** Science laboratory: a rising four-note blip. */
  private research(): void {
    const context = this.context;
    if (!context) return;
    [523, 659, 784, 1047].forEach((frequency, index) => (
      this.tone(frequency, 0.09, index * 0.06, 'triangle', 0.15, this.sfxBus)
    ));
  }

  /** A filtered noise burst — the closest thing to a drum with no samples. */
  private drum(delay: number, duration: number, volume: number, bus: GainNode | null = this.sfxBus): void {
    const context = this.context;
    const buffer = this.noiseBuffer;
    if (!context || !bus || !buffer) return;
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    const start = context.currentTime + delay;
    filter.frequency.setValueAtTime(240, start);
    filter.frequency.exponentialRampToValueAtTime(60, start + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(bus);
    source.start(start);
    source.stop(start + duration + 0.05);
    this.track(source);
  }

  private tone(
    frequency: number, duration: number, delay: number,
    type: OscillatorType, volume: number, bus: GainNode | null,
  ): void {
    const context = this.context;
    if (!context || !bus) return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(bus);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
    this.track(oscillator);
  }

  /** Remember a node so a soundtrack restart can stop it before it rings out. */
  private track(node: OscillatorNode | AudioBufferSourceNode): void {
    this.active.add(node);
    node.addEventListener('ended', () => this.active.delete(node), { once: true });
  }
}
