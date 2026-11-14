/** Messa di voce: the analysis of one swell (soft → loud → soft on one note). */
import { VOICES } from "./exercises";
import type { MessaSession } from "./history";
import { midiName } from "./pitch";
import type { DrawView, Note, SupportExercise, SupportPrefs } from "./support";
import { analyseVibrato, type Vibrato } from "./vibrato";
import { BUMP_DB, DEFAULT_GATE_DB, findLost, foldOctave, median, smoothDb, voicedSpan, type LostReason, type SupportFrame } from "./support-analysis";

export type MessaFrame = SupportFrame;

export interface MessaResult {
  /** First and last moment of voice (s). */
  from: number;
  to: number;
  /** The target length (s). */
  target: number;
  floorDb: number;
  peakDb: number;
  peakAt: number;
  /** Typical level at the soft start and end (first and last half second). */
  startDb: number;
  endDb: number;
  /** Peak above the louder of the two soft ends, dB. */
  range: number;
  /** Where the peak falls in the sung span, 0..1 (0.5 = the middle). */
  peakPos: number;
  /** How far the crescendo and the diminuendo stray from an even (straight-in-dB) line, dB RMS. */
  riseDev: number;
  fallDev: number;
  /** Where the volume went the wrong way for a moment: a dip while growing, a surge while fading. */
  bumps: { t: number; kind: "dip" | "surge"; db: number }[];
  /** Median pitch where soft (bottom third of the range) and loud (top third), cents. */
  softCents: number | null;
  loudCents: number | null;
  /** Loud minus soft: positive = goes sharp as it gets louder. */
  drift: number | null;
  meanCents: number | null;
  /** Where the voice stopped, cracked or lost its pitch while still sounding (first such place). */
  lost: { t: number; reason: LostReason } | null;
  vibrato: Vibrato | null;
  /** Smoothed level per frame (for drawing), aligned with the frames passed in. */
  smooth: number[];
}


export function analyseMessa(frames: SupportFrame[], floorDb: number, target: number, gateDb = DEFAULT_GATE_DB): MessaResult | null {
  if (frames.length < 20) return null;
  frames = frames.map((f) => (f.cents === null ? f : { ...f, cents: foldOctave(f.cents, 0) }));
  const smooth = smoothDb(frames, 0.1);
  const span0 = voicedSpan(frames, smooth, floorDb);
  if (!span0) return null;
  const { a, b } = span0;
  const from = frames[a].t;
  const to = frames[b].t;
  const span = to - from;
  const idx = (lo: number, hi: number) => {
    const r: number[] = [];
    for (let i = a; i <= b; i++) if (frames[i].t >= lo && frames[i].t <= hi) r.push(i);
    return r;
  };

  let p = a;
  for (let i = a; i <= b; i++) if (smooth[i] > smooth[p]) p = i;
  const peakDb = smooth[p];
  const peakAt = frames[p].t;
  const edge = Math.min(0.5, span / 6);
  const startDb = median(idx(from, from + edge).map((i) => smooth[i]));
  const endDb = median(idx(to - edge, to).map((i) => smooth[i]));
  const softEdge = Math.max(startDb, endDb);

  // Evenness: distance from straight lines (in dB) from each soft end to the peak.
  const dev = (i0: number, i1: number, d0: number, d1: number) => {
    const t0 = frames[i0].t;
    const t1 = frames[i1].t;
    if (t1 - t0 < 0.3) return 0;
    let s = 0;
    let n = 0;
    for (let i = i0; i <= i1; i++) {
      const line = d0 + ((d1 - d0) * (frames[i].t - t0)) / (t1 - t0);
      s += (smooth[i] - line) ** 2;
      n++;
    }
    return Math.sqrt(s / n);
  };
  const riseDev = dev(a, p, startDb, peakDb);
  const fallDev = dev(p, b, peakDb, endDb);

  // Wrong-way moves: a dip below the highest level so far while growing, a surge above the lowest
  // so far while fading. Each counts once, until the level is back on track.
  const bumps: MessaResult["bumps"] = [];
  let best = -Infinity;
  let inDip = false;
  for (let i = a; i <= p; i++) {
    best = Math.max(best, smooth[i]);
    if (!inDip && smooth[i] < best - BUMP_DB) {
      bumps.push({ t: frames[i].t, kind: "dip", db: best - smooth[i] });
      inDip = true;
    } else if (inDip && smooth[i] > best - 1) inDip = false;
  }
  let least = Infinity;
  let inSurge = false;
  for (let i = p; i <= b; i++) {
    least = Math.min(least, smooth[i]);
    if (!inSurge && smooth[i] > least + BUMP_DB) {
      bumps.push({ t: frames[i].t, kind: "surge", db: smooth[i] - least });
      inSurge = true;
    } else if (inSurge && smooth[i] < least + 1) inSurge = false;
  }

  // Pitch against volume.
  const level = (i: number) => (peakDb - softEdge > 1 ? (smooth[i] - softEdge) / (peakDb - softEdge) : 0.5);
  const pitched = idx(from, to).filter((i) => frames[i].cents !== null);
  const softC = pitched.filter((i) => level(i) < 1 / 3).map((i) => frames[i].cents!);
  const loudC = pitched.filter((i) => level(i) > 2 / 3).map((i) => frames[i].cents!);
  const softCents = softC.length > 10 ? median(softC) : null;
  const loudCents = loudC.length > 10 ? median(loudC) : null;
  const drift = softCents !== null && loudCents !== null ? loudCents - softCents : null;
  const meanCents = pitched.length > 10 ? median(pitched.map((i) => frames[i].cents!)) : null;

  const lost = findLost(frames, a, b, floorDb, undefined, false, gateDb);

  // A break makes the level jump back up after it: that isn't a surge of its own.
  if (lost?.reason === "break") {
    const t = lost.t;
    for (let k = bumps.length - 1; k >= 0; k--) if (bumps[k].t > t - 0.2 && bumps[k].t < t + 0.6) bumps.splice(k, 1);
  }

  // Vibrato in the loud middle (the upper half of the range around the peak).
  let l = p;
  let r = p;
  while (l > a && level(l - 1) > 0.5) l--;
  while (r < b && level(r + 1) > 0.5) r++;
  const loudPts = [];
  for (let i = l; i <= r; i++) if (frames[i].cents !== null) loudPts.push({ time: frames[i].t, cents: frames[i].cents! });
  const vibrato = analyseVibrato(loudPts);

  return {
    from,
    to,
    target,
    floorDb,
    peakDb,
    peakAt,
    startDb,
    endDb,
    range: peakDb - softEdge,
    peakPos: (peakAt - from) / span,
    riseDev,
    fallDev,
    bumps,
    softCents,
    loudCents,
    drift,
    meanCents,
    lost,
    vibrato,
    smooth,
  };
}


