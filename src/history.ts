import { midiName } from "./pitch";
import { HEALTHY_RATE, vibratoLabel, type Vibrato } from "./vibrato";

/** One complete run-through of a piece. */
export interface Run {
  date: number;
  /** 0–100, see runScore(). */
  score: number;
  notes: number;
  sung: number;
  good: number;
  meanAbsCents: number;
  meanCents: number;
  /** Share of judged onsets that were clean, or null if none could be judged. */
  cleanRate: number | null;
  /** Playback speed in percent of the notated tempo. */
  speed: number;
  toleranceCents: number;
  // Vibrato over the notes long enough to analyse (absent in runs recorded before it existed).
  vibratoNotes?: number;
  vibratoRate?: number | null;
  vibratoExtent?: number | null;
  vibratoRegularity?: number | null;
  /** Share of analysed notes with a wobble. */
  wobbleShare?: number | null;
}

/** A looped section sung several times in a row. */
export interface LoopSession {
  date: number;
  /** e.g. "3–4" */
  bars: string;
  passes: number;
  notes: number;
  /** Mean spread (standard deviation) of each note's pitch between passes, cents. */
  spread: number;
  /** Mean absolute deviation of each note's average pitch, cents. */
  accuracy: number;
  /** Mean absolute deviation in the best pass, cents (missing in sessions recorded before it existed). */
  bestPass?: number | null;
  speed: number;
}

/** A stretch of practice on one note in the pitch trainer. */
export interface TrainerSession {
  date: number;
  midi: number;
  /** Where the note came from, e.g. "Soprano · bar 3 · Practice Chorale in C". */
  context: string;
  voicedSec: number;
  /** Share of voiced time within tolerance. */
  inTune: number;
  longestHold: number;
  meanAbsCents: number;
  /** Vibrato of the longest uninterrupted stretch. */
  vibrato: Vibrato | null;
}

const MAX_ROWS = 1000;

export const runsKey = (song: string, track: string) => `ptchmtch.history.${song}.${track}`;
export const loopsKey = (song: string, track: string) => `ptchmtch.loops.${song}.${track}`;
export const TRAINER_KEY = "ptchmtch.trainer";

