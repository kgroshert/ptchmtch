import { Calibration } from "./calibration";
import { diagnose, renderDiagnosis } from "./diagnosis";
import { alignRecording, analyseRecording, toBeats, type Alignment, type Recording } from "./recording";
import {
  evaluate,
  noteWeight,
  precision,
  runScore,
  statusColor,
  summarize,
  summarizeVibrato,
  noteScore,
  weakRanges,
  type WeakRange,
  type NoteResult,
  type Settings,
  type TakeSample,
} from "./analysis";
import {
  addRow,
  loadRows,
  LOOP_VIEW,
  loopsKey,
  renderView,
  RUN_VIEW,
  runsKey,
  TRAINER_KEY,
  TRAINER_VIEW,
  ECHO_KEY,
  ECHO_VIEW,
  SYL_KEY,
  SYL_VIEW,
  type EchoSession,
  upsertRow,
  type LoopSession,
  type Run,
  type TrainerSession,
} from "./history";
import { midiName, PitchTracker, type MethodReading, type PitchSample } from "./pitch";
import { DETECTORS, type DetectorId } from "./detectors";
import { INSTRUMENTS, Player, toInstrument, type Instrument } from "./player";
import { PitchRoll } from "./roll";
import { Score, type NoteEvent, type Track } from "./score";
import { oscillates } from "./vibrato";
import { PitchTrainer } from "./trainer";
import { EXERCISES, KEYS, generateExercise, type ExerciseId } from "./exercises";
import { EchoTrainer } from "./echo";

type Mode = "lead" | "normal" | "mute";

interface Prefs {
  mode: Mode;
  others: number;
  speed: number;
  loop: boolean;
  countIn: boolean;
  reference: boolean;
  metronome: boolean;
  hideGraph: boolean;
  toleranceCents: number;
  octaveFree: boolean;
  /** Play and score notes under 8va/8vb marks as written, without the octave shift. */
  ignoreOctaveShifts: boolean;
  onsetMs: number;
  latencyMs: number;
  deviceId: string;
  /** Show only the staves of the part being practised. */
  onlyMyPart: boolean;
  /** Fit the pitch graph's axis to the notes in view. */
  fitPitch: boolean;
  /** Height of the pitch graph in px (0 = default). */
  rollHeight: number;
  /** Pitch detection method, its per-method minimum confidence, and the analysis window. */
  pitchMethod: DetectorId;
  pitchThresholds: Partial<Record<DetectorId, number>>;
  pitchWindow: number;
  /** Playback sounds of the practised part and of the other parts. */
  soundMine: Instrument;
  soundOthers: Instrument;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULTS: Prefs = {
  mode: "normal",
  others: 60,
  speed: 100,
  loop: false,
  countIn: true,
  reference: true,
  metronome: false,
  hideGraph: false,
  toleranceCents: 25,
  octaveFree: false,
  ignoreOctaveShifts: false,
  onsetMs: 100,
  latencyMs: 0,
  deviceId: "",
  onlyMyPart: false,
  fitPitch: true,
  rollHeight: 0,
  pitchMethod: "mpm",
  pitchThresholds: {},
  pitchWindow: 2048,
  soundMine: "piano",
  soundOthers: "piano",
};

function loadPrefs(): Prefs {
  try {
    // Looping always starts off; it is a per-session choice.
    const p: Prefs = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("ptchmtch.prefs") || "{}"), loop: false };
    p.soundMine = toInstrument(p.soundMine);
    p.soundOthers = toInstrument(p.soundOthers);
    return p;
  } catch {
    return { ...DEFAULTS };
  }
}

const prefs = loadPrefs();
function savePrefs(): void {
  try {
    const { loop, ...kept } = prefs;
    localStorage.setItem("ptchmtch.prefs", JSON.stringify(kept));
  } catch {
    /* storage unavailable */
  }
}

// --- core objects ---------------------------------------------------------

const scorePane = $("scorePane");
const score = new Score($("score"));
score.setIgnoreOctaveShifts(prefs.ignoreOctaveShifts);
const roll = new PitchRoll($<HTMLCanvasElement>("roll"), $("tip"));
let player: Player | null = null;
let tracker: PitchTracker | null = null;
const trainer = new PitchTrainer($<HTMLDialogElement>("trainer"));
let stopTone: (() => void) | null = null;
let trainerEvent: NoteEvent | null = null;

let loaded = false;
let track: Track | null = null;
let range = { from: 0, to: 0 }; // measure indices, inclusive
let results = new Map<number, NoteResult>();
let current: TakeSample[] = [];
let previous: TakeSample[] = [];
let samplePass = -1;
let pending: NoteEvent[] = [];
let pendingIdx = 0;
/** Results scored during the current pass only, for recording a run. */
let passResults = new Map<number, NoteResult>();
/** Each note's median pitch (cents) in every pass since Play, for precision across loop passes. */
let passMedians = new Map<number, number[]>();
/** Mean absolute deviation (cents) of each loop pass that covered most of the notes. */
let passAccuracies: number[] = [];
/** Whether the current playback loops (the checkbox may change while playing). */
let playLoop = false;
/** Vibrato rate of the singer's most recent notes that had one, for judging short notes. */
let singerRate: number | null = null;
let playhead: number | null = null;
/** Where Play continues after a stop (null = from the start of the selection). */
let resumeBeat: number | null = null;
/** Date of the loop session recorded for the current practice, so continuing updates it instead of adding another. */
let loopSessionDate: number | null = null;

const settings = (): Settings => ({
  toleranceCents: prefs.toleranceCents,
  octaveFree: prefs.octaveFree,
  onsetMs: prefs.onsetMs,
});

function getPlayer(): Player {
  player ??= new Player(score);
  return player;
}

/** Seconds between a note being scheduled and the singer's matching sound reaching the analyser. */
function latency(): number {
  const auto = (player?.outputLatency ?? 0) + (tracker?.inputLatency ?? 0);
  return auto + prefs.latencyMs / 1000;
}

// --- loading --------------------------------------------------------------

async function loadScore(content: string | Blob, name: string): Promise<void> {
  stop();
  exerciseLoaded = false;
  try {
    await score.load(content);
  } catch (err) {
    console.error(err);
    alert(`Could not read ${name}: ${(err as Error).message ?? err}`);
    return;
  }
  loaded = true;
  scorePane.classList.add("has-score");
  $("title").textContent = score.title;
  document.title = `${score.title} · ptchmtch`;

  fillVoiceSelect();
  range = { from: 0, to: score.measures.length - 1 };
  clearRecording(); // it was lined up with the previous piece
  selectTrack(score.tracks[0]?.key ?? null);
  roll.viewStart = -0.5;
  scorePane.scrollTop = 0;
  syncRangeInputs();
  drawOverlay();
}

/** Lists the parts with their ranges. */
function fillVoiceSelect(): void {
  const sel = $<HTMLSelectElement>("voice");
  sel.innerHTML = "";
  for (const t of score.tracks) {
    const o = document.createElement("option");
    o.value = t.key;
    o.textContent = `${t.label} (${midiName(t.minMidi)}–${midiName(t.maxMidi)})`;
    sel.append(o);
  }
  sel.value = track?.key ?? "";
}

function selectTrack(key: string | null): void {
  if (track) for (const ev of track.events) score.colorEvent(ev, null);
  track = score.tracks.find((t) => t.key === key) ?? null;
  $<HTMLSelectElement>("voice").value = key ?? "";
  results = new Map();
  passMedians = new Map();
  passAccuracies = [];
  resumeBeat = null;
  singerRate = null;
  current = [];
  previous = [];
  if (prefs.onlyMyPart) {
    score.showOnly(track);
    rerenderScore();
  } else paintTrack();
  applyGains();
  loadPractiseList();
  if (recording) showRecording(); // folds the recording into the new part's octaves
  refresh();
}