/** The target arch: 0 at the soft ends, 1 at the middle, straight in dB on either side. */
export const archAt = (x: number) => (x <= 0 || x >= 1 ? 0 : 1 - Math.abs(2 * x - 1));


function newStats() {
  return { rounds: 0, started: 0, context: "", range: 0, best: 0, offCentre: 0, evenness: 0, drift: 0, drifts: 0, held: 0, lost: 0 };
}

/** Messa di voce on the Support page: one note, soft → loud → soft, against a target arch. */
export class MessaExercise implements SupportExercise {
  readonly id = "messa" as const;
  readonly unit: [string, string] = ["swell", "swells"];
  private result: MessaResult | null = null;
  /** The last round's soft and loud levels, to scale the target arch to your voice. */
  private lastSoft: number | null = null;
  private lastPeak: number | null = null;
  private stats = newStats();

  constructor(
    private prefs: SupportPrefs,
    private onSession: (s: MessaSession) => void,
  ) {}

  private get range() {
    return VOICES.find((x) => x.id === this.prefs.voice)!;
  }

  refMidi(): number {
    const v = this.range;
    return Math.round((v.low + v.high) / 2) + this.prefs.offset;
  }

  /** Readings an octave off are tracker errors: shown and judged at the note's octave. */
  foldCents(cents: number): number {
    return foldOctave(cents, 0);
  }

  noteText(): string {
    return midiName(this.refMidi());
  }

  canStep(d: 1 | -1): boolean {
    const m = this.refMidi() + d;
    return m >= this.range.low && m <= this.range.high;
  }

  step(d: 1 | -1): void {
    this.prefs.offset += d;
    this.lastSoft = this.lastPeak = null;
  }

  startNotes(): Note[] {
    return [{ midi: this.refMidi(), start: 0, dur: 2 }];
  }

  hearNotes(): Note[] {
    return this.startNotes();
  }

  context(): string {
    return `${midiName(this.refMidi())} · ${this.range.label} · ${this.prefs.length} s`;
  }

  idleHint(): string {
    return `You'll hear the note, then breathe in while the room's noise is measured. Then sing it: start softly, grow evenly to your loudest in the middle, fade evenly back to soft, in ${this.prefs.length} s. Follow the moving line.`;
  }

  singHint(): string {
    return "Follow the arch with your volume. Enter when done.";
  }