export function loadRows<T>(key: string): T[] {
  try {
    const rows = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

/** Appends a row and returns the updated list (unchanged if storage is unavailable). */
export function addRow<T>(key: string, row: T): T[] {
  const rows = [...loadRows<T>(key), row].slice(-MAX_ROWS);
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    /* storage unavailable or full */
  }
  return rows;
}

export function clearRows(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

// --- views ------------------------------------------------------------------

export interface Metric<T> {
  label: string;
  unit: string;
  value: (r: T) => number | null | undefined;
  better?: "higher" | "lower";
  /** Fixed axis range; otherwise fitted to the data. */
  range?: [number, number];
  /** Shaded target zone, e.g. the healthy vibrato rate. */
  band?: [number, number];
  digits?: number;
}

export interface Column<T> {
  label: string;
  cell: (r: T) => string;
  strong?: boolean;
}

export interface View<T> {
  metrics: Metric<T>[];
  columns: Column<T>[];
  empty: string;
}

const fmtDate = (t: number) => new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const signed = (c: number) => `${c > 0 ? "+" : ""}${Math.round(c)}`;
const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${Math.round(v * 100)}%`);
const num = (v: number | null | undefined, d = 0, unit = "") => (v === null || v === undefined ? "–" : `${v.toFixed(d)}${unit}`);

export const RUN_VIEW: View<Run> = {
  empty: "No complete runs yet. Select all bars, turn on the microphone and sing the piece to the end.",
  metrics: [
    { label: "Score", unit: "", value: (r) => r.score, better: "higher", range: [0, 100] },
    { label: "Notes in tune", unit: "%", value: (r) => (r.notes ? (r.good / r.notes) * 100 : null), better: "higher", range: [0, 100] },
    { label: "Mean deviation", unit: "¢", value: (r) => r.meanAbsCents, better: "lower" },
    { label: "Clean onsets", unit: "%", value: (r) => (r.cleanRate == null ? null : r.cleanRate * 100), better: "higher", range: [0, 100] },
    { label: "Vibrato rate", unit: " Hz", value: (r) => r.vibratoRate, band: HEALTHY_RATE, digits: 1 },
    { label: "Vibrato width", unit: "¢", value: (r) => r.vibratoExtent, band: [50, 100] },
    { label: "Vibrato regularity", unit: "%", value: (r) => (r.vibratoRegularity == null ? null : r.vibratoRegularity * 100), better: "higher", range: [0, 100] },
    { label: "Notes with wobble", unit: "%", value: (r) => (r.wobbleShare == null ? null : r.wobbleShare * 100), better: "lower", range: [0, 100] },
  ],
  columns: [
    { label: "When", cell: (r) => fmtDate(r.date) },
    { label: "Score", cell: (r) => String(Math.round(r.score)), strong: true },
    { label: "In tune", cell: (r) => `${r.good}/${r.notes} <small>±${r.toleranceCents}¢</small>` },
    { label: "Mean dev.", cell: (r) => `${Math.round(r.meanAbsCents)}¢` },
    { label: "Tendency", cell: (r) => `${signed(r.meanCents)}¢` },
    { label: "Clean onsets", cell: (r) => pct(r.cleanRate) },
    { label: "Vibrato", cell: (r) => (r.vibratoRate == null ? "–" : `${r.vibratoRate.toFixed(1)} Hz ±${Math.round(r.vibratoExtent ?? 0)}¢`) },
    { label: "Wobble", cell: (r) => pct(r.wobbleShare) },
    { label: "Tempo", cell: (r) => `${r.speed}%` },
  ],
};

export const LOOP_VIEW: View<LoopSession> = {
  empty: "No loop sessions yet. Turn on Loop, select a few bars and sing at least three passes.",
  metrics: [
    { label: "Accuracy (best pass)", unit: "¢", value: (r) => r.bestPass, better: "lower", digits: 1 },
    { label: "Spread between passes", unit: "¢", value: (r) => r.spread, better: "lower", digits: 1 },
  ],
  columns: [
    { label: "When", cell: (r) => fmtDate(r.date) },
    { label: "Bars", cell: (r) => r.bars },
    { label: "Passes", cell: (r) => String(r.passes) },
    { label: "Accuracy (best pass)", cell: (r) => num(r.bestPass, 1, "¢"), strong: true },
    { label: "Spread", cell: (r) => `±${r.spread.toFixed(1)}¢` },
    { label: "Notes", cell: (r) => String(r.notes) },
    { label: "Tempo", cell: (r) => `${r.speed}%` },
  ],
};

export const TRAINER_VIEW: View<TrainerSession> = {
  empty: "No trainer sessions yet. Double-click a note and hold it for a few seconds.",
  metrics: [
    { label: "In tune", unit: "%", value: (r) => r.inTune * 100, better: "higher", range: [0, 100] },
    { label: "Longest hold", unit: " s", value: (r) => r.longestHold, better: "higher", digits: 1 },
    { label: "Mean deviation", unit: "¢", value: (r) => r.meanAbsCents, better: "lower" },
    { label: "Vibrato rate", unit: " Hz", value: (r) => (osc(r.vibrato) ? r.vibrato!.rate : null), band: HEALTHY_RATE, digits: 1 },
    { label: "Vibrato width", unit: "¢", value: (r) => (osc(r.vibrato) ? r.vibrato!.extent : null), band: [50, 100] },
    { label: "Vibrato regularity", unit: "%", value: (r) => (osc(r.vibrato) ? r.vibrato!.regularity * 100 : null), better: "higher", range: [0, 100] },
  ],
  columns: [
    { label: "When", cell: (r) => fmtDate(r.date) },
    { label: "Note", cell: (r) => `<b>${midiName(r.midi)}</b> <small>${r.context}</small>` },
    { label: "In tune", cell: (r) => pct(r.inTune), strong: true },
    { label: "Longest hold", cell: (r) => num(r.longestHold, 1, " s") },
    { label: "Mean dev.", cell: (r) => `${Math.round(r.meanAbsCents)}¢` },
    {
      label: "Vibrato",
      cell: (r) =>
        !r.vibrato
          ? "–"
          : osc(r.vibrato)
            ? `${vibratoLabel(r.vibrato)} <small>${r.vibrato.rate.toFixed(1)} Hz ±${Math.round(r.vibrato.extent)}¢</small>`
            : vibratoLabel(r.vibrato),
    },
  ],
};

function osc(v: Vibrato | null): boolean {
  return !!v && (v.kind === "vibrato" || v.kind === "wobble" || v.kind === "fast");
}

/** Renders a metric picker, a chart of that metric over time and a table (newest first). */
export function renderView<T extends { date: number }>(el: HTMLElement, rows: T[], view: View<T>, metricIndex = 0): void {
  el.innerHTML = "";
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = view.empty;
    el.append(p);
    return;
  }

  const bar = document.createElement("div");
  bar.className = "history-bar";
  const sel = document.createElement("select");
  view.metrics.forEach((m, i) => sel.append(new Option(m.label, String(i), i === metricIndex, i === metricIndex)));
  sel.addEventListener("change", () => renderView(el, rows, view, +sel.value));
  bar.append("Chart: ", sel);
  el.append(bar);
  el.append(chart(rows, view.metrics[metricIndex]));

  const table = document.createElement("table");
  table.className = "history-table";
  table.innerHTML = `<thead><tr>${view.columns.map((c) => `<th>${c.label}</th>`).join("")}</tr></thead>`;
  const body = document.createElement("tbody");
  for (const r of [...rows].reverse()) {
    const tr = document.createElement("tr");
    tr.innerHTML = view.columns.map((c) => `<td${c.strong ? ' class="score"' : ""}>${c.cell(r)}</td>`).join("");
    body.append(tr);
  }
  table.append(body);
  el.append(table);
}

function chart<T extends { date: number }>(rows: T[], m: Metric<T>): SVGSVGElement | HTMLElement {
  const pts = rows.map((r, i) => ({ i, r, v: m.value(r) })).filter((p): p is { i: number; r: T; v: number } => p.v != null);
  if (!pts.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = `No data for “${m.label}” yet.`;
    return p;
  }
  const W = 600;
  const H = 180;
  const L = 40;
  const R = 12;
  const T = 10;
  const B = 22;
  let [lo, hi] = m.range ?? [Math.min(...pts.map((p) => p.v)), Math.max(...pts.map((p) => p.v))];
  if (!m.range) {
    if (m.band) {
      lo = Math.min(lo, m.band[0]);
      hi = Math.max(hi, m.band[1]);
    }
    const pad = (hi - lo || Math.abs(hi) || 1) * 0.15;
    lo = Math.max(0, lo - pad);
    hi += pad;
  }
  const n = rows.length;
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (v: number) => T + ((hi - v) * (H - T - B)) / (hi - lo);
  const d = m.digits ?? 0;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.classList.add("history-chart");
  const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  if (m.band) {
    const top = y(Math.min(hi, m.band[1]));
    add("rect", { x: L, y: top, width: W - L - R, height: Math.max(0, y(Math.max(lo, m.band[0])) - top), class: "band" });
  }
  for (let k = 0; k <= 4; k++) {
    const v = lo + ((hi - lo) * k) / 4;
    add("line", { x1: L, x2: W - R, y1: y(v), y2: y(v), class: "grid" });
    add("text", { x: L - 6, y: y(v) + 4, "text-anchor": "end", class: "axis" }, v.toFixed(hi - lo < 10 ? 1 : 0));
  }
  add("text", { x: L, y: H - 4, class: "axis" }, "oldest");
  add("text", { x: W - R, y: H - 4, "text-anchor": "end", class: "axis" }, "latest");
  if (pts.length > 1) add("polyline", { points: pts.map((p) => `${x(p.i)},${y(p.v)}`).join(" "), class: "line" });
  const vals = pts.map((p) => p.v);
  const best = m.better === "higher" ? Math.max(...vals) : m.better === "lower" ? Math.min(...vals) : null;
  for (const p of pts) {
    const isBest = best !== null && p.v === best;
    const c = add("circle", { cx: x(p.i), cy: y(p.v), r: isBest ? 5 : 3.5, class: isBest ? "dot best" : "dot" });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `${fmtDate(p.r.date)}: ${p.v.toFixed(d)}${m.unit}`;
    c.append(tip);
  }
  return svg;
}
