/**
 * Echo trainer, for audiation: hear a short phrase, hold it in mind through a silence, sing it back.
 * The answer is judged on its notes only, not on when or how long they were sung. Difficulty adapts
 * to how the rounds go.
 */
import { centsOff, statusColor, type NoteStatus, type Settings } from "./analysis";
import { KEYS, MAJOR_SCALE, VOICES, tonicFor, type VoiceType } from "./exercises";
import { INSTRUMENTS, toInstrument, type Instrument } from "./player";
import type { EchoSession } from "./history";
import { midiName, type PitchSample } from "./pitch";
import { analyseVibrato } from "./vibrato";

// --- levels and phrases ----------------------------------------------------

interface Level {
  notes: number;
  /** Largest step between neighbouring notes, in scale degrees (1 = a step, 2 = a third …). */
  maxLeap: number;
  /** Lowest and highest scale degree used (0 = do, -3 = sol below, 7 = do above). */
  lo: number;
  hi: number;
  /** Phrases may outline a chord (do-mi-sol, sol-ti-re …) or run along the scale. */
  patterns: boolean;
  /** Silence between hearing and singing, in seconds. */
  gap: number;
}

export const LEVELS: Level[] = [
  { notes: 1, maxLeap: 0, lo: 0, hi: 4, patterns: false, gap: 1.5 },
  { notes: 1, maxLeap: 0, lo: -3, hi: 7, patterns: false, gap: 1.5 },
  { notes: 2, maxLeap: 1, lo: -1, hi: 5, patterns: false, gap: 1.5 },
  { notes: 2, maxLeap: 2, lo: -3, hi: 7, patterns: false, gap: 1.5 },
  { notes: 3, maxLeap: 1, lo: -1, hi: 5, patterns: true, gap: 1.5 },
  { notes: 3, maxLeap: 2, lo: -3, hi: 7, patterns: true, gap: 2 },
  { notes: 3, maxLeap: 4, lo: -3, hi: 7, patterns: true, gap: 2 },
  { notes: 4, maxLeap: 2, lo: -3, hi: 7, patterns: true, gap: 2 },
  { notes: 4, maxLeap: 4, lo: -3, hi: 7, patterns: true, gap: 2.5 },
  { notes: 5, maxLeap: 2, lo: -3, hi: 7, patterns: true, gap: 2.5 },
  { notes: 5, maxLeap: 4, lo: -3, hi: 7, patterns: true, gap: 3 },
  { notes: 5, maxLeap: 4, lo: -3, hi: 7, patterns: true, gap: 4 },
];

/** `shift` moves the range named (by -2 in minor, where phrases centre on la). */
export function describeLevel(i: number, shift = 0): string {
  const l = LEVELS[i];
  const leaps = l.maxLeap <= 1 ? "steps" : l.maxLeap === 2 ? "steps and thirds" : "with leaps";
  const notes = l.notes === 1 ? "1 note" : `${l.notes} notes, ${leaps}`;
  // The range tells levels apart that otherwise read the same (the two single-note ones), and
  // shows where a level keeps to the middle.
  const name = (d: number) => `${d < 0 ? "low " : d >= 7 ? "high " : ""}${degreeSyl(d)}`;
  const narrow = l.lo > -3 || l.hi < 7;
  const range = l.notes === 1 || narrow ? `, ${name(l.lo + shift)} to ${name(l.hi + shift)}` : "";
  return `${i + 1}: ${notes}${range}${l.patterns ? ", chords and scales" : ""}${l.gap > 2 ? `, ${l.gap} s silence` : ""}`;
}

const randInt = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

/** A random walk: mostly steps, then thirds, rarely larger leaps (up to the level's limit). */
function walk(l: Level): number[] {
  const weights = [0.3, 4, 3, 1.5, 1].slice(0, l.maxLeap + 1); // index = leap size; 0 = repeat
  const options = weights.flatMap((w, m) => (m ? [[m, w] as const, [-m, w] as const] : [[0, w] as const]));
  const total = options.reduce((t, [, w]) => t + w, 0);
  const out = [randInt(Math.max(l.lo, -1), Math.min(l.hi, 5))];
  while (out.length < l.notes) {
    let r = Math.random() * total;
    const move = options.find(([, w]) => (r -= w) < 0)?.[0] ?? 1;
    let next = out[out.length - 1] + move;
    if (next > l.hi || next < l.lo) next = out[out.length - 1] - move; // turn back at the edges
    out.push(next);
  }
  return out;
}

/** Up or down the scale from a random start. */
function run(l: Level): number[] {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const n = l.notes;
  const start = dir > 0 ? randInt(l.lo, l.hi - n + 1) : randInt(l.lo + n - 1, l.hi);
  return Array.from({ length: n }, (_, i) => start + dir * i);
}

/** Moves along the notes of a chord (I, IV, V, vi or ii): do-mi-sol, sol-ti-re, la-do-mi … */
function chordPattern(l: Level): number[] {
  const root = pick([0, 0, 4, 4, 3, 5, 1]);
  // The chord's notes within range, as a ladder.
  const ladder: number[] = [];
  for (let d = l.lo; d <= l.hi; d++) if ([0, 2, 4].includes((((d - root) % 7) + 7) % 7)) ladder.push(d);
  let i = ladder.indexOf(root) >= 0 && Math.random() < 0.6 ? ladder.indexOf(root) : randInt(0, ladder.length - 1);
  let dir = Math.random() < 0.6 ? 1 : -1;
  const out = [ladder[i]];
  while (out.length < l.notes) {
    if (i + dir < 0 || i + dir >= ladder.length || (out.length > 2 && Math.random() < 0.3)) dir = -dir;
    i += dir;
    out.push(ladder[i]);
  }
  return out;
}

export function phraseFor(level: number): number[] {
  const l = LEVELS[level];
  if (!l.patterns || l.notes < 3) return walk(l);
  const r = Math.random();
  if (r < 0.35) return chordPattern(l);
  if (r < 0.55) return run(l);
  return walk(l);
}

const degreeSemis = (deg: number) => MAJOR_SCALE[((deg % 7) + 7) % 7].semis + 12 * Math.floor(deg / 7);
const degreeSyl = (deg: number) => MAJOR_SCALE[((deg % 7) + 7) % 7].syl;

// --- syllable levels: tone sets in the Kodály order ----------------------------------------------

interface SylLevel {
  /** The scale degrees in use (0 = do, -3 = low sol, 7 = high do), low to high. */
  set: number[];
  /** Fewest and most notes in a phrase. */
  notes: [number, number];
  /** Largest move between neighbouring notes, in places within the set (1 = the next tone of the set). */
  leap: number;
  label: string;
}

const PENTA_LOW = [-3, -2, 0, 1, 2, 4, 5];
const SCALE = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];

export const SYL_LEVELS: SylLevel[] = [
  { set: [2, 4], notes: [2, 3], leap: 1, label: "sol mi" },
  { set: [2, 4, 5], notes: [3, 4], leap: 2, label: "sol mi la" },
  { set: [0, 2, 4, 5], notes: [3, 4], leap: 2, label: "do mi sol la" },
  { set: [0, 1, 2, 4, 5], notes: [4, 4], leap: 2, label: "pentatonic: do re mi sol la" },
  { set: PENTA_LOW, notes: [4, 5], leap: 2, label: "pentatonic with low la and low sol" },
  { set: [...PENTA_LOW, 7], notes: [4, 5], leap: 3, label: "pentatonic up to high do, with leaps" },
  { set: [-3, -2, 0, 1, 2, 3, 4, 5, 7], notes: [4, 5], leap: 2, label: "adds fa" },
  { set: SCALE, notes: [5, 5], leap: 2, label: "adds ti: the whole scale" },
  { set: SCALE, notes: [5, 6], leap: 4, label: "the whole scale, with leaps" },
];

export function describeSylLevel(i: number): string {
  const l = SYL_LEVELS[i];
  const n = l.notes[0] === l.notes[1] ? `${l.notes[0]}` : `${l.notes[0]}–${l.notes[1]}`;
  return `${i + 1}: ${l.label}, ${n} notes`;
}

