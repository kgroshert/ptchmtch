import type { PitchTracker } from "./pitch";
import type { Player } from "./player";

const BPM = 90;
const COUNT_IN = 4;
const BEATS = 16;
/** The first beats are often off while the singer finds the pulse. */
const SKIP = 2;
/** Envelope resolution: 64 samples ≈ 1.3 ms at 48 kHz. */
const BLOCK = 64;
/** Silence needed before a new "ba" counts as an onset. */
const QUIET_SEC = 0.06;
/** Onsets are matched to a beat within this window around it. */
const EARLY_SEC = 0.15;
const LATE_SEC = 0.5;
/** Plot range of the result chart, in ms. */
const PLOT_MIN = -150;
const PLOT_MAX = 500;

export interface CalibrationDeps {
  player: () => Player;
  /** Turns the microphone on if needed; null if unavailable. */
  mic: () => Promise<PitchTracker | null>;
  /** Pitch for the calibration notes (somewhere comfortable for the selected part). */
  midi: () => number;
  /** The latency the browser reports, in ms; the correction is measured on top of it. */
  reportedMs: () => number;
  /** Stores the correction in ms. */
  apply: (correctionMs: number) => void;
}

/**
 * Measures the full delay from a scheduled note to the singer's voice reaching the analyser
 * (output latency + reaction + input latency): the singer says "ba" on each of a series of beats,
 * and the start of each syllable is located in the raw microphone signal.
 */
export class Calibration {
  private targets: number[] = [];
  private offsets: (number | null)[] = [];
  private floor: number[] = [];
  private high = 0;
  private low = 0;
  private armed = false;
  private quietSince: number | null = null;
  private lastEnd = 0;
  private tracker: PitchTracker | null = null;
  private timer = 0;
  private raf = 0;
  private resultMs: number | null = null;
  private $ = (id: string) => this.dlg.querySelector<HTMLElement>(`#${id}`)!;

  constructor(
    private dlg: HTMLDialogElement,
    private deps: CalibrationDeps,
  ) {
    this.$("calStart").addEventListener("click", () => void this.start());
    this.$("calApply").addEventListener("click", () => {
      if (this.resultMs === null) return;
      this.deps.apply(Math.round(this.resultMs - this.deps.reportedMs()));
      this.dlg.close();
    });
    this.$("calClose").addEventListener("click", () => this.dlg.close());
    this.dlg.addEventListener("close", () => this.reset());
  }

  open(): void {
    this.reset();
    this.$("calStatus").textContent = "Put on your headphones, then press Start.";
    this.dlg.showModal();
    this.paint();
  }

  private reset(): void {
    clearTimeout(this.timer);
    cancelAnimationFrame(this.raf);
    if (this.tracker) this.tracker.onBuffer = null;
    if (this.targets.length && this.resultMs === null) this.deps.player().stop(); // cancelled mid-run
    this.targets = [];
    this.offsets = [];
    this.resultMs = null;
    (this.$("calApply") as HTMLButtonElement).disabled = true;
    (this.$("calStart") as HTMLButtonElement).disabled = false;
    this.$("calStart").textContent = "Start";
  }

