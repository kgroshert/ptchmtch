/**
 * Support page: breath-support exercises with a live volume and pitch graph and an analysis after
 * each round. The page hosts the exercises (messa di voce, glides); this file holds what they
 * share: the voice and note setting, the round (hear → breathe in → sing → result), the microphone
 * samples, the room's noise floor, and the graph's frame and traces.
 *
 * Volume is relative (dB from the microphone's full scale, measured above the room's noise
 * floor), so it compares between rounds only at the same distance from the microphone.
 */
import { VOICES, type VoiceType } from "./exercises";
import { GlideExercise } from "./glide";
import type { GlideSession, MessaSession } from "./history";
import { MessaExercise } from "./messa";
import type { PitchSample } from "./pitch";
import type { Instrument } from "./player";
import { median, smoothDb, VOICE_DB, type SupportFrame } from "./support-analysis";

export type ExerciseId = "messa" | "glide";
export type Phase = "idle" | "ref" | "ready" | "sing" | "result";
export interface Note {
  midi: number;
  start: number;
  dur: number;
}

export interface SupportHost {
  ctxTime(): number;
  play(notes: { midi: number | number[]; start: number; dur: number }[], sound: Instrument): { end: number; stop: () => void };
  ensureMic(): Promise<boolean>;
  toleranceCents(): number;
}

/** Saved settings, shared by reference with the exercises; the host saves them. */
export interface SupportPrefs {
  voice: VoiceType;
  /** Messa: semitones from the middle of the voice's range. */
  offset: number;
  /** Messa: length of the whole swell, seconds. */
  length: number;
  exercise: ExerciseId;
  /** Glide: semitones from the low note to the top. */
  interval: 4 | 7;
  /** Glide: semitones the low note is moved from its default. */
  glideOffset: number;
}

/** What an exercise gets to draw with: the graph's lanes and scales. */
export interface DrawView {
  g: CanvasRenderingContext2D;
  w: number;
  L: number;
  R: number;
  vol: { top: number; h: number };
  pitch: { top: number; h: number };
  x(t: number): number;
  yV(db: number): number;
  yP(cents: number): number;
  /** Volume axis, dB. */
  lo: number;
  hi: number;
  colors: { fg: string; muted: string; grid: string; accent: string; warn: string; lost: string };
  frames: SupportFrame[];
  phase: Phase;
  tol: number;
}

export interface SupportExercise {
  readonly id: ExerciseId;
  /** Singular and plural name of one round, e.g. ["swell", "swells"]. */
  readonly unit: [string, string];
  /** The note the frames' cents are measured from. */
  refMidi(): number;
  noteText(): string;
  canStep(d: 1 | -1): boolean;
  step(d: 1 | -1): void;
  startNotes(): Note[];
  hearNotes(): Note[];
  context(): string;
  idleHint(): string;
  singHint(): string;
  cue(t: number, frames: SupportFrame[]): string;
  /** Whether the round is over: `voicedFor` = seconds since the voice was first heard (0 if not yet). */
  finishAt(t: number, voicedFor: number, silentFor: number): boolean;
  timeSpan(frames: SupportFrame[]): number;
  pitchRange(): [number, number];
  /** A level the volume axis should reach (e.g. the last peak), or null. */
  peakHint(): number | null;
  /** Called as a round starts (a session's first round records its start and context). */
  startRound(): void;
  analyse(frames: SupportFrame[], floorDb: number): boolean;
  clearResult(): void;
  hasResult(): boolean;
  smoothDb(): number[] | null;
  drawBack(v: DrawView): void;
  drawMarks(v: DrawView): void;
  resultHtml(tol: number): string;
  statsText(): string;
  endSession(): void;
}

const PREFS_KEY = "ptchmtch.messa";
const LENGTHS = [6, 8, 10, 12, 15];

export const voiceRange = (voice: VoiceType) => VOICES.find((x) => x.id === voice)!;

