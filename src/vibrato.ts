/**
 * Vibrato analysis of a held note.
 *
 * Reference values from singing research (Seashore, Sundberg, Prame): a healthy vibrato
 * repeats about 5–7 times per second and swings about ±50–100 cents. Slower and/or wider
 * is heard as a wobble; clearly faster as a bleat (tremolo).
 */

export type VibratoKind = "straight" | "vibrato" | "wobble" | "fast" | "unsteady";

export interface Vibrato {
  /** Oscillations per second. */
  rate: number;
  /** Swing to either side of the centre, in cents (± value). */
  extent: number;
  /** 0–1: how evenly the oscillation repeats (autocorrelation peak). */
  regularity: number;
  kind: VibratoKind;
}

export interface PitchPoint {
  time: number;
  /** Deviation from the target note in cents (any reference works; trends are removed). */
  cents: number;
}

/** Shortest held stretch that can be analysed: about three cycles of a slow vibrato. */
export const MIN_VIBRATO_SEC = 0.6;

const FS = 100; // resampling rate, Hz
/**
 * The pitch tracker measures over a ~45 ms window (2048 samples at 44.1–48 kHz), which averages away
 * part of a fast oscillation; the measured extent is corrected for this.
 */
const TRACKER_WINDOW_SEC = 0.045;
const SMOOTH_SEC = 0.5; // trend removal window: ~2.5–3.5 vibrato cycles
const MIN_HZ = 3;
const MAX_HZ = 9;

export const HEALTHY_RATE: [number, number] = [5, 7];

export function analyseVibrato(points: PitchPoint[]): Vibrato | null {
  if (points.length < 8) return null;
  const t0 = points[0].time;
  const dur = points[points.length - 1].time - t0;
  if (dur < MIN_VIBRATO_SEC) return null;

  // Resample to an even grid; the tracker's polling is slightly irregular.
  const n = Math.floor(dur * FS);
  const y = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const t = t0 + i / FS;
    while (j + 1 < points.length - 1 && points[j + 1].time < t) j++;
    const a = points[j];
    const b = points[j + 1];
    const f = b.time > a.time ? Math.min(1, Math.max(0, (t - a.time) / (b.time - a.time))) : 0;
    y[i] = a.cents + f * (b.cents - a.cents);
  }

  // Remove the slow pitch movement (drift, scoops) with a centred moving average.
  const half = Math.round((SMOOTH_SEC * FS) / 2);
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.max(0, i - half); k <= Math.min(n - 1, i + half); k++) {
      sum += y[k];
      cnt++;
    }
    x[i] = y[i] - sum / cnt;
  }

  let energy = 0;
  for (let i = 0; i < n; i++) energy += x[i] * x[i];
  // A sinusoid with amplitude A has an RMS of A/√2.
  let extent = Math.sqrt(energy / n) * Math.SQRT2;

  // Strongest periodicity between MIN_HZ and MAX_HZ, by normalised autocorrelation.
  const minLag = Math.floor(FS / MAX_HZ);
  const maxLag = Math.min(Math.ceil(FS / MIN_HZ), n - 10);
  const r = (lag: number) => {
    let num = 0;
    let ea = 0;
    let eb = 0;
    for (let i = 0; i + lag < n; i++) {
      num += x[i] * x[i + lag];
      ea += x[i] * x[i];
      eb += x[i + lag] * x[i + lag];
    }
    return ea && eb ? num / Math.sqrt(ea * eb) : 0;
  };
  let bestLag = 0;
  let best = -1;
  const rs: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) rs[lag] = r(lag);
  // Take the first clear peak, so a multiple of the true period isn't picked.
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (rs[lag] > rs[lag - 1] && rs[lag] >= rs[lag + 1] && rs[lag] > best) {
      best = rs[lag];
      bestLag = lag;
      if (best > 0.5) break;
    }
  }
  if (!bestLag) return { rate: 0, extent, regularity: 0, kind: extent < 15 ? "straight" : "unsteady" };

  // Parabolic interpolation around the peak for a finer rate.
  const a = rs[bestLag - 1];
  const b = rs[bestLag];
  const c = rs[bestLag + 1];
  const shift = a - 2 * b + c ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const rate = FS / (bestLag + shift);
  const regularity = Math.max(0, best);
  // The trend removal also takes away a little of the vibrato itself; undo that at the found rate.
  const w = 2 * half + 1;
  const passed = 1 - Math.sin((Math.PI * rate * w) / FS) / (w * Math.sin((Math.PI * rate) / FS));
  if (passed > 0.5) extent /= passed;
  const x0 = Math.PI * rate * TRACKER_WINDOW_SEC;
  extent /= Math.sin(x0) / x0;

  let kind: VibratoKind;
  if (extent < 15) kind = "straight";
  else if (regularity < 0.35) kind = "unsteady";
  else if (rate < 4.8 || extent > 110) kind = "wobble";
  else if (rate > 7.5) kind = "fast";
  else kind = "vibrato";
  return { rate, extent, regularity, kind };
}

/** The longest stretch without gaps (unvoiced samples or dropouts longer than `maxGap`). */
export function longestRun<T extends { time: number }>(points: (T | null)[], maxGap = 0.06): T[] {
  let best: T[] = [];
  let cur: T[] = [];
  for (const p of points) {
    if (!p || (cur.length && p.time - cur[cur.length - 1].time > maxGap)) {
      if (cur.length > best.length) best = cur;
      cur = p ? [p] : [];
      continue;
    }
    cur.push(p);
  }
  return cur.length > best.length ? cur : best;
}

export function vibratoLabel(v: Vibrato): string {
  return {
    straight: "straight tone",
    vibrato: "even vibrato",
    wobble: v.rate < 4.8 ? "wobble (slow)" : "wobble (wide)",
    fast: "fast vibrato (bleat)",
    unsteady: "unsteady pitch",
  }[v.kind];
}

export function describeVibrato(v: Vibrato): string {
  if (v.kind === "straight") return `straight tone (±${Math.round(v.extent)}¢)`;
  if (v.kind === "unsteady") return `unsteady pitch (±${Math.round(v.extent)}¢, no regular vibrato)`;
  return `${vibratoLabel(v)}: ${v.rate.toFixed(1)} Hz, ±${Math.round(v.extent)}¢, ${Math.round(v.regularity * 100)}% regular`;
}

/** Whether the note has an actual oscillation (as opposed to a straight or wandering tone). */
export function oscillates(v: Vibrato | null): v is Vibrato {
  return !!v && (v.kind === "vibrato" || v.kind === "wobble" || v.kind === "fast");
}

/**
 * The centre line of a pitch trace: a moving average over one vibrato cycle. Listeners hear the
 * centre of a vibrato as the pitch, so tolerance checks on notes with vibrato use this line.
 */
export function centreLine(values: { time: number; cents: number | null }[], windowSec: number): (number | null)[] {
  const half = windowSec / 2;
  let lo = 0;
  let hi = 0;
  let sum = 0;
  let cnt = 0;
  return values.map((v) => {
    if (v.cents === null) return null;
    // Two-pointer sliding window over voiced samples within ±half.
    while (hi < values.length && values[hi].time <= v.time + half) {
      const c = values[hi++].cents;
      if (c !== null) {
        sum += c;
        cnt++;
      }
    }
    while (values[lo].time < v.time - half) {
      const c = values[lo++].cents;
      if (c !== null) {
        sum -= c;
        cnt--;
      }
    }
    return cnt ? sum / cnt : v.cents;
  });
}
