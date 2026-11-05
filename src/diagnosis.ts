import { centsOff, noteWeight, type NoteResult, type Settings, type TakeSample } from "./analysis";
import { midiName } from "./pitch";
import type { NoteEvent } from "./score";

/** Timing shifts tried when fitting the sung line to the score, in ms. */
const LAG_RANGE = 400;
const LAG_STEP = 10;
/** Deviations are capped at this when fitting, so wrong notes and octave slips don't dominate. */
const CAP_CENTS = 200;
/** A note this far off (by its median) is more likely a different octave than a wrong pitch. */
const OCTAVE_MIN = 900;

export interface NoteDiagnosis {
  ev: NoteEvent;
  bar: number;
  result: NoteResult;
  /** Median sung pitch (fractional MIDI). */
  sung: number;
}

export interface Diagnosis {
  samples: number;
  voiced: number;
  /** Mean capped deviation of the sung line at each timing shift; positive lag = judged against later music. */
  fit: { lagMs: number; cost: number }[];
  bestLagMs: number;
  /** Fit cost at the current timing and at the best shift. */
  costNow: number;
  costBest: number;
  /** Notes whose median is roughly an octave (or more) off. */
  octave: NoteDiagnosis[];
  /** Sung notes, worst first. */
  worst: NoteDiagnosis[];
  /** Length-weighted median of |deviation| over sung notes, and the weighted mean without octave notes. */
  medianAbsCents: number;
  meanAbsCentsNoOctave: number | null;
  meanAbsCents: number;
}

/** Looks for systematic problems in a take: timing offset, octave slips and the notes that pull the score down. */
export function diagnose(
  events: NoteEvent[],
  samples: TakeSample[],
  results: Map<number, NoteResult>,
  s: Settings,
  barOf: (ev: NoteEvent) => number,
): Diagnosis {
  const voiced = samples.filter((x) => x.midi !== null);

  // Beat at an arbitrary time within the take, interpolated from the samples' own time→beat mapping.
  const beatAt = (t: number): number | null => {
    if (!samples.length || t < samples[0].time || t > samples[samples.length - 1].time) return null;
    let lo = 0;
    let hi = samples.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].time <= t) lo = mid;
      else hi = mid;
    }
    const a = samples[lo];
    const b = samples[hi];
    // A loop restart jumps back in beats; don't interpolate across it.
    if (b.beat < a.beat || b.time === a.time) return a.beat;
    return a.beat + ((t - a.time) / (b.time - a.time)) * (b.beat - a.beat);
  };
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const targetAt = (beat: number, sung: number): number | null => {
    let best: number | null = null;
    for (const ev of sorted) {
      if (ev.start > beat) break;
      if (ev.end <= beat) continue;
      // In chords, compare against the nearest note.
      if (best === null || Math.abs(ev.midi - sung) < Math.abs(best - sung)) best = ev.midi;
    }
    return best;
  };

  const fit: Diagnosis["fit"] = [];
  for (let lag = -LAG_RANGE; lag <= LAG_RANGE; lag += LAG_STEP) {
    let sum = 0;
    let n = 0;
    for (const x of voiced) {
      const beat = beatAt(x.time + lag / 1000);
      if (beat === null) continue;
      const target = targetAt(beat, x.midi!);
      if (target === null) continue;
      sum += Math.min(CAP_CENTS, Math.abs(centsOff(x.midi!, target, s.octaveFree)));
      n++;
    }
    if (n) fit.push({ lagMs: lag, cost: sum / n });
  }
  const best = fit.reduce((a, b) => (b.cost < a.cost ? b : a), fit[0] ?? { lagMs: 0, cost: 0 });
  const now = fit.find((f) => f.lagMs === 0) ?? best;

  const sungNotes: NoteDiagnosis[] = [];
  for (const ev of events) {
    const r = results.get(ev.id);
    if (!r || r.status === "missed") continue;
    sungNotes.push({ ev, bar: barOf(ev), result: r, sung: ev.midi + r.cents / 100 });
  }
  const octave = sungNotes.filter((n) => Math.abs(n.result.cents) >= OCTAVE_MIN);
  const worst = [...sungNotes].sort((a, b) => Math.abs(b.result.cents) - Math.abs(a.result.cents));

  const weightedMean = (ns: NoteDiagnosis[]) => {
    const total = ns.reduce((a, n) => a + noteWeight(n.ev), 0);
    return total ? ns.reduce((a, n) => a + Math.abs(n.result.cents) * noteWeight(n.ev), 0) / total : null;
  };
  const byAbs = [...sungNotes].sort((a, b) => Math.abs(a.result.cents) - Math.abs(b.result.cents));
  const total = byAbs.reduce((a, n) => a + noteWeight(n.ev), 0);
  let acc = 0;
  let medianAbsCents = 0;
  for (const n of byAbs) {
    acc += noteWeight(n.ev);
    if (acc >= total / 2) {
      medianAbsCents = Math.abs(n.result.cents);
      break;
    }
  }

  return {
    samples: samples.length,
    voiced: voiced.length,
    fit,
    bestLagMs: best.lagMs,
    costNow: now.cost,
    costBest: best.cost,
    octave,
    worst,
    medianAbsCents,
    meanAbsCents: weightedMean(sungNotes) ?? 0,
    meanAbsCentsNoOctave: octave.length ? weightedMean(sungNotes.filter((n) => !octave.includes(n))) : null,
  };
}

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
const signed = (c: number) => `${c > 0 ? "+" : ""}${Math.round(c)}¢`;

