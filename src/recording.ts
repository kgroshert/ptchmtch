import { PitchDetector } from "pitchy";
import type { NoteEvent, Score } from "./score";

/** A pitch track extracted from an audio file, in the file's own time. */
export interface Recording {
  name: string;
  duration: number;
  /** Every HOP seconds: fractional MIDI pitch, or null when no clear pitch was found. */
  points: (number | null)[];
}

/** How the recording lines up with the score: score time = (file time − offset) × rate. */
export interface Alignment {
  /** File time (s) at which the score's beat 0 falls. */
  offset: number;
  /** Recording tempo relative to the notated tempo (1.1 = 10% faster). */
  rate: number;
  /** Semitones to add to the recording so it matches the score's key. */
  transpose: number;
}

export const HOP = 0.01;
const WINDOW = 2048;
const MIN_HZ = 60;
const MAX_HZ = 1400;
/** Stricter than for the microphone: recordings often have accompaniment underneath. */
const CLARITY = 0.9;

const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

/** Decodes an audio file and tracks its (dominant) pitch every 10 ms. */
export async function analyseRecording(
  file: Blob,
  name: string,
  ctx: BaseAudioContext,
  onProgress: (share: number) => void,
): Promise<Recording> {
  const audio = await ctx.decodeAudioData(await file.arrayBuffer());
  const sr = audio.sampleRate;
  // Mix down to mono.
  const mono = new Float32Array(audio.length);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const ch = audio.getChannelData(c);
    for (let i = 0; i < ch.length; i++) mono[i] += ch[i] / audio.numberOfChannels;
  }
  // Silence gate relative to the file's loudness, so quiet and loud files work alike.
  const frames = Math.floor((mono.length - WINDOW) / (HOP * sr));
  const rms = new Float32Array(Math.max(0, frames));
  for (let f = 0; f < frames; f++) {
    const s = Math.round(f * HOP * sr);
    let sum = 0;
    for (let i = s; i < s + WINDOW; i += 4) sum += mono[i] * mono[i];
    rms[f] = Math.sqrt(sum / (WINDOW / 4));
  }
  const loud = [...rms].sort((a, b) => a - b)[Math.floor(frames * 0.95)] ?? 0;
  const gate = loud * 0.08;

  const detector = PitchDetector.forFloat32Array(WINDOW);
  const raw: (number | null)[] = [];
  for (let f = 0; f < frames; f++) {
    if (f % 300 === 0) {
      onProgress(f / frames);
      await yieldToUi();
    }
    if (rms[f] < gate) {
      raw.push(null);
      continue;
    }
    const s = Math.round(f * HOP * sr);
    const [hz, clarity] = detector.findPitch(mono.subarray(s, s + WINDOW), sr);
    raw.push(clarity >= CLARITY && hz >= MIN_HZ && hz <= MAX_HZ ? 69 + 12 * Math.log2(hz / 440) : null);
  }
  // 3-point median against isolated glitches, as for the microphone.
  const points = raw.map((m, i) => {
    if (m === null) return null;
    const near = [raw[i - 1], m, raw[i + 1]].filter((x): x is number => x != null);
    return near.length < 3 ? m : near.sort((a, b) => a - b)[1];
  });
  onProgress(1);
  // Each window describes the sound around its centre.
  const lead = WINDOW / sr / 2;
  return { name, duration: audio.duration, points: [...Array(Math.round(lead / HOP)).fill(null), ...points] };
}

/** Time of point `i` in the file. */
export const pointTime = (i: number) => i * HOP;

/** Sorted lookup of the part's note at a beat. */
function noteAt(events: NoteEvent[]): (beat: number) => NoteEvent | null {
  const sorted = [...events].sort((a, b) => a.start - b.start);
  const starts = sorted.map((e) => e.start);
  return (beat) => {
    let lo = 0;
    let hi = starts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (starts[mid] <= beat) lo = mid + 1;
      else hi = mid;
    }
    for (let i = lo - 1; i >= 0 && i >= lo - 3; i--) if (sorted[i].end > beat) return sorted[i];
    return null;
  };
}

/** Distance between two pitches in semitones, ignoring octaves (0–6). */
const pcDist = (a: number, b: number) => {
  const d = (((a - b) % 12) + 12) % 12;
  return Math.min(d, 12 - d);
};

