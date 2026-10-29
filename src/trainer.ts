import { centsOff, statusColor, type Settings } from "./analysis";
import { midiName, type PitchSample } from "./pitch";

export interface TrainerTarget {
  midi: number;
  /** Where the note comes from, e.g. "Soprano · bar 3". */
  context: string;
}

interface Point {
  time: number;
  cents: number | null;
}

const SPAN_SEC = 8;
const RANGE_CENTS = 150;
const STEADY_SEC = 5;

/** Live view of the sung pitch against a single target note. */
export class PitchTrainer {
  onPrev: () => void = () => {};
  onNext: () => void = () => {};
  /** Called when the reference tone should start (true) or stop (false). */
  onTone: (on: boolean) => void = () => {};

  private target: TrainerTarget | null = null;
  private settings: Settings = { toleranceCents: 25, octaveFree: false, onsetMs: 100 };
  private points: Point[] = [];
  private streakStart: number | null = null;
  private best = 0;
  private toneOn = false;
  private raf = 0;
  private ctx: CanvasRenderingContext2D;
  private $ = (id: string) => this.dlg.querySelector<HTMLElement>(`#${id}`)!;

  constructor(private dlg: HTMLDialogElement) {
    this.ctx = (this.$("trCanvas") as HTMLCanvasElement).getContext("2d")!;
    this.$("trPrev").addEventListener("click", () => this.onPrev());
    this.$("trNext").addEventListener("click", () => this.onNext());
    this.$("trTone").addEventListener("click", () => this.setTone(!this.toneOn));
    this.$("trClose").addEventListener("click", () => this.dlg.close());
    this.dlg.addEventListener("close", () => {
      this.setTone(false);
      cancelAnimationFrame(this.raf);
    });
    this.dlg.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") this.onPrev();
      else if (e.key === "ArrowRight") this.onNext();
      else if (e.code === "Space") {
        e.preventDefault();
        this.setTone(!this.toneOn);
      }
    });
  }

  get isOpen(): boolean {
    return this.dlg.open;
  }

  open(target: TrainerTarget, settings: Settings): void {
    this.settings = settings;
    this.setTarget(target);
    if (!this.dlg.open) this.dlg.showModal();
    const loop = () => {
      this.paint();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    loop();
  }

  setTarget(target: TrainerTarget): void {
    this.target = target;
    this.points = [];
    this.streakStart = null;
    this.best = 0;
    this.$("trTitle").textContent = midiName(target.midi);
    this.$("trContext").textContent = target.context;
    if (this.toneOn) {
      // Restart the tone on the new pitch.
      this.onTone(false);
      this.onTone(true);
    }
  }

  get midi(): number | null {
    return this.target?.midi ?? null;
  }

  push(s: PitchSample): void {
    if (!this.target || !this.dlg.open) return;
    const cents = s.midi === null ? null : centsOff(s.midi, this.target.midi, this.settings.octaveFree);
    this.points.push({ time: s.time, cents });
    const cutoff = s.time - SPAN_SEC - 1;
    while (this.points.length && this.points[0].time < cutoff) this.points.shift();

    const inTune = cents !== null && Math.abs(cents) <= this.settings.toleranceCents;
    if (inTune) {
      this.streakStart ??= s.time;
      this.best = Math.max(this.best, s.time - this.streakStart);
    } else {
      this.streakStart = null;
    }
  }

  private setTone(on: boolean): void {
    if (on === this.toneOn) return;
    this.toneOn = on;
    this.$("trTone").textContent = on ? "Stop note" : "Play note";
    this.$("trTone").classList.toggle("primary", on);
    this.onTone(on);
  }

  private paint(): void {
    const canvas = this.$("trCanvas") as HTMLCanvasElement;
    const ctx = this.ctx;
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(r.width * dpr) || canvas.height !== Math.round(r.height * dpr)) {
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const w = r.width;
    const h = r.height;
    const css = getComputedStyle(canvas);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const tol = this.settings.toleranceCents;
    const LEFT = 52;
    const y = (c: number) => h / 2 - (Math.max(-RANGE_CENTS, Math.min(RANGE_CENTS, c)) / RANGE_CENTS) * (h / 2 - 12);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = v("--roll-bg");
    ctx.fillRect(0, 0, w, h);

    // Tolerance band and target line
    ctx.fillStyle = statusColor("good");
    ctx.globalAlpha = 0.14;
    ctx.fillRect(LEFT, y(tol), w - LEFT, y(-tol) - y(tol));
    ctx.globalAlpha = 1;

    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    const midi = this.target?.midi ?? 69;
    for (let c = -RANGE_CENTS; c <= RANGE_CENTS; c += 25) {
      const yy = Math.round(y(c));
      const major = c % 50 === 0;
      ctx.fillStyle = c === 0 ? statusColor("good") : major ? v("--roll-grid-strong") : v("--roll-grid");
      ctx.fillRect(LEFT, yy - (c === 0 ? 1 : 0), w - LEFT, c === 0 ? 2 : 1);
      if (major) {
        ctx.fillStyle = c === 0 ? v("--fg") : v("--muted");
        const label = c === 0 ? midiName(midi) : Math.abs(c) === 100 ? midiName(midi + c / 100) : `${c > 0 ? "+" : ""}${c}¢`;
        ctx.fillText(label, 8, yy);
      }
    }

    // Trace, newest at the right edge
    const pts = this.points;
    const now = pts.length ? pts[pts.length - 1].time : 0;
    const x = (t: number) => w - 14 - ((now - t) / SPAN_SEC) * (w - LEFT - 14);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (a.cents === null || b.cents === null || b.time - a.time > 0.1 || x(a.time) < LEFT) continue;
      ctx.strokeStyle = statusColor(this.classify(b.cents));
      ctx.beginPath();
      ctx.moveTo(x(a.time), y(a.cents));
      ctx.lineTo(x(b.time), y(b.cents));
      ctx.stroke();
    }

    // Readout
    const last = pts[pts.length - 1];
    const cents = last?.cents ?? null;
    const big = this.$("trCents");
    const state = this.$("trState");
    if (cents === null) {
      big.textContent = "—";
      big.style.color = "";
      state.textContent = "Sing the note";
    } else {
      ctx.fillStyle = statusColor(this.classify(cents));
      ctx.beginPath();
      ctx.arc(x(last.time), y(cents), 6, 0, Math.PI * 2);
      ctx.fill();
      big.textContent = `${cents > 0 ? "+" : ""}${Math.round(cents)}¢`;
      big.style.color = statusColor(this.classify(cents));
      const a = Math.abs(cents);
      state.textContent =
        a <= tol ? "In tune" : a > 600 ? "Wrong octave?" : `${a <= tol * 2 ? "A little" : "Too"} ${cents > 0 ? "sharp" : "flat"}`;
    }

    const recent = pts.filter((p) => p.time >= now - STEADY_SEC && p.cents !== null);
    const share = recent.length ? recent.filter((p) => Math.abs(p.cents!) <= tol).length / recent.length : null;
    const streak = this.streakStart !== null && last ? last.time - this.streakStart : 0;
    this.$("trStats").innerHTML =
      `<div><b>${streak.toFixed(1)} s</b> held in tune</div>` +
      `<div><b>${this.best.toFixed(1)} s</b> longest hold</div>` +
      `<div><b>${share === null ? "–" : `${Math.round(share * 100)}%`}</b> in tune, last ${STEADY_SEC} s</div>`;
  }

  private classify(c: number): "good" | "close" | "off" {
    const a = Math.abs(c);
    const tol = this.settings.toleranceCents;
    return a <= tol ? "good" : a <= tol * 2 ? "close" : "off";
  }
}
