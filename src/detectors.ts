import { PitchDetector } from "pitchy";

/**
 * Pitch detection methods to choose from. Each returns a frequency and a confidence (0..1); what
 * the confidence measures differs per method, so each has its own threshold.
 */

export type DetectorId = "mpm" | "yin" | "harmonic" | "cepstrum";

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

  private yin(buf: Float32Array, sr: number): Estimate | null {
    const W = buf.length / 2;
    const d = this.yinBuf;
    const tauMin = Math.max(2, Math.floor(sr / MAX_HZ));
    const tauMax = Math.min(W - 1, Math.ceil(sr / MIN_HZ));
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