/** Lays the score out again (after a size or visibility change) and restores colours and cursor. */
function rerenderScore(): void {
  if (!loaded) return;
  score.render();
  paintTrack();
  drawOverlay();
  score.setCursorBeat(playhead ?? rangeBeats().start);
}

/** Marks the practice part in the score: blue until sung, then by result. */
function paintTrack(): void {
  if (!track) return;
  const accent = getComputedStyle(document.documentElement).getPropertyValue("--target").trim() || "#2f6fde";
  for (const ev of track.events) {
    const r = results.get(ev.id);
    score.colorEvent(ev, r ? statusColor(r.status) : accent);
  }
}

// --- range / overlay ------------------------------------------------------

function rangeBeats(): { start: number; end: number } {
  const ms = score.measures;
  if (!ms.length) return { start: 0, end: 0 };
  return { start: ms[range.from].start, end: ms[range.to].end };
}

function setRange(from: number, to: number): void {
  const n = score.measures.length - 1;
  from = Math.max(0, Math.min(n, from));
  to = Math.max(from, Math.min(n, to));
  range = { from, to };
  passMedians = new Map();
  passAccuracies = [];
  resumeBeat = null;
  syncRangeInputs();
  drawOverlay();
  const wasPlaying = player?.playing;
  if (!wasPlaying) {
    score.setCursorBeat(rangeBeats().start);
    roll.reveal(rangeBeats().start);
  }
  refresh();
  updateSummary();
  if (wasPlaying) void play();
}

function syncRangeInputs(): void {
  const ms = score.measures;
  const f = $<HTMLInputElement>("from");
  const t = $<HTMLInputElement>("to");
  f.max = t.max = String(ms.length ? ms[ms.length - 1].number : 1);
  f.value = String(ms[range.from]?.number ?? 1);
  t.value = String(ms[range.to]?.number ?? 1);
}

function measureIndexByNumber(n: number): number {
  const i = score.measures.findIndex((m) => m.number >= n);
  return i < 0 ? score.measures.length - 1 : i;
}

function drawOverlay(): void {
  const ov = $("overlay");
  ov.innerHTML = "";
  if (!loaded) return;
  const boxes = score.measureBoxes();
  const whole = range.from === 0 && range.to === score.measures.length - 1;
  if (whole) return;
  for (let i = range.from; i <= range.to; i++) {
    const b = boxes[i];
    if (!b || !b.w) continue;
    const d = document.createElement("div");
    d.className = "sel";
    Object.assign(d.style, { left: `${b.x}px`, top: `${b.y - 12}px`, width: `${b.w}px`, height: `${b.h + 24}px` });
    ov.append(d);
  }
}

roll.onRangeSelect = (a, b) => setRange(a, b);

// --- gains ----------------------------------------------------------------

const soundOf = (key: string): Instrument => (track && key === track.key ? prefs.soundMine : prefs.soundOthers);

function applySounds(): void {
  if (!player?.playing) return;
  for (const t of score.tracks) player.setTrackInstrument(t.key, soundOf(t.key));
}

function trackGain(key: string): number {
  if (track && key === track.key) return { lead: 1.4, normal: 0.75, mute: 0 }[prefs.mode];
  return (prefs.others / 100) * 0.8;
}

function applyGains(): void {
  if (!player) return;
  for (const t of score.tracks) player.setTrackGain(t.key, trackGain(t.key));
}

// --- transport ------------------------------------------------------------

/**
 * Starts playback. `resume` continues where the last stop left off (if it did), keeping the
 * current run and loop statistics; otherwise playback starts over at the selection.
 */
async function play(resume = false): Promise<void> {
  if (!loaded || !track) return;
  const p = getPlayer();
  const { start, end } = rangeBeats();
  const from = resume && resumeBeat !== null ? resumeBeat : null;
  resumeBeat = null;
  samplePass = -1;
  pending = track.events.filter((ev) => ev.start >= start - 1e-6 && ev.end <= end + 1e-6);
  if (from === null) {
    if (current.length) previous = current;
    current = [];
    pendingIdx = 0;
    passResults = new Map();
    passMedians = new Map();
    passAccuracies = [];
    loopSessionDate = null;
  } else {
    // Notes before the resume point were already scored (or skipped) in this pass; the ones
    // from it on are sung again, so drop what the stop scored for them.
    pendingIdx = pending.findIndex((ev) => ev.start >= from - 1e-6);
    if (pendingIdx < 0) pendingIdx = pending.length;
    current = current.filter((s) => s.beat < from);
    for (const ev of pending.slice(pendingIdx)) {
      const r = passResults.get(ev.id);
      if (!r) continue;
      if (r.status !== "missed") passMedians.get(ev.id)?.pop();
      passResults.delete(ev.id);
    }
  }
  playLoop = prefs.loop;
  hideToast();
  const first = track.events.find((ev) => ev.end > (from ?? start));
  playhead = from ?? start;
  score.setCursorBeat(playhead);
  roll.follow = true;
  roll.reveal(playhead);
  await p.play({
    tracks: score.tracks.map((t) => ({ key: t.key, events: t.events, gain: trackGain(t.key), instrument: soundOf(t.key) })),
    startBeat: start,
    endBeat: end,
    loop: prefs.loop,
    speed: prefs.speed / 100,
    countIn: prefs.countIn,
    referenceMidi: prefs.reference && first ? first.midi : null,
    referenceInstrument: prefs.soundMine,
    metronome: prefs.metronome,
    resumeBeat: from ?? undefined,
  });
  setPlayingUI(true);
  document.body.classList.toggle("graph-hidden", prefs.hideGraph);
  requestAnimationFrame(frame);
}

/** `completed` = the piece (or selection) played to its end rather than being stopped. */
function stop(completed = false): void {
  if (!player?.playing) return;
  const at = playhead;
  player.stop();
  finishPass(Infinity);
  if (completed) recordRun();
  else if (playLoop) recordLoopSession();
  // Play continues from the beat the stop happened in; the playhead stays there.
  const { end } = rangeBeats();
  resumeBeat = completed || at === null || beatFloor(at) >= end - 1e-6 ? null : beatFloor(at);
  playhead = resumeBeat;
  setPlayingUI(false);
  document.body.classList.remove("graph-hidden");
  $("countdown").hidden = true;
  refresh();
}

/** The start of the beat that `beat` falls in. */
function beatFloor(beat: number): number {
  const m = score.measureAt(beat);
  return m.start + Math.floor((beat - m.start) / m.beatLength + 1e-6) * m.beatLength;
}

/** Jumps back to the start of the selection, without starting or stopping playback. */
function backToStart(): void {
  if (player?.playing) {
    void play();
    return;
  }
  resumeBeat = null;
  playhead = null;
  const { start } = rangeBeats();
  score.setCursorBeat(start);
  roll.reveal(start);
  refresh();
}

function setPlayingUI(on: boolean): void {
  const b = $("play");
  b.textContent = on ? "Pause" : "Play";
}

function frame(): void {
  const p = player;
  if (!p?.playing) return;
  const pos = p.positionAt(p.ctx.currentTime - p.outputLatency);
  const cd = $("countdown");
  if (pos.kind === "ended") {
    stop(true);
    return;
  }
  if (pos.kind === "countIn") {
    cd.hidden = false;
    cd.textContent = String(pos.beatsLeft);
  } else {
    cd.hidden = true;
    playhead = pos.beat;
    score.setCursorBeat(pos.beat);
  }
  refresh();
  requestAnimationFrame(frame);
}

// --- pitch input ----------------------------------------------------------

function onSample(s: PitchSample): void {
  $("level").style.width = `${Math.min(100, s.level * 400)}%`;
  showLive(s.midi);
  trainer.push(s);
  echo.push(s);

  const p = player;
  if (!p?.playing) return;
  const time = s.time - latency();
  const pos = p.positionAt(time);
  if (pos.kind !== "playing") return;
  if (pos.pass !== samplePass) {
    if (samplePass >= 0) {
      finishPass(Infinity);
      recordRun();
      const acc = passAccuracy();
      if (acc !== null) passAccuracies.push(acc);
      passResults = new Map();
      previous = current;
      current = [];
    }
    samplePass = pos.pass;
  }
  current.push({ beat: pos.beat, time, midi: s.midi });
  finishPass(pos.beat);
}