/**
 * Finds the offset, tempo and key at which the recording's pitch line best matches the part's
 * melody. Assumes a steady tempo relative to the score (tempo changes written in the score are
 * followed); with a lot of rubato, fine-tune the offset for the passage being practised.
 */
export async function alignRecording(rec: Recording, events: NoteEvent[], score: Score): Promise<Alignment> {
  // Key: compare pitch-class profiles, weighting score notes by length.
  const recPc = new Array(12).fill(0);
  for (const m of rec.points) if (m !== null) recPc[((Math.round(m) % 12) + 12) % 12]++;
  const scorePc = new Array(12).fill(0);
  for (const ev of events) scorePc[((ev.midi % 12) + 12) % 12] += ev.end - ev.start;
  let transpose = 0;
  let bestCorr = -Infinity;
  for (let k = -5; k <= 6; k++) {
    let c = 0;
    for (let p = 0; p < 12; p++) c += recPc[p] * scorePc[(((p + k) % 12) + 12) % 12];
    if (c > bestCorr) {
      bestCorr = c;
      transpose = k;
    }
  }

  const at = noteAt(events);
  const scoreEnd = Math.max(...events.map((e) => e.end), 0);
  const scoreDur = score.beatToSec(scoreEnd);
  // The part's note for every 10 ms of score time (NaN in rests), so each check is one lookup.
  const RES = 0.01;
  const table = new Float64Array(Math.ceil(scoreDur / RES) + 1);
  for (let k = 0; k < table.length; k++) table[k] = at(score.secToBeat(k * RES))?.midi ?? NaN;
  const fit = (step: number, offset: number, rate: number) => {
    let value = 0;
    for (let i = 0; i < rec.points.length; i += step) {
      const m = rec.points[i];
      if (m === null) continue;
      const k = Math.round(((pointTime(i) - offset) * rate) / RES);
      if (k < 0 || k >= table.length) continue;
      const target = table[k];
      if (target !== target) continue; // rest
      value += pcDist(m + transpose, target) < 0.8 ? 1 : -0.3;
    }
    return value;
  };

  // Coarse search over the whole file, then refine around the best match.
  let best = { offset: 0, rate: 1, value: -Infinity };
  const coarseStep = 10; // every 100 ms
  for (let rate = 0.6; rate <= 1.6001; rate += 0.02) {
    for (let offset = -scoreDur / rate; offset <= rec.duration; offset += 0.25) {
      const v = fit(coarseStep, offset, rate);
      if (v > best.value) best = { offset, rate, value: v };
    }
    await yieldToUi();
  }
  // Offset and tempo trade off against each other; when refining the tempo, keep the score
  // position at the middle of the recording fixed, so the offset follows instead of drifting.
  const voicedIdx = rec.points.flatMap((m, i) => (m === null ? [] : [i]));
  const mid = pointTime(voicedIdx[Math.floor(voicedIdx.length / 2)] ?? 0);
  for (let round = 0; round < 3; round++) {
    const c = best;
    const span = 0.02 / (round + 1);
    for (let rate = c.rate - span; rate <= c.rate + span + 1e-9; rate += span / 10) {
      const centre = mid - ((mid - c.offset) * c.rate) / rate;
      for (let offset = centre - 0.3; offset <= centre + 0.3; offset += 0.02) {
        const v = fit(2, offset, rate);
        if (v > best.value) best = { offset, rate, value: v };
      }
    }
  }
  return { offset: best.offset, rate: best.rate, transpose };
}

/**
 * The recording as display samples on the score's beat axis, each folded into the octave of the
 * part's note at that point so a different voice type still overlays the melody.
 */
export function toBeats(
  rec: Recording,
  a: Alignment,
  events: NoteEvent[],
  score: Score,
): { beat: number; time: number; midi: number | null }[] {
  const at = noteAt(events);
  const out: { beat: number; time: number; midi: number | null }[] = [];
  for (let i = 0; i < rec.points.length; i++) {
    const sec = (pointTime(i) - a.offset) * a.rate;
    if (sec < 0) continue;
    const beat = score.secToBeat(sec);
    if (beat > score.totalBeats) break;
    const m = rec.points[i];
    if (m === null) {
      out.push({ beat, time: pointTime(i), midi: null });
      continue;
    }
    let midi = m + a.transpose;
    const ev = at(beat);
    if (ev) midi += 12 * Math.round((ev.midi - midi) / 12);
    out.push({ beat, time: pointTime(i), midi });
  }
  return out;
}
