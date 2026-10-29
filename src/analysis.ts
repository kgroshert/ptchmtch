import type { NoteEvent } from "./score";
import {
  analyseVibrato,
  centreLine,
  longestRun,
  oscillates,
  type PitchPoint,
  type Vibrato,
  type VibratoKind,
} from "./vibrato";

export interface TakeSample {
  beat: number;
  /** Real time in seconds (AudioContext clock, latency-corrected), so onsets are judged independent of tempo. */
  time: number;
  midi: number | null;
}

export type NoteStatus = "good" | "close" | "off" | "missed";

export interface NoteResult {
  /** Median signed deviation in cents (positive = sharp). */
  cents: number;
  /** Share of voiced samples within tolerance. */
  inTune: number;
  /** Share of the note's duration with a detected pitch. */
  coverage: number;
  status: NoteStatus;
  /** How the note was entered; null when it was too short or not sung. */
  onset: Onset | null;
  /** Vibrato of the held part; null when it was too short to analyse. */
  vibrato: Vibrato | null;
}

/**
 * clean: on pitch straight away; scoop: slid up into the note from below;
 * fall: came down into it from above; unsettled: never held the pitch steadily.
 */
export type OnsetKind = "clean" | "scoop" | "fall" | "unsettled";

export interface Onset {
  kind: OnsetKind;
  /** Time from the first sound until the pitch held steady within tolerance. */
  settleMs: number | null;
  /** Deviation at the very start of the note. */
  startCents: number;
}

export interface Settings {
  toleranceCents: number;
  /** Treat singing in another octave as correct (e.g. a tenor part sung by an alto). */
  octaveFree: boolean;
  /** A note counts as cleanly hit when it settles within this many milliseconds. */
  onsetMs: number;
}

/** How long the pitch must stay within tolerance to count as settled. */
const HOLD_SEC = 0.08;
/** Pitch at the start of a note is measured over this span. */
const START_SEC = 0.05;

/** Signed distance in cents from target, folded into ±600 when octaves don't matter. */
export function centsOff(sung: number, target: number, octaveFree: boolean): number {
  let c = (sung - target) * 100;
  if (octaveFree) c = c - 1200 * Math.round(c / 1200);
  return c;
}

export function statusColor(status: NoteStatus): string {
  return { good: "#1f9d55", close: "#d08700", off: "#d13b3b", missed: "#8a8f98" }[status];
}

/**
 * `singerRate` is the vibrato rate seen on the singer's recent notes: short notes can't show their own
 * vibrato reliably, but are still judged on its centre line when the singer uses one.
 */
export function evaluate(ev: NoteEvent, samples: TakeSample[], s: Settings, singerRate: number | null = null): NoteResult {
  const dur = ev.end - ev.start;
  // Ignore the attack and the very end, where every singer glides.
  const from = ev.start + Math.min(0.35, dur * 0.2);
  const to = ev.end - Math.min(0.15, dur * 0.1);
  const body = samples
    .filter((x) => x.beat >= from && x.beat <= to)
    .map((x) => ({ time: x.time, cents: x.midi === null ? null : centsOff(x.midi, ev.midi, s.octaveFree) }));
  const devs = body.map((x) => x.cents).filter((c): c is number => c !== null);
  const coverage = body.length ? devs.length / body.length : 0;
  if (devs.length < 3 || coverage < 0.3)
    return { cents: 0, inTune: 0, coverage, status: "missed", onset: null, vibrato: null };

  const vibrato = analyseVibrato(longestRun(body.map((x) => (x.cents === null ? null : (x as PitchPoint)))));
  // With vibrato, judge the centre of the oscillation rather than its peaks. Short notes fall back
  // to the whole note (attack included), then to the singer's recent vibrato rate.
  let rate = oscillates(vibrato) ? vibrato.rate : null;
  if (!rate && !vibrato) {
    const whole = samples
      .filter((x) => x.beat >= ev.start && x.beat <= ev.end)
      .map((x): PitchPoint | null => (x.midi === null ? null : { time: x.time, cents: centsOff(x.midi, ev.midi, s.octaveFree) }));
    const v = analyseVibrato(longestRun(whole));
    // Only borrow the singer's rate when the note is too short to tell either way.
    rate = v ? (oscillates(v) ? v.rate : null) : singerRate;
  }
  const smoothSec = rate ? 1 / rate : 0;
  const judged = smoothSec ? centreLine(body, smoothSec).filter((c): c is number => c !== null) : devs;

  devs.sort((a, b) => a - b);
  const cents = devs[Math.floor(devs.length / 2)];
  const inTune = judged.filter((d) => Math.abs(d) <= s.toleranceCents).length / judged.length;
  const a = Math.abs(cents);
  const status: NoteStatus = a <= s.toleranceCents ? "good" : a <= s.toleranceCents * 2 ? "close" : "off";
  return { cents, inTune, coverage, status, onset: analyseOnset(ev, samples, s, smoothSec), vibrato };
}

