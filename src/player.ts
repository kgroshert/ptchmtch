import type { NoteEvent, Score } from "./score";

/** Playback sounds: piano and choir are recorded, the others synthesised. */
export type Instrument = "piano" | "soft" | "organ" | "strings" | "choir";

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: "piano", label: "Piano" },
  { id: "soft", label: "Soft tone" },
  { id: "organ", label: "Organ" },
  { id: "strings", label: "Strings" },
  { id: "choir", label: "Choir “aah”" },
];

/** A saved sound, mapped onto the current list (older versions had more choir sounds). */
export function toInstrument(x: unknown): Instrument {
  if (x === "choirAah") return "choir";
  return INSTRUMENTS.some((i) => i.id === x) ? (x as Instrument) : "piano";
}

/** A recorded instrument: one file per sampled note (named by MIDI number); notes in between are re-pitched. */
interface SampleSet {
  dir: string;
  notes: number[];
  /** Matches the samples' loudness to the synthesised sounds. */
  gain: number;
  /** Fade-out when a note ends, in seconds (time constant). */
  release: number;
  /** For sounds that hold steady: a stretch [start, end] in seconds that loops for longer notes. */
  loop?: [number, number];
  /** Evens out the recordings' loudness, measured on their attack (for struck sounds). */
  normalize?: boolean;
}

const range = (from: number, to: number, step = 1) => Array.from({ length: Math.floor((to - from) / step) + 1 }, (_, i) => from + i * step);

const SAMPLES: Partial<Record<Instrument, SampleSet>> = {
  // Salamander Grand Piano (Alexander Holm, CC BY 3.0), as prepared by Tone.js: every 3rd note, A1–C7.
  piano: { dir: "piano", notes: range(33, 96, 3), gain: 4.2, release: 0.1, normalize: true },
  // FluidR3 General MIDI "Choir Aahs" (Frank Wen, CC BY 3.0), via midi-js-soundfonts: every note, C2–C7.
  choir: { dir: "choir-aah", notes: range(36, 96), gain: 17, release: 0.12, loop: [0.8, 3.0] },
};
const LOOP_FADE = 0.3;

export interface PlayOptions {
  tracks: { key: string; events: NoteEvent[]; gain: number; instrument: Instrument }[];
  startBeat: number;
  endBeat: number;
  loop: boolean;
  /** Playback speed relative to the notated tempo (1 = as written). */
  speed: number;
  countIn: boolean;
  /** MIDI note to sound during the count-in so the singer gets their starting pitch. */
  referenceMidi: number | null;
  /** Sound of the reference pitch during the count-in. */
  referenceInstrument?: Instrument;
  metronome: boolean;
  /** Start the first pass here instead of at `startBeat` (continuing after a stop); later passes start at `startBeat`. */
  resumeBeat?: number;
}

/** Where the transport is at a given AudioContext time. */
export type Position =
  | { kind: "countIn"; beatsLeft: number }
  | { kind: "playing"; pass: number; beat: number }
  | { kind: "ended" };

interface Scheduled {
  at: number; // seconds from pass start
  dur: number;
  midi: number;
  node: GainNode | null; // null = metronome click
  instrument?: Instrument;
  accent?: boolean;
}

const LOOKAHEAD = 0.25;

interface Formant {
  freq: number;
  bw: number;
  amp: number;
}
/** Vowel resonances (averaged over voice types), for the synthesised stand-in for the choir. */
const VOWEL_AH: Formant[] = [
  { freq: 730, bw: 90, amp: 1 },
  { freq: 1150, bw: 110, amp: 0.55 },
  { freq: 2600, bw: 160, amp: 0.12 },
];

export class Player {
  readonly ctx: AudioContext;
  private out: GainNode;
  private bus: GainNode | null = null;
  private trackGains = new Map<string, GainNode>();
  private timer = 0;
  private items: Scheduled[] = [];
  private pointer = 0;
  private schedPass = 0;
  private firstPassAt = 0;
  private passDur = 0;
  /** Seconds into the first pass where playback begins (resuming), 0 otherwise. */
  private offset = 0;
  private opts: PlayOptions | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private sampleBuffers = new Map<SampleSet, Map<number, AudioBuffer>>();
  private sampleLoading = new Map<SampleSet, Promise<void>>();

