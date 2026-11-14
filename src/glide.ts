/**
 * Support page: slow glides. Start on a low note, glide evenly up a third or a fifth and back down
 * without pausing, at your own pace. The analysis judges how even the pitch moved (against straight
 * lines between where you actually started, turned and ended), stalls and jumps, whether the top
 * and the landing were in tune, and whether the volume (breath support) stayed level.
 */
import { VOICES } from "./exercises";
import type { GlideSession } from "./history";
import { midiName } from "./pitch";
import type { DrawView, Note, SupportExercise, SupportPrefs } from "./support";
import { analyseVibrato, type Vibrato } from "./vibrato";
import { BUMP_DB, DEFAULT_GATE_DB, findLost, median, smoothDb, voicedSpan, type LostReason, type SupportFrame } from "./support-analysis";

/** A drift from the even line larger than this is flagged, cents. */
export const DRIFT_CENTS = 30;
/** Slower than this share of the leg's average speed, for STALL_SECONDS, is a stall. */
export const STALL_FRACTION = 0.25;
export const STALL_SECONDS = 0.5;
/**
 * More than JUMP_CENTS of movement within JUMP_SECONDS (beyond the glide itself) is a jump. Measured
 * on the vibrato-free pitch, so the window has to span the smoothing.
 */
export const JUMP_CENTS = 60;
export const JUMP_SECONDS = 0.4;
/** Staying at the top this long counts as a pause there. */
export const TOP_HOLD_SECONDS = 1;
/**
 * Pitch is averaged over this window twice (a 0.4 s triangle) before judging evenness, so vibrato
 * (about 4.5–7 Hz, up to ±100¢) doesn't count.
 */
export const PITCH_SMOOTH_SECONDS = 0.2;
/** A volume sag or surge must last this long. */
export const SAG_SECONDS = 0.3;
const ONSET = 0.3;
const RELEASE = 0.4;
/** Stalls and jumps aren't looked for this close to a leg's ends (slowing into the turn is normal). */
const LEG_EDGE = 0.5;

export interface GlideLeg {
  from: number;
  to: number;
  /** Smoothed cents (from the low note) at the leg's endpoints. */
  c0: number;
  c1: number;
  /** RMS deviation from the straight line between the endpoints, cents. */
  rms: number;
  /** The largest deviation (signed), the MIDI note nearest it, and whether it fell in the middle 60%. */
  worst: { t: number; dev: number; near: number; middle: boolean } | null;
  stalls: { t: number; near: number }[];
  jumps: { t: number; near: number }[];
}

export interface GlideResult {
  /** Voiced span (s). */
  from: number;
  to: number;
  /** First settled pitch vs the low note, cents. */
  startCents: number;
  /** Highest smoothed pitch minus the top note: + overshoot, − undershoot. */
  topCents: number;
  /** Landing vs the low note; null when there was no way down. */
  endCents: number | null;
  /** Set when the pitch stayed at the top at least TOP_HOLD_SECONDS. */
  hold: { from: number; to: number } | null;
  /** Null when there was no glide (the top was under half the interval). */
  up: GlideLeg | null;
  /** Null when it never came down by half the interval. */
  down: GlideLeg | null;
  /** Median level and the RMS around it, dB (onset and release left out). */
  levelDb: number;
  volumeDev: number;
  bumps: { t: number; kind: "sag" | "surge"; db: number; near: number }[];
  lost: { t: number; reason: LostReason } | null;
  vibrato: Vibrato | null;
  /** Smoothed pitch per frame (null where unknown), for drawing. */
  smoothCents: (number | null)[];
  /** Smoothed level per frame, dB. */
  smooth: number[];
}

/**
 * Pitch smoothed for judging, between frames a and b only (the onset and release are left out): a
 * coarse running median (±0.3 s) first marks wild frames (octave slips, cracks) to leave out, then
 * the rest is averaged over PITCH_SMOOTH_SECONDS twice.
 */