/** Scores every pending note that ended before `beat`. */
function finishPass(beat: number): void {
  if (!tracker?.active || !current.length) {
    if (beat === Infinity) pendingIdx = 0;
    return;
  }
  const lastBeat = current[current.length - 1].beat;
  // While running, wait until a note is over; when the pass ends, score whatever was reached.
  const done = (ev: NoteEvent) => (beat === Infinity ? ev.start < lastBeat : ev.end + 0.05 <= Math.min(beat, lastBeat));
  let changed = false;
  while (pendingIdx < pending.length && done(pending[pendingIdx])) {
    const ev = pending[pendingIdx++];
    const r = evaluate(ev, current, settings(), singerRate);
    if (r.vibrato) singerRate = oscillates(r.vibrato) ? r.vibrato.rate : null;
    results.set(ev.id, r);
    passResults.set(ev.id, r);
    if (r.status !== "missed") passMedians.set(ev.id, [...(passMedians.get(ev.id) ?? []), r.cents]);
    score.colorEvent(ev, statusColor(r.status));
    changed = true;
  }
  if (beat === Infinity) pendingIdx = 0;
  if (changed) updateSummary();
}

let liveText = "";
function showLive(midi: number | null): void {
  let t = "—";
  if (midi !== null) {
    const c = Math.round((midi - Math.round(midi)) * 100);
    t = `${midiName(midi)} ${c >= 0 ? "+" : ""}${c}¢`;
  }
  if (t !== liveText) $("live").textContent = liveText = t;
}

/** Turns the microphone on if it isn't already; null if that failed. */
async function ensureMic(): Promise<PitchTracker | null> {
  if (!tracker?.active) await toggleMic();
  return tracker?.active ? tracker : null;
}

async function toggleMic(): Promise<void> {
  const btn = $("mic");
  if (tracker?.active) {
    tracker.stop();
    btn.classList.remove("on");
    $("level").style.width = "0";
    showLive(null);
    return;
  }
  const p = getPlayer();
  tracker ??= new PitchTracker(p.ctx);
  tracker.onSample = onSample;
  applyDetection();
  try {
    await tracker.start(prefs.deviceId || undefined);
    btn.classList.add("on");
    void listDevices();
  } catch (err) {
    alert(`Microphone unavailable: ${(err as Error).message ?? err}`);
  }
}

// --- pitch detection settings ---------------------------------------------

const detectorInfo = (id: DetectorId) => DETECTORS.find((d) => d.id === id) ?? DETECTORS[0];
const thresholdOf = (id: DetectorId) => prefs.pitchThresholds[id] ?? detectorInfo(id).threshold;

/** Refreshes every place that shows the detection settings (Settings dialog, trainer). */
const detectionViews: (() => void)[] = [];

function applyDetection(): void {
  $("detectSummary").textContent = `${detectorInfo(prefs.pitchMethod).label}, window ${prefs.pitchWindow}`;
  for (const v of detectionViews) v();
  if (!tracker) return;
  tracker.method = prefs.pitchMethod;
  for (const d of DETECTORS) tracker.thresholds[d.id] = thresholdOf(d.id);
  tracker.windowSize = prefs.pitchWindow;
}

function bindDetection(): void {
  const dlg = $<HTMLDialogElement>("detect");
  const rows = $("detectRows");
  const slider = $<HTMLInputElement>("detectThreshold");
  const win = $<HTMLSelectElement>("detectWindow");
  /** Per method: times of the last 3 s of loud frames, and whether each was accepted. */
  let recent = new Map<DetectorId, { t: number; ok: boolean }[]>();

  rows.innerHTML = DETECTORS.map(
    (d) =>
      `<tr data-id="${d.id}"><td>${d.label}</td><td class="note">–</td>` +
      `<td><div class="conf"><i></i><b></b></div></td><td class="share">–</td></tr>`,
  ).join("");
  rows.addEventListener("click", (e) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>("tr[data-id]");
    if (!tr) return;
    prefs.pitchMethod = tr.dataset.id as DetectorId;
    savePrefs();
    applyDetection();
  });

  const sync = (): void => {
    const info = detectorInfo(prefs.pitchMethod);
    for (const tr of rows.querySelectorAll<HTMLElement>("tr")) {
      const id = tr.dataset.id as DetectorId;
      tr.classList.toggle("selected", id === prefs.pitchMethod);
      tr.querySelector<HTMLElement>(".conf > b")!.style.left = `${thresholdOf(id) * 100}%`;
    }
    $("detectDesc").textContent = `${info.label}: ${info.description} Its confidence measures ${info.confidence}.`;
    $("detectMethodName").textContent = info.label;
    slider.value = String(thresholdOf(info.id));
    $("detectThresholdOut").textContent = thresholdOf(info.id).toFixed(2);
    win.value = String(prefs.pitchWindow);
  };

  slider.addEventListener("input", () => {
    prefs.pitchThresholds = { ...prefs.pitchThresholds, [prefs.pitchMethod]: +slider.value };
    savePrefs();
    applyDetection();
  });
  win.addEventListener("change", () => {
    prefs.pitchWindow = +win.value;
    savePrefs();
    applyDetection();
    recent = new Map();
  });
  $("detectReset").addEventListener("click", () => {
    prefs.pitchMethod = DEFAULTS.pitchMethod;
    prefs.pitchThresholds = {};
    prefs.pitchWindow = DEFAULTS.pitchWindow;
    savePrefs();
    applyDetection();
  });
  detectionViews.push(sync);

  const onCompare = (readings: MethodReading[], level: number) => {
    const now = performance.now() / 1000;
    for (const r of readings) {
      const tr = rows.querySelector<HTMLElement>(`tr[data-id="${r.id}"]`)!;
      const e = r.estimate;
      const note = tr.querySelector<HTMLElement>(".note")!;
      if (e) {
        const midi = 69 + 12 * Math.log2(e.hz / 440);
        const c = Math.round((midi - Math.round(midi)) * 100);
        note.textContent = `${midiName(midi)} ${c >= 0 ? "+" : ""}${c}¢`;
      } else note.textContent = "–";
      note.classList.toggle("rejected", !r.accepted);
      const bar = tr.querySelector<HTMLElement>(".conf > i")!;
      bar.style.width = `${(e?.confidence ?? 0) * 100}%`;
      bar.classList.toggle("ok", r.accepted);
      // Detection rate over loud frames only, so pauses between notes don't count.
      const list = recent.get(r.id) ?? [];
      if (level >= (tracker?.gate ?? 0)) list.push({ t: now, ok: r.accepted });
      while (list.length && list[0].t < now - 3) list.shift();
      recent.set(r.id, list);
      tr.querySelector<HTMLElement>(".share")!.textContent = list.length
        ? `${Math.round((list.filter((x) => x.ok).length / list.length) * 100)}%`
        : "–";
    }
  };

  $("detectBtn").addEventListener("click", async () => {
    $<HTMLDialogElement>("settings").close();
    dlg.showModal();
    const t = await ensureMic();
    if (t && dlg.open) t.onCompare = onCompare;
  });
  $("detectClose").addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", () => {
    if (tracker) tracker.onCompare = null;
    recent = new Map();
  });
  bindTrainerDetection();
  applyDetection();
}