/**
 * A walk through the level's tone set, mostly to neighbouring tones. From the third level on it
 * often ends on the home tone (do in major, la in minor), as tunes do.
 */
export function sylPhraseFor(level: number, minor: boolean): number[] {
  const l = SYL_LEVELS[level];
  const n = randInt(l.notes[0], l.notes[1]);
  const top = l.set.length - 1;
  const weights = [0.4, 5, 2.5, 1.2, 1].slice(0, l.leap + 1);
  const options = weights.flatMap((w, m) => (m ? [[m, w] as const, [-m, w] as const] : [[0, w] as const]));
  const total = options.reduce((t, [, w]) => t + w, 0);
  const idx = [randInt(0, top)];
  while (idx.length < n) {
    let r = Math.random() * total;
    const move = options.find(([, w]) => (r -= w) < 0)?.[0] ?? 1;
    let next = idx[idx.length - 1] + move;
    if (next < 0 || next > top) next = idx[idx.length - 1] - move;
    idx.push(Math.max(0, Math.min(top, next)));
  }
  const out = idx.map((i) => l.set[i]);
  const homes = l.set.filter((d) => (((d % 7) + 7) % 7) === (minor ? 5 : 0));
  if (level >= 2 && homes.length && n > 1 && Math.random() < 0.6) {
    const before = out[n - 2];
    const home = homes.reduce((a, b) => (Math.abs(b - before) < Math.abs(a - before) ? b : a));
    if (Math.abs(l.set.indexOf(home) - l.set.indexOf(before)) <= Math.max(2, l.leap)) out[n - 1] = home;
  }
  return out;
}

/** Curwen's hand sign for a scale degree, as an image path (public/signs). */
const signUrl = (deg: number) => `${import.meta.env.BASE_URL}signs/${degreeSyl(deg)}.png`;

// --- judging the answer -------------------------------------------------------

export interface SungNote {
  target: number;
  /** The pitch sung for it (median of its steady part), or null if it wasn't sung. */
  sung: number | null;
  cents: number;
  status: NoteStatus;
  /** Its span within the answer, in seconds from the answer's start. */
  from: number;
  to: number;
  /**
   * Steadiness, without the way into and out of the note: the spread (standard deviation) of the
   * pitch around its centre and the largest swing away from it, in cents; null if too short to say.
   */
  spread: number | null;
  swing: number | null;
  /** An even, healthy vibrato: its swing is wanted, not a wobble. */
  vibrato: boolean;
  /**
   * Landing: seconds from the start of the note until it settles near its pitch, and where it
   * came from ("above"/"below") if it slid in noticeably; null landing if it never settled.
   */
  landing: number | null;
  slideFrom: "above" | "below" | null;
}

/** Repeat on slide: the longest landing allowed (seconds) for strictness 1–3 (0 = off). */
const SLIDE_LIMITS = [Infinity, 0.3, 0.2, 0.12];
/** A start this far off the note (cents) counts as sliding in; smaller ones are just settling. */
const SLIDE_CENTS = 40;
/** Settled: within this band (or the tolerance, if wider) for this long. */
const SETTLE_CENTS = 20;
const SETTLE_SEC = 0.1;

/** Whether a sung note slid in for longer than strictness `level` (1 lenient … 3 strict) allows. */
export function isSlid(n: SungNote, level: number): boolean {
  if (level <= 0 || n.sung === null || !n.slideFrom || n.landing === null) return false;
  return n.landing > SLIDE_LIMITS[Math.min(level, 3)];
}