function smoothPitch(frames: SupportFrame[], a: number, b: number): (number | null)[] {
  const n = frames.length;
  const coarse: (number | null)[] = new Array(n).fill(null);
  for (let i = a; i <= b; i++) {
    if (frames[i].cents === null) continue;
    const xs: number[] = [];
    for (let j = i; j >= a && frames[i].t - frames[j].t <= 0.3; j--) if (frames[j].cents !== null) xs.push(frames[j].cents!);
    for (let j = i + 1; j <= b && frames[j].t - frames[i].t <= 0.3; j++) if (frames[j].cents !== null) xs.push(frames[j].cents!);
    coarse[i] = median(xs);
  }
  const first: (number | null)[] = frames.map((f, i) => (i >= a && i <= b && f.cents !== null && Math.abs(f.cents - coarse[i]!) < 150 ? f.cents : null));
  const pass = (src: (number | null)[]) => {
    const out: (number | null)[] = new Array(n).fill(null);
    const half = PITCH_SMOOTH_SECONDS / 2;
    for (let i = a; i <= b; i++) {
      if (src[i] === null) continue;
      let s = 0;
      let k = 0;
      for (let j = i; j >= a && frames[i].t - frames[j].t <= half; j--) if (src[j] !== null) (s += src[j]!), k++;
      for (let j = i + 1; j <= b && frames[j].t - frames[i].t <= half; j++) if (src[j] !== null) (s += src[j]!), k++;
      if (k >= 3) out[i] = s / k;
    }
    return out;
  };
  return pass(pass(first));
}

/**
 * Moves a reading that is a whole octave off back into the glide: anything more than half an
 * octave from the glide's middle must be a tracker octave error (common on phones for low notes,
 * where the fundamental is weak), since the glide only spans a third or a fifth. Idempotent.
 */
export function foldOctaves(cents: number, interval: number): number {
  const mid = (interval * 100) / 2;
  return cents - 1200 * Math.round((cents - mid) / 1200);
}