/** The compact detection controls in the trainer: method, its minimum confidence and the window. */
function bindTrainerDetection(): void {
  const method = $<HTMLSelectElement>("trMethod");
  const slider = $<HTMLInputElement>("trThreshold");
  const win = $<HTMLSelectElement>("trWindow");
  for (const d of DETECTORS) method.append(new Option(d.label, d.id));
  method.addEventListener("change", () => {
    prefs.pitchMethod = method.value as DetectorId;
    savePrefs();
    applyDetection();
  });
  slider.addEventListener("input", () => {
    prefs.pitchThresholds = { ...prefs.pitchThresholds, [prefs.pitchMethod]: +slider.value };
    savePrefs();
    applyDetection();
  });
  win.addEventListener("change", () => {
    prefs.pitchWindow = +win.value;
    savePrefs();
    applyDetection();
  });
  detectionViews.push(() => {
    const info = detectorInfo(prefs.pitchMethod);
    method.value = info.id;
    method.title = info.description;
    slider.value = String(thresholdOf(info.id));
    slider.title = `Minimum ${info.confidence}`;
    $("trThresholdOut").textContent = thresholdOf(info.id).toFixed(2);
    win.value = String(prefs.pitchWindow);
  });
}

// --- run history ----------------------------------------------------------

/** Stores the pass that just ended if it covered the whole piece and was actually sung. */
function recordRun(): void {
  if (!track || !tracker?.active) return;
  if (range.from !== 0 || range.to !== score.measures.length - 1) return;
  const rs = track.events.map((ev) => passResults.get(ev.id)).filter((r): r is NoteResult => !!r);
  const s = summarize(track.events, passResults);
  if (s.sung < track.events.length * 0.3) return; // not really a run-through
  const key = runsKey(score.fingerprint, track.key);
  const before = loadRows<Run>(key);
  const vib = summarizeVibrato(rs);
  const run: Run = {
    date: Date.now(),
    score: runScore(track.events, passResults),
    notes: track.events.length,
    sung: s.sung,
    good: s.good,
    goodShare: s.goodShare,
    meanAbsCents: s.meanAbsCents,
    meanCents: s.meanCents,
    cleanRate: s.onsets ? s.clean / s.onsets : null,
    speed: prefs.speed,
    toleranceCents: prefs.toleranceCents,
    vibratoNotes: vib.analysed,
    vibratoRate: vib.rate,
    vibratoExtent: vib.extent,
    vibratoRegularity: vib.regularity,
    wobbleShare: vib.analysed ? vib.counts.wobble / vib.analysed : null,
  };
  addRow(key, run);
  const prev = before[before.length - 1];
  const best = Math.max(...before.map((r) => r.score));
  let cmp = "first recorded run";
  if (prev) {
    const d = Math.round(run.score) - Math.round(prev.score);
    cmp = `${d > 0 ? "+" : ""}${d} vs. last run`;
    if (run.score > best) cmp += " · new best";
  }
  showToast(`Run complete: score <b>${Math.round(run.score)}</b> (${cmp})`);
}

/**
 * The current pass's mean deviation, for the loop's best-pass accuracy. Passes in which fewer
 * than 80% of the notes were sung don't count, so a partial pass can't be the best one.
 */
function passAccuracy(): number | null {
  const total = pending.reduce((a, ev) => a + noteWeight(ev), 0);
  const sung = pending.filter((ev) => passResults.has(ev.id) && passResults.get(ev.id)!.status !== "missed");
  if (!total || sung.reduce((a, ev) => a + noteWeight(ev), 0) < 0.8 * total) return null;
  return summarize(sung, passResults).meanAbsCents;
}

/** Length of a note of the current part, by id, for weighting. */
function weightOf(id: number): number {
  const ev = track?.events.find((e) => e.id === id);
  return ev ? noteWeight(ev) : 0;
}

/** Stores a loop session (several passes of the same bars) when looping stops. */
function recordLoopSession(): void {
  if (!track || !tracker?.active) return;
  const p = precision(passMedians, weightOf);
  if (!p || p.passes < 3) return;
  // The pass in progress counts too, if it got far enough.
  const accs = [...passAccuracies, passAccuracy()].filter((a): a is number => a !== null);
  const bestPass = accs.length ? Math.min(...accs) : null;
  const bars = `${score.measures[range.from].number}–${score.measures[range.to].number}`;
  const key = loopsKey(score.fingerprint, track.key);
  const last = loadRows<LoopSession>(key)
    .filter((s) => s.bars === bars && s.date !== loopSessionDate)
    .pop();
  // Continuing after a stop updates this practice's session rather than adding another.
  const date = loopSessionDate ?? Date.now();
  loopSessionDate = date;
  upsertRow<LoopSession>(key, (r) => r.date === date, {
    date,
    bars,
    passes: p.passes,
    notes: p.notes,
    spread: p.spread,
    accuracy: p.accuracy,
    bestPass,
    speed: prefs.speed,
  });
  const spread = `notes varied ±${p.spread.toFixed(1)}¢ between ${p.passes} passes`;
  if (bestPass === null) {
    const cmp = last ? ` (last time on these bars: ±${last.spread.toFixed(1)}¢)` : "";
    showToast(`Loop of bars ${bars}: <b>${spread}</b>${cmp}`);
  } else {
    const cmp = last?.bestPass != null ? ` (last time on these bars: ${last.bestPass.toFixed(1)}¢)` : "";
    showToast(`Loop of bars ${bars}: best pass <b>${bestPass.toFixed(1)}¢</b> off on average${cmp} · ${spread}`);
  }
}

let toastTimer = 0;
function showToast(html: string): void {
  const t = $("toast");
  t.innerHTML = `${html} <button class="btn ghost small" id="toastHistory">View history</button>`;
  t.hidden = false;
  $("toastHistory").addEventListener("click", openHistory);
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(hideToast, 15000);
}

function hideToast(): void {
  $("toast").hidden = true;
}

type HistoryTab = "runs" | "loops" | "notes" | "echo" | "syllables";
let historyTab: HistoryTab = "runs";

function openHistory(): void {
  hideToast();
  // Open on what you're doing: the trainer's mode on the Audiation page, the score's history on
  // the Score page. (Only when opening; the tabs then switch freely.)
  if (!$<HTMLDialogElement>("history").open) {
    if (page === "audiation") historyTab = echo.currentMode === "syllables" ? "syllables" : "echo";
    else if (historyTab === "echo" || historyTab === "syllables") historyTab = "runs";
  }
  const dlg = $<HTMLDialogElement>("history");
  for (const b of $("historyTabs").querySelectorAll<HTMLButtonElement>("button"))
    b.classList.toggle("on", b.dataset.tab === historyTab);
  const body = $("historyBody");
  if (historyTab === "notes") {
    $("historyFor").textContent = "All notes practised in the pitch trainer, across pieces.";
    renderView<TrainerSession>(body, TRAINER_KEY, TRAINER_VIEW);
  } else if (historyTab === "echo") {
    $("historyFor").textContent = "All Echo trainer sessions (first tries of each phrase).";
    renderView<EchoSession>(body, ECHO_KEY, ECHO_VIEW);
  } else if (historyTab === "syllables") {
    $("historyFor").textContent = "All Syllables sessions: solfège read and sung, without hearing it first.";
    renderView<EchoSession>(body, SYL_KEY, SYL_VIEW);
  } else if (!loaded || !track) {
    $("historyFor").textContent = "Open a score first.";
    body.innerHTML = "";
  } else {
    $("historyFor").textContent = `${track.label} · ${score.title}`;
    if (historyTab === "runs") renderView<Run>(body, runsKey(score.fingerprint, track.key), RUN_VIEW);
    else renderView<LoopSession>(body, loopsKey(score.fingerprint, track.key), LOOP_VIEW);
  }
  $("historyNote").textContent = {
    runs: "A run is recorded when you sing the whole piece to the end with the microphone on. Each note scores up to 100: half for how close its pitch is, 30% for staying within tolerance, 20% for a clean entry. Vibrato is measured on notes held for at least 0.6 s; the shaded band is the typical healthy range.",
    loops: "A loop session is recorded when you stop after at least three passes of a looped selection. Accuracy is how far the notes were off on average in your best pass (passes with fewer than 80% of the notes sung don't count). Spread shows how differently each note came out from pass to pass (precision).",
    notes: "A session is recorded for each note you practise in the trainer for at least 2 seconds of singing. Vibrato is measured on the longest uninterrupted stretch.",
    syllables: "A session is recorded as for Echo, in the Syllables mode. Levels follow the Kodály order of tone sets (sol mi, then la, do, re, low la and sol, fa, ti), so they aren't the same as Echo's.",
    echo: "A session is recorded when you stop the Echo trainer, close it, change key or voice, or leave the page, if you sang at least one round. Only the first try of each phrase counts. Right: every note within 50 cents; in tune: every note within your tolerance.",
  }[historyTab];
  if (!dlg.open) dlg.showModal();
}