  /** The word under the graph while singing: where you are in the swell. */
  cue(t: number): string {
    const x = t / this.prefs.length;
    return x < 0.08 ? "Start softly" : x < 0.42 ? "Grow…" : x < 0.58 ? "Loudest" : x < 0.92 ? "Fade…" : x < 1 ? "Softly" : "Let it end";
  }

  // Ends after a second of silence once the voice has been there a while, or well past the length.
  finishAt(t: number, voicedFor: number, silentFor: number): boolean {
    return (voicedFor > 0 && t > 1.5 && silentFor > 1) || t > this.prefs.length + 4;
  }

  timeSpan(frames: MessaFrame[]): number {
    return Math.max(this.prefs.length, this.result?.to ?? 0, frames.length ? frames[frames.length - 1].t : 0) + 0.5;
  }

  pitchRange(): [number, number] {
    return [-100, 100];
  }

  peakHint(): number | null {
    return this.lastPeak;
  }

  startRound(): void {
    if (!this.stats.rounds && !this.stats.started) {
      this.stats.started = Date.now();
      this.stats.context = this.context();
    }
  }

  analyse(frames: MessaFrame[], floorDb: number, gateDb: number): boolean {
    this.result = analyseMessa(frames, floorDb, this.prefs.length, gateDb);
    const r = this.result;
    if (!r) return false;
    this.lastSoft = Math.max(r.startDb, r.endDb);
    this.lastPeak = r.peakDb;
    const s = this.stats;
    s.rounds++;
    s.range += r.range;
    s.best = Math.max(s.best, r.range);
    s.offCentre += Math.abs(r.peakPos - 0.5);
    s.evenness += (r.riseDev + r.fallDev) / 2;
    if (r.drift !== null) {
      s.drift += Math.abs(r.drift);
      s.drifts++;
    }
    s.held += Math.min(1, (r.to - r.from) / r.target);
    if (r.lost) s.lost++;
    return true;
  }

  clearResult(): void {
    this.result = null;
  }

  hasResult(): boolean {
    return this.result !== null;
  }

  smoothDb(): number[] | null {
    return this.result?.smooth ?? null;
  }

  /** The target arch, and the pitch lane's note and tolerance band. */
  drawBack(v: DrawView): void {
    const { g, x, yV, yP, L, R, w, lo } = v;
    const { fg, muted, grid, accent } = v.colors;
    // Target arch, between your last soft level and your last peak (or a default span).
    const soft = this.lastSoft ?? lo + 12;
    const peak = Math.max(soft + 10, this.lastPeak ?? lo + 35);
    g.strokeStyle = accent + "66";
    g.lineWidth = 8;
    g.lineCap = "round";
    g.beginPath();
    for (let i = 0; i <= 100; i++) {
      const tt = (i / 100) * this.prefs.length;
      const yy = yV(soft + (peak - soft) * archAt(tt / this.prefs.length));
      if (i) g.lineTo(x(tt), yy);
      else g.moveTo(x(tt), yy);
    }
    g.stroke();

    // Pitch lane: the note, and the tolerance band.
    const tol = v.tol;
    g.fillStyle = accent + "1a";
    g.fillRect(L, yP(tol), w - L - R, yP(-tol) - yP(tol));
    g.fillStyle = grid;
    g.fillRect(L, yP(0), w - L - R, 1);
    g.fillStyle = muted;
    g.fillText("+100¢", 2, yP(100));
    g.fillText(midiName(this.refMidi()), 2, yP(0));
    g.fillText("−100¢", 2, yP(-100));
    g.fillStyle = fg;
    g.fillText("Pitch", L + 4, v.pitch.top - 9);
  }

  /** Findings on the graph: wrong-way moves, where control gave out, the loudest moment. */
  drawMarks(v: DrawView): void {
    const r = this.result;
    if (!r) return;
    const { g, x, yV } = v;
    const volTop = v.vol.top;
    for (const b of r.bumps) {
      g.fillStyle = v.colors.warn;
      g.beginPath();
      g.arc(x(b.t), volTop + 6, 4, 0, Math.PI * 2);
      g.fill();
    }
    if (r.lost) {
      g.fillStyle = v.colors.lost;
      g.fillRect(x(r.lost.t) - 1, volTop, 2, v.pitch.top + v.pitch.h - volTop);
      g.fillText(r.lost.reason, x(r.lost.t) + 4, volTop + 6);
    }
    g.fillStyle = v.colors.accent;
    g.beginPath();
    g.arc(x(r.peakAt), yV(r.peakDb), 4, 0, Math.PI * 2);
    g.fill();
  }