export function analyseGlide(frames: SupportFrame[], floorDb: number, interval: number, lowMidi: number, gateDb = DEFAULT_GATE_DB): GlideResult | null {
  if (frames.length < 20) return null;
  frames = frames.map((f) => (f.cents === null ? f : { ...f, cents: foldOctaves(f.cents, interval) }));
  const smooth = smoothDb(frames, 0.1);
  const span = voicedSpan(frames, smooth, floorDb);
  if (!span) return null;
  const { a, b } = span;
  const from = frames[a].t;
  const to = frames[b].t;
  // Judge only between the onset and the release: scoops in and fall-offs at the end are normal.
  let a2 = a;
  while (a2 < b && frames[a2].t < from + ONSET) a2++;
  let b2 = b;
  while (b2 > a2 && frames[b2].t > to - RELEASE) b2--;
  if (b2 - a2 < 10) return null;
  const sc = smoothPitch(frames, a2, b2);
  const near = (c: number) => Math.round(lowMidi + c / 100);
  const t = (i: number) => frames[i].t;

  // The start: the first moment the pitch is near the low note and settled (not still scooping).
  const settled = (i: number) => {
    if (sc[i] === null || Math.abs(sc[i]!) > 60) return false;
    for (let k = i; k <= b2 && t(k) - t(i) <= 0.2; k++) if (sc[k] !== null && Math.abs(sc[k]! - sc[i]!) > 30) return false;
    return true;
  };
  let s = -1;
  for (let i = a2; i <= b2; i++) if (settled(i)) { s = i; break; }
  if (s < 0) for (let i = a2; i <= b2; i++) if (sc[i] !== null) { s = i; break; }
  let e = -1;
  for (let i = b2; i >= a2; i--) if (sc[i] !== null) { e = i; break; }
  if (s < 0 || e <= s) return null;

  let p = s;
  for (let i = s; i <= e; i++) if (sc[i] !== null && sc[i]! > sc[p]!) p = i;
  const topC = sc[p]!;
  const full = interval * 100;
  const startCents = sc[s]!;
  const rose = topC - startCents >= full / 2;

  // Where the pitch is barely moving: settling on the first note, a pause at the top, landing.
  // Measured by speed (not a pitch band), so slowing into the turn doesn't count as a pause.
  const avgUp = Math.max(1, (topC - startCents) / Math.max(0.5, t(p) - t(s)));
  const slow = (i: number) => {
    let lo = i;
    let hi = i;
    while (lo > s && t(i) - t(lo) < PITCH_SMOOTH_SECONDS / 2) lo--;
    while (hi < e && t(hi) - t(i) < PITCH_SMOOTH_SECONDS / 2) hi++;
    if (sc[lo] === null || sc[hi] === null || hi === lo) return true;
    return Math.abs(sc[hi]! - sc[lo]!) / (t(hi) - t(lo)) < STALL_FRACTION * avgUp;
  };
  let hl = p;
  let hr = p;
  while (hl > s && slow(hl - 1)) hl--;
  while (hr < e && slow(hr + 1)) hr++;
  const held = t(hr) - t(hl) >= TOP_HOLD_SECONDS;
  // Settling on the first note and landing on the last: the leg starts where the pitch leaves the
  // first note (by more than 30¢) and ends where it arrives at the last. A pitch band works here,
  // where speed doesn't: the smoothing is one-sided at the ends of the judged span.
  const bandRef = (from0: number, dir: 1 | -1) => {
    const xs: number[] = [];
    for (let i = from0; i >= s && i <= e && Math.abs(t(i) - t(from0)) <= 0.3; i += dir) if (sc[i] !== null) xs.push(sc[i]!);
    return median(xs);
  };
  const startRef = bandRef(s, 1);
  const endRef = bandRef(e, -1);
  let s1 = s;
  while (s1 < p && (sc[s1 + 1] === null || Math.abs(sc[s1 + 1]! - startRef) <= 30)) s1++;
  let e0 = e;
  while (e0 > p && (sc[e0 - 1] === null || Math.abs(sc[e0 - 1]! - endRef) <= 30)) e0--;
  const upStart = s1 < (held ? hl : p) ? s1 : s;
  const upEnd = held ? hl : p;
  const downStart = held ? hr : p;
  const downEnd = e0 > downStart ? e0 : e;
  let lowest = topC;
  for (let i = downStart; i <= e; i++) if (sc[i] !== null) lowest = Math.min(lowest, sc[i]!);
  const cameDown = rose && topC - lowest >= full / 2;
  const landing: number[] = [];
  for (let i = downEnd; i <= e; i++) if (sc[i] !== null) landing.push(sc[i]!);

  const leg = (i0: number, i1: number, dir: 1 | -1): GlideLeg => {
    const t0 = t(i0);
    const t1 = t(i1);
    const c0 = sc[i0]!;
    const c1 = sc[i1]!;
    const len = Math.max(1e-6, t1 - t0);
    const line = (tt: number) => c0 + ((c1 - c0) * (tt - t0)) / len;
    let sum = 0;
    let n = 0;
    let worst: GlideLeg["worst"] = null;
    for (let i = i0; i <= i1; i++) {
      if (sc[i] === null) continue;
      const dev = sc[i]! - line(t(i));
      sum += dev * dev;
      n++;
      if (!worst || Math.abs(dev) > Math.abs(worst.dev)) {
        const x = (t(i) - t0) / len;
        worst = { t: t(i), dev, near: near(line(t(i))), middle: x >= 0.2 && x <= 0.8 };
      }
    }
    // Stalls: the speed over a PITCH_SMOOTH_SECONDS window, in the leg's direction, stays low.
    const avg = Math.abs(c1 - c0) / len;
    const stalls: GlideLeg["stalls"] = [];
    let slowFrom: number | null = null;
    let flagged = false;
    for (let i = i0; i <= i1; i++) {
      if (sc[i] === null || t(i) < t0 + LEG_EDGE) continue;
      let j = i;
      while (j < i1 && t(j) - t(i) < PITCH_SMOOTH_SECONDS) j++;
      if (t(j) > t1 - LEG_EDGE) break;
      if (sc[j] === null) continue;
      const speed = (dir * (sc[j]! - sc[i]!)) / (t(j) - t(i));
      if (speed < STALL_FRACTION * avg) {
        slowFrom ??= t(i);
        if (!flagged && t(i) - slowFrom >= STALL_SECONDS - PITCH_SMOOTH_SECONDS) {
          stalls.push({ t: slowFrom, near: near(sc[i]!) });
          flagged = true;
        }
      } else {
        slowFrom = null;
        flagged = false;
      }
    }
    // Jumps: the vibrato-free pitch moves more than JUMP_CENTS within JUMP_SECONDS beyond what the
    // even glide would. Wild frames (tracker slips) are already left out of it.
    const jumps: GlideLeg["jumps"] = [];
    let nextAt = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const ti = t(i);
      if (sc[i] === null || ti < t0 + LEG_EDGE || ti < nextAt) continue;
      let j = i;
      while (j < i1 && t(j) - ti < JUMP_SECONDS) j++;
      if (t(j) > t1 - LEG_EDGE) break;
      if (sc[j] === null) continue;
      if (Math.abs(sc[j]! - sc[i]! - (line(t(j)) - line(ti))) > JUMP_CENTS) {
        const mid = (ti + t(j)) / 2;
        jumps.push({ t: mid, near: near(line(mid)) });
        nextAt = t(j) + 0.3;
      }
    }
    return { from: t0, to: t1, c0, c1, rms: n ? Math.sqrt(sum / n) : 0, worst, stalls, jumps };
  };

  const up = rose ? leg(upStart, upEnd, 1) : null;
  const down = cameDown ? leg(downStart, downEnd, -1) : null;

  // The pitch expected at any moment, to tell a crack from the glide itself.
  const expected =
    up === null
      ? undefined
      : (tt: number) => {
          if (tt <= up.to) return tt <= up.from ? up.c0 : up.c0 + ((up.c1 - up.c0) * (tt - up.from)) / Math.max(1e-6, up.to - up.from);
          if (!down || tt <= down.from) return topC;
          return tt >= down.to ? down.c1 : down.c0 + ((down.c1 - down.c0) * (tt - down.from)) / Math.max(1e-6, down.to - down.from);
        };
  const lost = findLost(frames, a, b, floorDb, expected, true, gateDb);
  if (lost?.reason === "crack")
    for (const l of [up, down]) if (l) l.jumps = l.jumps.filter((j) => Math.abs(j.t - lost.t) >= 0.3);

  // Steady support: the level around its own median.
  const mid: number[] = [];
  for (let i = a; i <= b; i++) if (t(i) >= from + LEG_EDGE && t(i) <= to - LEG_EDGE) mid.push(i);
  const levelDb = mid.length ? median(mid.map((i) => smooth[i])) : median(smooth.slice(a, b + 1));
  const volumeDev = mid.length ? Math.sqrt(mid.reduce((acc, i) => acc + (smooth[i] - levelDb) ** 2, 0) / mid.length) : 0;
  const pitchAt = (i: number) => {
    for (let k = 0; k < 40; k++) {
      if (i - k >= a && sc[i - k] !== null) return sc[i - k]!;
      if (i + k <= b && sc[i + k] !== null) return sc[i + k]!;
    }
    return 0;
  };
  const bumps: GlideResult["bumps"] = [];
  let run: { i: number; kind: "sag" | "surge"; db: number } | null = null;
  const close = (endT: number) => {
    if (run && endT - t(run.i) >= SAG_SECONDS) bumps.push({ t: t(run.i), kind: run.kind, db: run.db, near: near(pitchAt(run.i)) });
    run = null;
  };
  for (const i of mid) {
    const d = smooth[i] - levelDb;
    const kind = d <= -BUMP_DB ? "sag" : d >= BUMP_DB ? "surge" : null;
    if (run && run.kind !== kind) close(t(i));
    if (kind) {
      run ??= { i, kind, db: 0 };
      run.db = Math.max(run.db, Math.abs(d));
    }
  }
  if (mid.length) close(t(mid[mid.length - 1]));
  if (lost?.reason === "break") {
    for (let k = bumps.length - 1; k >= 0; k--) if (bumps[k].t > lost.t - 0.2 && bumps[k].t < lost.t + 0.6) bumps.splice(k, 1);
  }

  // Vibrato over the way up (trends are removed by the analyser).
  const pts: { time: number; cents: number }[] = [];
  if (up) for (let i = s; i <= upEnd; i++) if (frames[i].cents !== null && sc[i] !== null) pts.push({ time: t(i), cents: frames[i].cents! });
  const vibrato = analyseVibrato(pts);

  return {
    from,
    to,
    startCents,
    topCents: topC - full,
    endCents: down ? median(landing) : null,
    hold: held ? { from: t(hl), to: t(hr) } : null,
    up,
    down,
    levelDb,
    volumeDev,
    bumps,
    lost,
    vibrato,
    smoothCents: sc,
    smooth,
  };
}