  constructor(private score: Score) {
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(comp).connect(this.ctx.destination);
  }

  get playing(): boolean {
    return this.opts !== null;
  }

  /** Seconds between scheduling a sound and it reaching the speakers. */
  get outputLatency(): number {
    return (this.ctx as AudioContext & { outputLatency?: number }).outputLatency || this.ctx.baseLatency || 0;
  }

  setTrackGain(key: string, gain: number): void {
    const g = this.trackGains.get(key);
    if (g) g.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.03);
    const t = this.opts?.tracks.find((t) => t.key === key);
    if (t) t.gain = gain;
  }

  /** Changes a part's sound from the next note on. */
  setTrackInstrument(key: string, instrument: Instrument): void {
    const node = this.trackGains.get(key);
    if (!node) return;
    for (const it of this.items) if (it.node === node) it.instrument = instrument;
    const t = this.opts?.tracks.find((t) => t.key === key);
    if (t) t.instrument = instrument;
  }

  /** Loads an instrument's samples (once); until they are in, it is synthesised. */
  loadSamples(instrument: Instrument): Promise<void> {
    const set = SAMPLES[instrument];
    if (!set) return Promise.resolve();
    let p = this.sampleLoading.get(set);
    if (!p) {
      const bufs = new Map<number, AudioBuffer>();
      this.sampleBuffers.set(set, bufs);
      p = Promise.all(
        set.notes.map(async (midi) => {
          try {
            const res = await fetch(`${import.meta.env.BASE_URL}samples/${set.dir}/${midi}.mp3`);
            const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
            if (set.normalize) normalizeAttack(buf);
            bufs.set(midi, set.loop ? loopable(this.ctx, buf, set.loop) : buf);
          } catch {
            /* notes near this one are synthesised */
          }
        }),
      ).then(() => undefined);
      this.sampleLoading.set(set, p);
    }
    return p;
  }

  async play(opts: PlayOptions): Promise<void> {
    this.stop();
    await this.ctx.resume();
    const used = new Set([...opts.tracks.map((t) => t.instrument), opts.referenceInstrument ?? "soft"]);
    await Promise.race([Promise.all([...used].map((i) => this.loadSamples(i))), new Promise((r) => setTimeout(r, 3000))]);
    this.opts = opts;
    const { score } = this;
    const ctx = this.ctx;

    this.bus = ctx.createGain();
    this.bus.connect(this.out);
    this.trackGains.clear();
    for (const t of opts.tracks) {
      const g = ctx.createGain();
      g.gain.value = t.gain;
      g.connect(this.bus);
      this.trackGains.set(t.key, g);
    }

    const t0 = score.beatToSec(opts.startBeat);
    const toPass = (beat: number) => (score.beatToSec(beat) - t0) / opts.speed;
    this.passDur = toPass(opts.endBeat);

    const items: Scheduled[] = [];
    for (const t of opts.tracks) {
      const node = this.trackGains.get(t.key)!;
      for (const ev of t.events) {
        if (ev.end <= opts.startBeat || ev.start >= opts.endBeat) continue;
        const s = Math.max(ev.start, opts.startBeat);
        const e = Math.min(ev.end, opts.endBeat);
        items.push({ at: toPass(s), dur: toPass(e) - toPass(s), midi: ev.midi, node, instrument: t.instrument });
      }
    }
    if (opts.metronome) {
      for (const m of score.measures) {
        for (let k = 0; k < m.beatsPerBar; k++) {
          const b = m.start + k * m.beatLength;
          if (b >= opts.startBeat - 1e-6 && b < opts.endBeat - 1e-6)
            items.push({ at: toPass(b), dur: 0.05, midi: 0, node: null, accent: k === 0 });
        }
      }
    }
    items.sort((a, b) => a.at - b.at);
    this.items = items;
    const from = Math.min(Math.max(opts.resumeBeat ?? opts.startBeat, opts.startBeat), opts.endBeat);
    this.offset = toPass(from);
    this.pointer = items.findIndex((it) => it.at >= this.offset - 1e-6);
    if (this.pointer < 0) this.pointer = items.length;
    this.schedPass = 0;

    // Count-in: one bar of clicks at the starting tempo, optionally over the reference pitch.
    const start = ctx.currentTime + 0.12;
    let countInDur = 0;
    if (opts.countIn) {
      const m = score.measureAt(from);
      const beatSec = (m.beatLength * 60) / m.bpm / opts.speed;
      countInDur = beatSec * m.beatsPerBar;
      for (let k = 0; k < m.beatsPerBar; k++) this.click(start + k * beatSec, k === 0);
      if (opts.referenceMidi !== null)
        this.tone(opts.referenceMidi, start, countInDur - 0.08, this.bus, 0.16, opts.referenceInstrument);
    }
    this.firstPassAt = start + countInDur - this.offset;
    // When resuming, notes already sounding at the resume point play their remainder.
    for (const it of items.slice(0, this.pointer)) {
      const left = it.at + it.dur - this.offset;
      if (it.node && left > 0.05) this.tone(it.midi, start + countInDur, left, it.node, 0.22, it.instrument);
    }

    this.tick();
    this.timer = window.setInterval(() => this.tick(), 30);
  }

  stop(): void {
    window.clearInterval(this.timer);
    this.opts = null;
    const bus = this.bus;
    if (bus) {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
      setTimeout(() => bus.disconnect(), 150);
    }
    for (const s of this.sources) {
      try {
        s.stop(this.ctx.currentTime + 0.1);
      } catch {
        /* already stopped */
      }
    }
    this.sources = [];
    this.bus = null;
  }

  /** Maps an AudioContext time (as scheduled, before output latency) to a transport position. */
  positionAt(time: number): Position {
    const o = this.opts;
    if (!o) return { kind: "ended" };
    const elapsed = time - this.firstPassAt;
    if (elapsed < this.offset) {
      const m = this.score.measureAt(o.resumeBeat ?? o.startBeat);
      return { kind: "countIn", beatsLeft: Math.ceil((this.offset - elapsed) / ((m.beatLength * 60) / m.bpm / o.speed)) };
    }
    const pass = Math.floor(elapsed / this.passDur);
    if (!o.loop && pass >= 1) return { kind: "ended" };
    const within = elapsed - pass * this.passDur;
    const beat = this.score.secToBeat(this.score.beatToSec(o.startBeat) + within * o.speed);
    return { kind: "playing", pass, beat: Math.min(beat, o.endBeat) };
  }

  private tick(): void {
    const o = this.opts;
    if (!o || !this.bus) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD;
    for (;;) {
      const passAt = this.firstPassAt + this.schedPass * this.passDur;
      if (this.pointer >= this.items.length) {
        if (!o.loop || this.passDur <= 0) break;
        if (passAt + this.passDur > horizon) break;
        this.schedPass++;
        this.pointer = 0;
        continue;
      }
      const it = this.items[this.pointer];
      const at = passAt + it.at;
      if (at > horizon) break;
      this.pointer++;
      if (at < this.ctx.currentTime - 0.05) continue;
      if (it.node) this.tone(it.midi, at, it.dur, it.node, 0.22, it.instrument);
      else this.click(at, !!it.accent);
    }
  }

  /**
   * Plays `countIn` clicks, then `beats` short notes with clicks, at `bpm`.
   * Returns the scheduled times of the notes, for latency calibration.
   */
  async playCalibration(midi: number, bpm: number, countIn: number, beats: number): Promise<number[]> {
    this.stop();
    await this.ctx.resume();
    this.bus = this.ctx.createGain();
    this.bus.connect(this.out);
    const beat = 60 / bpm;
    const start = this.ctx.currentTime + 0.3;
    const targets: number[] = [];
    for (let i = 0; i < countIn + beats; i++) {
      const t = start + i * beat;
      this.click(t, i % 4 === 0);
      if (i >= countIn) {
        this.tone(midi, t, beat * 0.4, this.bus, 0.2);
        targets.push(t);
      }
    }
    return targets;
  }

  /**
   * Plays notes (a MIDI number, or several for a chord) at times in seconds from now. Returns the
   * AudioContext time when the last one ends, and a function that silences them.
   */
  playNotes(notes: { midi: number | number[]; start: number; dur: number }[], instrument: Instrument, vel = 0.2): { end: number; stop: () => void } {
    void this.ctx.resume();
    const bus = this.ctx.createGain();
    bus.connect(this.out);
    const t0 = this.ctx.currentTime + 0.08;
    let end = t0;
    for (const n of notes) {
      const midis = Array.isArray(n.midi) ? n.midi : [n.midi];
      for (const m of midis) this.tone(m, t0 + n.start, n.dur, bus, midis.length > 1 ? vel * 0.6 : vel, instrument);
      end = Math.max(end, t0 + n.start + n.dur);
    }
    return {
      end,
      stop: () => {
        bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
        setTimeout(() => bus.disconnect(), 300);
      },
    };
  }

  /** Starts a steady reference tone; call the returned function to stop it. */
  sustain(midi: number, instrument: Instrument = "soft"): () => void {
    void this.ctx.resume();
    const bus = this.ctx.createGain();
    bus.connect(this.out);
    // A piano note dies away, which is no use as a held reference.
    this.tone(midi, this.ctx.currentTime + 0.02, 3600, bus, 0.2, instrument === "piano" ? "soft" : instrument);
    return () => {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      setTimeout(() => bus.disconnect(), 200);
    };
  }

  private tone(midi: number, at: number, dur: number, dest: AudioNode, vel: number, instrument: Instrument = "soft"): void {
    const f = 440 * 2 ** ((midi - 69) / 12);
    const end = at + Math.max(0.06, dur - 0.025);
    switch (instrument) {
      case "piano":
        if (this.sampled(SAMPLES.piano!, midi, at, end, dest, vel)) return;
        void this.loadSamples("piano");
        return this.piano(f, at, end, dest, vel);
      case "organ":
        return this.additive(f, at, end, dest, vel * 0.52, [[1, 1], [2, 0.5], [3, 0.25], [4, 0.2], [6, 0.08]], 0.01, 0.05);
      case "strings":
        return this.filtered(f, at, end, dest, vel * 0.95, "sawtooth", [{ type: "lowpass", freq: Math.min(5000, f * 5), q: 0.8 }], 0.09, 0.18, 0.004);
      case "choir":
        if (this.sampled(SAMPLES.choir!, midi, at, end, dest, vel)) return;
        void this.loadSamples("choir");
        return this.choir(f, at, end, dest, vel * 1.7, VOWEL_AH);
      default: {
        // The original soft tone: triangle with a little 2nd and 3rd harmonic.
        const env = this.envelope(at, end, vel, 0.02, 0.035, 0.7);
        const lp = this.ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = Math.min(4000, f * 6);
        lp.connect(env).connect(dest);
        this.osc("triangle", f, 1, at, end + 0.25, lp);
        this.osc("sine", f * 2, 0.22, at, end + 0.25, lp);
        this.osc("sine", f * 3, 0.06, at, end + 0.25, lp);
      }
    }
  }

  /** Attack to `vel`, settle to `vel * sustain`, release at `end`. */
  private envelope(at: number, end: number, vel: number, attack: number, release: number, sustain = 1): GainNode {
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(vel, at + attack);
    if (sustain < 1) env.gain.setTargetAtTime(vel * sustain, at + attack, 0.2);
    env.gain.setTargetAtTime(0, Math.max(end, at + attack), release);
    return env;
  }

  private osc(type: OscillatorType, freq: number, amp: number, at: number, stop: number, dest: AudioNode, vibrato = 0): OscillatorNode {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    if (vibrato) {
      // Gentle vibrato that fades in, as players and singers do on held notes.
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 5.2;
      const depth = this.ctx.createGain();
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(freq * vibrato, at + 0.5);
      lfo.connect(depth).connect(o.frequency);
      lfo.start(at);
      lfo.stop(stop);
      this.track(lfo);
    }
    const g = this.ctx.createGain();
    g.gain.value = amp;
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(stop);
    this.track(o);
    return o;
  }

  /** Sine partials [multiple, amplitude] under one envelope. */
  private additive(f: number, at: number, end: number, dest: AudioNode, vel: number, partials: [number, number][], attack: number, release: number): void {
    const env = this.envelope(at, end, vel, attack, release);
    env.connect(dest);
    for (const [mult, amp] of partials) if (f * mult < 12000) this.osc("sine", f * mult, amp, at, end + release * 6, env);
  }

  /** One oscillator through filters (in parallel), with vibrato. */
  private filtered(
    f: number,
    at: number,
    end: number,
    dest: AudioNode,
    vel: number,
    type: OscillatorType,
    filters: { type: BiquadFilterType; freq: number; q: number; gain?: number }[],
    attack: number,
    release: number,
    vibrato: number,
  ): void {
    const env = this.envelope(at, end, vel, attack, release);
    env.connect(dest);
    const src = this.ctx.createGain();
    for (const fl of filters) {
      const bq = this.ctx.createBiquadFilter();
      bq.type = fl.type;
      bq.frequency.value = fl.freq;
      bq.Q.value = fl.q;
      const g = this.ctx.createGain();
      g.gain.value = fl.gain ?? 1;
      src.connect(bq).connect(g).connect(env);
    }
    this.osc(type, f, 1, at, end + release * 6, src, vibrato);
  }

  /**
   * A few voices singing a vowel: each a waveform whose harmonics follow the vowel's formants
   * (built per note, so the fundamental is kept on high notes), slightly detuned against each
   * other, with its own gentle vibrato.
   */
  private choir(f: number, at: number, end: number, dest: AudioNode, vel: number, vowel: Formant[]): void {
    const ctx = this.ctx;
    const attack = 0.12;
    const release = 0.22;
    const env = this.envelope(at, end, vel, attack, release);
    env.connect(dest);
    // Singers raise the first formant to the note when singing above it.
    const formants = vowel.map((fm, i) => (i === 0 ? { ...fm, freq: Math.max(fm.freq, f * 1.05) } : fm));
    const H = Math.max(1, Math.min(40, Math.floor(5000 / f)));
    const real = new Float32Array(H + 1);
    const imag = new Float32Array(H + 1);
    for (let h = 1; h <= H; h++) {
      const hz = h * f;
      let a = 0.02;
      for (const fm of formants) a += fm.amp / (1 + ((hz - fm.freq) / fm.bw) ** 2);
      imag[h] = a / h ** 0.6; // glottal source slope, then the vowel's resonances
    }
    const wave = ctx.createPeriodicWave(real, imag);
    const stop = end + release * 6;
    const detunes = [-9, 0, 8]; // cents
    detunes.forEach((cents, i) => {
      const o = ctx.createOscillator();
      o.setPeriodicWave(wave);
      o.frequency.value = f;
      o.detune.value = cents;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 4.8 + i * 0.37;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0, at);
      depth.gain.linearRampToValueAtTime(14, at + 0.6); // ±14 cents
      lfo.connect(depth).connect(o.detune);
      const g = ctx.createGain();
      g.gain.value = 1 / detunes.length;
      o.connect(g).connect(env);
      o.start(at);
      o.stop(stop);
      lfo.start(at);
      lfo.stop(stop);
      this.track(o);
      this.track(lfo);
    });
  }

  /** Plays the nearest sample of a set, re-pitched to `midi`; false if it isn't loaded. */
  private sampled(set: SampleSet, midi: number, at: number, end: number, dest: AudioNode, vel: number): boolean {
    const near = set.notes.reduce((a, b) => (Math.abs(b - midi) < Math.abs(a - midi) ? b : a));
    const buf = this.sampleBuffers.get(set)?.get(near);
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 2 ** ((midi - near) / 12);
    if (set.loop) {
      src.loop = true;
      [src.loopStart, src.loopEnd] = set.loop;
    }
    // The recording has its own attack; only the end is shaped (a damper, or the voices stopping).
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(vel * set.gain, at);
    env.gain.setTargetAtTime(0, end, set.release);
    src.connect(env).connect(dest);
    src.start(at);
    src.stop(Math.min(end + set.release * 8, at + (set.loop ? Infinity : buf.duration / src.playbackRate.value)));
    this.track(src);
    return true;
  }

  /** Struck string: slightly stretched partials, each dying away, higher ones faster. */
  private piano(f: number, at: number, end: number, dest: AudioNode, vel: number): void {
    const ctx = this.ctx;
    // Low notes ring longer than high ones.
    const decay = Math.max(0.35, Math.min(2.5, 2.2 * (220 / f) ** 0.5));
    const out = ctx.createGain();
    out.gain.setValueAtTime(1, at);
    out.gain.setTargetAtTime(0, Math.max(end, at + 0.03), 0.08); // damper at note end
    out.connect(dest);
    const B = 0.0004; // inharmonicity
    const amps = [1, 0.55, 0.3, 0.22, 0.12, 0.08, 0.05];
    const stop = Math.min(end + 0.6, at + decay * 6);
    amps.forEach((amp, i) => {
      const h = i + 1;
      const fh = f * h * Math.sqrt(1 + B * h * h);
      if (fh > 10000) return;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(vel * 0.75 * amp, at + 0.004);
      g.gain.setTargetAtTime(0, at + 0.004, decay / h ** 0.6);
      g.connect(out);
      const o = ctx.createOscillator();
      o.frequency.value = fh;
      o.connect(g);
      o.start(at);
      o.stop(stop);
      this.track(o);
    });
  }

  private click(at: number, accent: boolean): void {
    if (!this.bus) return;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = accent ? 1760 : 1320;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(accent ? 0.35 : 0.2, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + 0.05);
    osc.connect(g).connect(this.bus);
    osc.start(at);
    osc.stop(at + 0.06);
    this.track(osc);
  }

  private track(src: AudioScheduledSourceNode): void {
    this.sources.push(src);
    src.onended = () => {
      const i = this.sources.indexOf(src);
      if (i >= 0) this.sources.splice(i, 1);
    };
  }
}