export class SupportTrainer {
  private prefs: SupportPrefs = { voice: "alto", offset: 0, length: 10, exercise: "messa", interval: 4, glideOffset: 0 };
  private phase: Phase = "idle";
  private timers: number[] = [];
  private stopSound: (() => void) | null = null;
  private frames: SupportFrame[] = [];
  private floor: number[] = [];
  private floorDb = -70;
  private singStart = 0;
  private voiceStart: number | null = null;
  private lastVoice = 0;
  private raf = 0;
  private exercises: Record<ExerciseId, SupportExercise>;
  private ex: SupportExercise;
  onSession: (s: MessaSession) => void = () => {};
  onGlideSession: (s: GlideSession) => void = () => {};
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
    if (this.prefs.exercise !== "glide") this.prefs.exercise = "messa";
    if (this.prefs.interval !== 7) this.prefs.interval = 4;
    this.exercises = {
      messa: new MessaExercise(this.prefs, (s) => this.onSession(s)),
      glide: new GlideExercise(this.prefs, (s) => this.onGlideSession(s)),
    };
    this.ex = this.exercises[this.prefs.exercise];
    const voiceSel = this.$<HTMLSelectElement>("mvVoice");
    VOICES.forEach((v) => voiceSel.append(new Option(v.label, v.id)));
    voiceSel.value = this.prefs.voice;
    const lenSel = this.$<HTMLSelectElement>("mvLength");
    LENGTHS.forEach((s) => lenSel.append(new Option(`${s} s`, String(s))));
    lenSel.value = String(this.prefs.length);
    voiceSel.addEventListener("change", () => {
      this.prefs.voice = voiceSel.value as VoiceType;
      this.prefs.offset = 0;
      this.prefs.glideOffset = 0;
      this.changed();
    });
    lenSel.addEventListener("change", () => {
      this.prefs.length = +lenSel.value;
      this.changed();
    });
    const intSel = this.$<HTMLSelectElement>("glInterval");
    intSel.value = String(this.prefs.interval);
    intSel.addEventListener("change", () => {
      this.prefs.interval = intSel.value === "7" ? 7 : 4;
      this.prefs.glideOffset = 0;
      this.changed();
    });
    for (const b of this.page.querySelectorAll<HTMLButtonElement>("#mvExercise button"))
      b.addEventListener("click", () => this.switchTo(b.dataset.ex === "glide" ? "glide" : "messa"));
    this.$("mvDown").addEventListener("click", () => this.step(-1));
    this.$("mvUp").addEventListener("click", () => this.step(1));
    this.$("mvStart").addEventListener("click", () => (this.phase === "idle" ? this.round() : this.stop()));
    this.$("mvDone").addEventListener("click", () => this.finish());
    this.$("mvAgain").addEventListener("click", () => this.round());
    this.$("mvHear").addEventListener("click", () => this.playNotes(this.ex.hearNotes()));
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
    this.showExercise();
    this.setPhase("idle");
  }

  /** Switches exercise: ends the running round and session first. */
  private switchTo(id: ExerciseId): void {
    if (id === this.ex.id) return;
    if (this.phase !== "idle") this.stop();
    else this.endSession();
    this.ex.clearResult();
    this.prefs.exercise = id;
    this.save();
    this.ex = this.exercises[id];
    this.ex.clearResult();
    this.showExercise();
    this.setPhase("idle");
    this.draw();
  }

  private showExercise(): void {
    const glide = this.ex.id === "glide";
    this.$("mvTitle").textContent = glide ? "Glide" : "Messa di voce";
    this.$("mvSub").textContent = glide
      ? "Glide slowly from the low note up and back down, evenly and with steady breath"
      : "One note: soft, swell to loud, fade back to soft, evenly and on pitch";
    this.$("mvNoteLabel").textContent = glide ? "Glide" : "Note";
    for (const b of this.page.querySelectorAll<HTMLButtonElement>("#mvExercise button")) b.classList.toggle("on", b.dataset.ex === this.ex.id);
    for (const el of this.page.querySelectorAll<HTMLElement>("[data-for]")) el.hidden = el.dataset.for !== this.ex.id;
    this.showNote();
    this.showStats();
  }

  get isOpen(): boolean {
    return !this.page.hidden;
  }

  get exercise(): ExerciseId {
    return this.ex.id;
  }

  open(): void {
    if (this.isOpen) return;
    this.page.hidden = false;
    this.showStats();
    this.setPhase(this.ex.hasResult() ? "result" : "idle");
    this.draw();
  }

  close(): void {
    if (!this.isOpen) return;
    this.stop();
    this.page.hidden = true;
  }

  private changed(): void {
    this.save();
    this.showNote();
    // The last result belongs to the old settings (its pitch is relative to the old note).
    this.ex.clearResult();
    this.frames = [];
    // A new note or length starts a new session (History keeps them apart).
    if (this.phase !== "idle") this.stop();
    else this.endSession();
  }

  private step(d: 1 | -1): void {
    if (!this.ex.canStep(d)) return;
    this.ex.step(d);
    this.changed();
    if (this.phase === "idle" || this.phase === "result") this.playNotes([{ midi: this.ex.refMidi(), start: 0, dur: 1.2 }]);
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* not remembered */
    }
  }

  private showNote(): void {
    this.$("mvNote").textContent = this.ex.noteText();
    this.$<HTMLButtonElement>("mvDown").disabled = !this.ex.canStep(-1);
    this.$<HTMLButtonElement>("mvUp").disabled = !this.ex.canStep(1);
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

  /** Plays notes on the piano; returns seconds until they end. */
  private playNotes(notes: Note[]): number {
    this.stopSound?.();
    const p = this.host.play(notes, "piano");
    this.stopSound = p.stop;
    return p.end - this.host.ctxTime();
  }

  /** One round: hear the note(s), breathe in (the room's noise is measured), sing. */
  private async round(): Promise<void> {
    this.clearTimers();
    if (!(await this.host.ensureMic())) return;
    this.$("mvStart").textContent = "Stop";
    this.ex.startRound();
    this.ex.clearResult();
    this.frames = [];
    this.setPhase("ref");
    const len = this.playNotes(this.ex.startNotes());
    this.later(len + 0.3, () => {
      this.floor = [];
      this.setPhase("ready");
      this.later(1.5, () => {
        if (this.floor.length > 10) this.floorDb = median(this.floor);
        this.frames = [];
        this.voiceStart = null;
        this.singStart = this.host.ctxTime();
        this.lastVoice = this.singStart;
        this.setPhase("sing");
        this.animate();
      });
    });
  }

  push(s: PitchSample): void {
    if (this.phase === "ready") {
      this.floor.push(20 * Math.log10(Math.max(1e-6, s.level)));
      return;
    }
    if (this.phase !== "sing" || s.time < this.singStart) return;
    const t = s.time - this.singStart;
    const db = 20 * Math.log10(Math.max(1e-6, s.level));
    this.frames.push({ t, db, cents: s.midi === null ? null : (s.midi - this.ex.refMidi()) * 100 });
    if (db > this.floorDb + VOICE_DB) {
      this.voiceStart ??= s.time;
      this.lastVoice = s.time;
    }
    const voicedFor = this.voiceStart === null ? 0 : s.time - this.voiceStart;
    if (this.ex.finishAt(t, voicedFor, s.time - this.lastVoice)) this.finish();
  }

  private animate(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.phase !== "sing") return;
      this.draw();
      this.$("mvPhase").textContent = this.ex.cue(this.host.ctxTime() - this.singStart, this.frames);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private finish(): void {
    if (this.phase !== "sing") return;
    cancelAnimationFrame(this.raf);
    this.ex.analyse(this.frames, this.floorDb);
    this.setPhase("result");
    this.showResult();
    this.showStats();
    this.draw();
  }

  private stop(): void {
    cancelAnimationFrame(this.raf);
    this.clearTimers();
    this.endSession();
    this.setPhase(this.ex.hasResult() ? "result" : "idle");
    this.$("mvStart").textContent = "Start";
    this.draw();
  }

  /** Saves the session so far to the history (if any round was sung) and starts a new one. */
  endSession(): void {
    this.ex.endSession();
    this.showStats();
  }

  // --- display ---

  private setPhase(p: Phase): void {
    this.phase = p;
    const text: Record<Phase, string> = {
      idle: "Press Start",
      ref: this.ex.startNotes().length > 1 ? "Your notes" : "Your note",
      ready: "Breathe in…",
      sing: this.ex.cue(0, []),
      result: "",
    };
    const hint: Record<Phase, string> = {
      idle: this.ex.idleHint(),
      ref: "",
      ready: "Stay quiet for a moment.",
      sing: this.ex.singHint(),
      result: "",
    };
    this.page.dataset.phase = p;
    this.$("mvPhase").textContent = text[p];
    this.$("mvPhase").hidden = !text[p];
    this.$("mvHint").textContent = hint[p];
    this.$("mvHint").hidden = !hint[p];
    this.$("mvDone").hidden = p !== "sing";
    this.$("mvResult").hidden = p !== "result" || !this.ex.hasResult();
    this.$("mvAgain").hidden = p !== "result";
    if (p === "idle") this.$("mvStart").textContent = "Start";
  }

  private showStats(): void {
    this.$("mvStats").textContent = this.ex.statsText();
  }

  private showResult(): void {
    const body = this.$("mvResultBody");
    body.innerHTML = this.ex.hasResult()
      ? this.ex.resultHtml(this.host.toleranceCents())
      : `<h3>Nothing heard</h3><p class="muted">Sing a little louder or closer to the microphone, or check it under Settings.</p>`;
    this.$("mvResult").hidden = false;
  }

  /** Volume (top) and pitch (bottom) against time; the exercise adds its targets and findings. */
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
    const colors = {
      fg: v("--fg", "#222"),
      muted: v("--muted", "#888"),
      grid: v("--roll-grid", "rgba(0,0,0,.08)"),
      accent: v("--accent", "#2a6de0"),
      warn: "#e08a2a",
      lost: "#d9534f",
    };
    const { fg, muted, grid, accent } = colors;

    const L = 40;
    const R = 8;
    const volTop = 18;
    const volH = Math.round((h - 40) * 0.62);
    const pitchTop = volTop + volH + 22;
    const pitchH = h - pitchTop - 16;
    const T = this.ex.timeSpan(this.frames);
    const x = (t: number) => L + (t / T) * (w - L - R);

    // Volume axis: from the noise floor up to above the loudest heard (or a sensible default).
    const maxDb = Math.max(...this.frames.map((f) => f.db), this.ex.peakHint() ?? -Infinity);
    const lo = this.floorDb;
    const hi = Math.max(lo + 30, Number.isFinite(maxDb) ? maxDb + 3 : lo + 40);
    const yV = (db: number) => volTop + volH - ((Math.min(hi, Math.max(lo, db)) - lo) / (hi - lo)) * volH;
    const [pLo, pHi] = this.ex.pitchRange();
    const yP = (c: number) => pitchTop + pitchH - ((Math.max(pLo, Math.min(pHi, c)) - pLo) / (pHi - pLo)) * pitchH;

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

    const view: DrawView = {
      g,
      w,
      L,
      R,
      vol: { top: volTop, h: volH },
      pitch: { top: pitchTop, h: pitchH },
      x,
      yV,
      yP,
      lo,
      hi,
      colors,
      frames: this.frames,
      phase: this.phase,
      tol: this.host.toleranceCents(),
    };
    this.ex.drawBack(view);

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
      const sm = this.ex.smoothDb() ?? smoothDb(fr, 0.1);
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

    this.ex.drawMarks(view);
  }
}
