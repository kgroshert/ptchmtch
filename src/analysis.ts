import type { NoteEvent } from "./score";

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

export function evaluate(ev: NoteEvent, samples: TakeSample[], s: Settings): NoteResult {
  const dur = ev.end - ev.start;
  // Ignore the attack and the very end, where every singer glides.
  const from = ev.start + Math.min(0.35, dur * 0.2);
  const to = ev.end - Math.min(0.15, dur * 0.1);
  let total = 0;
  const devs: number[] = [];
  for (const smp of samples) {
    if (smp.beat < from || smp.beat > to) continue;
    total++;
    if (smp.midi !== null) devs.push(centsOff(smp.midi, ev.midi, s.octaveFree));
  }
  const coverage = total ? devs.length / total : 0;
  if (devs.length < 3 || coverage < 0.3) return { cents: 0, inTune: 0, coverage, status: "missed", onset: null };
  devs.sort((a, b) => a - b);
  const cents = devs[Math.floor(devs.length / 2)];
  const inTune = devs.filter((d) => Math.abs(d) <= s.toleranceCents).length / devs.length;
  const a = Math.abs(cents);
  const status: NoteStatus = a <= s.toleranceCents ? "good" : a <= s.toleranceCents * 2 ? "close" : "off";
  return { cents, inTune, coverage, status, onset: analyseOnset(ev, samples, s) };
}

export function analyseOnset(ev: NoteEvent, samples: TakeSample[], s: Settings): Onset | null {
  const dur = ev.end - ev.start;
  // Start exactly on the note: earlier samples still carry the previous note in legato singing.
  const win = samples.filter((x) => x.beat >= ev.start && x.beat <= ev.end - Math.min(0.15, dur * 0.1));
  const i0 = win.findIndex((x) => x.midi !== null);
  if (i0 < 0) return null;
  const t0 = win[i0].time;
  const tEnd = win[win.length - 1].time;
  if (tEnd - t0 < 0.15) return null; // too short to say anything about the attack

  const dev = (x: TakeSample) => (x.midi === null ? null : centsOff(x.midi, ev.midi, s.octaveFree));
  const start: number[] = [];
  for (let i = i0; i < win.length && win[i].time <= t0 + START_SEC; i++) {
    const d = dev(win[i]);
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
      const d = dev(win[j]);
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
