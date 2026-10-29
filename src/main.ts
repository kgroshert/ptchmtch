import { evaluate, statusColor, summarize, type NoteResult, type Settings, type TakeSample } from "./analysis";
import { midiName, PitchTracker, type PitchSample } from "./pitch";
import { Player } from "./player";
import { PitchRoll } from "./roll";
import { Score, type NoteEvent, type Track } from "./score";

type Mode = "lead" | "normal" | "mute";

interface Prefs {
  mode: Mode;
  others: number;
  speed: number;
  loop: boolean;
  countIn: boolean;
  reference: boolean;
  metronome: boolean;
  toleranceCents: number;
  octaveFree: boolean;
  onsetMs: number;
  latencyMs: number;
  deviceId: string;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const DEFAULTS: Prefs = {
  mode: "normal",
  others: 60,
  speed: 100,
  loop: true,
  countIn: true,
  reference: true,
  metronome: false,
  toleranceCents: 25,
  octaveFree: false,
  onsetMs: 100,
  latencyMs: 0,
  deviceId: "",
};

function loadPrefs(): Prefs {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("ptchmtch.prefs") || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

const prefs = loadPrefs();
function savePrefs(): void {
  try {
    localStorage.setItem("ptchmtch.prefs", JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
}

// --- core objects ---------------------------------------------------------

const scorePane = $("scorePane");
const score = new Score($("score"));
const roll = new PitchRoll($<HTMLCanvasElement>("roll"), $("tip"));
let player: Player | null = null;
let tracker: PitchTracker | null = null;

let loaded = false;
let track: Track | null = null;
let range = { from: 0, to: 0 }; // measure indices, inclusive
let results = new Map<number, NoteResult>();
let current: TakeSample[] = [];
let previous: TakeSample[] = [];
let samplePass = -1;
let pending: NoteEvent[] = [];
let pendingIdx = 0;
let playhead: number | null = null;

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

  const sel = $<HTMLSelectElement>("voice");
  sel.innerHTML = "";
  for (const t of score.tracks) {
    const o = document.createElement("option");
    o.value = t.key;
    o.textContent = `${t.label} (${midiName(t.minMidi)}–${midiName(t.maxMidi)})`;
    sel.append(o);
  }
  range = { from: 0, to: score.measures.length - 1 };
  selectTrack(score.tracks[0]?.key ?? null);
  roll.viewStart = -0.5;
  scorePane.scrollTop = 0;
  syncRangeInputs();
  drawOverlay();
}

function selectTrack(key: string | null): void {
  if (track) for (const ev of track.events) score.colorEvent(ev, null);
  track = score.tracks.find((t) => t.key === key) ?? null;
  $<HTMLSelectElement>("voice").value = key ?? "";
  results = new Map();
  current = [];
  previous = [];
  paintTrack();
  applyGains();
  refresh();
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
  syncRangeInputs();
  drawOverlay();
  const wasPlaying = player?.playing;
  if (!wasPlaying) {
    score.setCursorBeat(rangeBeats().start);
    roll.reveal(rangeBeats().start);
  }
  refresh();
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

scorePane.addEventListener("click", (e) => {
  if (!loaded) return;
  const r = scorePane.getBoundingClientRect();
  const x = e.clientX - r.left + scorePane.scrollLeft;
  const y = e.clientY - r.top + scorePane.scrollTop;
  const boxes = score.measureBoxes();
  const i = boxes.findIndex((b) => x >= b.x && x <= b.x + b.w && y >= b.y - 12 && y <= b.y + b.h + 12);
  if (i < 0) return;
  if (e.shiftKey) setRange(Math.min(range.from, i), Math.max(range.to, i));
  else setRange(i, i);
});

roll.onRangeSelect = (a, b) => setRange(a, b);

// --- gains ----------------------------------------------------------------

function trackGain(key: string): number {
  if (track && key === track.key) return { lead: 1.4, normal: 0.75, mute: 0 }[prefs.mode];
  return (prefs.others / 100) * 0.8;
}

function applyGains(): void {
  if (!player) return;
  for (const t of score.tracks) player.setTrackGain(t.key, trackGain(t.key));
}

// --- transport ------------------------------------------------------------

async function play(): Promise<void> {
  if (!loaded || !track) return;
  const p = getPlayer();
  const { start, end } = rangeBeats();
  if (current.length) previous = current;
  current = [];
  samplePass = -1;
  pending = track.events.filter((ev) => ev.start >= start - 1e-6 && ev.end <= end + 1e-6);
  pendingIdx = 0;
  const first = track.events.find((ev) => ev.end > start);
  roll.follow = true;
  roll.reveal(start);
  await p.play({
    tracks: score.tracks.map((t) => ({ key: t.key, events: t.events, gain: trackGain(t.key) })),
    startBeat: start,
    endBeat: end,
    loop: prefs.loop,
    speed: prefs.speed / 100,
    countIn: prefs.countIn,
    referenceMidi: prefs.reference && first ? first.midi : null,
    metronome: prefs.metronome,
  });
  setPlayingUI(true);
  requestAnimationFrame(frame);
}

function stop(): void {
  if (!player?.playing) return;
  player.stop();
  finishPass(Infinity);
  playhead = null;
  setPlayingUI(false);
  $("countdown").hidden = true;
  refresh();
}

function setPlayingUI(on: boolean): void {
  const b = $("play");
  b.textContent = on ? "Stop" : "Play";
}

function frame(): void {
  const p = player;
  if (!p?.playing) return;
  const pos = p.positionAt(p.ctx.currentTime - p.outputLatency);
  const cd = $("countdown");
  if (pos.kind === "ended") {
    stop();
    return;
  }
  if (pos.kind === "countIn") {
    cd.hidden = false;
    cd.textContent = String(pos.beatsLeft);
    playhead = rangeBeats().start;
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

  const p = player;
  if (!p?.playing) return;
  const time = s.time - latency();
  const pos = p.positionAt(time);
  if (pos.kind !== "playing") return;
  if (pos.pass !== samplePass) {
    if (samplePass >= 0) {
      finishPass(Infinity);
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
    const r = evaluate(ev, current, settings());
    results.set(ev.id, r);
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
  try {
    await tracker.start(prefs.deviceId || undefined);
    btn.classList.add("on");
    void listDevices();
  } catch (err) {
    alert(`Microphone unavailable: ${(err as Error).message ?? err}`);
  }
}

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
    settings: settings(),
  });
}

function updateSummary(): void {
  const el = $("summary");
  if (!track) return;
  const { start, end } = rangeBeats();
  const inRange = track.events.filter((ev) => ev.start >= start && ev.end <= end);
  const rs = inRange.map((ev) => results.get(ev.id)).filter((r): r is NoteResult => !!r);
  if (!rs.length) {
    el.innerHTML = "";
    el.textContent = tracker?.active
      ? "Press Play and sing your part."
      : "Turn on the microphone and press Play to see your pitch here.";
    return;
  }
  const s = summarize(rs);
  const bars =
    range.from === range.to
      ? `Bar ${score.measures[range.from].number}`
      : `Bars ${score.measures[range.from].number}–${score.measures[range.to].number}`;
  const tend =
    Math.abs(s.meanCents) < 5 ? "centred" : `${Math.round(Math.abs(s.meanCents))}¢ ${s.meanCents > 0 ? "sharp" : "flat"} on average`;
  const pitch = `${bars}: ${s.good}/${s.notes} notes within ±${prefs.toleranceCents}¢ · ${s.sung} sung · mean deviation ${Math.round(s.meanAbsCents)}¢ · ${tend}`;

  let onsets = "Onsets: notes too short to judge";
  if (s.onsets) {
    const parts = [`${s.clean}/${s.onsets} hit cleanly (${Math.round((s.clean / s.onsets) * 100)}%)`];
    if (s.scoops) parts.push(`${s.scoops} slid up from below`);
    if (s.falls) parts.push(`${s.falls} came down from above`);
    if (s.unsettled) parts.push(`${s.unsettled} never settled`);
    if (s.scoops + s.falls) parts.push(`slides take ${Math.round(s.meanSlideMs)} ms to settle`);
    onsets = `Onsets: ${parts.join(" · ")}`;
  }
  el.innerHTML = "";
  for (const line of [pitch, onsets]) {
    const d = document.createElement("div");
    d.textContent = line;
    d.title = line;
    el.append(d);
  }
}

// --- controls -------------------------------------------------------------

function bindControls(): void {
  $("file").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) void loadScore(f, f.name);
  });
  $("sample").addEventListener("click", async () => {
    const res = await fetch(`${import.meta.env.BASE_URL}samples/chorale.musicxml`);
    await loadScore(await res.text(), "sample");
  });

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

  $("play").addEventListener("click", () => (player?.playing ? stop() : void play()));
  $("mic").addEventListener("click", () => void toggleMic());
  $<HTMLSelectElement>("voice").addEventListener("change", (e) => {
    stop();
    selectTrack((e.target as HTMLSelectElement).value);
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

  for (const key of ["loop", "countIn", "reference", "metronome"] as const) {
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

  $("zoomIn").addEventListener("click", () => roll.zoom(1.25));
  $("zoomOut").addEventListener("click", () => roll.zoom(0.8));

  // Settings dialog
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
  $<HTMLSelectElement>("device").addEventListener("change", async (e) => {
    prefs.deviceId = (e.target as HTMLSelectElement).value;
    savePrefs();
    if (tracker?.active) await tracker.start(prefs.deviceId || undefined);
  });

  document.addEventListener("keydown", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest("input, select, textarea, dialog")) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (player?.playing) stop();
      else void play();
    } else if (e.key === "l" || e.key === "L") {
      const box = $<HTMLInputElement>("loop");
      box.checked = !box.checked;
      box.dispatchEvent(new Event("change"));
    } else if (e.key === "m" || e.key === "M") {
      void toggleMic();
    }
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!loaded) return;
      score.render();
      paintTrack();
      drawOverlay();
      score.setCursorBeat(playhead ?? rangeBeats().start);
    }, 250);
  });
}

function showLatency(): void {
  const auto = Math.round(((player?.outputLatency ?? 0) + (tracker?.inputLatency ?? 0)) * 1000);
  $("latencyOut").textContent = `${prefs.latencyMs >= 0 ? "+" : ""}${prefs.latencyMs} ms`;
  $("latencyInfo").textContent =
    `Added to the ${auto} ms the browser reports. Increase it if your line consistently looks late compared to the notes.`;
}

/** Re-scores the latest take after tolerance or octave settings change. */
function rescore(): void {
  if (!track) return;
  if (current.length) {
    const { start, end } = rangeBeats();
    const last = current[current.length - 1].beat;
    for (const ev of track.events) {
      if (ev.start >= start && ev.end <= end && ev.end <= last) results.set(ev.id, evaluate(ev, current, settings()));
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

bindControls();
refresh();
updateSummary();

if (import.meta.env.DEV) Object.assign(window, { __app: { score, roll, get player() { return player; } } });
