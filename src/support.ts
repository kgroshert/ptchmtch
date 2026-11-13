/**
 * Support page: messa di voce. One sustained note, soft → loud → soft, with a live volume and
 * pitch graph against a target arch, and an analysis of how even the swell was, whether the pitch
 * moved with the volume, and where control gave out.
 *
 * Volume is relative (dB from the microphone's full scale, measured above the room's noise
 * floor), so it compares between rounds only at the same distance from the microphone.
 */
import { VOICES, type VoiceType } from "./exercises";
import type { MessaSession } from "./history";
import { midiName, type PitchSample } from "./pitch";
import type { Instrument } from "./player";
import { analyseVibrato, type Vibrato } from "./vibrato";

// --- analysis ---------------------------------------------------------------------------

export interface MessaFrame {
  /** Seconds since singing was asked for. */
  t: number;
  /** Level in dB relative to full scale. */
  db: number;
  /** Pitch in cents from the target note, or null where no pitch was found. */
  cents: number | null;
}

export type LostReason = "break" | "crack" | "no pitch";

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

/** dB above the noise floor that counts as voice. */
const VOICE_DB = 8;
/** A wrong-way move in volume this large counts as a dip or a surge. */
const BUMP_DB = 3;
/** A jump in pitch this large from the running median counts as a crack. */
const CRACK_CENTS = 80;
/**
 * The pitch tracker ignores input below its gate (RMS 0.008, about −42 dBFS), so a very soft tone
 * has no pitch on purpose; losing the pitch only counts above this level.
 */
const PITCH_GATE_DB = 20 * Math.log10(0.008) + 3;

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Averages power (not dB) over ±`half` seconds around each frame, so short flickers don't count. */
function smoothDb(frames: MessaFrame[], half: number): number[] {
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

export function analyseMessa(frames: MessaFrame[], floorDb: number, target: number): MessaResult | null {
  if (frames.length < 20) return null;
  const smooth = smoothDb(frames, 0.1);
  const voiced = (i: number) => smooth[i] > floorDb + VOICE_DB;
  // The sung span: from the first to the last stretch of voice lasting 0.15 s (ignores clicks).
  const lasting = (i: number, dir: 1 | -1) => {
    for (let j = i; j >= 0 && j < frames.length && Math.abs(frames[j].t - frames[i].t) < 0.15; j += dir) if (!voiced(j)) return false;
    return true;
  };
  let a = 0;
  while (a < frames.length && !(voiced(a) && lasting(a, 1))) a++;
  let b = frames.length - 1;
  while (b > a && !(voiced(b) && lasting(b, -1))) b--;
  if (b - a < 10 || frames[b].t - frames[a].t < 1) return null;
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

  // Where control gave out: a gap in the voice, a jump in pitch away from the running median, or
  // the pitch lost while the voice still sounds; each must last 0.12 s.
  let lost: MessaResult["lost"] = null;
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
      if (f.db < PITCH_GATE_DB) {
        noPitchStart = null;
        continue;
      }
      noPitchStart ??= f.t;
      if (f.t - noPitchStart >= 0.25) lost = { t: noPitchStart, reason: "no pitch" };
      continue;
    }
    noPitchStart = null;
    const ref = recent.length >= 20 ? median(recent) : null;
    if (ref !== null && Math.abs(f.cents - ref) > CRACK_CENTS) {
      crackStart ??= f.t;
      if (f.t - crackStart >= HOLD) lost = { t: crackStart, reason: "crack" };
    } else {
      crackStart = null;
      recent.push(f.cents);
      if (recent.length > 60) recent.shift();
    }
  }

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

// --- the trainer ------------------------------------------------------------------------

type Phase = "idle" | "ref" | "ready" | "sing" | "result";

export interface SupportHost {
  ctxTime(): number;
  play(notes: { midi: number | number[]; start: number; dur: number }[], sound: Instrument): { end: number; stop: () => void };
  ensureMic(): Promise<boolean>;
  toleranceCents(): number;
}