function newStats() {
  return { rounds: 0, started: 0, context: "", evenUp: 0, evenDown: 0, drift: 0, volume: 0, topError: 0, seconds: 0, lost: 0 };
}

const sec = (t: number) => `${t.toFixed(1)} s`;

/** Glides on the Support page: low note → up a third or fifth → back down, at your own pace. */
export class GlideExercise implements SupportExercise {
  readonly id = "glide" as const;
  readonly unit: [string, string] = ["glide", "glides"];
  private result: GlideResult | null = null;
  private stats = newStats();
  /** Live cue state for the current round. */
  private cueFirst: number | null = null;
  private cueMax = -Infinity;
  private cueRising = false;

  constructor(
    private prefs: SupportPrefs,
    private onSession: (s: GlideSession) => void,
  ) {}

  private get range() {
    return VOICES.find((x) => x.id === this.prefs.voice)!;
  }

  private get interval(): number {
    return this.prefs.interval === 7 ? 7 : 4;
  }

  refMidi(): number {
    const v = this.range;
    return Math.round((v.low + v.high) / 2 - this.interval / 2) + this.prefs.glideOffset;
  }

  private get top(): number {
    return this.refMidi() + this.interval;
  }

  /** Readings an octave off are tracker errors: shown and judged in the glide's octave. */
  foldCents(cents: number): number {
    return foldOctaves(cents, this.interval);
  }