/** `latencyMs` is the current latency correction, to suggest a new one. */
export function renderDiagnosis(el: HTMLElement, d: Diagnosis, latencyMs: number): void {
  const parts: string[] = [];

  // Timing
  const gain = d.costNow - d.costBest;
  const timingOk = Math.abs(d.bestLagMs) < 40 || gain < 5;
  parts.push(`<h3>Timing</h3>`);
  parts.push(fitChart(d));
  parts.push(`<p class="muted">Typical deviation if your pitch line were shifted in time. Blue: as judged now; green: best fit.</p>`);
  if (timingOk) {
    parts.push(
      `<p>Your pitch line already lines up with the score: shifting it in time doesn't improve the fit noticeably` +
        (d.bestLagMs ? ` (best at ${d.bestLagMs > 0 ? "+" : ""}${d.bestLagMs} ms, ${Math.round(gain)}¢ better)` : "") +
        `. Timing is not what lowers the result.</p>`,
    );
  } else {
    const suggested = Math.round(latencyMs - d.bestLagMs);
    parts.push(
      `<p>Your pitch line fits the score best when shifted <b>${Math.abs(d.bestLagMs)} ms ${d.bestLagMs < 0 ? "earlier" : "later"}</b>: ` +
        `the typical deviation drops from ${Math.round(d.costNow)}¢ to ${Math.round(d.costBest)}¢. ` +
        `Either you sang consistently ${d.bestLagMs < 0 ? "behind" : "ahead of"} the music, or the latency setting is off. ` +
        `Recalibrating (Settings → Calibrate) or setting the latency correction to about <b>${suggested} ms</b> (now ${latencyMs} ms) would line it up.</p>`,
    );
  }

  // Octaves
  parts.push(`<h3>Octave</h3>`);
  if (!d.octave.length) {
    parts.push(`<p>No note was sung (or detected) an octave away from the target.</p>`);
  } else {
    parts.push(
      `<p><b>${d.octave.length}</b> note${d.octave.length > 1 ? "s were" : " was"} about an octave or more away from the target: ` +
        d.octave.map((n) => `bar ${n.bar} ${midiName(n.ev.midi)} (${signed(n.result.cents)})`).join(", ") +
        `. Either they were sung in another octave, or the pitch detection picked the wrong octave. ` +
        `Without them the mean deviation would be <b>${Math.round(d.meanAbsCentsNoOctave ?? 0)}¢</b> instead of ${Math.round(d.meanAbsCents)}¢.` +
        ` If you sing this part in your own octave on purpose, turn on Settings → Ignore octave.</p>`,
    );
  }

  // Typical vs mean
  parts.push(`<h3>Typical deviation</h3>`);
  parts.push(
    `<p>Half of the music (by note length) was within <b>±${Math.round(d.medianAbsCents)}¢</b>; the mean deviation is ${Math.round(d.meanAbsCents)}¢. ` +
      (d.meanAbsCents > d.medianAbsCents * 1.5
        ? "The mean is much higher than the typical value, so a few far-off notes pull it up."
        : "The two are close, so the deviation is spread fairly evenly over the notes.") +
      `</p>`,
  );

  // Worst notes
  parts.push(`<h3>Furthest off</h3>`);
  if (!d.worst.length) parts.push(`<p>No sung notes.</p>`);
  else {
    const rows = d.worst
      .slice(0, 12)
      .map(
        (n) =>
          `<tr><td>${n.bar}</td><td>${esc(midiName(n.ev.midi))}</td><td>${esc(midiName(n.sung))} ${signed((n.sung - Math.round(n.sung)) * 100)}</td>` +
          `<td class="score">${signed(n.result.cents)}</td><td>${Math.round(n.result.inTune * 100)}%</td><td>${n.result.onset?.kind ?? "–"}</td><td>${fmtLen(noteWeight(n.ev))}</td></tr>`,
      )
      .join("");
    parts.push(
      `<table class="history-table"><thead><tr><th>Bar</th><th>Target</th><th>Sung</th><th>Deviation</th><th>In tune</th><th>Onset</th><th>Length</th></tr></thead><tbody>${rows}</tbody></table>`,
    );
  }
  parts.push(`<p class="muted">${d.voiced} of ${d.samples} pitch samples voiced.</p>`);
  el.innerHTML = parts.join("");
}

