/** One complete run-through of a piece, as stored in the browser. */
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
}

const MAX_RUNS = 500;

const key = (song: string, track: string) => `ptchmtch.history.${song}.${track}`;

export function loadRuns(song: string, track: string): Run[] {
  try {
    const runs = JSON.parse(localStorage.getItem(key(song, track)) || "[]");
    return Array.isArray(runs) ? runs : [];
  } catch {
    return [];
  }
}

/** Appends a run and returns the updated list (unchanged if storage is unavailable). */
export function addRun(song: string, track: string, run: Run): Run[] {
  const runs = [...loadRuns(song, track), run].slice(-MAX_RUNS);
  try {
    localStorage.setItem(key(song, track), JSON.stringify(runs));
  } catch {
    /* storage unavailable or full */
  }
  return runs;
}

export function clearRuns(song: string, track: string): void {
  try {
    localStorage.removeItem(key(song, track));
  } catch {
    /* storage unavailable */
  }
}

const fmtDate = (t: number) =>
  new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const signed = (c: number) => `${c > 0 ? "+" : ""}${Math.round(c)}`;

/** Renders a score chart (oldest → newest) and a table (newest first) into `el`. */
export function renderHistory(el: HTMLElement, runs: Run[]): void {
  el.innerHTML = "";
  if (!runs.length) {
    const p = document.createElement("p");
    p.className = "note";
    p.textContent = "No complete runs yet. Select all bars, turn on the microphone and sing the piece to the end.";
    el.append(p);
    return;
  }

  const W = 600;
  const H = 180;
  const L = 34;
  const R = 12;
  const T = 10;
  const B = 22;
  const n = runs.length;
  const x = (i: number) => (n === 1 ? L + (W - L - R) / 2 : L + (i * (W - L - R)) / (n - 1));
  const y = (s: number) => T + ((100 - s) * (H - T - B)) / 100;
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
  for (const g of [0, 25, 50, 75, 100]) {
    add("line", { x1: L, x2: W - R, y1: y(g), y2: y(g), class: "grid" });
    add("text", { x: L - 6, y: y(g) + 4, "text-anchor": "end", class: "axis" }, String(g));
  }
  add("text", { x: L, y: H - 4, class: "axis" }, "oldest");
  add("text", { x: W - R, y: H - 4, "text-anchor": "end", class: "axis" }, "latest");
  if (n > 1) add("polyline", { points: runs.map((r, i) => `${x(i)},${y(r.score)}`).join(" "), class: "line" });
  const best = Math.max(...runs.map((r) => r.score));
  runs.forEach((r, i) => {
    const c = add("circle", { cx: x(i), cy: y(r.score), r: r.score === best ? 5 : 3.5, class: r.score === best ? "dot best" : "dot" });
    const tip = document.createElementNS(ns, "title");
    tip.textContent = `${fmtDate(r.date)}: ${Math.round(r.score)} (tempo ${r.speed}%)`;
    c.append(tip);
  });
  el.append(svg);

  const table = document.createElement("table");
  table.className = "history-table";
  table.innerHTML = `<thead><tr><th>When</th><th>Score</th><th>In tune</th><th>Mean dev.</th><th>Tendency</th><th>Clean onsets</th><th>Tempo</th></tr></thead>`;
  const body = document.createElement("tbody");
  for (const r of [...runs].reverse()) {
    const tr = document.createElement("tr");
    const cells = [
      fmtDate(r.date),
      String(Math.round(r.score)),
      `${r.good}/${r.notes} <small>±${r.toleranceCents}¢</small>`,
      `${Math.round(r.meanAbsCents)}¢`,
      `${signed(r.meanCents)}¢`,
      r.cleanRate === null ? "–" : `${Math.round(r.cleanRate * 100)}%`,
      `${r.speed}%`,
    ];
    tr.innerHTML = cells.map((c, i) => `<td${i === 1 ? ' class="score"' : ""}>${c}</td>`).join("");
    body.append(tr);
  }
  table.append(body);
  el.append(table);
}