// --- pitch trainer --------------------------------------------------------

async function openTrainer(ev: NoteEvent): Promise<void> {
  stop();
  trainerEvent = ev;
  await ensureMic();
  trainer.open({ midi: ev.midi, context: trainerContext(ev) }, settings());
}

function trainerContext(ev: NoteEvent): string {
  const t = score.trackOf(ev);
  return `${t?.label ?? ""} · bar ${score.measures[ev.measureIndex]?.number ?? ""} · ${score.title}`;
}

function stepTrainer(dir: 1 | -1): void {
  if (!trainerEvent) return;
  const events = score.trackOf(trainerEvent)?.events ?? [];
  const next = events[events.indexOf(trainerEvent) + dir];
  if (!next) return;
  trainerEvent = next;
  trainer.setTarget({ midi: next.midi, context: trainerContext(next) });
}

const echo = new EchoTrainer($("echo"), {
  ctxTime: () => getPlayer().ctx.currentTime,
  play: (notes, sound) => getPlayer().playNotes(notes, sound),
  ensureMic: async () => !!(await ensureMic()),
  settings,
});

echo.onSession = (s, mode) => addRow(mode === "syllables" ? SYL_KEY : ECHO_KEY, s);
// A session still running when the page goes away is kept too.
window.addEventListener("pagehide", () => echo.endSession());

trainer.onPrev = () => stepTrainer(-1);
trainer.onNext = () => stepTrainer(1);
trainer.onSession = (s) => addRow(TRAINER_KEY, s);
trainer.onTone = (on) => {
  stopTone?.();
  stopTone = null;
  const midi = trainer.midi;
  if (on && midi !== null) stopTone = getPlayer().sustain(midi, prefs.soundMine);
};

scorePane.addEventListener("dblclick", (e) => {
  const ev = score.eventAtPoint(e.clientX, e.clientY);
  if (ev) void openTrainer(ev);
});
roll.onNoteDblClick = (ev) => void openTrainer(ev);

// --- display --------------------------------------------------------------

function refresh(): void {
  roll.draw({
    track,
    measures: score.measures,
    range: rangeBeats(),
    playhead,
    current,
    previous,
    results,
    repeats: passMedians,
    reference,
    settings: settings(),
  });
}

// --- diagnosis --------------------------------------------------------------

/** The most recent take: the pass in progress or just finished, else the one before. */
const lastTake = () => (current.length ? current : previous);

function selectionEvents(): NoteEvent[] {
  if (!track) return [];
  const { start, end } = rangeBeats();
  return track.events.filter((ev) => ev.start >= start && ev.end <= end);
}

function openDiagnosis(): void {
  if (!track) return;
  stop();
  const d = diagnose(selectionEvents(), lastTake(), results, settings(), (ev) => score.measures[ev.measureIndex].number);
  const bars = `${score.measures[range.from].number}–${score.measures[range.to].number}`;
  $("diagnosisFor").textContent = `${track.label} · ${score.title} · bars ${bars} · last take`;
  renderDiagnosis($("diagnosisBody"), d, prefs.latencyMs);
  $<HTMLDialogElement>("diagnosis").showModal();
}

/** Saves everything needed to re-run the analysis elsewhere. */
function exportTake(): void {
  if (!track) return;
  const events = selectionEvents();
  const data = {
    app: "ptchmtch",
    version: 1,
    exported: new Date().toISOString(),
    piece: { title: score.title, fingerprint: score.fingerprint },
    part: { key: track.key, label: track.label },
    bars: { from: score.measures[range.from].number, to: score.measures[range.to].number },
    settings: settings(),
    playback: { speed: prefs.speed, latencyMs: prefs.latencyMs, ignoreOctaveShifts: prefs.ignoreOctaveShifts },
    latency: { outputMs: (player?.outputLatency ?? 0) * 1000, inputMs: (tracker?.inputLatency ?? 0) * 1000 },
    events: events.map((ev) => ({
      id: ev.id,
      bar: score.measures[ev.measureIndex].number,
      midi: ev.midi,
      start: ev.start,
      end: ev.end,
      startSec: score.beatToSec(ev.start),
    })),
    results: events.filter((ev) => results.has(ev.id)).map((ev) => ({ id: ev.id, ...results.get(ev.id)! })),
    samples: lastTake().map((x) => [+x.beat.toFixed(4), +x.time.toFixed(4), x.midi === null ? null : +x.midi.toFixed(3)]),
    sampleFormat: ["beat", "time", "midi"],
  };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const slug = score.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "take";
  a.download = `ptchmtch-${slug}-bars-${data.bars.from}-${data.bars.to}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function updateSummary(): void {
  const el = $("summary");
  renderPractiseList();
  if (!track) return;
  const { start, end } = rangeBeats();
  const inRange = track.events.filter((ev) => ev.start >= start && ev.end <= end);
  const rs = inRange.map((ev) => results.get(ev.id)).filter((r): r is NoteResult => !!r);
  $<HTMLButtonElement>("diagnoseBtn").disabled = !rs.length;
  if (!rs.length) {
    el.innerHTML = "";
    el.textContent = tracker?.active
      ? "Press Play and sing your part."
      : "Turn on the microphone and press Play to see your pitch here.";
    return;
  }
  const s = summarize(inRange, results);
  const bars =
    range.from === range.to
      ? `Bar ${score.measures[range.from].number}`
      : `Bars ${score.measures[range.from].number}–${score.measures[range.to].number}`;
  const tend =
    Math.abs(s.meanCents) < 5 ? "centred" : `${Math.round(Math.abs(s.meanCents))}¢ ${s.meanCents > 0 ? "sharp" : "flat"} on average`;
  // Shares and averages weigh each note by its length.
  const pitch = `${bars}: ${Math.round(s.goodShare * 100)}% within ±${prefs.toleranceCents}¢ (${s.good}/${s.notes} notes) · ${s.sung} sung · mean deviation ${Math.round(s.meanAbsCents)}¢ · ${tend}`;

  let onsets = "Onsets: notes too short to judge";
  if (s.onsets) {
    const parts = [`${s.clean}/${s.onsets} hit cleanly (${Math.round((s.clean / s.onsets) * 100)}%)`];
    if (s.scoops) parts.push(`${s.scoops} slid up from below`);
    if (s.falls) parts.push(`${s.falls} came down from above`);
    if (s.unsettled) parts.push(`${s.unsettled} never settled`);
    if (s.scoops + s.falls) parts.push(`slides take ${Math.round(s.meanSlideMs)} ms to settle`);
    onsets = `Onsets: ${parts.join(" · ")}`;
  }
  const extra: string[] = [];
  const vib = summarizeVibrato(rs);
  if (vib.analysed) {
    const c = vib.counts;
    const kinds = [
      c.vibrato && `${c.vibrato} even`,
      c.wobble && `${c.wobble} wobble`,
      c.fast && `${c.fast} fast`,
      c.straight && `${c.straight} straight`,
      c.unsteady && `${c.unsteady} unsteady`,
    ].filter(Boolean);
    const avg =
      vib.rate !== null
        ? ` · ${vib.rate.toFixed(1)} Hz, ±${Math.round(vib.extent!)}¢, ${Math.round(vib.regularity! * 100)}% regular`
        : "";
    extra.push(`Vibrato on ${vib.analysed} held notes: ${kinds.join(", ")}${avg}`);
  }
  const inRangeIds = new Set(inRange.map((ev) => ev.id));
  const p = precision(new Map([...passMedians].filter(([id]) => inRangeIds.has(id))), weightOf);
  if (p) extra.push(`Precision: notes varied ±${p.spread.toFixed(1)}¢ between ${p.passes} passes`);
  const lines = [pitch, onsets];
  if (extra.length) lines.push(extra.join(" · "));

  el.innerHTML = "";
  for (const line of lines) {
    const d = document.createElement("div");
    d.textContent = line;
    d.title = line;
    el.append(d);
  }

  // Only worth pointing out within a selection longer than a practise range (up to four bars).
  const weak = range.to - range.from >= 4 ? weakRanges(inRange, results) : [];
  if (weak.length) {
    const d = document.createElement("div");
    d.className = "practise";
    d.append("Practise: ");
    weak.forEach((w, i) => {
      if (i) d.append(" · ");
      const a = score.measures[w.from].number;
      const b = score.measures[w.to].number;
      const btn = document.createElement("button");
      btn.className = "link";
      btn.textContent = a === b ? `bar ${a}` : `bars ${a}–${b}`;
      btn.title = `Score ${Math.round(w.score)} · click to loop ${a === b ? "this bar" : "these bars"}`;
      btn.addEventListener("click", () => {
        // Keep all current suggestions at hand while practising one of them.
        setPractiseList(weak);
        practise(w.from, w.to);
      });
      d.append(btn);
    });
    el.append(d);
  }
}

// --- recording ----------------------------------------------------------------

/** A loaded audio recording, shown on the pitch graph instead of the sung takes. */
let recording: Recording | null = null;
let alignment: Alignment | null = null;
let reference: TakeSample[] | null = null;

async function loadRecording(file: File): Promise<void> {
  if (!loaded || !track) return;
  clearRecording();
  $("recBar").hidden = false;
  $("recName").textContent = file.name;
  const status = $("recStatus");
  setRecInputs(null);
  try {
    status.textContent = "Reading…";
    const rec = await analyseRecording(file, file.name, getPlayer().ctx, (share) => {
      status.textContent = `Finding pitch… ${Math.round(share * 100)}%`;
    });
    const voiced = rec.points.filter((m) => m !== null).length / Math.max(1, rec.points.length);
    if (voiced < 0.05) {
      status.textContent = "No clear pitch found in this recording.";
      return;
    }
    status.textContent = "Lining up with the score…";
    recording = rec;
    alignment = await alignRecording(rec, track.events, score);
    showRecording();
    status.textContent = `${fmtDuration(rec.duration)} · pitch found in ${Math.round(voiced * 100)}%`;
  } catch (err) {
    console.error(err);
    status.textContent = `Could not read this file: ${(err as Error).message ?? err}`;
  }
}

function fmtDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.round(sec - m * 60)).padStart(2, "0")}`;
}