  noteText(): string {
    return `${midiName(this.refMidi())} → ${midiName(this.top)} → ${midiName(this.refMidi())}`;
  }

  canStep(d: 1 | -1): boolean {
    return this.refMidi() + d >= this.range.low && this.top + d <= this.range.high;
  }

  step(d: 1 | -1): void {
    this.prefs.glideOffset += d;
  }

  startNotes(): Note[] {
    return [
      { midi: this.refMidi(), start: 0, dur: 1.2 },
      { midi: this.top, start: 1.2, dur: 1.2 },
    ];
  }

  hearNotes(): Note[] {
    return [
      { midi: this.refMidi(), start: 0, dur: 1 },
      { midi: this.top, start: 1, dur: 1 },
      { midi: this.refMidi(), start: 2, dur: 1 },
    ];
  }

  context(): string {
    return `${midiName(this.refMidi())}–${midiName(this.top)} · ${this.range.label}`;
  }

  idleHint(): string {
    const lo = midiName(this.refMidi());
    return `You'll hear the low and the top note, then breathe in while the room's noise is measured. Then start on ${lo}, glide slowly and evenly up to ${midiName(this.top)} and back down to ${lo} without stopping, at your own pace (around 10 s each way). Keep the volume level.`;
  }

  singHint(): string {
    return "Glide evenly and keep the volume steady. Enter when done.";
  }

