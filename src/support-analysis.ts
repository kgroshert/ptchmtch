/**
 * Analysis shared by the Support page exercises: level smoothing, the sung span, and where control
 * gave out. Frames carry the level in dB and the pitch in cents from the exercise's reference note.
 */

export interface SupportFrame {
  /** Seconds since singing was asked for. */
  t: number;
  /** Level in dB relative to full scale. */
  db: number;
  /** Pitch in cents from the exercise's reference note, or null where no pitch was found. */
  cents: number | null;
}

export type LostReason = "break" | "crack" | "no pitch";

/** dB above the noise floor that counts as voice. */
export const VOICE_DB = 8;
/** A wrong-way move in volume this large counts as a dip or a surge. */
export const BUMP_DB = 3;
/** A jump in pitch this large from the running median counts as a crack. */
export const CRACK_CENTS = 80;
/**
 * The pitch tracker ignores input below its gate (RMS 0.008, about −42 dBFS, unless the microphone
 * was calibrated), so a very soft tone has no pitch on purpose; losing the pitch only counts above
 * the gate plus 3 dB. Analyses take the tracker's gate in dB; this is the default.
 */
export const DEFAULT_GATE_DB = 20 * Math.log10(0.008);

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Averages power (not dB) over ±`half` seconds around each frame, so short flickers don't count. */
export function smoothDb(frames: SupportFrame[], half: number): number[] {
  const out: number[] = [];
  let lo = 0;
  let hi = 0;
  let sum = 0;
  for (let i = 0; i < frames.length; i++) {
    const t = frames[i].t;
    while (hi < frames.length && frames[hi].t <= t + half) sum += 10 ** (frames[hi++].db / 10);
    while (frames[lo].t < t - half) sum -= 10 ** (frames[lo++].db / 10);
    out.push(10 * Math.log10(Math.max(1e-12, sum / (hi - lo))));
  }
  return out;
}


/** The sung span: from the first to the last stretch of voice lasting 0.15 s (ignores clicks). */
export function voicedSpan(frames: SupportFrame[], smooth: number[], floorDb: number): { a: number; b: number } | null {
  const voiced = (i: number) => smooth[i] > floorDb + VOICE_DB;
  const lasting = (i: number, dir: 1 | -1) => {
    for (let j = i; j >= 0 && j < frames.length && Math.abs(frames[j].t - frames[i].t) < 0.15; j += dir) if (!voiced(j)) return false;
    return true;
  };
  let a = 0;
  while (a < frames.length && !(voiced(a) && lasting(a, 1))) a++;
  let b = frames.length - 1;
  while (b > a && !(voiced(b) && lasting(b, -1))) b--;
  if (b - a < 10 || frames[b].t - frames[a].t < 1) return null;
  return { a, b };
}

/**
 * Where control gave out between frames a and b: a gap in the voice, a jump in pitch, or the pitch
 * lost while the voice still sounds; each must last a moment. A jump is measured from `expected`
 * (the pitch the exercise expects at that time) when given, else from the running median.
 */
export function findLost(
  frames: SupportFrame[],
  a: number,
  b: number,
  floorDb: number,
  expected?: (t: number) => number,
  /** Also ignore cracks and lost pitch that begin at the onset or the release (as breaks always are). */
  edges = false,
  /** The pitch tracker's gate, dB. */
  gateDb = DEFAULT_GATE_DB,
): { t: number; reason: LostReason } | null {
  const pitchGateDb = gateDb + 3;
  const from = frames[a].t;
  const to = frames[b].t;
  const inner = (t0: number) => !edges || (t0 > from + 0.3 && t0 < to - 0.4);
  let lost: { t: number; reason: LostReason } | null = null;
  const HOLD = 0.12;
  let gapStart: number | null = null;
  let crackStart: number | null = null;
  let noPitchStart: number | null = null;
  const recent: number[] = [];
  for (let i = a; i <= b && !lost; i++) {
    const f = frames[i];
    // Gaps on the raw level: smoothing would blur a short break away.
    if (f.db <= floorDb + VOICE_DB) {
      gapStart ??= f.t;
      // Not at the very soft edges, where coming from and fading into silence is the point.
      if (f.t - gapStart >= HOLD && gapStart > from + 0.3 && gapStart < to - 0.4) lost = { t: gapStart, reason: "break" };
      continue;
    }
    gapStart = null;
    if (f.cents === null) {
      if (f.db < pitchGateDb) {
        noPitchStart = null;
        continue;
      }
      noPitchStart ??= f.t;
      if (f.t - noPitchStart >= 0.25 && inner(noPitchStart)) lost = { t: noPitchStart, reason: "no pitch" };
      continue;
    }
    noPitchStart = null;
    const ref = expected ? expected(f.t) : recent.length >= 20 ? median(recent) : null;
    if (ref !== null && Math.abs(f.cents - ref) > CRACK_CENTS) {
      crackStart ??= f.t;
      if (f.t - crackStart >= HOLD && inner(crackStart)) lost = { t: crackStart, reason: "crack" };
    } else {
      crackStart = null;
      recent.push(f.cents);
      if (recent.length > 60) recent.shift();
    }
  }

  return lost;
}