  resultHtml(tol: number): string {
    const r = this.result!;
    const items: { ok: boolean; text: string }[] = [];
    // Range.
    items.push({
      ok: r.range >= 15,
      text: `<b>Range ${r.range.toFixed(0)} dB</b> from soft to loud${r.range < 10 ? ": little change; let the soft ends be softer and the middle fuller" : r.range < 15 ? ": room for more contrast" : ""}.`,
    });
    // Symmetry.
    const pos = Math.round(r.peakPos * 100);
    items.push({
      ok: Math.abs(r.peakPos - 0.5) <= 0.15,
      text: `<b>Loudest at ${pos}%</b> of the note${r.peakPos < 0.35 ? ": too soon; spread the crescendo over the first half" : r.peakPos > 0.65 ? ": late; the fade had little time" : ", near the middle"}.`,
    });
    // Evenness.
    const even = (d: number) => (d <= 2 ? "even" : d <= 3.5 ? "fairly even" : "uneven");
    const dips = r.bumps.filter((x) => x.kind === "dip");
    const surges = r.bumps.filter((x) => x.kind === "surge");
    const where = (xs: { t: number }[]) => xs.map((x) => `${x.t.toFixed(1)} s`).join(", ");
    items.push({
      ok: r.riseDev <= 3.5 && !dips.length,
      text: `<b>Crescendo ${even(r.riseDev)}</b> (±${r.riseDev.toFixed(1)} dB from a steady rise)${dips.length ? `; it sagged at ${where(dips)}` : ""}.`,
    });
    items.push({
      ok: r.fallDev <= 3.5 && !surges.length,
      text: `<b>Diminuendo ${even(r.fallDev)}</b> (±${r.fallDev.toFixed(1)} dB from a steady fall)${surges.length ? `; it swelled again at ${where(surges)}` : ""}.`,
    });
    // Pitch.
    if (r.drift !== null) {
      const d = Math.round(r.drift);
      items.push({
        ok: Math.abs(d) <= tol,
        text:
          Math.abs(d) <= tol
            ? `<b>Pitch steady</b> from soft to loud (${d > 0 ? "+" : ""}${d}¢).`
            : `<b>Pitch ${d > 0 ? "rises" : "drops"} ${Math.abs(d)}¢</b> when loud compared with soft: ${d > 0 ? "pushing as it grows" : "sagging when soft, or spreading when loud"}.`,
      });
    }
    if (r.meanCents !== null && Math.abs(r.meanCents) > tol)
      items.push({ ok: false, text: `<b>${Math.round(Math.abs(r.meanCents))}¢ ${r.meanCents > 0 ? "sharp" : "flat"}</b> overall.` });
    // Control.
    if (r.lost) {
      const what = r.lost.reason === "break" ? "the voice stopped" : r.lost.reason === "crack" ? "the pitch cracked" : "the tone lost its pitch (breathy or unstable)";
      items.push({ ok: false, text: `<b>Control gave out at ${r.lost.t.toFixed(1)} s</b>: ${what}. Marked on the graph.` });
    }
    const held = r.to - r.from;
    if (held < r.target * 0.85) items.push({ ok: false, text: `<b>Held ${held.toFixed(1)} s</b> of ${r.target} s: plan the breath for the whole swell.` });
    if (r.vibrato && (r.vibrato.kind === "vibrato" || r.vibrato.kind === "wobble"))
      items.push({
        ok: r.vibrato.kind === "vibrato",
        text: `<b>${r.vibrato.kind === "vibrato" ? "Vibrato" : "Wobble"}</b> at the loud part: ${r.vibrato.rate.toFixed(1)}/s, ±${Math.round(r.vibrato.extent)}¢.`,
      });
    const good = items.filter((i) => i.ok).length;
    const head = good === items.length ? "A clean swell" : good >= items.length - 1 ? "Nearly there" : "Some things to work on";
    return `<h3>${head}</h3><ul class="mv-findings">${items.map((i) => `<li class="${i.ok ? "ok" : "warn"}">${i.text}</li>`).join("")}</ul>`;
  }

  statsText(): string {
    const s = this.stats;
    return s.rounds
      ? `This session: ${s.rounds} ${s.rounds === 1 ? "swell" : "swells"} · range ${(s.range / s.rounds).toFixed(0)} dB on average, best ${s.best.toFixed(0)} dB`
      : "";
  }

  endSession(): void {
    const s = this.stats;
    if (s.rounds > 0)
      this.onSession({
        date: s.started,
        context: s.context,
        rounds: s.rounds,
        meanRange: s.range / s.rounds,
        bestRange: s.best,
        offCentre: s.offCentre / s.rounds,
        evenness: s.evenness / s.rounds,
        drift: s.drifts ? s.drift / s.drifts : null,
        held: s.held / s.rounds,
        lost: s.lost,
        minutes: (Date.now() - s.started) / 60000,
      });
    this.stats = newStats();
  }
}