function fmtLen(beats: number): string {
  const names: [number, string][] = [
    [4, "whole"],
    [3, "dotted half"],
    [2, "half"],
    [1.5, "dotted quarter"],
    [1, "quarter"],
    [0.75, "dotted eighth"],
    [0.5, "eighth"],
    [0.25, "16th"],
  ];
  const hit = names.find(([b]) => Math.abs(b - beats) < 1e-6);
  return hit ? hit[1] : `${+beats.toFixed(2)} beats`;
}

/** Fit cost against timing shift, with the current timing and the best shift marked. */
function fitChart(d: Diagnosis): string {
  if (d.fit.length < 2) return "";
  const W = 600;
  const H = 120;
  const L = 40;
  const B = 22;
  const maxC = Math.max(...d.fit.map((f) => f.cost));
  const minC = Math.min(...d.fit.map((f) => f.cost));
  const x = (lag: number) => L + ((lag + LAG_RANGE) / (2 * LAG_RANGE)) * (W - L - 8);
  const y = (c: number) => 8 + (1 - (c - minC) / (maxC - minC || 1)) * (H - B - 8);
  const path = d.fit.map((f, i) => `${i ? "L" : "M"}${x(f.lagMs).toFixed(1)},${y(f.cost).toFixed(1)}`).join("");
  const ticks = [-400, -200, 0, 200, 400]
    .map((t) => `<line class="grid" x1="${x(t)}" x2="${x(t)}" y1="8" y2="${H - B}"/><text class="axis" x="${x(t)}" y="${H - 6}" text-anchor="middle">${t > 0 ? "+" : ""}${t} ms</text>`)
    .join("");
  return (
    `<svg class="history-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Fit of the pitch line against timing shift">` +
    ticks +
    `<text class="axis" x="4" y="${y(maxC) + 4}">${Math.round(maxC)}¢</text><text class="axis" x="4" y="${y(minC) + 4}">${Math.round(minC)}¢</text>` +
    `<path class="line" d="${path}"/>` +
    `<circle class="dot" cx="${x(0)}" cy="${y(d.costNow)}" r="4"/><circle class="dot best" cx="${x(d.bestLagMs)}" cy="${y(d.costBest)}" r="4"/>` +
    `</svg>`
  );
}