/**
 * A copy of a sample whose stretch loopStart–loopEnd loops without a click: its last LOOP_FADE
 * seconds are faded into the sound just before loopStart, so the end leads straight into the start.
 */
function loopable(ctx: BaseAudioContext, buf: AudioBuffer, [loopStart, loopEnd]: [number, number]): AudioBuffer {
  const sr = buf.sampleRate;
  const end = Math.min(buf.length, Math.round(loopEnd * sr));
  const span = end - Math.round(loopStart * sr);
  const fade = Math.round(LOOP_FADE * sr);
  const out = ctx.createBuffer(buf.numberOfChannels, end, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c);
    const dst = out.getChannelData(c);
    dst.set(src.subarray(0, end));
    for (let i = end - fade; i < end; i++) {
      const w = (i - (end - fade)) / fade;
      dst[i] = src[i] * Math.sqrt(1 - w) + src[i - span] * Math.sqrt(w);
    }
  }
  return out;
}

/** Scales a recording so the loudness of its first 0.15 s from the loudest point is the same for every note. */
function normalizeAttack(buf: AudioBuffer): void {
  const d0 = buf.getChannelData(0);
  let peak = 0;
  for (let i = 0; i < d0.length; i++) if (Math.abs(d0[i]) > Math.abs(d0[peak])) peak = i;
  const n = Math.min(d0.length - peak, Math.round(0.15 * buf.sampleRate));
  let sum = 0;
  for (let i = peak; i < peak + n; i++) sum += d0[i] * d0[i];
  const rms = Math.sqrt(sum / Math.max(1, n));
  if (rms < 1e-4) return;
  const k = 0.1 / rms;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
  }
}