  /** The cue follows what you sing, not a clock. */
  cue(_t: number, frames: SupportFrame[]): string {
    const lo = midiName(this.refMidi());
    if (!frames.length) {
      this.cueFirst = null;
      this.cueMax = -Infinity;
      this.cueRising = false;
      return `Start on ${lo}`;
    }
    const last = frames[frames.length - 1].t;
    const recent = frames.filter((f) => f.cents !== null && f.t > last - 0.3).map((f) => f.cents!);
    if (recent.length < 5) return this.cueRising ? "Glide up…" : `Start on ${lo}`;
    const cur = median(recent);
    this.cueFirst ??= cur;
    this.cueMax = Math.max(this.cueMax, cur);
    if (!this.cueRising) {
      if (cur - this.cueFirst <= 30) return `Start on ${lo}`;
      this.cueRising = true;
    }
    if (this.cueMax - cur <= 40) return "Glide up…";
    return cur < this.cueFirst + 0.25 * (this.cueMax - this.cueFirst) ? `Land on ${lo}` : "Back down…";
  }

  finishAt(t: number, voicedFor: number, silentFor: number): boolean {
    return (voicedFor >= 2 && silentFor >= 1) || t > 60;
  }

  timeSpan(frames: SupportFrame[]): number {
    return Math.max(25, (frames.length ? frames[frames.length - 1].t : 0) + 1, (this.result?.to ?? 0) + 1);
  }

  pitchRange(): [number, number] {
    return [-100, this.interval * 100 + 100];
  }

  peakHint(): number | null {
    return null;
  }

  startRound(): void {
    if (!this.stats.rounds && !this.stats.started) {
      this.stats.started = Date.now();
      this.stats.context = this.context();
    }
  }

  analyse(frames: SupportFrame[], floorDb: number, gateDb: number): boolean {
    this.result = analyseGlide(frames, floorDb, this.interval, this.refMidi(), gateDb);
    const r = this.result;
    if (!r) return false;
    if (r.up && r.down) {
      const s = this.stats;
      s.rounds++;
      s.evenUp += r.up.rms;
      s.evenDown += r.down.rms;
      s.drift += Math.max(Math.abs(r.up.worst?.dev ?? 0), Math.abs(r.down.worst?.dev ?? 0));
      s.volume += r.volumeDev;
      s.topError += Math.abs(r.topCents);
      s.seconds += r.down.to - r.up.from;
      if (r.lost) s.lost++;
    }
    return true;
  }

  clearResult(): void {
    this.result = null;
  }

  hasResult(): boolean {
    return this.result !== null;
  }

  smoothDb(): number[] | null {
    return this.result?.smooth ?? null;
  }

  /** The pitch lane: low and top note, the scale notes between as landmarks, tolerance bands. */
  drawBack(v: DrawView): void {
    const { g, yP, L, R, w } = v;
    const { fg, muted, grid, accent } = v.colors;
    const full = this.interval * 100;
    for (const c of [0, full]) {
      g.fillStyle = accent + "1a";
      g.fillRect(L, yP(c + v.tol), w - L - R, yP(c - v.tol) - yP(c + v.tol));
    }
    const steps = this.interval === 7 ? [0, 2, 4, 5, 7] : [0, 2, 4];
    for (const k of steps) {
      const end = k === 0 || k === this.interval;
      g.fillStyle = end ? muted : grid;
      g.fillRect(L, yP(k * 100), w - L - R, 1);
      g.fillStyle = end ? fg : muted;
      g.fillText(midiName(this.refMidi() + k), 2, yP(k * 100));
    }
    g.fillStyle = fg;
    g.fillText("Pitch", L + 4, v.pitch.top - 9);
  }

