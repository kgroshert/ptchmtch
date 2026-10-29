import type { NoteEvent, Score } from "./score";

export interface PlayOptions {
  tracks: { key: string; events: NoteEvent[]; gain: number }[];
  startBeat: number;
  endBeat: number;
  loop: boolean;
  /** Playback speed relative to the notated tempo (1 = as written). */
  speed: number;
  countIn: boolean;
  /** MIDI note to sound during the count-in so the singer gets their starting pitch. */
  referenceMidi: number | null;
  metronome: boolean;
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
  accent?: boolean;
}

const LOOKAHEAD = 0.25;

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
  private opts: PlayOptions | null = null;
  private sources: AudioScheduledSourceNode[] = [];

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

  async play(opts: PlayOptions): Promise<void> {
    this.stop();
    await this.ctx.resume();
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
        items.push({ at: toPass(s), dur: toPass(e) - toPass(s), midi: ev.midi, node });
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
    this.pointer = 0;
    this.schedPass = 0;

    // Count-in: one bar of clicks at the starting tempo, optionally over the reference pitch.
    const start = ctx.currentTime + 0.12;
    let countInDur = 0;
    if (opts.countIn) {
      const m = score.measureAt(opts.startBeat);
      const beatSec = (m.beatLength * 60) / m.bpm / opts.speed;
      countInDur = beatSec * m.beatsPerBar;
      for (let k = 0; k < m.beatsPerBar; k++) this.click(start + k * beatSec, k === 0);
      if (opts.referenceMidi !== null) this.tone(opts.referenceMidi, start, countInDur - 0.08, this.bus, 0.16);
    }
    this.firstPassAt = start + countInDur;

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
    if (elapsed < 0) {
      const m = this.score.measureAt(o.startBeat);
      return { kind: "countIn", beatsLeft: Math.ceil(-elapsed / ((m.beatLength * 60) / m.bpm / o.speed)) };
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
      if (it.node) this.tone(it.midi, at, it.dur, it.node, 0.22);
      else this.click(at, !!it.accent);
    }
  }

  /** Starts a steady reference tone; call the returned function to stop it. */
  sustain(midi: number): () => void {
    void this.ctx.resume();
    const bus = this.ctx.createGain();
    bus.connect(this.out);
    this.tone(midi, this.ctx.currentTime + 0.02, 3600, bus, 0.2);
    return () => {
      bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
      setTimeout(() => bus.disconnect(), 200);
    };
  }

  private tone(midi: number, at: number, dur: number, dest: AudioNode, vel: number): void {
    const ctx = this.ctx;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const end = at + Math.max(0.06, dur - 0.025);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(vel, at + 0.02);
    env.gain.setTargetAtTime(vel * 0.7, at + 0.02, 0.2);
    env.gain.setTargetAtTime(0, end, 0.035);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = Math.min(4000, f * 6);
    lp.connect(env).connect(dest);

    const partials: [OscillatorType, number, number][] = [
      ["triangle", 1, 1],
      ["sine", 2, 0.22],
      ["sine", 3, 0.06],
    ];
    for (const [type, mult, amp] of partials) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f * mult;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g).connect(lp);
      osc.start(at);
      osc.stop(end + 0.25);
      this.track(osc);
    }
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
