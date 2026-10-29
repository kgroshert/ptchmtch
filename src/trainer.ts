import { centsOff, statusColor, type Settings } from "./analysis";
import type { TrainerSession } from "./history";
import { midiName, type PitchSample } from "./pitch";
import { analyseVibrato, describeVibrato, oscillates, type PitchPoint } from "./vibrato";

export interface TrainerTarget {
  midi: number;
  /** Where the note comes from, e.g. "Soprano · bar 3". */
  context: string;
}

interface Point {
  time: number;
  cents: number | null;
  /** The pitch as judged: the vibrato centre while a vibrato is detected, else the raw pitch. */
  judged: number | null;
}

const SPAN_SEC = 8;
const RANGE_CENTS = 150;
const STEADY_SEC = 5;
/** Live vibrato is measured over this much of the current held stretch. */
const VIBRATO_SEC = 1.5;
/** Practice shorter than this isn't recorded. */
const MIN_SESSION_SEC = 2;
/** A dropout longer than this ends a held stretch. */
const MAX_GAP = 0.06;

/** Live view of the sung pitch against a single target note. */
export class PitchTrainer {
  onPrev: () => void = () => {};
  onNext: () => void = () => {};
  /** Called when the reference tone should start (true) or stop (false). */
  onTone: (on: boolean) => void = () => {};
  /** Called when practice on a note ends (another note, or closing), if it lasted long enough. */
  onSession: (s: TrainerSession) => void = () => {};

  private target: TrainerTarget | null = null;
  private settings: Settings = { toleranceCents: 25, octaveFree: false, onsetMs: 100 };
  private points: Point[] = [];
  private streakStart: number | null = null;
  private best = 0;
  /** One vibrato cycle while a vibrato is detected, else 0 (judge the raw pitch). */
  private cycleSec = 0;
  private toneOn = false;
  // Session totals for the current note.
  private voicedSec = 0;
  private inTuneSec = 0;
  private absCentsSec = 0;
  private held: PitchPoint[] = [];
  private longestHeld: PitchPoint[] = [];
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
      this.flush();
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
    this.flush();
    this.target = target;
    this.points = [];
    this.streakStart = null;
    this.best = 0;
    this.voicedSec = this.inTuneSec = this.absCentsSec = 0;
    this.held = [];
    this.longestHeld = [];
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
    const prev = this.points[this.points.length - 1];

    // Session totals and the current uninterrupted held stretch (for vibrato).
    const last = this.held[this.held.length - 1];
    if (cents === null || (last && s.time - last.time > MAX_GAP)) this.endHeld();
    let judged = cents;
    if (cents !== null) {
      this.held.push({ time: s.time, cents });
      if (this.cycleSec) {
        // Average over the last vibrato cycle: listeners hear the centre as the pitch.
        const recent = this.held.filter((p) => p.time > s.time - this.cycleSec);
        judged = recent.reduce((a, p) => a + p.cents, 0) / recent.length;
      }
      if (prev?.cents != null && s.time - prev.time <= MAX_GAP) {
        const dt = s.time - prev.time;
        this.voicedSec += dt;
        this.absCentsSec += Math.abs(judged!) * dt;
        if (Math.abs(judged!) <= this.settings.toleranceCents) this.inTuneSec += dt;
      }
    }
    this.points.push({ time: s.time, cents, judged });
    const cutoff = s.time - SPAN_SEC - 1;
    while (this.points.length && this.points[0].time < cutoff) this.points.shift();

    const inTune = judged !== null && Math.abs(judged) <= this.settings.toleranceCents;
    if (inTune) {
      this.streakStart ??= s.time;
      this.best = Math.max(this.best, s.time - this.streakStart);
    } else {
      this.streakStart = null;
    }
  }

  private endHeld(): void {
    if (this.held.length > this.longestHeld.length) this.longestHeld = this.held;
    this.held = [];
  }

  /** Reports the practice on the current note, if there was enough of it. */
  private flush(): void {
    this.endHeld();
    if (!this.target || this.voicedSec < MIN_SESSION_SEC) return;
    this.onSession({
      date: Date.now(),
      midi: this.target.midi,
      context: this.target.context,
      voicedSec: this.voicedSec,
      inTune: this.inTuneSec / this.voicedSec,
      longestHold: this.best,
      meanAbsCents: this.absCentsSec / this.voicedSec,
      vibrato: analyseVibrato(this.longestHeld),
    });
    this.voicedSec = 0; // reported once
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
      ctx.strokeStyle = statusColor(this.classify(b.judged ?? b.cents));
      ctx.beginPath();
      ctx.moveTo(x(a.time), y(a.cents));
      ctx.lineTo(x(b.time), y(b.cents));
      ctx.stroke();
    }

    // Readout
    const last = pts[pts.length - 1];
    // The number and colour follow the judged pitch; the dot sits on the raw trace.
    const cents = last?.judged ?? null;
    const big = this.$("trCents");
    const state = this.$("trState");
    if (cents === null) {
      big.textContent = "—";
      big.style.color = "";
      state.textContent = "Sing the note";
    } else {
      ctx.fillStyle = statusColor(this.classify(cents));
      ctx.beginPath();
      ctx.arc(x(last.time), y(last.cents ?? cents), 6, 0, Math.PI * 2);
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
    const recentHeld = this.held.filter((p) => p.time >= now - VIBRATO_SEC);
    const vib = analyseVibrato(recentHeld);
    this.cycleSec = oscillates(vib) ? 1 / vib.rate : 0;
    this.$("trVibrato").textContent = vib ? `Vibrato: ${describeVibrato(vib)}` : "Vibrato: hold the note to measure";
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