  /** The even lines the glide is judged against, and the findings. */
  drawMarks(v: DrawView): void {
    const r = this.result;
    if (!r) return;
    const { g, x, yV, yP } = v;
    const { accent, warn, lost } = v.colors;
    // The level band: the glide's own level ± 3 dB.
    g.fillStyle = accent + "14";
    g.fillRect(x(r.from), yV(r.levelDb + BUMP_DB), x(r.to) - x(r.from), yV(r.levelDb - BUMP_DB) - yV(r.levelDb + BUMP_DB));
    g.save();
    g.strokeStyle = accent;
    g.lineWidth = 2;
    g.setLineDash([6, 4]);
    for (const l of [r.up, r.down]) {
      if (!l) continue;
      g.beginPath();
      g.moveTo(x(l.from), yP(l.c0));
      g.lineTo(x(l.to), yP(l.c1));
      g.stroke();
    }
    g.restore();
    for (const l of [r.up, r.down]) {
      if (!l) continue;
      const w = l.worst;
      if (w && Math.abs(w.dev) > DRIFT_CENTS) {
        const line = l.c0 + ((l.c1 - l.c0) * (w.t - l.from)) / Math.max(1e-6, l.to - l.from);
        g.fillStyle = warn;
        g.beginPath();
        g.arc(x(w.t), yP(line + w.dev), 5, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = warn;
      for (const m of [...l.stalls, ...l.jumps]) g.fillRect(x(m.t) - 1, v.pitch.top, 3, 10);
    }
    for (const b of r.bumps) {
      g.fillStyle = warn;
      g.beginPath();
      g.arc(x(b.t), v.vol.top + 6, 4, 0, Math.PI * 2);
      g.fill();
    }
    if (r.lost) {
      g.fillStyle = lost;
      g.fillRect(x(r.lost.t) - 1, v.vol.top, 2, v.pitch.top + v.pitch.h - v.vol.top);
      g.fillText(r.lost.reason, x(r.lost.t) + 4, v.vol.top + 6);
    }
  }

  resultHtml(tol: number): string {
    const r = this.result!;
    const lo = midiName(this.refMidi());
    const top = midiName(this.top);
    if (!r.up || !r.down) {
      const what = !r.up
        ? `No glide up to ${top} was heard: start on ${lo}, glide slowly up to ${top}, then back down.`
        : `The glide didn't come back down: after ${top}, keep going, slowly, all the way back to ${lo}.`;
      return `<h3>No full glide heard</h3><ul class="mv-findings"><li class="warn">${what}</li></ul>`;
    }
    const items: { ok: boolean | null; text: string }[] = [];
    const even = (rms: number) => (rms <= 12 ? "even" : rms <= 20 ? "fairly even" : "uneven");
    items.push({ ok: r.up.rms <= 20, text: `<b>Up ${even(r.up.rms)}</b> (±${Math.round(r.up.rms)}¢ from an even glide).` });
    items.push({ ok: r.down.rms <= 20, text: `<b>Down ${even(r.down.rms)}</b> (±${Math.round(r.down.rms)}¢ from an even glide).` });
    const worst = [r.up, r.down].map((l) => l.worst).filter((w) => w !== null).sort((a, b) => Math.abs(b!.dev) - Math.abs(a!.dev))[0] ?? null;
    let drift: { t: number } | null = null;
    if (worst) {
      const big = Math.abs(worst.dev) > DRIFT_CENTS;
      if (big) drift = worst;
      const way = worst.dev > 0 ? "sharp" : "flat";
      items.push({
        ok: !big,
        text: big
          ? `<b>Drifted ${Math.round(Math.abs(worst.dev))}¢ ${way}</b> near ${midiName(worst.near)} at ${sec(worst.t)}${worst.middle ? ": a drift in the middle; check that nothing moved (tongue, jaw)" : ""}.`
          : `<b>No big drift</b> (largest ${Math.round(Math.abs(worst.dev))}¢).`,
      });
    }
    const marks = [
      ...[...r.up.stalls, ...r.down.stalls].map((m) => ({ ...m, kind: "stalled" })),
      ...[...r.up.jumps, ...r.down.jumps].map((m) => ({ ...m, kind: "jumped" })),
    ].sort((a, b) => a.t - b.t);
    items.push({
      ok: !marks.length,
      text: marks.length
        ? `<b>${marks.map((m) => `${m.kind[0].toUpperCase()}${m.kind.slice(1)} near ${midiName(m.near)} (${sec(m.t)})`).join("; ")}</b>: keep the pitch moving at the same speed.`
        : "<b>No stalls or jumps.</b>",
    });
    const tc = Math.round(r.topCents);
    items.push({
      ok: Math.abs(tc) <= tol,
      text: Math.abs(tc) <= tol ? `<b>Reached ${top}</b> (${tc > 0 ? "+" : ""}${tc}¢).` : `<b>Top ${Math.abs(tc)}¢ ${tc > 0 ? "over" : "under"} ${top}</b>.`,
    });
    const ec = Math.round(r.endCents ?? 0);
    items.push({
      ok: Math.abs(ec) <= tol,
      text: Math.abs(ec) <= tol ? `<b>Landed on ${lo}</b> (${ec > 0 ? "+" : ""}${ec}¢).` : `<b>Landed ${Math.abs(ec)}¢ ${ec > 0 ? "sharp" : "flat"}</b> of ${lo}.`,
    });
    const steady = !r.bumps.length && r.volumeDev <= 2;
    const together = drift !== null && r.bumps.some((b) => b.kind === "sag" && Math.abs(b.t - drift!.t) <= 0.5);
    items.push({
      ok: steady,
      text: steady
        ? `<b>Volume steady</b> (±${r.volumeDev.toFixed(1)} dB).`
        : `<b>Volume ${r.bumps.length ? "not steady" : "a little uneven"}</b> (±${r.volumeDev.toFixed(1)} dB)${r.bumps.length ? `: ${r.bumps.map((b) => `${b.kind === "sag" ? "sagged" : "swelled"} ${b.db.toFixed(0)} dB near ${midiName(b.near)} (${sec(b.t)})`).join("; ")}` : ""}${together ? ". The sag and the drift came together, likely the same cause" : ""}.`,
    });
    if (r.lost) {
      const what = r.lost.reason === "break" ? "the voice stopped" : r.lost.reason === "crack" ? "the pitch cracked" : "the tone lost its pitch (breathy or unstable)";
      items.push({ ok: false, text: `<b>Control gave out at ${sec(r.lost.t)}</b>: ${what}. Marked on the graph.` });
    }
    const judged = items.filter((i) => i.ok !== null);
    const good = judged.filter((i) => i.ok).length;
    items.push({
      ok: null,
      text: `Up ${sec(r.up.to - r.up.from)}, down ${sec(r.down.to - r.down.from)}${r.hold ? `; paused at the top ${sec(r.hold.to - r.hold.from)}` : ""}.`,
    });
    if (r.vibrato && (r.vibrato.kind === "vibrato" || r.vibrato.kind === "wobble"))
      items.push({ ok: null, text: `${r.vibrato.kind === "vibrato" ? "Vibrato" : "Wobble"}: ${r.vibrato.rate.toFixed(1)}/s, ±${Math.round(r.vibrato.extent)}¢.` });
    const head = good === judged.length ? "An even glide" : good >= judged.length - 1 ? "Nearly there" : "Some things to work on";
    const cls = (ok: boolean | null) => (ok === null ? "info" : ok ? "ok" : "warn");
    return `<h3>${head}</h3><ul class="mv-findings">${items.map((i) => `<li class="${cls(i.ok)}">${i.text}</li>`).join("")}</ul>`;
  }

  statsText(): string {
    const s = this.stats;
    return s.rounds
      ? `This session: ${s.rounds} ${s.rounds === 1 ? "glide" : "glides"} · evenness ±${Math.round(s.evenUp / s.rounds)}¢ up, ±${Math.round(s.evenDown / s.rounds)}¢ down`
      : "";
  }

  endSession(): void {
    const s = this.stats;
    if (s.rounds > 0)
      this.onSession({
        date: s.started,
        context: s.context,
        rounds: s.rounds,
        minutes: (Date.now() - s.started) / 60000,
        evenUp: s.evenUp / s.rounds,
        evenDown: s.evenDown / s.rounds,
        drift: s.drift / s.rounds,
        volume: s.volume / s.rounds,
        topError: s.topError / s.rounds,
        seconds: s.seconds / s.rounds,
        lost: s.lost,
      });
    this.stats = newStats();
  }
}
