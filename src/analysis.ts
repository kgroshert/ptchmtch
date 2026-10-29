import type { NoteEvent } from "./score";

export interface TakeSample {
  beat: number;
  midi: number | null;
}

export interface Take {
  pass: number;
  samples: TakeSample[];
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
}

export interface Settings {
  toleranceCents: number;
  /** Treat singing in another octave as correct (e.g. a tenor part sung by an alto). */
  octaveFree: boolean;
}

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
  if (devs.length < 3 || coverage < 0.3) return { cents: 0, inTune: 0, coverage, status: "missed" };
  devs.sort((a, b) => a - b);
  const cents = devs[Math.floor(devs.length / 2)];
  const inTune = devs.filter((d) => Math.abs(d) <= s.toleranceCents).length / devs.length;
  const a = Math.abs(cents);
  const status: NoteStatus = a <= s.toleranceCents ? "good" : a <= s.toleranceCents * 2 ? "close" : "off";
  return { cents, inTune, coverage, status };
}

export interface Summary {
  notes: number;
  sung: number;
  good: number;
  meanAbsCents: number;
  meanCents: number;
}

export function summarize(results: NoteResult[]): Summary {
  const sung = results.filter((r) => r.status !== "missed");
  const n = sung.length || 1;
  return {
    notes: results.length,
    sung: sung.length,
    good: sung.filter((r) => r.status === "good").length,
    meanAbsCents: sung.reduce((a, r) => a + Math.abs(r.cents), 0) / n,
    meanCents: sung.reduce((a, r) => a + r.cents, 0) / n,
  };
}