/** How a note was reached: time to settle within the band around `centre`, and from which side. */
function landing(points: { time: number; midi: number }[], centre: number, tol: number): Pick<SungNote, "landing" | "slideFrom"> {
  if (points.length < 4) return { landing: null, slideFrom: null };
  const dev = points.map((p) => (p.midi - centre) * 100);
  const med = dev.map((_, i) => {
    const w = dev.slice(Math.max(0, i - 1), i + 2).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const band = Math.max(SETTLE_CENTS, tol);
  const t0 = points[0].time;
  for (let i = 0; i < med.length; i++) {
    // Settled at i if the pitch stays in the band for SETTLE_SEC from here (or to the note's end).
    let held = true;
    for (let j = i; j < med.length && points[j].time - points[i].time < SETTLE_SEC; j++)
      if (Math.abs(med[j]) > band) {
        held = false;
        break;
      }
    if (held) {
      const before = med.slice(0, i);
      const peak = before.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
      return { landing: points[i].time - t0, slideFrom: Math.abs(peak) >= SLIDE_CENTS ? (peak > 0 ? "above" : "below") : null };
    }
  }
  return { landing: null, slideFrom: null };
}

/** Repeat on wobble: [largest spread, largest swing] in cents for strictness 1–3 (0 = off). */
const WOBBLE_LIMITS: [number, number][] = [
  [Infinity, Infinity],
  [22, 70],
  [14, 50],
  [9, 35],
];
/** Left out of the steadiness check: the way into a note and out to the next one, in seconds. */
const EDGE_IN = 0.12;
const EDGE_OUT = 0.1;

/** Whether a sung note wobbles more than strictness `level` (1 lenient … 3 strict) allows. */
export function isWobbly(n: SungNote, level: number): boolean {
  if (level <= 0 || n.sung === null || n.spread === null || n.swing === null || n.vibrato) return false;
  const [spread, swing] = WOBBLE_LIMITS[Math.min(level, 3)];
  return n.spread > spread || n.swing > swing;
}

/** Spread and largest swing (cents) of a held stretch around `centre`, after a 3-point median against glitches. */
function steadiness(points: { time: number; midi: number }[], centre: number): Pick<SungNote, "spread" | "swing" | "vibrato"> {
  if (points.length < 6 || points[points.length - 1].time - points[0].time < 0.15) return { spread: null, swing: null, vibrato: false };
  const dev = points.map((p) => (p.midi - centre) * 100);
  const med = dev.map((_, i) => {
    const w = dev.slice(Math.max(0, i - 1), i + 2).sort((a, b) => a - b);
    return w[Math.floor(w.length / 2)];
  });
  const mean = med.reduce((a, b) => a + b, 0) / med.length;
  const spread = Math.sqrt(med.reduce((a, b) => a + (b - mean) ** 2, 0) / med.length);
  const swing = Math.max(...med.map(Math.abs));
  const v = analyseVibrato(points.map((p, i) => ({ time: p.time, cents: med[i] })));
  return { spread, swing, vibrato: v?.kind === "vibrato" };
}

/** Shorter than this, a note counts as not sung. */
const MIN_NOTE_SEC = 0.12;
/** Further off than this is a wrong note rather than an out-of-tune right one. */
const WRONG_CENTS = 50;

/**
 * Splits the voiced part of an answer into the target notes in order, wherever they fall in time:
 * every voiced frame is given to one note, in sequence, so that the frames fit their notes best
 * (dynamic programming over frames × notes). Glides between notes cost the same as being far off,
 * so they end up at the edges; each note is then judged on its steady middle.
 */
export function judgeAnswer(frames: { time: number; midi: number | null }[], targets: number[], s: Settings): SungNote[] {
  const voiced = frames.filter((f): f is { time: number; midi: number } => f.midi !== null);
  const K = targets.length;
  const t0 = frames[0]?.time ?? 0;
  const missedAll = () =>
    targets.map((target) => ({
      target, sung: null, cents: 0, status: "missed" as NoteStatus, from: 0, to: 0, spread: null, swing: null, vibrato: false, landing: null, slideFrom: null,
    }));
  if (voiced.length < K * 4) return missedAll();
  const F = voiced.length;
  const diff = (m: number, target: number) => Math.min(3, Math.abs(centsOff(m, target, s.octaveFree)) / 100);
  // Each note gets at least M frames (about MIN_NOTE_SEC), so a wrong note can't be squeezed out
  // by its neighbours: it is then judged as sung wrong, not as left out.
  const dt = (voiced[F - 1].time - voiced[0].time) / Math.max(1, F - 1);
  const M = Math.max(1, Math.min(Math.round(MIN_NOTE_SEC / Math.max(dt, 1e-3)), Math.floor(F / K)));
  // Running cost sums per note, so a stretch's cost is a difference.
  const sum = targets.map((t) => {
    const c = new Float64Array(F + 1);
    for (let f = 0; f < F; f++) c[f + 1] = c[f] + diff(voiced[f].midi, t);
    return c;
  });
  // dp[f*K + k]: least cost with frames 0..f covered and frame f belonging to note k. A note either
  // carries on (one more frame) or begins with a block of M frames.
  const dp = new Float64Array(F * K).fill(Infinity);
  const began = new Uint8Array(F * K);
  for (let f = 0; f < F; f++)
    for (let k = 0; k < K; k++) {
      const stay = f > 0 ? dp[(f - 1) * K + k] + diff(voiced[f].midi, targets[k]) : Infinity;
      const s0 = f - M + 1; // first frame of a block ending at f
      let move = Infinity;
      if (s0 >= 0) {
        const block = sum[k][f + 1] - sum[k][s0];
        if (k === 0 && s0 === 0) move = block;
        else if (k > 0 && s0 > 0) move = dp[(s0 - 1) * K + k - 1] + block;
      }
      if (move < stay) {
        dp[f * K + k] = move;
        began[f * K + k] = 1;
      } else dp[f * K + k] = stay;
    }
  // Trace back the frames of each note.
  const owner = new Int32Array(F);
  let k = K - 1;
  for (let f = F - 1; f >= 0; ) {
    if (began[f * K + k]) {
      for (let j = 0; j < M; j++) owner[f - j] = k;
      f -= M;
      k--;
    } else {
      owner[f] = k;
      f--;
    }
  }
  return targets.map((target, n) => {
    const idx: number[] = [];
    for (let f = 0; f < F; f++) if (owner[f] === n) idx.push(f);
    const from = idx.length ? voiced[idx[0]].time - t0 : 0;
    const to = idx.length ? voiced[idx[idx.length - 1]].time - t0 : 0;
    const none = { spread: null, swing: null, vibrato: false, landing: null, slideFrom: null };
    if (to - from < MIN_NOTE_SEC * 0.6) return { target, sung: null, cents: 0, status: "missed" as NoteStatus, from, to, ...none };
    // Leave out the start (the way in) and the end (the way out to the next note).
    const steady = idx.slice(Math.floor(idx.length * 0.25), Math.max(Math.floor(idx.length * 0.25) + 1, Math.ceil(idx.length * 0.85)));
    const ms = steady.map((f) => voiced[f].midi).sort((a, b) => a - b);
    const sung = ms[Math.floor(ms.length / 2)];
    const cents = centsOff(sung, target, s.octaveFree);
    const a = Math.abs(cents);
    const status: NoteStatus = a <= s.toleranceCents ? "good" : a <= WRONG_CENTS ? "close" : "off";
    const held = idx.map((f) => voiced[f]).filter((p) => p.time - t0 >= from + EDGE_IN && p.time - t0 <= to - EDGE_OUT);
    return { target, sung, cents, status, from, to, ...steadiness(held, sung), ...landing(idx.map((f) => voiced[f]), sung, s.toleranceCents) };
  });
}

/** The overall impression, as a singer would put it. */
type Impression = "flat" | "in tune" | "sharp" | "wrong notes";

function impressionOf(notes: SungNote[], tol: number): Impression {
  if (notes.some((n) => n.status === "off" || n.status === "missed")) return "wrong notes";
  const mean = notes.reduce((a, n) => a + n.cents, 0) / notes.length;
  return mean < -tol ? "flat" : mean > tol ? "sharp" : "in tune";
}

// --- the trainer ----------------------------------------------------------------

type Phase = "idle" | "key" | "listen" | "hold" | "read" | "sing" | "rate" | "result";

/** Echo: hear a phrase and sing it back. Syllables: read solfège syllables and sing them, unheard. */
export type TrainMode = "echo" | "syllables";

export type Help = "learn" | "hint" | "test";
const HELP_LABEL: Record<Help, string> = { learn: "Learn", hint: "Hint", test: "Test" };
/** First tries in a row, of these, that suggest moving to less help. */
const SUGGEST_OF = 8;
const SUGGEST_RIGHT = 6;

/** Where each mode is on its own staircase. */
interface LevelState {
  /** Fixed level, or null to adapt. */
  fixedLevel: number | null;
  level: number;
  /** The day (YYYY-MM-DD, local) of the last session, to start a new day with a warm-up. */
  lastDay?: string;
  /**
   * During a warm-up: the level reached last time, which the warm-up climbs back to (one right
   * round per level); null otherwise.
   */
  warmTo?: number | null;
}

interface EchoPrefs extends LevelState {
  key: number;
  voice: VoiceType;
  /** Minor is la-based: the same syllables as the relative major, with la as home. */
  minor?: boolean;
  mode?: TrainMode;
  /** What plays before each syllable phrase: the home tone, the whole cadence, or nothing. */
  ref?: "home" | "key" | "none";
  /**
   * How much the Syllables mode helps: Learn plays the phrase first while the cards light up;
   * Hint plays the first note, then the whole phrase, on request; Test plays nothing.
   */
  help?: Help;
  /** The Syllables mode's level (Echo's is on the prefs themselves). */
  syl?: LevelState;
  sound: Instrument;
  selfRate: boolean;
  autoNext: boolean;
  /** How often a phrase is tried again while not every note is in tune. */
  repeats: number;
  /** Also repeat when a note wobbles: 0 off, 1 lenient … 3 strict. */
  wobble?: number;
  /** Also repeat when a note slides in: 0 off, 1 lenient … 3 strict. */
  slide?: number;
  /** Settings version: 2 made piano the default sound. */
  v?: number;
}

/** How well each pitch (MIDI number) has gone: a running average of 0..1 over the last tries. */
type NoteMap = Record<number, { avg: number; n: number }>;
const NOTES_KEY = "ptchmtch.echo.notes";
/** The average follows about this many latest tries. */
const NOTE_MEMORY = 20;

/** A note's score: 1 in tune, falling to 0.5 at 50 cents off, 0 for a wrong or missing note. */
function noteValue(n: SungNote, tol: number): number {
  if (n.status === "good") return 1;
  if (n.status === "close") return 1 - (0.5 * (Math.abs(n.cents) - tol)) / Math.max(1, WRONG_CENTS - tol);
  return 0;
}

/** Red (0) through yellow (0.5) to green (1). */
export function accuracyColor(v: number): [number, number, number] {
  const red = [209, 59, 59], yellow = [226, 180, 0], green = [31, 157, 85];
  const [a, b, t] = v < 0.5 ? [red, yellow, v / 0.5] : [yellow, green, (v - 0.5) / 0.5];
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as [number, number, number];
}

const PREFS_KEY = "ptchmtch.echo";
/** Right rounds in a row to move up, wrong ones in a row to move down. */
const UP_AFTER = 3;
const DOWN_AFTER = 2;
/** The answer ends after this much silence once singing has started. */
const END_SILENCE = 1.1;
/** Note lengths when playing a phrase, in seconds. */
const NOTE_SEC = 0.7;
const LAST_SEC = 1.2;

export interface EchoHost {
  ctxTime(): number;
  play(notes: { midi: number | number[]; start: number; dur: number }[], sound: Instrument): { end: number; stop: () => void };
  ensureMic(): Promise<boolean>;
  settings(): Settings;
}

function newStats() {
  return { mode: "echo" as TrainMode, rounds: 0, right: 0, inTune: 0, rated: 0, agreed: 0, top: 0, started: 0, startLevel: 0, context: "", absCents: 0, notes: 0, landing: 0, landed: 0 };
}

export class EchoTrainer {
  private prefs: EchoPrefs = { key: 0, voice: "alto", fixedLevel: null, level: 0, sound: "piano", selfRate: false, autoNext: true, repeats: 3, v: 2 };
  /** 0 for a new phrase, then 1, 2 … for each repeat of it. */
  private attempt = 0;
  private notes: NoteMap = {};
  private phase: Phase = "idle";
  private timers: number[] = [];
  /** The pending automatic move to the next round, if any. */
  private autoTimer = 0;
  private stopSound: (() => void) | null = null;
  private tonic = 60;
  private degs: number[] = [];
  private targets: number[] = [];
  private frames: { time: number; midi: number | null }[] = [];
  private singStart = 0;
  private voicedSec = 0;
  private lastVoiced = 0;
  private result: SungNote[] = [];
  private selfImpression: Impression | null = null;
  private streak = 0; // > 0: right rounds in a row, < 0: wrong ones
  private stats = newStats();
  /** Hints used on this phrase (Hint mode): 1 = the first note, 2 = the whole phrase. */
  private hints = 0;
  /** The phrase was played before it was sung (Learn, or a whole-phrase hint in Hint or Test). */
  private heard = false;
  /** Recent first tries (right or not) with the current help, for suggesting less help. */
  private recent: boolean[] = [];
  /** Called when a session with at least one round ends (Stop, closing, a new key or voice, leaving the page). */
  onSession: (s: EchoSession, mode: TrainMode) => void = () => {};
  private $ = <T extends HTMLElement = HTMLElement>(id: string) => this.dlg.querySelector<T>(`#${id}`)!;

  /** `dlg` is the Audiation page the trainer lives on. */
  constructor(
    private dlg: HTMLElement,
    private host: EchoHost,
  ) {
    try {
      const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
      if (!saved.v) delete saved.sound; // piano became the default
      Object.assign(this.prefs, saved, { v: 2 });
      this.prefs.sound = toInstrument(this.prefs.sound);
      this.notes = JSON.parse(localStorage.getItem(NOTES_KEY) || "{}");
    } catch {
      /* defaults */
    }
    const keySel = this.$<HTMLSelectElement>("ecKeySel");
    KEYS.forEach((k, pc) => keySel.append(new Option(k, String(pc))));
    const voiceSel = this.$<HTMLSelectElement>("ecVoice");
    VOICES.forEach((v) => voiceSel.append(new Option(v.label, v.id)));
    const levelSel = this.$<HTMLSelectElement>("ecLevel");
    const fillLevels = () => {
      levelSel.replaceChildren(new Option("Automatic", "auto"));
      for (let i = 0; i < this.levelCount; i++) levelSel.append(new Option(this.describe(i), String(i)));
    };
    fillLevels();
    const soundSel = this.$<HTMLSelectElement>("ecSound");
    INSTRUMENTS.forEach((i) => soundSel.append(new Option(i.label, i.id)));

    const showPrefs = () => {
      keySel.value = String(this.prefs.key);
      voiceSel.value = this.prefs.voice;
      levelSel.value = this.lv.fixedLevel === null ? "auto" : String(this.lv.fixedLevel);
      this.$<HTMLSelectElement>("ecTonality").value = this.minor ? "minor" : "major";
      this.$<HTMLSelectElement>("ecRef").value = this.prefs.ref ?? "home";
      this.$("ecRefWrap").hidden = this.mode !== "syllables";
      this.$("ecHelpWrap").hidden = this.mode !== "syllables";
      this.$<HTMLSelectElement>("ecHelp").value = this.help;
      for (const b of this.dlg.querySelectorAll<HTMLButtonElement>("#ecMode button")) b.classList.toggle("on", b.dataset.mode === this.mode);
      this.$("ecTitle").textContent = this.mode === "syllables" ? "Sing the syllables" : "Echo";
      if (this.phase === "idle")
        this.$("ecContext").textContent =
          this.mode === "syllables" ? "Read solfège syllables, hear them in your head, sing them" : "Hear a short phrase, keep it in mind, sing it back";
      soundSel.value = this.prefs.sound;
      this.$<HTMLInputElement>("ecSelf").checked = this.prefs.selfRate;
      this.$<HTMLInputElement>("ecAuto").checked = this.prefs.autoNext;
      this.$<HTMLSelectElement>("ecRepeats").value = String(this.prefs.repeats);
      this.$<HTMLSelectElement>("ecWobble").value = String(this.prefs.wobble ?? 0);
      this.$<HTMLSelectElement>("ecSlide").value = String(this.prefs.slide ?? 0);
    };
    showPrefs();
    const onChange = (restart: boolean) => () => {
      this.prefs.key = +keySel.value;
      this.prefs.voice = voiceSel.value as VoiceType;
      this.lv.fixedLevel = levelSel.value === "auto" ? null : +levelSel.value;
      this.prefs.minor = this.$<HTMLSelectElement>("ecTonality").value === "minor";
      this.prefs.ref = this.$<HTMLSelectElement>("ecRef").value as EchoPrefs["ref"];
      const help = this.$<HTMLSelectElement>("ecHelp").value as Help;
      if (help !== this.help) {
        this.prefs.help = help;
        this.recent = [];
      }
      // Level names in Echo name the range, which minor moves.
      fillLevels();
      levelSel.value = this.lv.fixedLevel === null ? "auto" : String(this.lv.fixedLevel);
      this.prefs.sound = soundSel.value as Instrument;
      this.prefs.selfRate = this.$<HTMLInputElement>("ecSelf").checked;
      const auto = this.$<HTMLInputElement>("ecAuto").checked;
      if (auto !== this.prefs.autoNext) {
        // Takes effect at once: unticked, a pending move to the next round is cancelled;
        // ticked on a result, it carries on from here.
        this.prefs.autoNext = auto;
        if (!auto) this.cancelAuto();
        else if (this.phase === "result") this.scheduleAuto(2);
      }
      this.prefs.repeats = +this.$<HTMLSelectElement>("ecRepeats").value;
      this.prefs.wobble = +this.$<HTMLSelectElement>("ecWobble").value;
      this.prefs.slide = +this.$<HTMLSelectElement>("ecSlide").value;
      this.save();
      this.showLevel();
      this.paintMap();
      // A new key or voice needs the key played again.
      if (restart && this.phase !== "idle") this.start();
    };
    keySel.addEventListener("change", onChange(true));
    voiceSel.addEventListener("change", onChange(true));
    this.$("ecTonality").addEventListener("change", onChange(true));
    // A new kind of help is a new session (History shows the help used).
    this.$("ecHelp").addEventListener("change", onChange(true));
    this.$("ecHintBtn").addEventListener("click", () => this.giveHint());
    this.$("ecReady").addEventListener("click", () => {
      if (this.phase !== "read") return;
      this.clearTimers();
      this.beginAnswer();
    });
    this.$("ecResultBody").addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest<HTMLButtonElement>("button[data-help]");
      if (!b) return;
      const sel = this.$<HTMLSelectElement>("ecHelp");
      sel.value = b.dataset.help!;
      sel.dispatchEvent(new Event("change"));
    });
    for (const id of ["ecLevel", "ecSound", "ecSelf", "ecAuto", "ecRepeats", "ecWobble", "ecSlide", "ecRef"]) this.$(id).addEventListener("change", onChange(false));
    // Switching mode ends the session (each mode has its own history and level).
    for (const b of this.dlg.querySelectorAll<HTMLButtonElement>("#ecMode button"))
      b.addEventListener("click", () => {
        if (b.dataset.mode === this.mode) return;
        this.stop();
        this.prefs.mode = b.dataset.mode as TrainMode;
        this.streak = 0;
        this.degs = [];
        this.targets = [];
        this.save();
        fillLevels();
        showPrefs();
        this.setPhase("idle");
        this.showLevel();
        this.paintMap();
      });

    this.$("ecStart").addEventListener("click", () => (this.phase === "idle" ? this.start() : this.stop()));
    this.$("ecKey").addEventListener("click", () => this.playKey());
    this.$("ecNext").addEventListener("click", () => this.next());
    this.$("ecSkip").addEventListener("click", () => this.next(true));
    this.$("ecMapReset").addEventListener("click", () => {
      if (!confirm("Forget how well each note has gone so far?")) return;
      this.notes = {};
      this.saveNotes();
      this.paintMap();
    });
    const map = this.$<HTMLCanvasElement>("ecMap");
    map.addEventListener("mousemove", (e) => (map.title = this.mapTip(e.offsetY)));
    this.$("ecDone").addEventListener("click", () => this.finishAnswer());
    this.$("ecAgain").addEventListener("click", () => this.practiceAgain());
    for (const b of this.dlg.querySelectorAll<HTMLButtonElement>("#ecRate button"))
      b.addEventListener("click", () => this.rate(b.dataset.rate as Impression));
    // Keep the keyboard on the stage after clicking, so Enter doesn't press the clicked button again.
    this.dlg.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest("button")) this.$("ecStage").focus();
    });
    // Keys work anywhere on the page while it is shown (not in fields, buttons or dialogs).
    document.addEventListener("keydown", (e) => {
      if (!this.isOpen || (e.target as HTMLElement).closest("select, button, input, textarea, dialog")) return;
      if (e.key === "Enter") {
        e.preventDefault();
        if (this.phase === "idle") this.start();
        else if (this.phase === "read") {
          this.clearTimers();
          this.beginAnswer();
        } else if (this.phase === "sing") this.finishAnswer();
        else if (this.phase === "result") this.next();
      } else if (e.key === "h" || e.key === "H") {
        this.giveHint();
      } else if (e.code === "Space" && this.phase === "result") {
        e.preventDefault();
        this.practiceAgain();
      }
    });
  }

  /** Shows the page, ready to start. */
  open(): void {
    if (this.isOpen) return;
    this.stats = newStats();
    this.showStats();
    this.showLevel();
    this.setPhase("idle");
    this.dlg.hidden = false;
    this.paintMap();
    this.$("ecStage").focus();
  }

  /** Leaves the page: stops the session (saving it to the history). */
  close(): void {
    if (!this.isOpen) return;
    this.stop();
    this.dlg.hidden = true;
  }

  get isOpen(): boolean {
    return !this.dlg.hidden;
  }

  /** Pitch from the microphone; only collected while the answer is being sung. */
  push(s: PitchSample): void {
    if (this.phase !== "sing" || s.time < this.singStart) return;
    const prev = this.frames[this.frames.length - 1];
    this.frames.push({ time: s.time, midi: s.midi });
    this.$("ecMeter").style.width = `${Math.min(100, s.level * 400)}%`;
    if (s.midi !== null) {
      if (prev?.midi != null) this.voicedSec += s.time - prev.time;
      this.lastVoiced = s.time;
    }
    const now = s.time;
    if (this.voicedSec > 0.25 && now - this.lastVoiced > END_SILENCE) this.finishAnswer();
    else if (this.voicedSec === 0 && now - this.singStart > 8) this.finishAnswer(); // nothing sung
    else if (now - this.singStart > 6 + this.targets.length * 3) this.finishAnswer();
  }

  private get mode(): TrainMode {
    return this.prefs.mode ?? "echo";
  }

  get currentMode(): TrainMode {
    return this.mode;
  }

  private get help(): Help {
    return this.prefs.help ?? "learn";
  }

  private get minor(): boolean {
    return !!this.prefs.minor;
  }

  /** The current mode's staircase. */
  private get lv(): LevelState {
    return this.mode === "syllables" ? (this.prefs.syl ??= { fixedLevel: null, level: 0 }) : this.prefs;
  }

  private get level(): number {
    return Math.min(this.levelCount - 1, this.lv.fixedLevel ?? this.lv.level);
  }

  private get levelCount(): number {
    return this.mode === "syllables" ? SYL_LEVELS.length : LEVELS.length;
  }

  private describe(i: number): string {
    return this.mode === "syllables" ? describeSylLevel(i) : describeLevel(i, this.shift);
  }

  /** Echo phrases in minor are moved down to la, so they centre on the minor home tone. */
  private get shift(): number {
    return this.mode === "echo" && this.minor ? -2 : 0;
  }

  /** Lowest and highest scale degree phrases can use. */
  private get degRange(): [number, number] {
    return [-3 + this.shift, 7 + this.shift];
  }

  /** Pitch class of do: the key's own tonic in major, a minor third above it in (la-based) minor. */
  private get doPc(): number {
    return (this.prefs.key + (this.minor ? 3 : 0)) % 12;
  }

  /** MIDI number of do for the voice, placed so the phrases' range suits it. */
  private doMidi(): number {
    const [lo, hi] = this.degRange;
    return tonicFor(this.prefs.voice, this.doPc, degreeSemis(lo), degreeSemis(hi));
  }

  private keyName(): string {
    return `${KEYS[this.prefs.key]} ${this.minor ? "minor" : "major"}`;
  }

  private save(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs));
    } catch {
      /* not remembered */
    }
  }

  private later(sec: number, fn: () => void): void {
    this.timers.push(window.setTimeout(fn, Math.max(0, sec) * 1000));
  }

  /** Moves on to the next round after `sec` seconds, unless cancelled. */
  private scheduleAuto(sec: number): void {
    this.cancelAuto();
    this.autoTimer = window.setTimeout(() => {
      this.autoTimer = 0;
      this.next();
    }, sec * 1000);
  }

  private cancelAuto(): void {
    clearTimeout(this.autoTimer);
    this.autoTimer = 0;
  }

  private clearTimers(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.cancelAuto();
    this.stopSound?.();
    this.stopSound = null;
  }

  private async start(): Promise<void> {
    this.clearTimers();
    this.endSession();
    if (!(await this.host.ensureMic())) return;
    // A new day starts from level 1 again and climbs quickly back to where you were: a warm-up,
    // and a check that yesterday's level still holds.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const lv = this.lv;
    if (lv.lastDay && lv.lastDay !== today && lv.fixedLevel === null && lv.level > 0) {
      lv.warmTo = lv.level;
      lv.level = 0;
      this.streak = 0;
    }
    lv.lastDay = today;
    this.save();
    this.showLevel();
    this.tonic = this.doMidi();
    this.$("ecStart").textContent = "Stop";
    this.$("ecContext").textContent =
      `${this.keyName()} · ${VOICES.find((v) => v.id === this.prefs.voice)!.label}` + (this.mode === "syllables" ? ` · ${HELP_LABEL[this.help]}` : "");
    // The key once, then a silence, then the first round.
    const end = this.playKey();
    this.later(end + 1.2, () => this.round());
  }

  private stop(): void {
    this.clearTimers();
    this.endSession();
    this.setPhase("idle");
    this.$("ecStart").textContent = "Start";
  }

  /** I – IV – V – I in the key (i – iv – V – i in minor, with the raised si); returns its length in seconds. */
  private playKey(): number {
    this.stopSound?.();
    const pc = (x: number) => (((this.prefs.key + x) % 12) + 12) % 12;
    // Root position in the bass, the chord's notes in the octave above middle E.
    const chord = (root: number, third: number) => [36 + pc(root), ...[0, third, 7].map((x) => 52 + pc(root + x - 4))];
    const t = this.minor ? 3 : 4;
    const notes = [
      { midi: chord(0, t), start: 0, dur: 0.75 },
      { midi: chord(5, t), start: 0.75, dur: 0.75 },
      { midi: chord(7, 4), start: 1.5, dur: 0.75 },
      { midi: chord(0, t), start: 2.25, dur: 1.3 },
    ];
    const p = this.host.play(notes, "piano");
    this.stopSound = p.stop;
    if (this.phase === "idle") this.setPhase("key");
    return p.end - this.host.ctxTime();
  }

  /** Plays a phrase and listens for the answer: a new phrase, or the same one again (`repeat`). */
  private round(repeat = false): void {
    if (repeat) this.attempt++;
    else {
      this.attempt = 0;
      const make = () => (this.mode === "syllables" ? sylPhraseFor(this.level, this.minor) : phraseFor(this.level).map((d) => d + this.shift));
      let degs = make();
      for (let i = 0; degs.join() === this.degs.join() && i < 10; i++) degs = make();
      this.degs = degs;
      this.targets = degs.map((d) => this.tonic + degreeSemis(d));
    }
    this.result = [];
    this.selfImpression = null;
    this.showLevel();
    if (this.mode === "syllables") return this.readRound();
    this.setPhase("listen");
    const end = this.playPhrase();
    this.later(end, () => {
      this.setPhase("hold");
      this.later(LEVELS[this.level].gap, () => this.beginAnswer());
    });
  }

  /**
   * Syllables: the reference (if any), then the syllables to read; singing starts after a moment
   * to hear them inwardly, or at once with Enter.
   */
  private readRound(): void {
    this.hints = 0;
    this.heard = this.help === "learn";
    this.setPhase("read");
    this.showHintButton();
    let t = 0;
    const home = this.minor ? 5 : 0;
    if (this.prefs.ref === "key") t = this.playKey() + 0.4;
    else if (this.prefs.ref !== "none") {
      this.stopSound?.();
      const p = this.host.play([{ midi: this.tonic + degreeSemis(home), start: 0, dur: 1.2 }], this.prefs.sound);
      this.stopSound = p.stop;
      this.light(-1, 0.08, 1.2);
      // A clear pause, so the home note isn't heard as the phrase's first note.
      t = p.end - this.host.ctxTime() + 0.8;
    }
    const ref = this.prefs.ref === "none" ? "" : this.prefs.ref === "key" ? "After the key: " : `This is ${degreeSyl(home)}. `;
    const hint = this.$("ecHint");
    if (this.help === "learn") {
      // Hear it with the syllables lighting up, then sing it back.
      hint.textContent = `${ref}Listen and follow the syllables, then sing them back.`;
      this.later(t, () => {
        const len = this.playPhrase(true);
        this.later(len + 1, () => {
          if (this.phase === "read") this.beginAnswer();
        });
      });
    } else if (this.help === "hint") {
      // No hurry: sing when ready (Enter); a hint if lost (H).
      hint.textContent = `${ref}Hear the syllables in your head. Lost? Hint (H) plays the first note, then the whole phrase. Sing when ready (Enter).`;
    } else {
      hint.textContent = `${ref}Hear the syllables in your head, then sing them (Enter to start now).`;
      this.later(t + 1.5 + 0.4 * this.targets.length, () => {
        if (this.phase === "read") this.beginAnswer();
      });
    }
  }

  /** Hint mode: the first note, then (pressed again) the whole phrase, which then doesn't count. */
  private giveHint(): void {
    if (this.phase !== "read" || this.mode !== "syllables" || this.help !== "hint" || this.hints >= 2) return;
    this.hints++;
    if (this.hints === 1) {
      this.stopSound?.();
      const p = this.host.play([{ midi: this.targets[0], start: 0, dur: 1.2 }], this.prefs.sound);
      this.stopSound = p.stop;
      this.light(0, 0.08, 1.2);
    } else {
      this.heard = true;
      this.playPhrase(true);
    }
    this.showHintButton();
  }

  private showHintButton(): void {
    const b = this.$<HTMLButtonElement>("ecHintBtn");
    b.hidden = !(this.mode === "syllables" && this.help === "hint" && this.phase === "read");
    b.disabled = this.hints >= 2;
    b.textContent = this.hints === 0 ? "Hint: first note" : this.hints === 1 ? "Hint: whole phrase" : "Hint used";
    this.$("ecReady").hidden = !(this.mode === "syllables" && this.phase === "read");
  }

  /** Lights card `i` from `at` for `dur` seconds (relative to now). */
  /** Lights phrase card `i` (or the home-note card, for -1) from `at` for `dur` seconds (relative to now). */
  private light(i: number, at: number, dur: number): void {
    const card = () => (i < 0 ? this.$("ecSyl").querySelector(".syl.ref") : this.$("ecSyl").querySelectorAll(".syl:not(.ref)")[i]);
    this.later(at, () => card()?.classList.add("on"));
    this.later(at + dur, () => card()?.classList.remove("on"));
  }

  /** Plays the current phrase; returns its length in seconds. */
  private playPhrase(highlight = false): number {
    this.stopSound?.();
    const n = this.targets.length;
    // playNotes starts 80 ms from now.
    if (highlight) this.targets.forEach((_, i) => this.light(i, 0.08 + i * NOTE_SEC, n === 1 ? 1.5 : i === n - 1 ? LAST_SEC : NOTE_SEC - 0.05));
    const notes = this.targets.map((midi, i) => ({
      midi,
      start: i * NOTE_SEC,
      dur: n === 1 ? 1.5 : i === n - 1 ? LAST_SEC : NOTE_SEC,
    }));
    const p = this.host.play(notes, this.prefs.sound);
    this.stopSound = p.stop;
    return p.end - this.host.ctxTime();
  }

  private beginAnswer(): void {
    this.frames = [];
    this.voicedSec = 0;
    this.singStart = this.host.ctxTime();
    this.lastVoiced = this.singStart;
    this.setPhase("sing");
  }

  private finishAnswer(): void {
    if (this.phase !== "sing") return;
    this.result = judgeAnswer(this.frames, this.targets, this.host.settings());
    if (this.prefs.selfRate) this.setPhase("rate");
    else this.reveal();
  }

  private rate(imp: Impression): void {
    this.selfImpression = imp;
    this.reveal();
  }

  /** Not every note in tune and steady (if wobble counts), and repeats left: the phrase comes again. */
  private get willRepeat(): boolean {
    const wobble = this.prefs.wobble ?? 0;
    const slide = this.prefs.slide ?? 0;
    return this.attempt < this.prefs.repeats && !this.result.every((n) => n.status === "good" && !isWobbly(n, wobble) && !isSlid(n, slide));
  }

  private reveal(): void {
    const tol = this.host.settings().toleranceCents;
    const right = this.result.every((n) => n.status === "good" || n.status === "close");
    const inTune = this.result.every((n) => n.status === "good");
    // Only the first try of a phrase counts towards the level, the session and the note map: a
    // repeat has been heard more often, so it says less about hearing from memory.
    // In Hint and Test, a phrase played as a hint has been heard: it doesn't count either.
    const counts = this.attempt === 0 && (this.mode !== "syllables" || this.help === "learn" || !this.heard);
    if (counts && this.mode === "syllables") {
      this.recent.push(right);
      if (this.recent.length > SUGGEST_OF) this.recent.shift();
    }
    if (counts) {
      if (!this.stats.rounds) {
        this.stats.started = Date.now();
        this.stats.startLevel = this.level;
        this.stats.mode = this.mode;
        this.stats.context = this.$("ecContext").textContent ?? "";
      }
      this.stats.rounds++;
      for (const n of this.result)
        if (n.status === "good" || n.status === "close") {
          this.stats.absCents += Math.abs(n.cents);
          this.stats.notes++;
          if (n.landing !== null) {
            this.stats.landing += n.landing;
            this.stats.landed++;
          }
        }
      if (right) this.stats.right++;
      if (inTune) this.stats.inTune++;
      this.adapt(right);
      this.stats.top = Math.max(this.stats.top, this.level);
      for (const n of this.result) this.addNote(n.target, noteValue(n, tol));
      this.saveNotes();
    }
    if (this.selfImpression) {
      this.stats.rated++;
      if (this.selfImpression === impressionOf(this.result, tol)) this.stats.agreed++;
    }
    this.setPhase("result");
    this.showResult();
    this.showStats();
    this.showLevel();
    this.paintMap();
    const again = this.willRepeat;
    this.$("ecNext").textContent = again ? "Try again" : "Next round";
    this.$("ecSkip").hidden = !again;
    if (again) {
      // The phrase plays again as the next try begins.
      if (this.prefs.autoNext) this.scheduleAuto(2.5);
      return;
    }
    // Hear the phrase again to compare, then carry on.
    this.later(0.5, () => {
      const len = this.playPhrase();
      if (this.prefs.autoNext) this.scheduleAuto(len + 2);
    });
  }

  /** Saves the session so far to the history (if any round was sung) and starts a new one. */
  endSession(): void {
    const s = this.stats;
    if (s.rounds > 0)
      this.onSession({
        date: s.started,
        context: s.context,
        rounds: s.rounds,
        right: s.right,
        inTune: s.inTune,
        startLevel: s.startLevel + 1,
        endLevel: this.level + 1,
        topLevel: s.top + 1,
        meanAbsCents: s.notes ? s.absCents / s.notes : null,
        meanLanding: s.landed ? s.landing / s.landed : null,
        rated: s.rated,
        agreed: s.agreed,
        minutes: (Date.now() - s.started) / 60000,
        toleranceCents: this.host.settings().toleranceCents,
      }, s.mode);
    this.stats = newStats();
  }

  private addNote(midi: number, v: number): void {
    const e = (this.notes[midi] ??= { avg: v, n: 0 });
    e.n++;
    e.avg += (v - e.avg) / Math.min(e.n, NOTE_MEMORY);
  }

  private saveNotes(): void {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(this.notes));
    } catch {
      /* not remembered */
    }
  }

  /** The same phrase once more, by choice: hear it, then sing it again (counts as another try). */
  private practiceAgain(): void {
    if (this.phase !== "result") return;
    this.clearTimers();
    this.setPhase("hold");
    this.later(0.8, () => this.round(true));
  }

  /** The next round: the same phrase again if it should be repeated (unless `skip`), else a new one. */
  private next(skip = false): void {
    if (this.phase !== "result") return;
    const repeat = !skip && this.willRepeat;
    this.clearTimers();
    this.setPhase("hold"); // a moment's quiet before the next phrase
    this.later(0.8, () => this.round(repeat));
  }

  /** Staircase: up a level after a run of right rounds, down after a run of wrong ones. */
  private adapt(right: boolean): void {
    this.streak = right ? Math.max(1, this.streak + 1) : Math.min(-1, this.streak - 1);
    const lv = this.lv;
    if (lv.fixedLevel !== null) return;
    const warm = lv.warmTo != null && lv.level < lv.warmTo;
    if (this.streak >= (warm ? 1 : UP_AFTER) && lv.level < this.levelCount - 1) {
      lv.level++;
      this.streak = 0;
      if (lv.warmTo != null && lv.level >= lv.warmTo) lv.warmTo = null;
    } else if (this.streak <= -DOWN_AFTER && lv.level > 0) {
      lv.level--;
      this.streak = 0;
    }
    this.save();
  }

  // --- display ---

  private setPhase(p: Phase): void {
    this.phase = p;
    const text: Record<Phase, string> = {
      idle: "Press Start",
      key: "The key",
      listen: "Listen",
      hold: "Hold it in your mind…",
      read: this.help === "learn" ? "Listen and read" : "Read it",
      sing: this.mode === "syllables" ? "Sing it" : "Sing it back",
      rate: "How was it?",
      result: "",
    };
    const hint: Record<Phase, string> = {
      idle:
        this.mode === "syllables"
          ? "You'll hear the key, then see a few solfège syllables with their hand signs. Hear them in your head, then sing them, in your own time."
          : "You'll hear the key, then a short phrase. Keep it in mind through the silence, then sing it back, in your own time.",
      key: "",
      listen: "",
      hold: "",
      read: "Hear the syllables in your head, then sing them (Enter to start now).",
      sing: "Take your time; it ends when you stop. Enter when done.",
      rate: "Before you see the result: how did it sound to you?",
      result: "",
    };
    this.dlg.dataset.phase = p;
    this.$("ecPhase").textContent = text[p];
    this.$("ecPhase").hidden = !text[p];
    this.$("ecHint").textContent = hint[p];
    this.$("ecHint").hidden = !hint[p];
    this.$("ecRate").hidden = p !== "rate";
    this.$("ecResult").hidden = p !== "result";
    this.$("ecDone").hidden = p !== "sing";
    this.$("ecMeterWrap").hidden = p !== "sing";
    const syl = this.mode === "syllables";
    this.$("ecDots").innerHTML = !syl && ["listen", "hold", "sing"].includes(p) ? this.targets.map(() => "<span></span>").join("") : "";
    const cards = this.$("ecSyl");
    cards.hidden = !syl || !["read", "sing"].includes(p);
    if (!cards.hidden && p === "read") cards.innerHTML = this.cardsHtml();
    if (p !== "sing") this.$("ecMeter").style.width = "0";
    this.showHintButton();
  }

  private showLevel(): void {
    const lv = this.lv;
    const auto = lv.fixedLevel === null;
    let text = `Level ${this.describe(this.level)}`;
    const warm = auto && lv.warmTo != null && this.level < lv.warmTo;
    if (warm) text += ` · warming up: each right round moves up, back to level ${lv.warmTo! + 1}`;
    else if (auto && this.streak > 0 && this.level < this.levelCount - 1) text += ` · ${UP_AFTER - this.streak} more right to move up`;
    this.$("ecLevelInfo").textContent = text;
  }

  private showStats(): void {
    const s = this.stats;
    if (!s.rounds) {
      this.$("ecStats").textContent = "";
      return;
    }
    let text = `This session: ${s.right} of ${s.rounds} right, ${s.inTune} in tune · up to level ${s.top + 1}`;
    if (s.rated) text += ` · your own rating matched ${s.agreed} of ${s.rated}`;
    this.$("ecStats").textContent = text;
  }

  private showResult(): void {
    const tol = this.host.settings().toleranceCents;
    const r = this.result;
    const right = r.filter((n) => n.status === "good" || n.status === "close").length;
    const imp = impressionOf(r, tol);
    const wobble = this.prefs.wobble ?? 0;
    const slide = this.prefs.slide ?? 0;
    const count = (k: number, one: string, many: string) => (r.length === 1 ? one : `${k} ${k === 1 ? "note" : "notes"} ${many}`);
    const wobbly = r.filter((n) => isWobbly(n, wobble)).length;
    const slid = r.filter((n) => isSlid(n, slide)).length;
    const issues = [slid ? count(slid, "it slid in", slid === 1 ? "slid in" : "slid in") : "", wobbly ? count(wobbly, "it wobbles", wobbly === 1 ? "wobbles" : "wobble") : ""].filter(Boolean);
    const head =
      right === r.length
        ? r.every((n) => n.status === "good")
          ? issues.length
            ? `In tune, but ${issues.join(" and ")}`
            : "All right and in tune"
          : `All right, a little ${imp === "flat" ? "flat" : imp === "sharp" ? "sharp" : "out of tune"}`
        : r.every((n) => n.status === "missed")
          ? "Nothing heard"
          : `${right} of ${r.length} notes right`;
    let rated = "";
    if (this.selfImpression) {
      rated =
        this.selfImpression === imp
          ? `<p class="echo-agree good">You heard it right: ${imp}.</p>`
          : `<p class="echo-agree">You said <b>${this.selfImpression}</b>; it was <b>${imp}</b>.</p>`;
    }
    const rows = r
      .map((n, i) => {
        const sung =
          n.sung === null
            ? "not sung"
            : n.status === "off"
              ? `sang ${midiName(n.sung)}`
              : `${n.cents > 0 ? "+" : ""}${Math.round(n.cents)}¢`;
        // Steadiness: shown when wobble counts, or for an even vibrato.
        const steady =
          n.spread === null || n.swing === null
            ? ""
            : n.vibrato
              ? `<span class="echo-steady">even vibrato</span>`
              : wobble
                ? `<span class="echo-steady${isWobbly(n, wobble) ? " wobbly" : ""}" title="Spread ±${Math.round(n.spread)}¢, largest swing ${Math.round(n.swing)}¢">${isWobbly(n, wobble) ? "wobbly" : "steady"} ±${Math.round(n.spread)}¢</span>`
                : "";
        // Landing: shown when slides count, and for any long slide.
        const slidHere = isSlid(n, slide);
        const land =
          n.sung === null || n.landing === null
            ? ""
            : n.slideFrom && (slide || n.landing > SLIDE_LIMITS[1])
              ? `<span class="echo-steady${slidHere ? " wobbly" : ""}" title="Settled after ${n.landing.toFixed(2)} s">slid in from ${n.slideFrom} · ${n.landing.toFixed(1)} s</span>`
              : slide
                ? `<span class="echo-steady">clean start</span>`
                : "";
        const flagged = n.status === "good" && (isWobbly(n, wobble) || slidHere);
        return (
          `<li style="--c:${statusColor(flagged ? "close" : n.status)}"><b>${degreeSyl(this.degs[i])}</b>` +
          `<span>${midiName(n.target)}</span><span class="echo-sung">${sung}</span>${land}${steady}</li>`
        );
      })
      .join("");
    const tries =
      this.attempt === 0
        ? ""
        : `<p class="echo-agree">Try ${this.attempt + 1}${this.attempt <= this.prefs.repeats ? ` of ${this.prefs.repeats + 1}` : " (extra practice)"}</p>`;
    let help = "";
    if (this.mode === "syllables") {
      if (this.help !== "learn" && this.heard && this.attempt === 0) help = `<p class="echo-agree">You heard the whole phrase as a hint, so this one doesn't count towards the level.</p>`;
      const next: Help | null = this.help === "learn" ? "hint" : this.help === "hint" ? "test" : null;
      const ok = this.recent.filter(Boolean).length;
      if (next && this.recent.length >= SUGGEST_OF && ok >= SUGGEST_RIGHT)
        help += `<p class="echo-agree good">${ok} of the last ${this.recent.length} right with ${HELP_LABEL[this.help]}. Ready for less help? <button class="btn ghost small" data-help="${next}">Switch to ${HELP_LABEL[next]}</button></p>`;
    }
    this.$("ecResultBody").innerHTML = `<h3>${head}</h3>${tries}${rated}${help}<ol class="echo-notes">${rows}</ol>`;
    this.paintAnswer();
  }

  /**
   * The phrase as syllable cards with Curwen's hand signs, each raised by its pitch, as the hand
   * rises with the tones; low and high octaves are marked.
   */
  private cardsHtml(): string {
    const [lo, hi] = this.degRange;
    const card = (d: number, cls: string, note: string) =>
      `<div class="syl${cls}" style="--h:${((d - lo) / (hi - lo)).toFixed(3)}"><i class="sign" style="--img:url('${signUrl(d)}')"></i><b>${degreeSyl(d)}</b><small>${note}</small></div>`;
    const oct = (d: number) => (d < 0 ? "low" : d >= 7 ? "high" : "");
    // The home note heard before the phrase gets its own card, set apart, so it isn't read as
    // part of the phrase.
    const home = this.prefs.ref === "home" || this.prefs.ref === undefined ? card(this.minor ? 5 : 0, " ref", "home") : "";
    return home + this.degs.map((d) => card(d, "", oct(d))).join("");
  }

  /** Pitches shown on the note map: the current voice's range of phrase notes, with a margin. */
  private mapRange(): [number, number] {
    const doMidi = this.doMidi();
    const [lo, hi] = this.degRange;
    return [doMidi + degreeSemis(lo) - 1, doMidi + degreeSemis(hi) + 1];
  }

  /**
   * A bar from red through yellow to green per pitch: how well each note has gone (first tries,
   * the last 20 or so); faint where it has hardly been tried, empty where never.
   */
  private paintMap(): void {
    const cv = this.$<HTMLCanvasElement>("ecMap");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (!w || !h) return;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const [lo, hi] = this.mapRange();
    const step = h / (hi - lo + 1);
    const y = (m: number) => h - (m - lo + 0.5) * step;
    const barX = 34;
    const barW = w - barX - 2;
    // Bar: a vertical gradient through the notes' colours, so neighbours blend as in a heat map.
    // Notes outside the key that were never sung are left out, so the scale's notes blend.
    const grad = g.createLinearGradient(0, h, 0, 0);
    const inKey = (m: number) => MAJOR_SCALE.some((d) => (this.doPc + d.semis) % 12 === ((m % 12) + 12) % 12);
    for (let m = lo; m <= hi; m++) {
      const e = this.notes[m];
      const pos = (m - lo + 0.5) / (hi - lo + 1);
      if (!e && !inKey(m) && m !== lo && m !== hi) continue;
      if (!e) grad.addColorStop(pos, "rgba(128,128,128,0.12)");
      else {
        const [r, gg, b] = accuracyColor(e.avg);
        grad.addColorStop(pos, `rgba(${r},${gg},${b},${0.3 + 0.7 * Math.min(1, e.n / 5)})`);
      }
    }
    g.fillStyle = grad;
    g.beginPath();
    g.roundRect(barX, 0, barW, h, 4);
    g.fill();
    // Note names, and a tick on the tonic.
    const css = getComputedStyle(this.dlg);
    g.font = "10px system-ui";
    g.textBaseline = "middle";
    g.fillStyle = css.getPropertyValue("--muted") || "#888";
    const tonic = this.prefs.key; // home: do in major, la in minor
    for (let m = lo; m <= hi; m++) {
      if (step < 11 && midiName(m).length > 2) continue; // too tight: naturals only
      g.font = m % 12 === tonic % 12 ? "bold 10px system-ui" : "10px system-ui";
      g.fillText(midiName(m), 2, y(m));
    }
  }

  private mapTip(offsetY: number): string {
    const cv = this.$<HTMLCanvasElement>("ecMap");
    const [lo, hi] = this.mapRange();
    const m = lo + Math.floor(((cv.clientHeight - offsetY) / cv.clientHeight) * (hi - lo + 1));
    const e = this.notes[m];
    return e ? `${midiName(m)}: ${Math.round(e.avg * 100)}% (${e.n} ${e.n === 1 ? "try" : "tries"})` : `${midiName(m)}: not sung yet`;
  }

  /** The sung line, as sung (in time), with each note's target over the stretch that was matched to it. */
  private paintAnswer(): void {
    const cv = this.$<HTMLCanvasElement>("ecCanvas");
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    cv.width = w * dpr;
    cv.height = h * dpr;
    const g = cv.getContext("2d")!;
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const t0 = this.frames[0]?.time ?? 0;
    const dur = Math.max(1, (this.frames[this.frames.length - 1]?.time ?? t0) - t0);
    const sungMidis = this.frames.flatMap((f) => (f.midi === null ? [] : [f.midi]));
    const lo = Math.min(...this.targets, ...sungMidis.filter((m) => Math.abs(m - this.targets[0]) < 14)) - 1.5;
    const hi = Math.max(...this.targets, ...sungMidis.filter((m) => Math.abs(m - this.targets[0]) < 14)) + 1.5;
    const x = (t: number) => 40 + ((t - t0) / dur) * (w - 50);
    const y = (m: number) => h - 8 - ((m - lo) / (hi - lo)) * (h - 16);
    const css = getComputedStyle(this.dlg);
    // Semitone grid with note names.
    g.font = "10px system-ui";
    g.textBaseline = "middle";
    for (let m = Math.ceil(lo); m <= hi; m++) {
      g.fillStyle = css.getPropertyValue("--roll-grid") || "rgba(0,0,0,.06)";
      g.fillRect(40, y(m), w - 40, 1);
      g.fillStyle = css.getPropertyValue("--muted") || "#888";
      g.fillText(midiName(m), 4, y(m));
    }
    // Targets over their matched stretches.
    for (const n of this.result) {
      if (n.sung === null) continue;
      g.fillStyle = statusColor(n.status) + "33";
      g.fillRect(x(t0 + n.from), y(n.target) - 5, Math.max(4, x(t0 + n.to) - x(t0 + n.from)), 10);
    }
    // The sung line.
    g.strokeStyle = css.getPropertyValue("--fg") || "#222";
    g.lineWidth = 2;
    g.beginPath();
    let pen = false;
    for (const f of this.frames) {
      if (f.midi === null || f.midi < lo || f.midi > hi) {
        pen = false;
        continue;
      }
      if (pen) g.lineTo(x(f.time), y(f.midi));
      else g.moveTo(x(f.time), y(f.midi));
      pen = true;
    }
    g.stroke();
  }
}