/** `smoothSec` > 0 judges the vibrato centre line (one cycle long) instead of the raw pitch. */
export function analyseOnset(ev: NoteEvent, samples: TakeSample[], s: Settings, smoothSec = 0): Onset | null {
  const dur = ev.end - ev.start;
  // Start exactly on the note: earlier samples still carry the previous note in legato singing.
  const win = samples.filter((x) => x.beat >= ev.start && x.beat <= ev.end - Math.min(0.15, dur * 0.1));
  const i0 = win.findIndex((x) => x.midi !== null);
  if (i0 < 0) return null;
  const t0 = win[i0].time;
  const tEnd = win[win.length - 1].time;
  if (tEnd - t0 < 0.15) return null; // too short to say anything about the attack

  const raw = win.map((x) => ({ time: x.time, cents: x.midi === null ? null : centsOff(x.midi, ev.midi, s.octaveFree) }));
  const devs = smoothSec ? centreLine(raw, smoothSec) : raw.map((x) => x.cents);
  const start: number[] = [];
  for (let i = i0; i < win.length && win[i].time <= t0 + START_SEC; i++) {
    const d = devs[i];
    if (d !== null) start.push(d);
  }
  start.sort((a, b) => a - b);
  const startCents = start[Math.floor(start.length / 2)];

  // Settled = from here on, every sample for HOLD_SEC (or until the note ends) is voiced and within tolerance.
  let settle: number | null = null;
  for (let i = i0; i < win.length && settle === null; i++) {
    let ok = true;
    let n = 0;
    for (let j = i; j < win.length && win[j].time <= win[i].time + HOLD_SEC; j++) {
      const d = devs[j];
      if (d === null || Math.abs(d) > s.toleranceCents) {
        ok = false;
        break;
      }
      n++;
    }
    if (ok && n >= 2) settle = win[i].time;
  }

  if (settle === null) return { kind: "unsettled", settleMs: null, startCents };
  const settleMs = (settle - t0) * 1000;
  if (settleMs <= s.onsetMs || Math.abs(startCents) <= s.toleranceCents) return { kind: "clean", settleMs, startCents };
  return { kind: startCents < 0 ? "scoop" : "fall", settleMs, startCents };
}

export interface Summary {
  notes: number;
  sung: number;
  good: number;
  meanAbsCents: number;
  meanCents: number;
  /** Notes whose attack could be judged. */
  onsets: number;
  clean: number;
  scoops: number;
  falls: number;
  unsettled: number;
  /** Mean time to settle for scoops and falls, in ms. */
  meanSlideMs: number;
}

