import { PitchDetector } from "pitchy";

/**
 * Pitch detection methods to choose from. Each returns a frequency and a confidence (0..1); what
 * the confidence measures differs per method, so each has its own threshold.
 */

export type DetectorId = "mpm" | "yin" | "pyin" | "harmonic" | "cepstrum";

export const MIN_HZ = 60;
export const MAX_HZ = 1400;

export interface Estimate {
  hz: number;
  confidence: number;
}

export interface DetectorInfo {
  id: DetectorId;
  label: string;
  /** What the confidence measures. */
  confidence: string;
  /** Default minimum confidence. */
  threshold: number;
  description: string;
}

export const DETECTORS: DetectorInfo[] = [
  {
    id: "mpm",
    label: "McLeod (MPM)",
    confidence: "clarity",
    threshold: 0.88,
    description: "Normalised autocorrelation (the default). Precise and fast on clean, steady tone.",
  },
  {
    id: "yin",
    label: "YIN",
    confidence: "periodicity",
    threshold: 0.8,
    description: "Normalised difference function. Widely used for voice; a little more tolerant of breathy or uneven sound.",
  },
  {
    id: "pyin",
    label: "pYIN",
    confidence: "voicing probability",
    threshold: 0.1,
    description:
      "Probabilistic YIN: keeps several pitch candidates per frame and picks the most plausible line over time, which removes octave jumps and stray readings. Shows the pitch about 75 ms later than the others.",
  },
  {
    id: "harmonic",
    label: "Harmonic spectrum",
    confidence: "harmonicity",
    threshold: 0.45,
    description: "Finds the note whose harmonics carry most of the sound's energy. Copes with buzzy, noisy sounds such as lip trills.",
  },
  {
    id: "cepstrum",
    label: "Cepstrum",
    confidence: "harmonicity",
    threshold: 0.45,
    description: "Finds the regular spacing of the harmonics. Also suited to buzzy sounds; less precise on high notes.",
  },
];

/** Runs the detectors on one window size; reuses its buffers between frames. */
export class DetectorBank {
  private mpm: PitchDetector<Float32Array>;
  private fftSize: number;
  private re: Float64Array;
  private im: Float64Array;
  private mag: Float64Array;
  private hann: Float64Array;
  /** Frame for which the spectrum was last computed (shared by the spectral methods). */
  private spectrumOf: Float32Array | null = null;
  private cmndfOf: Float32Array | null = null;
  private yinBuf: Float64Array;
  // Scratch buffers, allocated once.
  private ar: Float64Array;
  private ai: Float64Array;
  private br: Float64Array;
  private bi: Float64Array;
  private cr: Float64Array;
  private ci: Float64Array;