  private async start(): Promise<void> {
    this.reset();
    this.tracker = await this.deps.mic();
    if (!this.tracker) {
      this.$("calStatus").textContent = "The microphone is needed for calibration.";
      return;
    }
    (this.$("calStart") as HTMLButtonElement).disabled = true;
    this.floor = [];
    this.high = this.low = 0;
    this.armed = false;
    this.quietSince = null;
    this.lastEnd = 0;
    this.tracker.onBuffer = (buf, end) => this.feed(buf, end);
    this.targets = await this.deps.player().playCalibration(this.deps.midi(), BPM, COUNT_IN, BEATS);
    this.offsets = this.targets.map(() => null);
    const ctx = this.deps.player().ctx;
    const done = this.targets[this.targets.length - 1] + 0.9;
    this.timer = window.setTimeout(() => this.finish(), (done - ctx.currentTime) * 1000);
    const tick = () => {
      const now = ctx.currentTime;
      const beat = this.targets.findIndex((t) => t > now);
      if (now < this.targets[0]) this.$("calStatus").textContent = `Get ready… say "ba" on each note after the ${COUNT_IN} clicks.`;
      else this.$("calStatus").textContent = `Say "ba" on each note: ${beat < 0 ? BEATS : beat} / ${BEATS}`;
      this.paint();
      this.raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Scans the newest part of the microphone buffer for the start of a syllable. */
  private feed(buf: Float32Array, end: number): void {
    const sr = this.deps.player().ctx.sampleRate;
    let fresh = this.lastEnd ? Math.round((end - this.lastEnd) * sr) : buf.length;
    fresh = Math.max(0, Math.min(buf.length, fresh));
    this.lastEnd = end;
    const firstTarget = this.targets[0] ?? Infinity;

    for (let i = buf.length - fresh; i + BLOCK <= buf.length; i += BLOCK) {
      let sum = 0;
      for (let j = i; j < i + BLOCK; j++) sum += buf[j] * buf[j];
      const rms = Math.sqrt(sum / BLOCK);
      const t = end - (buf.length - i) / sr;

      // The count-in (singer silent) gives the noise floor.
      if (t < firstTarget - 0.25) {
        this.floor.push(rms);
        continue;
      }
      if (!this.high) {
        const sorted = [...this.floor].sort((a, b) => a - b);
        const floor = sorted[Math.floor(sorted.length / 2)] ?? 0;
        this.high = Math.max(0.015, floor * 8);
        this.low = Math.max(0.006, floor * 3);
        this.armed = true;
      }
      if (rms < this.low) {
        this.quietSince ??= t;
        if (t - this.quietSince >= QUIET_SEC) this.armed = true;
      } else {
        this.quietSince = null;
        if (this.armed && rms > this.high) {
          this.armed = false;
          this.onset(t);
        }
      }
    }
  }

  private onset(t: number): void {
    for (let i = 0; i < this.targets.length; i++) {
      const d = t - this.targets[i];
      if (d >= -EARLY_SEC && d <= LATE_SEC) {
        this.offsets[i] ??= d * 1000; // first onset per beat
        return;
      }
    }
  }

  private finish(): void {
    cancelAnimationFrame(this.raf);
    if (this.tracker) this.tracker.onBuffer = null;
    (this.$("calStart") as HTMLButtonElement).disabled = false;
    this.$("calStart").textContent = "Try again";

    const used = this.offsets.slice(SKIP).filter((o): o is number => o !== null);
    const needed = Math.ceil((BEATS - SKIP) / 2);
    if (used.length < needed) {
      this.$("calStatus").textContent =
        `Only ${used.length} of ${BEATS - SKIP} syllables were detected. Say "ba" a little louder, close to the microphone, with a short pause between them.`;
      this.paint();
      return;
    }
    const sorted = [...used].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const spread = [...used.map((o) => Math.abs(o - median))].sort((a, b) => a - b)[Math.floor(used.length / 2)];
    const reported = Math.round(this.deps.reportedMs());
    const correction = Math.round(median - reported);
    this.resultMs = median;
    (this.$("calApply") as HTMLButtonElement).disabled = false;
    const steady = spread <= 40;
    this.$("calStatus").innerHTML =
      `Your voice arrives <b>${Math.round(median)} ms</b> after the note ` +
      `(±${Math.round(spread)} ms, ${used.length} of ${BEATS - SKIP} syllables detected). ` +
      `The browser reports ${reported} ms, so the correction is <b>${correction >= 0 ? "+" : ""}${correction} ms</b>.` +
      (steady ? "" : `<br>Your timing varied quite a bit; consider trying again for a steadier result.`);
    this.paint();
  }

  private paint(): void {
    const canvas = this.$("calCanvas") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width;
    const h = r.height;
    const css = getComputedStyle(canvas);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const x = (ms: number) => 10 + ((ms - PLOT_MIN) / (PLOT_MAX - PLOT_MIN)) * (w - 20);

    ctx.fillStyle = v("--roll-bg");
    ctx.fillRect(0, 0, w, h);
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "center";
    // Label every grid line when there is room, otherwise every other one.
    const labelEvery = x(100) - x(0) < 56 ? 200 : 100;
    for (let ms = -100; ms <= PLOT_MAX; ms += 100) {
      ctx.fillStyle = ms === 0 ? v("--fg") : v("--roll-grid-strong");
      ctx.fillRect(Math.round(x(ms)), 6, ms === 0 ? 2 : 1, h - 26);
      if (ms % labelEvery !== 0) continue;
      ctx.fillStyle = v("--muted");
      ctx.fillText(ms === 0 ? "note" : `${ms > 0 ? "+" : ""}${ms} ms`, x(ms), h - 8);
    }
    const rows = BEATS;
    this.offsets.forEach((o, i) => {
      if (o === null) return;
      const y = 10 + (i / rows) * (h - 40);
      ctx.fillStyle = i < SKIP ? v("--muted") : v("--accent");
      ctx.beginPath();
      ctx.arc(x(Math.max(PLOT_MIN, Math.min(PLOT_MAX, o))), y, 4, 0, Math.PI * 2);
      ctx.fill();
    });
    if (this.resultMs !== null) {
      ctx.fillStyle = "#1f9d55";
      ctx.fillRect(Math.round(x(this.resultMs)) - 1, 6, 3, h - 26);
    }
  }
}