function setRecInputs(a: Alignment | null): void {
  const off = $<HTMLInputElement>("recOffset");
  const rate = $<HTMLInputElement>("recRate");
  const tr = $<HTMLInputElement>("recTranspose");
  for (const el of [off, rate, tr, $<HTMLButtonElement>("recAlign")]) el.disabled = !a;
  off.value = a ? a.offset.toFixed(2) : "";
  rate.value = a ? (a.rate * 100).toFixed(1) : "";
  tr.value = a ? String(a.transpose) : "";
}

/** (Re)maps the recording onto the score's beats with the current alignment and part. */
function showRecording(): void {
  reference = recording && alignment && track ? toBeats(recording, alignment, track.events, score) : null;
  setRecInputs(reference ? alignment : null);
  const legend = $("legend");
  legend.querySelector<HTMLElement>(".takes")!.hidden = !!reference;
  legend.querySelector<HTMLElement>(".ref")!.hidden = !reference;
  refresh();
}

function clearRecording(): void {
  recording = null;
  alignment = null;
  reference = null;
  $("recBar").hidden = true;
  showRecording();
}

function bindRecording(): void {
  const file = $<HTMLInputElement>("recFile");
  $("recLoad").addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files?.[0];
    file.value = "";
    if (f) void loadRecording(f);
  });
  $("recClear").addEventListener("click", clearRecording);
  $("recAlign").addEventListener("click", async () => {
    if (!recording || !track) return;
    $("recStatus").textContent = "Lining up with the score…";
    alignment = await alignRecording(recording, track.events, score);
    $("recStatus").textContent = "";
    showRecording();
  });
  const onEdit = () => {
    if (!alignment) return;
    const offset = parseFloat($<HTMLInputElement>("recOffset").value);
    const rate = parseFloat($<HTMLInputElement>("recRate").value) / 100;
    const transpose = Math.round(parseFloat($<HTMLInputElement>("recTranspose").value));
    alignment = {
      offset: Number.isFinite(offset) ? offset : alignment.offset,
      rate: Number.isFinite(rate) && rate > 0.2 ? rate : alignment.rate,
      transpose: Number.isFinite(transpose) ? transpose : alignment.transpose,
    };
    showRecording();
  };
  for (const id of ["recOffset", "recRate", "recTranspose"]) $(id).addEventListener("input", onEdit);
}

// --- practise list ------------------------------------------------------------

/** Bars to work on, kept in the side list while practising (stored per piece and part). */
let practiseList: WeakRange[] = [];
const practiseKey = () => (track ? `ptchmtch.practise.${score.fingerprint}.${track.key}` : null);

function loadPractiseList(): void {
  const key = practiseKey();
  practiseList = key ? loadRows<WeakRange>(key) : [];
  renderPractiseList();
}

function setPractiseList(list: WeakRange[]): void {
  practiseList = list;
  const key = practiseKey();
  if (key) {
    try {
      if (list.length) localStorage.setItem(key, JSON.stringify(list));
      else localStorage.removeItem(key);
    } catch {
      /* storage unavailable */
    }
  }
  renderPractiseList();
}

/** Length-weighted note score of the scored notes in measures from..to, or null if none was sung yet. */
function rangeScore(from: number, to: number): number | null {
  let sum = 0;
  let len = 0;
  for (const ev of track?.events ?? []) {
    if (ev.measureIndex < from || ev.measureIndex > to) continue;
    const r = results.get(ev.id);
    if (!r) continue;
    sum += noteScore(r) * noteWeight(ev);
    len += noteWeight(ev);
  }
  return len ? sum / len : null;
}

function renderPractiseList(): void {
  const aside = $("practiseList");
  const ul = $("practiseItems");
  const valid = practiseList.filter((w) => w.to < score.measures.length);
  aside.hidden = !valid.length;
  ul.innerHTML = "";
  for (const w of valid) {
    const a = score.measures[w.from].number;
    const b = score.measures[w.to].number;
    const now = rangeScore(w.from, w.to);
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.classList.toggle("active", range.from === w.from && range.to === w.to);
    const label = document.createElement("span");
    label.textContent = a === b ? `Bar ${a}` : `Bars ${a}–${b}`;
    const scores = document.createElement("span");
    scores.className = "scores";
    scores.innerHTML = `${Math.round(w.score)}` + (now !== null && Math.round(now) !== Math.round(w.score) ? ` → <b>${Math.round(now)}</b>` : "");
    btn.title = `Loop ${a === b ? "this bar" : "these bars"}`;
    btn.append(label, scores);
    btn.addEventListener("click", () => practise(w.from, w.to));
    li.append(btn);
    ul.append(li);
  }
}

