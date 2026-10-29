import { centsOff, statusColor, type NoteResult, type Settings, type TakeSample } from "./analysis";
import { midiName } from "./pitch";
import type { Measure, NoteEvent, Track } from "./score";

export interface RollModel {
  track: Track | null;
  measures: Measure[];
  range: { start: number; end: number };
  playhead: number | null;
  current: TakeSample[];
  previous: TakeSample[];
  results: Map<number, NoteResult>;
  settings: Settings;
}

const GUTTER = 46;
const RULER = 22;
const NATURAL = [true, false, true, false, true, true, false, true, false, true, false, true];

/** Piano-roll view: target notes as bars, the sung pitch as a line on top. */
export class PitchRoll {
  pxPerBeat = 56;
  viewStart = 0;
  /** Keep the playhead in view while playing. */
  follow = true;
  onRangeSelect: (fromMeasure: number, toMeasure: number) => void = () => {};

  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private model: RollModel | null = null;
  private drag: { kind: "pan"; x: number; view: number } | { kind: "range"; from: number; to: number } | null = null;
  private hoverX: number | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private tip: HTMLElement,
  ) {
    this.ctx = canvas.getContext("2d")!;
    new ResizeObserver(() => this.resize()).observe(canvas);
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointerleave", () => {
      this.hoverX = null;
      this.tip.hidden = true;
    });
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
  }

  get visibleBeats(): number {
    return (this.w - GUTTER) / this.pxPerBeat;
  }

  zoom(factor: number, anchorX = GUTTER + (this.w - GUTTER) / 2): void {
    const anchorBeat = this.xToBeat(anchorX);
    this.pxPerBeat = Math.min(400, Math.max(12, this.pxPerBeat * factor));
    this.viewStart = anchorBeat - (anchorX - GUTTER) / this.pxPerBeat;
    this.redraw();
  }

  /** Scroll so that `beat` is visible (at 20% from the left edge). */
  reveal(beat: number): void {
    this.viewStart = beat - this.visibleBeats * 0.2;
  }

  draw(model: RollModel): void {
    this.model = model;
    if (this.follow && model.playhead !== null) {
      const vb = this.visibleBeats;
      if (model.playhead > this.viewStart + vb * 0.75 || model.playhead < this.viewStart) this.reveal(model.playhead);
    }
    this.paint();
  }

  redraw(): void {
    if (this.model) this.paint();
  }

  // --- geometry -----------------------------------------------------------

  private xToBeat(x: number): number {
    return this.viewStart + (x - GUTTER) / this.pxPerBeat;
  }

  private beatToX(b: number): number {
    return GUTTER + (b - this.viewStart) * this.pxPerBeat;
  }

  private pitchSpan(): [number, number] {
    const t = this.model?.track;
    let lo = t ? t.minMidi - 4 : 55;
    let hi = t ? t.maxMidi + 4 : 79;
    while (hi - lo < 16) {
      lo--;
      hi++;
    }
    return [lo, hi];
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.redraw();
  }

  // --- painting -----------------------------------------------------------

  private paint(): void {
    const m = this.model!;
    const { ctx, w, h } = this;
    const css = getComputedStyle(this.canvas);
    const v = (n: string) => css.getPropertyValue(n).trim();
    const [lo, hi] = this.pitchSpan();
    const rowH = (h - RULER) / (hi - lo + 1);
    const yOf = (midi: number) => RULER + (hi - midi + 0.5) * rowH;
    const b0 = this.viewStart;
    const b1 = this.xToBeat(w);

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = v("--roll-bg");
    ctx.fillRect(0, 0, w, h);

    // Pitch rows
    for (let p = lo; p <= hi; p++) {
      const y = RULER + (hi - p) * rowH;
      if (!NATURAL[((p % 12) + 12) % 12]) {
        ctx.fillStyle = v("--roll-sharp");
        ctx.fillRect(GUTTER, y, w - GUTTER, rowH);
      }
      if (p % 12 === 0) {
        ctx.fillStyle = v("--roll-grid-strong");
        ctx.fillRect(GUTTER, y + rowH - 1, w - GUTTER, 1);
      }
    }

    // Range shading (outside the practice range)
    ctx.fillStyle = v("--roll-outside");
    const rx0 = this.beatToX(m.range.start);
    const rx1 = this.beatToX(m.range.end);
    if (rx0 > GUTTER) ctx.fillRect(GUTTER, RULER, rx0 - GUTTER, h - RULER);
    if (rx1 < w) ctx.fillRect(Math.max(GUTTER, rx1), RULER, w - Math.max(GUTTER, rx1), h - RULER);

    // Measures and beats
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    for (const ms of m.measures) {
      if (ms.end < b0 || ms.start > b1) continue;
      for (let k = 1; k < ms.beatsPerBar; k++) {
        const x = Math.round(this.beatToX(ms.start + k * ms.beatLength));
        ctx.fillStyle = v("--roll-grid");
        ctx.fillRect(x, RULER, 1, h - RULER);
      }
      const x = Math.round(this.beatToX(ms.start));
      ctx.fillStyle = v("--roll-grid-strong");
      ctx.fillRect(x, 0, 1, h);
      ctx.fillStyle = v("--muted");
      ctx.fillText(String(ms.number), x + 4, RULER / 2);
    }

    // Ruler: selected range
    ctx.fillStyle = v("--accent-soft");
    const sel = this.drag?.kind === "range" ? this.dragRangeBeats() : m.range;
    ctx.fillRect(this.beatToX(sel.start), 0, (sel.end - sel.start) * this.pxPerBeat, RULER);
    ctx.fillStyle = v("--roll-grid-strong");
    ctx.fillRect(GUTTER, RULER - 1, w - GUTTER, 1);

    // Target notes with tolerance band
    const tolH = Math.max(2, (rowH * m.settings.toleranceCents * 2) / 100);
    for (const ev of m.track?.events ?? []) {
      if (ev.end < b0 || ev.start > b1) continue;
      const x = this.beatToX(ev.start) + 1;
      const wd = Math.max(2, (ev.end - ev.start) * this.pxPerBeat - 2);
      const y = yOf(ev.midi);
      const res = m.results.get(ev.id);
      const col = res ? statusColor(res.status) : v("--target");
      ctx.globalAlpha = 0.18;
      ctx.fillStyle = col;
      ctx.fillRect(x, y - rowH / 2, wd, rowH);
      ctx.globalAlpha = 0.35;
      ctx.fillRect(x, y - tolH / 2, wd, tolH);
      ctx.globalAlpha = 1;
      ctx.fillStyle = col;
      ctx.fillRect(x, y - 1, wd, 2);
      const kind = res?.onset?.kind;
      if (kind === "scoop" || kind === "fall") {
        // Small ramp into the start of the bar, from the side the singer came from.
        const dy = kind === "scoop" ? rowH * 0.9 : -rowH * 0.9;
        ctx.strokeStyle = statusColor("close");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 7, y + dy);
        ctx.lineTo(x + 2, y);
        ctx.stroke();
      }
      if (res && res.status !== "missed" && wd > 34) {
        ctx.fillStyle = v("--fg");
        ctx.font = "10px system-ui, sans-serif";
        ctx.fillText(`${res.cents > 0 ? "+" : ""}${Math.round(res.cents)}¢`, x + 3, y - rowH / 2 - 6 < RULER ? y + rowH / 2 + 7 : y - rowH / 2 - 6);
        ctx.font = "11px system-ui, sans-serif";
      }
    }

    // Sung pitch
    this.paintTake(m.previous, () => v("--take-prev"), yOf, 1.5);
    this.paintTake(m.current, (c) => (c === null ? v("--take-free") : statusColor(this.classify(c))), yOf, 2.5);

    // Playhead
    if (m.playhead !== null) {
      const x = Math.round(this.beatToX(m.playhead));
      ctx.fillStyle = v("--accent");
      ctx.fillRect(x - 1, 0, 2, h);
    }

    // Gutter labels
    ctx.fillStyle = v("--roll-gutter");
    ctx.fillRect(0, 0, GUTTER, h);
    ctx.fillStyle = v("--roll-grid-strong");
    ctx.fillRect(GUTTER - 1, 0, 1, h);
    ctx.font = "11px system-ui, sans-serif";
    for (let p = lo; p <= hi; p++) {
      const pc = ((p % 12) + 12) % 12;
      if (!NATURAL[pc] || (rowH < 11 && pc !== 0 && pc !== 7)) continue;
      ctx.fillStyle = pc === 0 ? v("--fg") : v("--muted");
      ctx.fillText(midiName(p), 8, yOf(p));
    }
  }

  private classify(c: number): "good" | "close" | "off" {
    const a = Math.abs(c);
    const tol = this.model!.settings.toleranceCents;
    return a <= tol ? "good" : a <= tol * 2 ? "close" : "off";
  }

  private paintTake(
    samples: TakeSample[],
    color: (cents: number | null) => string,
    yOf: (midi: number) => number,
    width: number,
  ): void {
    if (!samples.length) return;
    const { ctx } = this;
    const m = this.model!;
    const events = m.track?.events ?? [];
    const b0 = this.viewStart - 0.5;
    const b1 = this.xToBeat(this.w) + 0.5;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    let prev: { x: number; y: number; beat: number } | null = null;
    for (const s of samples) {
      if (s.beat < b0 || s.beat > b1 || s.midi === null) {
        prev = null;
        continue;
      }
      const target = targetAt(events, s.beat, s.midi);
      let shown = s.midi;
      let cents: number | null = null;
      if (target) {
        cents = centsOff(s.midi, target.midi, m.settings.octaveFree);
        if (m.settings.octaveFree) shown = target.midi + cents / 100;
      }
      const x = this.beatToX(s.beat);
      const y = yOf(shown);
      if (prev && s.beat - prev.beat < 0.25 && Math.abs(y - prev.y) < 80) {
        ctx.strokeStyle = color(cents);
        ctx.beginPath();
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      prev = { x, y, beat: s.beat };
    }
  }

  // --- interaction --------------------------------------------------------

  private measureIndexAt(beat: number): number {
    const ms = this.model?.measures ?? [];
    let i = 0;
    while (i + 1 < ms.length && ms[i + 1].start <= beat) i++;
    return i;
  }

  private dragRangeBeats(): { start: number; end: number } {
    const d = this.drag as { from: number; to: number };
    const ms = this.model!.measures;
    const a = Math.min(d.from, d.to);
    const b = Math.max(d.from, d.to);
    return { start: ms[a].start, end: ms[b].end };
  }

  private down(e: PointerEvent): void {
    if (!this.model) return;
    const { x, y } = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    if (y < RULER && this.model.measures.length) {
      const i = this.measureIndexAt(this.xToBeat(x));
      this.drag = { kind: "range", from: i, to: i };
      this.redraw();
    } else {
      this.drag = { kind: "pan", x, view: this.viewStart };
      this.follow = false;
    }
  }

  private move(e: PointerEvent): void {
    const { x, y } = this.local(e);
    const d = this.drag;
    if (d?.kind === "pan") {
      this.viewStart = d.view - (x - d.x) / this.pxPerBeat;
      this.redraw();
    } else if (d?.kind === "range") {
      d.to = this.measureIndexAt(this.xToBeat(x));
      this.redraw();
    }
    this.hoverX = y > RULER && x > GUTTER ? x : null;
    this.showTip(e);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    this.canvas.releasePointerCapture(e.pointerId);
    if (d?.kind === "range") this.onRangeSelect(Math.min(d.from, d.to), Math.max(d.from, d.to));
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      this.zoom(Math.exp(-e.deltaY * 0.01), this.local(e).x);
      return;
    }
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    this.viewStart += delta / this.pxPerBeat;
    this.follow = false;
    this.redraw();
  }

  private local(e: MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private showTip(e: PointerEvent): void {
    const m = this.model;
    if (this.hoverX === null || !m || this.drag) {
      this.tip.hidden = true;
      return;
    }
    const beat = this.xToBeat(this.hoverX);
    const ev = m.track?.events.find((n) => n.start <= beat && n.end > beat);
    const lines: string[] = [];
    if (ev) {
      lines.push(`<b>${midiName(ev.midi)}</b> · bar ${m.measures[ev.measureIndex]?.number ?? ""}`);
      const r = m.results.get(ev.id);
      if (r && r.status !== "missed")
        lines.push(`${r.cents > 0 ? "+" : ""}${Math.round(r.cents)}¢ median · ${Math.round(r.inTune * 100)}% in tune`);
      else if (r) lines.push("not enough voiced sound");
      const o = r?.onset;
      if (o) {
        const start = `${o.startCents > 0 ? "+" : ""}${Math.round(o.startCents)}¢`;
        const settle = o.settleMs !== null ? `, on pitch after ${Math.round(o.settleMs)} ms` : "";
        const text = {
          clean: `clean onset (started at ${start}${settle})`,
          scoop: `slid up from below (started at ${start}${settle})`,
          fall: `came down from above (started at ${start}${settle})`,
          unsettled: `never held the pitch steadily (started at ${start})`,
        }[o.kind];
        lines.push(text);
      }
    }
    let near: TakeSample | null = null;
    for (const s of m.current) if (s.midi !== null && Math.abs(s.beat - beat) < 0.08) near = s;
    if (near?.midi != null) {
      const c = ev ? centsOff(near.midi, ev.midi, m.settings.octaveFree) : null;
      lines.push(`sung ${midiName(near.midi)}${c !== null ? ` (${c > 0 ? "+" : ""}${Math.round(c)}¢)` : ""}`);
    }
    if (!lines.length) {
      this.tip.hidden = true;
      return;
    }
    this.tip.innerHTML = lines.join("<br>");
    this.tip.hidden = false;
    const r = this.canvas.getBoundingClientRect();
    const tx = Math.min(e.clientX - r.left + 14, this.w - this.tip.offsetWidth - 6);
    this.tip.style.left = `${tx}px`;
    this.tip.style.top = `${Math.max(4, e.clientY - r.top - this.tip.offsetHeight - 10)}px`;
  }
}

/** The target note sounding at `beat`; with several (divisi), the one closest to what was sung. */
export function targetAt(events: NoteEvent[], beat: number, sung: number): NoteEvent | null {
  let best: NoteEvent | null = null;
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (events[mid].start <= beat) lo = mid + 1;
    else hi = mid;
  }
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) {
    const ev = events[i];
    if (ev.end <= beat) continue;
    if (!best || Math.abs(ev.midi - sung) < Math.abs(best.midi - sung)) best = ev;
  }
  return best;
}