export function summarize(results: NoteResult[]): Summary {
  const sung = results.filter((r) => r.status !== "missed");
  const n = sung.length || 1;
  const onsets = sung.map((r) => r.onset).filter((o): o is Onset => o !== null);
  const count = (k: OnsetKind) => onsets.filter((o) => o.kind === k).length;
  const slides = onsets.filter((o) => o.kind === "scoop" || o.kind === "fall");
  return {
    onsets: onsets.length,
    clean: count("clean"),
    scoops: count("scoop"),
    falls: count("fall"),
    unsettled: count("unsettled"),
    meanSlideMs: slides.length ? slides.reduce((a, o) => a + (o.settleMs ?? 0), 0) / slides.length : 0,
    notes: results.length,
    sung: sung.length,
    good: sung.filter((r) => r.status === "good").length,
    meanAbsCents: sung.reduce((a, r) => a + Math.abs(r.cents), 0) / n,
    meanCents: sung.reduce((a, r) => a + r.cents, 0) / n,
  };
}

/**
 * 0–100 for one note: half for how close the median pitch is (0¢ → full, 100¢ → none),
 * 30% for how steadily it stayed within tolerance, 20% for a clean entry.
 */
export function noteScore(r: NoteResult | undefined): number {
  if (!r || r.status === "missed") return 0;
  const accuracy = Math.max(0, 1 - Math.abs(r.cents) / 100);
  const entry = r.onset ? { clean: 1, scoop: 0.5, fall: 0.5, unsettled: 0 }[r.onset.kind] : 1;
  return 100 * (0.5 * accuracy + 0.3 * r.inTune + 0.2 * entry);
}

/** Score for a whole run: the mean note score, with unsung notes counting as 0. */
export function runScore(events: NoteEvent[], results: Map<number, NoteResult>): number {
  if (!events.length) return 0;
  return events.reduce((a, ev) => a + noteScore(results.get(ev.id)), 0) / events.length;
}

export interface VibratoSummary {
  /** Notes long enough to analyse. */
  analysed: number;
  counts: Record<VibratoKind, number>;
  /** Means over notes that had an oscillation (vibrato, wobble or fast); null if none. */
  rate: number | null;
  extent: number | null;
  regularity: number | null;
}

export function summarizeVibrato(results: NoteResult[]): VibratoSummary {
  const vs = results.map((r) => r.vibrato).filter((v): v is Vibrato => v !== null);
  const counts: Record<VibratoKind, number> = { straight: 0, vibrato: 0, wobble: 0, fast: 0, unsteady: 0 };
  for (const v of vs) counts[v.kind]++;
  const osc = vs.filter((v) => v.kind === "vibrato" || v.kind === "wobble" || v.kind === "fast");
  const mean = (f: (v: Vibrato) => number) => (osc.length ? osc.reduce((a, v) => a + f(v), 0) / osc.length : null);
  return { analysed: vs.length, counts, rate: mean((v) => v.rate), extent: mean((v) => v.extent), regularity: mean((v) => v.regularity) };
}

export interface Precision {
  /** Notes sung in at least two passes. */
  notes: number;
  passes: number;
  /** Mean standard deviation of a note's median pitch between passes, in cents. */
  spread: number;
  /** Mean absolute deviation of each note's average pitch, in cents. */
  accuracy: number;
}

/**
 * Precision (how consistently a note comes out the same between repetitions) is a different skill
 * from accuracy (how close it is on average); see Pfordresher et al. 2010.
 */
export function precision(mediansByNote: Map<number, number[]>): Precision | null {
  const spreads: number[] = [];
  const accs: number[] = [];
  let passes = 0;
  for (const v of mediansByNote.values()) {
    passes = Math.max(passes, v.length);
    if (v.length < 2) continue;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const variance = v.reduce((a, b) => a + (b - mean) ** 2, 0) / (v.length - 1);
    spreads.push(Math.sqrt(variance));
    accs.push(Math.abs(mean));
  }
  if (!spreads.length) return null;
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { notes: spreads.length, passes, spread: avg(spreads), accuracy: avg(accs) };
}