/** Drag handle between the score and the pitch graph. */
function bindSplitter(): void {
  const main = document.querySelector("main")!;
  const handle = $("splitter");
  const apply = () => {
    if (prefs.rollHeight) main.style.setProperty("--roll-h", `${prefs.rollHeight}px`);
    else main.style.removeProperty("--roll-h");
  };
  apply();
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    handle.classList.add("dragging");
    const move = (ev: PointerEvent) => {
      const r = main.getBoundingClientRect();
      // Keep at least 120 px of score and 160 px of graph.
      const h = Math.round(Math.max(160, Math.min(r.height - 140, r.bottom - ev.clientY - 12)));
      prefs.rollHeight = h;
      apply();
    };
    const up = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      savePrefs();
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  // Double-click returns to the default height.
  handle.addEventListener("dblclick", () => {
    prefs.rollHeight = 0;
    apply();
    savePrefs();
  });
}

/** Selects bars to work on, with looping on. */
function practise(from: number, to: number): void {
  const loop = $<HTMLInputElement>("loop");
  if (!loop.checked) {
    loop.checked = true;
    loop.dispatchEvent(new Event("change"));
  }
  setRange(from, to);
}

// --- practice scores ------------------------------------------------------

const EX_KEY = "ptchmtch.exercise";
/** A generated exercise is loaded: changing Your part is remembered for the next one. */
let exerciseLoaded = false;

function rememberExercisePart(): void {
  if (!exerciseLoaded || !track) return;
  try {
    const saved = JSON.parse(localStorage.getItem(EX_KEY) || "{}");
    localStorage.setItem(EX_KEY, JSON.stringify({ ...saved, part: track.label }));
  } catch {
    /* not remembered */
  }
}