interface MessaPrefs {
  voice: VoiceType;
  /** Semitones from the middle of the voice's range. */
  offset: number;
  /** Length of the whole swell, seconds. */
  length: number;
}

const PREFS_KEY = "ptchmtch.messa";
const LENGTHS = [6, 8, 10, 12, 15];

function newStats() {
  return { rounds: 0, started: 0, context: "", range: 0, best: 0, offCentre: 0, evenness: 0, drift: 0, drifts: 0, held: 0, lost: 0 };
}

export class SupportTrainer {
  private prefs: MessaPrefs = { voice: "alto", offset: 0, length: 10 };
  private phase: Phase = "idle";
  private timers: number[] = [];
  private stopSound: (() => void) | null = null;
  private frames: MessaFrame[] = [];
  private floor: number[] = [];
  private floorDb = -70;
  private singStart = 0;
  private voiceSeen = false;
  private lastVoice = 0;
  private result: MessaResult | null = null;
  /** The last round's soft and loud levels, to scale the target arch to your voice. */
  private lastSoft: number | null = null;
  private lastPeak: number | null = null;
  private stats = newStats();
  private raf = 0;
  onSession: (s: MessaSession) => void = () => {};
  private $ = <T extends HTMLElement = HTMLElement>(id: string) => this.page.querySelector<T>(`#${id}`)!;