  constructor(readonly size: number) {
    this.mpm = PitchDetector.forFloat32Array(size);
    this.fftSize = size * 4; // zero-padded for finer frequency resolution
    this.re = new Float64Array(this.fftSize);
    this.im = new Float64Array(this.fftSize);
    this.mag = new Float64Array(this.fftSize / 2);
    this.hann = new Float64Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1)));
    this.yinBuf = new Float64Array(size / 2);
    const n = 2 * size;
    this.ar = new Float64Array(n);
    this.ai = new Float64Array(n);
    this.br = new Float64Array(n);
    this.bi = new Float64Array(n);
    this.cr = new Float64Array(this.fftSize);
    this.ci = new Float64Array(this.fftSize);
  }

  /** Call once per new frame before `detect`, so the spectral methods share one FFT. */
  newFrame(): void {
    this.spectrumOf = null;
    this.cmndfOf = null;
  }

  detect(id: DetectorId, buf: Float32Array, sr: number): Estimate | null {
    let est: Estimate | null;
    switch (id) {
      case "mpm": {
        const [hz, clarity] = this.mpm.findPitch(buf, sr);
        est = { hz, confidence: clarity };
        break;
      }
      case "yin":
        est = this.yin(buf, sr);
        break;
      case "pyin": {
        // Frame by frame, the likeliest candidate; PYinTracker decodes the line over time.
        const cs = this.pyinCandidates(buf, sr);
        const best = cs.reduce<{ hz: number; p: number } | null>((a, c) => (!a || c.p > a.p ? c : a), null);
        est = best && { hz: best.hz, confidence: Math.min(1, cs.reduce((a, c) => a + c.p, 0)) };
        break;
      }
      case "harmonic":
        est = this.harmonic(buf, sr);
        break;
      case "cepstrum":
        est = this.cepstrum(buf, sr);
        break;
    }
    if (!est || !(est.hz >= MIN_HZ && est.hz <= MAX_HZ)) return null;
    return est;
  }

  // --- YIN (de Cheveigné & Kawahara 2002) --------------------------------

  /**
   * YIN's cumulative mean normalised difference d'(τ) of the frame, for lags tauMin..tauMax
   * (computed once per frame; shared by YIN and pYIN).
   */
  cmndf(buf: Float32Array, sr: number): { d: Float64Array; tauMin: number; tauMax: number } {
    const W = buf.length / 2;
    const d = this.yinBuf;
    const tauMin = Math.max(2, Math.floor(sr / MAX_HZ));
    const tauMax = Math.min(W - 1, Math.ceil(sr / MIN_HZ));
    if (this.cmndfOf === buf) return { d, tauMin, tauMax };
    this.cmndfOf = buf;
    // Difference function via cross-correlation of the first half with the whole frame (FFT).
    const { ar, ai, br, bi } = this;
    const n = ar.length;
    ar.fill(0);
    ai.fill(0);
    br.fill(0);
    bi.fill(0);
    for (let i = 0; i < buf.length; i++) br[i] = buf[i];
    for (let i = 0; i < W; i++) ar[i] = buf[i];
    fft(ar, ai, false);
    fft(br, bi, false);
    // r(τ) = Σ a[j] b[j+τ]  →  conj(A)·B
    for (let k = 0; k < n; k++) {
      const re = ar[k] * br[k] + ai[k] * bi[k];
      const im = ar[k] * bi[k] - ai[k] * br[k];
      ar[k] = re;
      ai[k] = im;
    }
    fft(ar, ai, true);
    // Energies of the sliding window b[τ..τ+W).
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += buf[i] * buf[i];
    let eT = e0;
    d[0] = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      eT += buf[tau + W - 1] * buf[tau + W - 1] - buf[tau - 1] * buf[tau - 1];
      d[tau] = e0 + eT - 2 * ar[tau];
    }
    // Cumulative mean normalised difference.
    let running = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }
    return { d, tauMin, tauMax };
  }

  private yin(buf: Float32Array, sr: number): Estimate | null {
    const { d, tauMin, tauMax } = this.cmndf(buf, sr);
    const ABS = 0.2;
    let best = -1;
    for (let tau = tauMin; tau < tauMax; tau++) {
      if (d[tau] < ABS) {
        while (tau + 1 < tauMax && d[tau + 1] < d[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) {
      // No dip below the absolute threshold: take the global minimum (low confidence).
      best = tauMin;
      for (let tau = tauMin; tau < tauMax; tau++) if (d[tau] < d[best]) best = tau;
    }
    const t = best + parabola(d[best - 1], d[best], d[best + 1] ?? d[best]);
    return { hz: sr / t, confidence: Math.max(0, Math.min(1, 1 - d[best])) };
  }

  /**
   * pYIN's per-frame step (Mauch & Dixon 2014): instead of one YIN threshold, a distribution of
   * thresholds; each local minimum of d' gets the probability that it would be YIN's pick.
   */
  pyinCandidates(buf: Float32Array, sr: number): { hz: number; p: number }[] {
    const { d, tauMin, tauMax } = this.cmndf(buf, sr);
    const out: { hz: number; p: number }[] = [];
    let minPrev = Infinity; // smallest d' among earlier minima
    let globalTau = -1;
    for (let tau = tauMin + 1; tau < tauMax; tau++) {
      if (!(d[tau] < d[tau - 1] && d[tau] <= d[tau + 1])) continue;
      if (globalTau < 0 || d[tau] < d[globalTau]) globalTau = tau;
      // Thresholds s with d'(τ) < s ≤ (all earlier minima) pick this minimum.
      if (d[tau] < minPrev) {
        const p = thresholdCdf(Math.min(1, minPrev)) - thresholdCdf(d[tau]);
        if (p > 1e-4) out.push({ hz: sr / (tau + parabola(d[tau - 1], d[tau], d[tau + 1])), p });
        minPrev = d[tau];
      }
    }
    // Thresholds below every minimum: YIN falls back to the global minimum, trusted little.
    if (globalTau >= 0) {
      const p = 0.01 * thresholdCdf(d[globalTau]);
      const hz = sr / (globalTau + parabola(d[globalTau - 1], d[globalTau], d[globalTau + 1]));
      const same = out.find((c) => Math.abs(c.hz - hz) < 1e-6);
      if (same) same.p += p;
      else if (p > 1e-4) out.push({ hz, p });
    }
    return out.filter((c) => c.hz >= MIN_HZ && c.hz <= MAX_HZ);
  }

  // --- spectral methods ----------------------------------------------------

  private spectrum(buf: Float32Array): void {
    if (this.spectrumOf === buf) return;
    const { re, im, mag, hann } = this;
    re.fill(0);
    im.fill(0);
    let mean = 0;
    for (let i = 0; i < buf.length; i++) mean += buf[i];
    mean /= buf.length;
    for (let i = 0; i < buf.length; i++) re[i] = (buf[i] - mean) * hann[i];
    fft(re, im, false);
    for (let k = 0; k < mag.length; k++) mag[k] = Math.hypot(re[k], im[k]);
    this.spectrumOf = buf;
  }

  /** Magnitude at a frequency, linearly interpolated between bins. */
  private magAt(hz: number, sr: number): number {
    const k = (hz / sr) * this.fftSize;
    const i = Math.floor(k);
    if (i < 0 || i + 1 >= this.mag.length) return 0;
    return this.mag[i] + (k - i) * (this.mag[i + 1] - this.mag[i]);
  }

  private harmonic(buf: Float32Array, sr: number): Estimate | null {
    this.spectrum(buf);
    const top = Math.min(5000, sr / 2 - 100);
    // Score each candidate (1/20 semitone grid) by the compressed magnitude at its harmonics minus
    // that halfway between them (rejects the octave above), weighting harmonic h by 1/h (favours
    // the candidate whose lowest harmonics are strong, rejecting the octave and twelfth above).
    const steps = Math.round(12 * 20 * Math.log2(MAX_HZ / MIN_HZ));
    let bestI = -1;
    let bestS = -Infinity;
    const scores = new Float64Array(steps + 1);
    for (let i = 0; i <= steps; i++) {
      const f = MIN_HZ * 2 ** (i / 240);
      const H = Math.max(1, Math.min(20, Math.floor(top / f)));
      let on = 0;
      let off = 0;
      for (let h = 1; h <= H; h++) {
        on += Math.sqrt(this.magAt(h * f, sr)) / h;
        off += Math.sqrt(this.magAt((h - 0.5) * f, sr)) / h;
      }
      const s = on - off;
      scores[i] = s;
      if (s > bestS) {
        bestS = s;
        bestI = i;
      }
    }
    if (bestI < 0 || bestS <= 0) return null;
    const di = parabola(scores[bestI - 1] ?? bestS, bestS, scores[bestI + 1] ?? bestS);
    const f0 = this.refine(buf, sr, MIN_HZ * 2 ** ((bestI + di) / 240));
    return { hz: f0, confidence: this.harmonicity(f0, sr) };
  }

  private cepstrum(buf: Float32Array, sr: number): Estimate | null {
    this.spectrum(buf);
    const n = this.fftSize;
    const { cr, ci } = this;
    ci.fill(0);
    const half = this.mag.length;
    const hiBin = Math.floor((Math.min(5000, sr / 2) / sr) * n);
    // Band-limit to where the voice's harmonics are: above that, a flat log spectrum at the band's
    // mean (a hard step would ripple through the cepstrum).
    // Floor at −60 dB below the peak, so near-silent bins don't dominate the log spectrum.
    let peak = 0;
    for (let k = 0; k <= hiBin; k++) peak = Math.max(peak, this.mag[k]);
    const floor = peak * 1e-3 + 1e-12;
    let mean = 0;
    for (let k = 0; k <= hiBin; k++) mean += Math.log(Math.max(floor, this.mag[k]));
    mean /= hiBin + 1;
    for (let k = 0; k <= half; k++) {
      const v = k <= hiBin ? Math.log(Math.max(floor, this.mag[k])) - mean : 0;
      cr[k] = v;
      if (k && k < n / 2) cr[n - k] = v;
    }
    fft(cr, ci, true);
    // Quefrency in samples of the zero-padded spectrum equals samples of the signal.
    const qMin = Math.floor(sr / MAX_HZ);
    const qMax = Math.min(buf.length - 2, Math.ceil(sr / MIN_HZ));
    let best = qMin;
    for (let q = qMin; q <= qMax; q++) if (cr[q] > cr[best]) best = q;
    const q = best + parabola(cr[best - 1], cr[best], cr[best + 1]);
    const f0 = this.refine(buf, sr, sr / q);
    return { hz: f0, confidence: this.harmonicity(f0, sr) };
  }

  /**
   * Share of the energy (60–5000 Hz) that lies on the harmonics of f0, beyond what noise would put
   * there by chance: 0 for noise, 1 for a purely harmonic sound.
   */
  private harmonicity(f0: number, sr: number): number {
    const binHz = sr / this.fftSize;
    const lo = Math.ceil(MIN_HZ / binHz);
    const hi = Math.min(this.mag.length - 1, Math.floor(5000 / binHz));
    // Most of a harmonic's energy: ±1 bin of the unpadded frame, but at most a sixth of the spacing.
    const width = Math.min(sr / this.size, f0 / 6);
    let total = 0;
    let on = 0;
    let onBins = 0;
    for (let k = lo; k <= hi; k++) {
      const p = this.mag[k] * this.mag[k];
      total += p;
      const hz = k * binHz;
      const h = Math.round(hz / f0);
      if (h >= 1 && Math.abs(hz - h * f0) <= width) {
        on += p;
        onBins++;
      }
    }
    if (!total) return 0;
    const chance = onBins / (hi - lo + 1);
    return Math.max(0, (on / total - chance) / (1 - chance));
  }

  /** Sharpens a spectral estimate with the autocorrelation peak near its period. */
  private refine(buf: Float32Array, sr: number, hz: number): number {
    const T = sr / hz;
    const lo = Math.max(2, Math.floor(T * 0.94));
    const hi = Math.min(buf.length / 2, Math.ceil(T * 1.06));
    if (hi <= lo + 1) return hz;
    const W = buf.length - hi;
    const r = (tau: number) => {
      let s = 0;
      let e1 = 0;
      let e2 = 0;
      for (let i = 0; i < W; i++) {
        s += buf[i] * buf[i + tau];
        e1 += buf[i] * buf[i];
        e2 += buf[i + tau] * buf[i + tau];
      }
      return e1 && e2 ? s / Math.sqrt(e1 * e2) : 0;
    };
    const vals: number[] = [];
    for (let t = lo - 1; t <= hi + 1; t++) vals.push(r(t));
    let best = 1;
    for (let i = 1; i < vals.length - 1; i++) if (vals[i] > vals[best]) best = i;
    if (best === 0 || best === vals.length - 1 || vals[best] < 0.3) return hz;
    return sr / (lo - 1 + best + parabola(vals[best - 1], vals[best], vals[best + 1]));
  }
}

// --- pYIN ----------------------------------------------------------------

/** Threshold prior: Beta(2, 18) (mean 0.1) on 0.01..1, as a cumulative distribution. */
const THRESHOLD_CDF = (() => {
  const n = 100;
  const pdf = Array.from({ length: n }, (_, i) => {
    const x = (i + 1) / n;
    return x * (1 - x) ** 17;
  });
  const total = pdf.reduce((a, b) => a + b, 0);
  const cdf = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) cdf[i + 1] = cdf[i] + pdf[i] / total;
  return cdf;
})();

/** Share of thresholds at or below s. */
function thresholdCdf(s: number): number {
  if (s <= 0) return 0;
  if (s >= 1) return 1;
  return THRESHOLD_CDF[Math.floor(s * 100)];
}

/** Pitch grid of the HMM: 20-cent bins (5 per semitone). */
const BINS_PER_SEMITONE = 5;
const MIDI_LO = 69 + 12 * Math.log2(MIN_HZ / 440);
const N_BINS = Math.ceil((69 + 12 * Math.log2(MAX_HZ / 440) - MIDI_LO) * BINS_PER_SEMITONE) + 1;
/** Largest pitch change between frames (≈15 ms apart), in bins: 5 semitones. */
const MAX_STEP = 25;
const SWITCH = 0.01; // voiced ↔ unvoiced
/** How much the candidate probabilities are trusted (pYIN's "YIN trust"). */
const TRUST = 0.5;
/** Frames decided this many frames late: the line is fixed once later frames confirm it. */
export const PYIN_LAG = 5;

const binOf = (hz: number) => Math.round((69 + 12 * Math.log2(hz / 440) - MIDI_LO) * BINS_PER_SEMITONE);
const binHz = (b: number) => 440 * 2 ** ((MIDI_LO + b / BINS_PER_SEMITONE - 69) / 12);

/** Triangular log weights of a pitch step of −MAX_STEP..MAX_STEP bins. */
const STEP_LOG = (() => {
  const w = Array.from({ length: 2 * MAX_STEP + 1 }, (_, i) => MAX_STEP + 1 - Math.abs(i - MAX_STEP));
  const total = w.reduce((a, b) => a + b, 0);
  return w.map((x) => Math.log(x / total));
})();

interface PyinFrame {
  time: number;
  candidates: { hz: number; p: number }[];
  /** Best predecessor state for each state. */
  back: Int16Array;
}

/**
 * Online pYIN: the candidates of each frame feed a hidden Markov model over pitch bins, each
 * voiced or unvoiced, decoded with Viterbi over the last few frames (fixed-lag), so the output is
 * the most plausible pitch line rather than each frame's own best guess.
 */
export class PYinTracker {
  private delta = new Float64Array(2 * N_BINS);
  private next = new Float64Array(2 * N_BINS);
  private frames: PyinFrame[] = [];
  private started = false;

  reset(): void {
    this.frames = [];
    this.started = false;
  }

  /**
   * Adds a frame (candidates empty for silence) and returns the decision for the frame PYIN_LAG
   * frames back, or null while there aren't enough frames yet.
   */
  push(time: number, candidates: { hz: number; p: number }[]): { time: number; estimate: Estimate | null } | null {
    const N = N_BINS;
    // Observation log-probabilities.
    const voicedSum = Math.min(0.99, candidates.reduce((a, c) => a + c.p, 0));
    const obsV = new Float64Array(N).fill(-Infinity);
    for (const c of candidates) {
      const b = binOf(c.hz);
      if (b < 0 || b >= N) continue;
      const v = Math.log(TRUST * c.p);
      obsV[b] = obsV[b] === -Infinity ? v : Math.log(Math.exp(obsV[b]) + TRUST * c.p);
    }
    const obsU = Math.log((1 - TRUST * voicedSum) / N);

    const back = new Int16Array(2 * N);
    if (!this.started) {
      for (let b = 0; b < N; b++) {
        this.delta[b] = Math.log(0.5 / N) + obsV[b];
        this.delta[N + b] = Math.log(0.5 / N) + obsU;
      }
      this.started = true;
    } else {
      const stay = Math.log(1 - SWITCH);
      const swap = Math.log(SWITCH);
      for (let b = 0; b < N; b++) {
        let bestV = -Infinity;
        let argV = 0;
        let bestU = -Infinity;
        let argU = N;
        const lo = Math.max(0, b - MAX_STEP);
        const hi = Math.min(N - 1, b + MAX_STEP);
        for (let a = lo; a <= hi; a++) {
          const w = STEP_LOG[a - b + MAX_STEP];
          const fromV = this.delta[a] + w;
          const fromU = this.delta[N + a] + w;
          // Into voiced b
          const v1 = fromV + stay;
          const v2 = fromU + swap;
          if (v1 > bestV) (bestV = v1), (argV = a);
          if (v2 > bestV) (bestV = v2), (argV = N + a);
          // Into unvoiced b
          const u1 = fromU + stay;
          const u2 = fromV + swap;
          if (u1 > bestU) (bestU = u1), (argU = N + a);
          if (u2 > bestU) (bestU = u2), (argU = a);
        }
        this.next[b] = bestV + obsV[b];
        this.next[N + b] = bestU + obsU;
        back[b] = argV;
        back[N + b] = argU;
      }
      // Keep the numbers in range.
      let max = -Infinity;
      for (let i = 0; i < 2 * N; i++) if (this.next[i] > max) max = this.next[i];
      for (let i = 0; i < 2 * N; i++) this.delta[i] = this.next[i] - max;
    }
    this.frames.push({ time, candidates, back });
    if (this.frames.length > PYIN_LAG + 1) this.frames.shift();
    if (this.frames.length < PYIN_LAG + 1) return null;

    // Backtrack from the best current state to the frame PYIN_LAG back.
    let state = 0;
    for (let i = 1; i < 2 * N; i++) if (this.delta[i] > this.delta[state]) state = i;
    for (let k = this.frames.length - 1; k > 0; k--) state = this.frames[k].back[state];
    const frame = this.frames[0];
    if (state >= N) return { time: frame.time, estimate: null };
    // The exact pitch: the frame's candidate in (or nearest to) the chosen bin.
    let hz = binHz(state);
    let nearest = Infinity;
    for (const c of frame.candidates) {
      const dist = Math.abs(binOf(c.hz) - state);
      if (dist <= 1 && dist < nearest) (nearest = dist), (hz = c.hz);
    }
    const p = frame.candidates.reduce((a, c) => a + c.p, 0);
    return { time: frame.time, estimate: { hz, confidence: Math.min(1, p) } };
  }
}

/** Offset (−0.5..0.5) of the vertex of the parabola through three equally spaced points. */
function parabola(a: number, b: number, c: number): number {
  const den = a - 2 * b + c;
  if (!den || !Number.isFinite(den)) return 0;
  return Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}

/** In-place iterative radix-2 FFT; `inverse` also scales by 1/n. */
function fft(re: Float64Array, im: Float64Array, inverse: boolean): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const t = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = t;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) (re[i] /= n), (im[i] /= n);
}