function bindPracticeMenu(): void {
  const btn = $("practiceBtn");
  const panel = $("practicePanel");
  const exSel = $<HTMLSelectElement>("exExercise");
  const keySel = $<HTMLSelectElement>("exKey");

  const group = (label: string, items: [string, string][]) => {
    const g = document.createElement("optgroup");
    g.label = label;
    for (const [value, text] of items) g.append(new Option(text, value));
    exSel.append(g);
  };
  const ex = (ids: string[]) => EXERCISES.filter((e) => ids.includes(e.id)).map((e) => [e.id, e.label] as [string, string]);
  group("Scales", ex(["major-scale", "natural-minor-scale", "harmonic-minor-scale", "chromatic-scale"]));
  group("Warm-ups", ex(["five-note-major", "five-note-minor", "arpeggio-major", "arpeggio-minor"]));
  group("Triplets", ex(["triplets-five-note", "triplets-stepping", "triplets-arpeggio", "triplets-octave", "triplets-octave-half"]));
  group("Pieces", [["chorale", "Practice chorale (SATB)"]]);
  KEYS.forEach((k, pc) => keySel.append(new Option(k, String(pc))));

  try {
    const saved = JSON.parse(localStorage.getItem(EX_KEY) || "{}");
    if (saved.exercise) exSel.value = saved.exercise;
    if (saved.key != null) keySel.value = String(saved.key);
  } catch {
    /* defaults */
  }
  const sync = () => {
    for (const el of panel.querySelectorAll<HTMLElement>(".ex-param")) el.hidden = exSel.value === "chorale";
    for (const el of panel.querySelectorAll<HTMLElement>(".ex-satb")) el.hidden = exSel.value === "chorale";
  };
  exSel.addEventListener("change", sync);
  sync();

  const show = (open: boolean) => {
    panel.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (open) exSel.focus();
  };
  btn.addEventListener("click", () => show(panel.hidden === true));
  document.addEventListener("pointerdown", (e) => {
    if (!panel.hidden && !btn.parentElement!.contains(e.target as Node)) show(false);
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      show(false);
      btn.focus();
    }
  });

  $("exLoad").addEventListener("click", async () => {
    show(false);
    try {
      const saved = JSON.parse(localStorage.getItem(EX_KEY) || "{}");
      localStorage.setItem(EX_KEY, JSON.stringify({ ...saved, exercise: exSel.value, key: +keySel.value }));
    } catch {
      /* not remembered */
    }
    if (exSel.value === "chorale") {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/chorale.musicxml`);
      await loadScore(await res.text(), "sample");
      return;
    }
    const g = generateExercise(exSel.value as ExerciseId, +keySel.value);
    await loadScore(g.xml, g.title);
    // Open on the part chosen last time for an exercise.
    try {
      const part = JSON.parse(localStorage.getItem(EX_KEY) || "{}").part;
      const t = score.tracks.find((t) => t.label === part);
      if (t && t !== track) selectTrack(t.key);
    } catch {
      /* first part */
    }
    exerciseLoaded = true;
  });
}

// --- controls -------------------------------------------------------------

function bindControls(): void {
  $("file").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void loadScore(f, f.name);
  });
  bindPracticeMenu();

  // Drag & drop
  scorePane.addEventListener("dragover", (e) => {
    e.preventDefault();
    scorePane.classList.add("drop");
  });
  scorePane.addEventListener("dragleave", () => scorePane.classList.remove("drop"));
  scorePane.addEventListener("drop", (e) => {
    e.preventDefault();
    scorePane.classList.remove("drop");
    const f = e.dataTransfer?.files[0];
    if (f) void loadScore(f, f.name);
  });

  $("play").addEventListener("click", () => (player?.playing ? stop() : void play(true)));
  $("rewind").addEventListener("click", backToStart);
  $("mic").addEventListener("click", () => void toggleMic());
  $<HTMLSelectElement>("voice").addEventListener("change", (e) => {
    stop();
    selectTrack((e.target as HTMLSelectElement).value);
    rememberExercisePart();
    updateSummary();
  });

  const modeBtns = [...$("mode").querySelectorAll<HTMLButtonElement>("button")];
  const showMode = () => modeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === prefs.mode));
  modeBtns.forEach((b) =>
    b.addEventListener("click", () => {
      prefs.mode = b.dataset.mode as Mode;
      showMode();
      applyGains();
      savePrefs();
    }),
  );
  showMode();

  const others = $<HTMLInputElement>("others");
  others.value = String(prefs.others);
  const showOthers = () => ($("othersOut").textContent = `${prefs.others}%`);
  others.addEventListener("input", () => {
    prefs.others = +others.value;
    showOthers();
    applyGains();
    savePrefs();
  });
  showOthers();

  const speed = $<HTMLInputElement>("speed");
  speed.value = String(prefs.speed);
  const showSpeed = () => ($("speedOut").textContent = `${prefs.speed}%`);
  speed.addEventListener("input", () => {
    prefs.speed = +speed.value;
    showSpeed();
    savePrefs();
  });
  speed.addEventListener("change", () => {
    if (player?.playing) void play();
  });
  showSpeed();

  for (const key of ["loop", "countIn", "reference", "metronome", "hideGraph"] as const) {
    const box = $<HTMLInputElement>(key);
    box.checked = prefs[key];
    box.addEventListener("change", () => {
      prefs[key] = box.checked;
      savePrefs();
    });
  }

  const from = $<HTMLInputElement>("from");
  const to = $<HTMLInputElement>("to");
  from.addEventListener("change", () => {
    const a = measureIndexByNumber(+from.value);
    setRange(a, Math.max(a, range.to));
  });
  to.addEventListener("change", () => {
    const b = measureIndexByNumber(+to.value);
    setRange(Math.min(range.from, b), b);
  });
  $("all").addEventListener("click", () => setRange(0, score.measures.length - 1));

  $("historyBtn").addEventListener("click", openHistory);
  $("diagnoseBtn").addEventListener("click", openDiagnosis);
  $("diagnosisExport").addEventListener("click", exportTake);
  $("diagnosisClose").addEventListener("click", () => $<HTMLDialogElement>("diagnosis").close());
  $("historyClose").addEventListener("click", () => $<HTMLDialogElement>("history").close());
  for (const b of $("historyTabs").querySelectorAll<HTMLButtonElement>("button"))
    b.addEventListener("click", () => {
      historyTab = b.dataset.tab as HistoryTab;
      openHistory();
    });

  $("zoomIn").addEventListener("click", () => roll.zoom(1.25));
  $("zoomOut").addEventListener("click", () => roll.zoom(0.8));

  // Settings dialog
  bindDetection();
  for (const [id, key] of [["soundMine", "soundMine"], ["soundOthers", "soundOthers"]] as const) {
    const sel = $<HTMLSelectElement>(id);
    for (const ins of INSTRUMENTS) sel.append(new Option(ins.label, ins.id));
    sel.value = prefs[key];
    sel.addEventListener("change", () => {
      prefs[key] = sel.value as Instrument;
      savePrefs();
      applySounds();
    });
  }
  const dlg = $<HTMLDialogElement>("settings");
  $("settingsBtn").addEventListener("click", () => {
    showLatency();
    void listDevices();
    dlg.showModal();
  });
  const tol = $<HTMLSelectElement>("tolerance");
  tol.value = String(prefs.toleranceCents);
  tol.addEventListener("change", () => {
    prefs.toleranceCents = +tol.value;
    savePrefs();
    rescore();
  });
  const oct = $<HTMLInputElement>("octaveFree");
  oct.checked = prefs.octaveFree;
  oct.addEventListener("change", () => {
    prefs.octaveFree = oct.checked;
    savePrefs();
    rescore();
  });
  const ottava = $<HTMLInputElement>("ignoreOctaveShifts");
  ottava.checked = prefs.ignoreOctaveShifts;
  ottava.addEventListener("change", () => {
    prefs.ignoreOctaveShifts = ottava.checked;
    savePrefs();
    stop();
    score.setIgnoreOctaveShifts(ottava.checked);
    if (!loaded) return;
    // The affected notes have new target pitches, so earlier results no longer apply.
    fillVoiceSelect();
    selectTrack(track?.key ?? null);
    updateSummary();
    if (score.hasOctaveShifts) showToast(ottava.checked ? "8va/8vb marks are now ignored: those notes play as written." : "8va/8vb marks apply again.");
  });
  const onset = $<HTMLSelectElement>("onsetMs");
  onset.value = String(prefs.onsetMs);
  onset.addEventListener("change", () => {
    prefs.onsetMs = +onset.value;
    savePrefs();
    rescore();
  });
  const lat = $<HTMLInputElement>("latency");
  lat.value = String(prefs.latencyMs);
  lat.addEventListener("input", () => {
    prefs.latencyMs = +lat.value;
    showLatency();
    savePrefs();
  });
  $("calibrateBtn").addEventListener("click", () => {
    stop();
    dlg.close();
    calibration.open();
  });
  $<HTMLSelectElement>("device").addEventListener("change", async (e) => {
    prefs.deviceId = (e.target as HTMLSelectElement).value;
    savePrefs();
    if (tracker?.active) await tracker.start(prefs.deviceId || undefined);
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea, dialog")) return;
    if (e.key === "m" || e.key === "M") {
      void toggleMic();
      return;
    }
    if (page !== "score") return; // the other pages have their own keys
    if (e.code === "Space") {
      e.preventDefault();
      if (player?.playing) stop();
      else void play(true);
    } else if (e.key === "Home") {
      e.preventDefault();
      backToStart();
    } else if (e.key === "l" || e.key === "L") {
      const box = $<HTMLInputElement>("loop");
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
    } else if (e.key === "g" || e.key === "G") {
      const box = $<HTMLInputElement>("hideGraph");
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
      if (player?.playing) document.body.classList.toggle("graph-hidden", box.checked);
    }
  });

  // Re-layout when the score pane changes width (window resize, practise list shown or hidden).
  let resizeTimer = 0;
  let paneWidth = scorePane.clientWidth;
  new ResizeObserver(() => {
    // Hidden (another page is shown): keep the layout for when it comes back.
    if (!scorePane.clientWidth || scorePane.clientWidth === paneWidth) return;
    paneWidth = scorePane.clientWidth;
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(rerenderScore, 250);
  }).observe(scorePane);

  const only = $<HTMLInputElement>("onlyMyPart");
  only.checked = prefs.onlyMyPart;
  only.addEventListener("change", () => {
    prefs.onlyMyPart = only.checked;
    savePrefs();
    score.showOnly(prefs.onlyMyPart ? track : null);
    rerenderScore();
  });

  const fit = $("fitPitch");
  const showFit = () => {
    fit.setAttribute("aria-pressed", String(prefs.fitPitch));
    fit.classList.toggle("on", prefs.fitPitch);
    roll.fitPitch = prefs.fitPitch;
  };
  showFit();
  fit.addEventListener("click", () => {
    prefs.fitPitch = !prefs.fitPitch;
    savePrefs();
    showFit();
    roll.resetPitchZoom();
    refresh();
  });

  bindSplitter();
  bindRecording();

  $("practiseClose").addEventListener("click", () => setPractiseList([]));
  $("practiseAll").addEventListener("click", () => setRange(0, score.measures.length - 1));
}

const reportedLatencyMs = () => ((player?.outputLatency ?? 0) + (tracker?.inputLatency ?? 0)) * 1000;

const calibration = new Calibration($<HTMLDialogElement>("calibration"), {
  player: getPlayer,
  mic: ensureMic,
  // Middle of the selected part, so the notes sit in the singer's range.
  midi: () => (track ? Math.round((track.minMidi + track.maxMidi) / 2) : 60),
  reportedMs: reportedLatencyMs,
  apply: (ms) => {
    prefs.latencyMs = ms;
    $<HTMLInputElement>("latency").value = String(ms);
    savePrefs();
    showLatency();
  },
});

function showLatency(): void {
  const auto = Math.round(reportedLatencyMs());
  $("latencyOut").textContent = `${prefs.latencyMs >= 0 ? "+" : ""}${prefs.latencyMs} ms`;
  $("latencyInfo").textContent =
    `Added to the ${auto} ms the browser reports. Use Calibrate to measure it, or increase it if your line consistently looks late compared to the notes.`;
}

/** Re-scores the latest take after tolerance or octave settings change. */
function rescore(): void {
  if (!track) return;
  if (current.length) {
    const { start, end } = rangeBeats();
    const last = current[current.length - 1].beat;
    for (const ev of track.events) {
      if (ev.start >= start && ev.end <= end && ev.end <= last) results.set(ev.id, evaluate(ev, current, settings(), singerRate));
    }
  }
  paintTrack();
  updateSummary();
  refresh();
}

async function listDevices(): Promise<void> {
  const sel = $<HTMLSelectElement>("device");
  const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  sel.innerHTML = `<option value="">Default input</option>`;
  for (const d of devices) {
    if (!d.deviceId || d.deviceId === "default") continue;
    const o = document.createElement("option");
    o.value = d.deviceId;
    o.textContent = d.label || "Microphone";
    sel.append(o);
  }
  sel.value = prefs.deviceId;
}

// --- pages ----------------------------------------------------------------

type Page = "score" | "audiation";
const PAGE_KEY = "ptchmtch.page";
let page: Page = "score";

function showPage(p: Page): void {
  if (p === "audiation") stop();
  page = p;
  $("pageScore").hidden = p !== "score";
  if (p === "audiation") echo.open();
  else echo.close();
  for (const b of $("nav").querySelectorAll<HTMLButtonElement>("[data-page]")) {
    b.classList.toggle("on", b.dataset.page === p);
    b.setAttribute("aria-current", b.dataset.page === p ? "page" : "false");
  }
  try {
    localStorage.setItem(PAGE_KEY, p);
  } catch {
    /* not remembered */
  }
}

for (const b of $("nav").querySelectorAll<HTMLButtonElement>("[data-page]"))
  b.addEventListener("click", () => showPage(b.dataset.page as Page));
try {
  showPage(localStorage.getItem(PAGE_KEY) === "audiation" ? "audiation" : "score");
} catch {
  showPage("score");
}

bindControls();
refresh();
updateSummary();

if (import.meta.env.DEV) Object.assign(window, { __app: { score, roll, calibration, echo, get player() { return player; } } });