  constructor(
    private page: HTMLElement,
    private host: SupportHost,
  ) {
    try {
      Object.assign(this.prefs, JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"));
    } catch {
      /* defaults */
    }
    const voiceSel = this.$<HTMLSelectElement>("mvVoice");
    VOICES.forEach((v) => voiceSel.append(new Option(v.label, v.id)));
    voiceSel.value = this.prefs.voice;
    const lenSel = this.$<HTMLSelectElement>("mvLength");
    LENGTHS.forEach((s) => lenSel.append(new Option(`${s} s`, String(s))));
    lenSel.value = String(this.prefs.length);
    voiceSel.addEventListener("change", () => {
      this.prefs.voice = voiceSel.value as VoiceType;
      this.prefs.offset = 0;
      this.changed();
    });
    lenSel.addEventListener("change", () => {
      this.prefs.length = +lenSel.value;
      this.changed();
    });
    this.$("mvDown").addEventListener("click", () => this.step(-1));
    this.$("mvUp").addEventListener("click", () => this.step(1));
    this.$("mvStart").addEventListener("click", () => (this.phase === "idle" ? this.round() : this.stop()));
    this.$("mvDone").addEventListener("click", () => this.finish());
    this.$("mvAgain").addEventListener("click", () => this.round());
    this.$("mvHear").addEventListener("click", () => this.playNote(2));
    document.addEventListener("keydown", (e) => {
      if (!this.isOpen || (e.target as HTMLElement).closest("select, button, input, textarea, dialog")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.phase === "idle" || this.phase === "result") this.round();
        else if (this.phase === "sing") this.finish();
      } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.step(e.key === "ArrowUp" ? 1 : -1);
      }
    });
    new ResizeObserver(() => this.draw()).observe(this.$("mvCanvas"));
    this.showNote();
    this.setPhase("idle");
  }

  get isOpen(): boolean {
    return !this.page.hidden;
  }

  open(): void {
    if (this.isOpen) return;
    this.page.hidden = false;
    this.stats = newStats();
    this.showStats();
    this.setPhase(this.result ? "result" : "idle");
    this.draw();
  }

  close(): void {
    if (!this.isOpen) return;
    this.stop();
    this.page.hidden = true;
  }

  private get midi(): number {
    const v = VOICES.find((x) => x.id === this.prefs.voice)!;
    return Math.round((v.low + v.high) / 2) + this.prefs.offset;
  }

  private changed(): void {
    this.save();
    this.showNote();
    // A new note or length starts a new session (History keeps them apart).
    if (this.phase !== "idle") this.stop();
    else this.endSession();
  }

  private step(d: number): void {
    const v = VOICES.find((x) => x.id === this.prefs.voice)!;
    const mid = Math.round((v.low + v.high) / 2);
    const next = this.prefs.offset + d;
    // Within the voice's comfortable range.
    if (mid + next < v.low || mid + next > v.high) return;
    this.prefs.offset = next;
    this.lastSoft = this.lastPeak = null;
    this.changed();
    if (this.phase === "idle" || this.phase === "result") this.playNote(1.2);
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* not remembered */
    }
  }

  private showNote(): void {
    const v = VOICES.find((x) => x.id === this.prefs.voice)!;
    this.$("mvNote").textContent = midiName(this.midi);
    this.$<HTMLButtonElement>("mvDown").disabled = this.midi <= v.low;
    this.$<HTMLButtonElement>("mvUp").disabled = this.midi >= v.high;
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, sec) * 1000));
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.stopSound?.();
    this.stopSound = null;
  }

  private playNote(sec: number): number {
    this.stopSound?.();
    const p = this.host.play([{ midi: this.midi, start: 0, dur: sec }], "piano");
    this.stopSound = p.stop;
    return p.end - this.host.ctxTime();
  }

  /** One swell: hear the note, breathe in (the room's noise is measured), sing. */
  private async round(): Promise<void> {
    this.clearTimers();
    if (!(await this.host.ensureMic())) return;
    this.$("mvStart").textContent = "Stop";
    if (!this.stats.rounds && !this.stats.started) {
      this.stats.started = Date.now();
      this.stats.context = this.context();
    }
    this.result = null;
    this.frames = [];
    this.setPhase("ref");
    const len = this.playNote(2);
    this.later(len + 0.3, () => {
      this.floor = [];
      this.setPhase("ready");
      this.later(1.5, () => {
        if (this.floor.length > 10) this.floorDb = median(this.floor);
        this.frames = [];
        this.voiceSeen = false;
        this.singStart = this.host.ctxTime();
        this.lastVoice = this.singStart;
        this.setPhase("sing");
        this.animate();
      });
    });
  }

  private context(): string {
    return `${midiName(this.midi)} · ${VOICES.find((v) => v.id === this.prefs.voice)!.label} · ${this.prefs.length} s`;
  }

  push(s: PitchSample): void {
    if (this.phase === "ready") {
      this.floor.push(20 * Math.log10(Math.max(1e-6, s.level)));
      return;
    }
    if (this.phase !== "sing" || s.time < this.singStart) return;
    const t = s.time - this.singStart;
    const db = 20 * Math.log10(Math.max(1e-6, s.level));
    this.frames.push({ t, db, cents: s.midi === null ? null : (s.midi - this.midi) * 100 });
    if (db > this.floorDb + VOICE_DB) {
      this.voiceSeen = true;
      this.lastVoice = s.time;
    }
    // Ends after a second of silence once the voice has been there a while, or well past the length.
    if ((this.voiceSeen && t > 1.5 && s.time - this.lastVoice > 1) || t > this.prefs.length + 4) this.finish();
  }

  private animate(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.phase !== "sing") return;
      this.draw();
      this.cue();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** The word under the graph while singing: where you are in the swell. */
  private cue(): void {
    const x = (this.host.ctxTime() - this.singStart) / this.prefs.length;
    const word = x < 0.08 ? "Start softly" : x < 0.42 ? "Grow…" : x < 0.58 ? "Loudest" : x < 0.92 ? "Fade…" : x < 1 ? "Softly" : "Let it end";
    this.$("mvPhase").textContent = word;
  }

  private finish(): void {
    if (this.phase !== "sing") return;
    cancelAnimationFrame(this.raf);
    this.result = analyseMessa(this.frames, this.floorDb, this.prefs.length);
    if (this.result) {
      const r = this.result;
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
    }
    this.setPhase("result");
    this.showResult();
    this.showStats();
    this.draw();
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    this.endSession();
    this.setPhase(this.result ? "result" : "idle");
    this.$("mvStart").textContent = "Start";
    this.draw();
  }

  /** Saves the session so far to the history (if any round was sung) and starts a new one. */
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
    this.showStats();
  }

  // --- display ---

  private setPhase(p: Phase): void {
    this.phase = p;
    const text: Record<Phase, string> = {
      idle: "Press Start",
      ref: "Your note",
      ready: "Breathe in…",
      sing: "Start softly",
      result: "",
    };
    const hint: Record<Phase, string> = {
      idle: `You'll hear the note, then breathe in while the room's noise is measured. Then sing it: start softly, grow evenly to your loudest in the middle, fade evenly back to soft, in ${this.prefs.length} s. Follow the moving line.`,
      ref: "",
      ready: "Stay quiet for a moment.",
      sing: "Follow the arch with your volume. Enter when done.",
      result: "",
    };
    this.page.dataset.phase = p;
    this.$("mvPhase").textContent = text[p];
    this.$("mvPhase").hidden = !text[p];
    this.$("mvHint").textContent = hint[p];
    this.$("mvHint").hidden = !hint[p];
    this.$("mvDone").hidden = p !== "sing";
    this.$("mvResult").hidden = p !== "result" || !this.result;
    this.$("mvAgain").hidden = p !== "result";
    if (p === "idle") this.$("mvStart").textContent = "Start";
  }

  private showStats(): void {
    const s = this.stats;
    this.$("mvStats").textContent = s.rounds
      ? `This session: ${s.rounds} ${s.rounds === 1 ? "swell" : "swells"} · range ${(s.range / s.rounds).toFixed(0)} dB on average, best ${s.best.toFixed(0)} dB`
      : "";
  }

  private showResult(): void {
    const r = this.result;
    const body = this.$("mvResultBody");
    if (!r) {
      body.innerHTML = `<h3>Nothing heard</h3><p class="muted">Sing a little louder or closer to the microphone, or check it under Settings.</p>`;
      this.$("mvResult").hidden = false;
      return;
    }
    const tol = this.host.toleranceCents();
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
    body.innerHTML = `<h3>${head}</h3><ul class="mv-findings">${items.map((i) => `<li class="${i.ok ? "ok" : "warn"}">${i.text}</li>`).join("")}</ul>`;
  }

  /** Volume (top) and pitch (bottom) against time, with the target arch and the guide line. */
  private draw(): void {
    const cv = this.$<HTMLCanvasElement>("mvCanvas");
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(this.page);
    const v = (n: string, d: string) => css.getPropertyValue(n).trim() || d;
    const fg = v("--fg", "#222");
    const muted = v("--muted", "#888");
    const grid = v("--roll-grid", "rgba(0,0,0,.08)");
    const accent = v("--accent", "#2a6de0");
    const warn = "#e08a2a";

    const L = 40;
    const R = 8;
    const volTop = 18;
    const volH = Math.round((h - 40) * 0.62);
    const pitchTop = volTop + volH + 22;
    const pitchH = h - pitchTop - 16;
    const T = Math.max(this.prefs.length, this.result?.to ?? 0, this.frames.length ? this.frames[this.frames.length - 1].t : 0) + 0.5;
    const x = (t: number) => L + (t / T) * (w - L - R);

    // Volume axis: from the noise floor up to above the loudest heard (or a sensible default).
    const maxDb = Math.max(...this.frames.map((f) => f.db), this.lastPeak ?? -Infinity);
    const lo = this.floorDb;
    const hi = Math.max(lo + 30, Number.isFinite(maxDb) ? maxDb + 3 : lo + 40);
    const yV = (db: number) => volTop + volH - ((Math.min(hi, Math.max(lo, db)) - lo) / (hi - lo)) * volH;
    const range = 100;
    const yP = (c: number) => pitchTop + pitchH / 2 - (Math.max(-range, Math.min(range, c)) / range) * (pitchH / 2);

    g.font = "10px system-ui";
    g.textBaseline = "middle";
    // Volume grid every 10 dB, labelled above the floor.
    for (let d = 0; lo + d <= hi; d += 10) {
      g.fillStyle = grid;
      g.fillRect(L, yV(lo + d), w - L - R, 1);
      g.fillStyle = muted;
      g.fillText(`${d} dB`, 2, yV(lo + d));
    }
    g.fillStyle = fg;
    g.fillText("Volume", L + 4, volTop - 9);
    // Seconds.
    for (let s = 0; s <= T; s += s < 20 ? 1 : 5) {
      g.fillStyle = grid;
      g.fillRect(x(s), volTop, 1, volH);
      g.fillRect(x(s), pitchTop, 1, pitchH);
      if (s % 2 === 0) {
        g.fillStyle = muted;
        g.fillText(`${s}`, x(s) - 3, h - 6);
      }
    }

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
    const tol = this.host.toleranceCents();
    g.fillStyle = accent + "1a";
    g.fillRect(L, yP(tol), w - L - R, yP(-tol) - yP(tol));
    g.fillStyle = grid;
    g.fillRect(L, yP(0), w - L - R, 1);
    g.fillStyle = muted;
    g.fillText("+100¢", 2, yP(range));
    g.fillText(midiName(this.midi), 2, yP(0));
    g.fillText("−100¢", 2, yP(-range));
    g.fillStyle = fg;
    g.fillText("Pitch", L + 4, pitchTop - 9);

    // The guide line while singing.
    if (this.phase === "sing") {
      const now = this.host.ctxTime() - this.singStart;
      g.fillStyle = accent;
      g.fillRect(x(now), volTop, 2, volH);
      g.fillRect(x(now), pitchTop, 2, pitchH);
    }

    // Volume as sung: smoothed, so it reads as a line, not noise.
    const fr = this.frames;
    if (fr.length > 2) {
      const sm = this.result?.smooth ?? smoothDb(fr, 0.1);
      g.strokeStyle = fg;
      g.lineWidth = 2;
      g.beginPath();
      let pen = false;
      fr.forEach((f, i) => {
        if (sm[i] < lo + VOICE_DB) {
          pen = false;
          return;
        }
        if (pen) g.lineTo(x(f.t), yV(sm[i]));
        else g.moveTo(x(f.t), yV(sm[i]));
        pen = true;
      });
      g.stroke();
      // Pitch.
      g.strokeStyle = fg;
      g.lineWidth = 1.5;
      g.beginPath();
      pen = false;
      let prev = -1;
      for (const f of fr) {
        if (f.cents === null || f.t - prev > 0.06) pen = false;
        if (f.cents === null) continue;
        if (pen) g.lineTo(x(f.t), yP(f.cents));
        else g.moveTo(x(f.t), yP(f.cents));
        pen = true;
        prev = f.t;
      }
      g.stroke();
    }

    // Findings on the graph: wrong-way moves and where control gave out.
    const r = this.result;
    if (r) {
      for (const b of r.bumps) {
        g.fillStyle = warn;
        g.beginPath();
        g.arc(x(b.t), volTop + 6, 4, 0, Math.PI * 2);
        g.fill();
      }
      if (r.lost) {
        g.fillStyle = "#d9534f";
        g.fillRect(x(r.lost.t) - 1, volTop, 2, pitchTop + pitchH - volTop);
        g.fillText(r.lost.reason, x(r.lost.t) + 4, volTop + 6);
      }
      // The loudest moment.
      g.fillStyle = accent;
      g.beginPath();
      g.arc(x(r.peakAt), yV(r.peakDb), 4, 0, Math.PI * 2);
      g.fill();
    }
  }
}
