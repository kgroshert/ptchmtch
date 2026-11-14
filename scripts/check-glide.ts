/** Offline check of the glide analysis on synthetic glides (low note → up → back down, free pace). */
import { analyseGlide, DRIFT_CENTS, type GlideResult } from "../src/glide";
import type { SupportFrame } from "../src/support-analysis";
import { between, done, expect, rng } from "./check-util";

const LOW = 60; // C4
const GATE = 20 * Math.log10(0.008);

interface Opts {
  up?: number; down?: number; interval?: number; seed?: number;
  driftAt?: number; driftCents?: number; stallAt?: number; jumpAt?: number; sagAt?: number;
  overshoot?: number; endCents?: number; vib?: boolean; roundTurn?: boolean; scoop?: boolean;
  volPerCent?: number; slip?: number; upOnly?: boolean; flat?: boolean; hold?: number;
  vibAmp?: number; vibHz?: number; settle?: number; land?: number; slipDur?: number;
  holdWander?: number; holdCreep?: number; holdOffset?: number; crackAt?: number; octErrors?: boolean; onsetOct?: boolean; breathy?: boolean; falloff?: boolean; scoopCents?: number; scoopDur?: number;
}

function glide(o: Opts = {}): SupportFrame[] {
  const rand = rng(o.seed ?? 7);
  const up = o.up ?? 10, down = o.down ?? 10, hold = o.hold ?? 0;
  const top = (o.interval ?? 4) * 100 + (o.overshoot ?? 0);
  const endC = o.endCents ?? 0;
  // Singers settle on the first note for a moment and land on the last one before stopping.
  const sing = 0.5, start = sing + (o.settle ?? 0.4), turn = start + up, downAt = turn + hold;
  const end = o.upOnly ? turn : downAt + down + (o.land ?? 0.6);
  const line = (t: number): number => {
    if (o.flat) return 0;
    if (t <= start) return 0;
    if (t <= turn) return (top * (t - start)) / up;
    if (t >= downAt + down) return endC;
    if (t <= downAt) return top + (o.holdOffset ?? 0) + (o.holdCreep ?? 0) * ((t - turn) / Math.max(hold, 1e-6)) + (o.holdWander ?? 0) * Math.sin(2 * Math.PI * 0.5 * (t - turn));
    const from = top + (o.holdOffset ?? 0) + (o.holdCreep ?? 0) * (hold ? 1 : 0);
    return from + ((endC - from) * (t - downAt)) / down;
  };
  const out: SupportFrame[] = [];
  for (let t = 0; t < end + 1.2; t += 0.015) {
    let db = -70 + (rand() - 0.5) * 2;
    let cents: number | null = null;
    if (t >= sing && t <= end) {
      let c = line(t);
      if (o.roundTurn && !hold && Math.abs(t - turn) < 0.4) {
        const r = top / up, dt = t - turn;
        c = top - r * 0.2 - (r * dt * dt) / 0.8; // meets both lines, tangent, at ±0.4 s
      }
      if (o.scoop && t - sing < 0.3) c -= 50 * (1 - (t - sing) / 0.3);
      if (o.scoopCents && t - sing < (o.scoopDur ?? 0.3)) c += o.scoopCents * (1 - (t - sing) / (o.scoopDur ?? 0.3));
      if (o.falloff && end - t < 0.4) c -= 200 * (1 - (end - t) / 0.4);
      if (o.driftAt && Math.abs(t - o.driftAt) < 0.5) c += (o.driftCents ?? 0) * 0.5 * (1 + Math.cos((Math.PI * (t - o.driftAt)) / 0.5));
      if (o.stallAt) {
        if (t >= o.stallAt && t < o.stallAt + 0.8) c = line(o.stallAt);
        else if (t >= o.stallAt + 0.8 && t < o.stallAt + 1.1) c = line(o.stallAt) + ((line(o.stallAt + 1.1) - line(o.stallAt)) * (t - o.stallAt - 0.8)) / 0.3;
      }
      // A lurch: drops 70¢ at once, then holds until the even line catches up.
      if (o.jumpAt && t >= o.jumpAt && line(t) > line(o.jumpAt) - 70) c = Math.min(c, line(o.jumpAt) - 70);
      c += (rand() - 0.5) * 6;
      if (o.vib) c += (o.vibAmp ?? 40) * Math.sin(2 * Math.PI * (o.vibHz ?? 5.5) * t);
      if (o.slip && t >= o.slip && t < o.slip + (o.slipDur ?? 0.2)) c += 1200;
      if (o.onsetOct && t - sing < 0.15) c += 1200;
      if (o.crackAt && t >= o.crackAt && t < o.crackAt + 0.3) c += 300;
      // A phone mic on low notes: the tracker jumps an octave up in bursts of 0.1–0.4 s on the way down.
      if (o.octErrors && t > turn + hold && Math.sin(t * 7.3) + Math.sin(t * 2.9) > 0.6) c += 1200;
      db = -34 + (rand() - 0.5) * 1.5 + (o.volPerCent ?? 0) * line(t);
      if (o.sagAt && t >= o.sagAt && t < o.sagAt + 0.6) db -= 6;
      cents = db < GATE || (o.breathy && t - sing < 0.3) ? null : c;
    }
    out.push({ t, db, cents });
  }
  return out;
}

const run = (o: Opts = {}): GlideResult | null => analyseGlide(glide(o), -70, o.interval ?? 4, LOW);
const show = (r: GlideResult | null) =>
  r ? `up ±${r.up?.rms.toFixed(1)} worst ${r.up?.worst?.dev.toFixed(0)} st ${r.up?.stalls.length} j ${r.up?.jumps.length} | down ±${r.down?.rms.toFixed(1)} worst ${r.down?.worst?.dev.toFixed(0)} st ${r.down?.stalls.length} j ${r.down?.jumps.length} | bumps ${r.bumps.length} lost ${r.lost?.reason ?? "-"} top ${r.topCents.toFixed(0)} end ${r.endCents?.toFixed(0)}` : "null";

function clean(name: string, o: Opts, holds = false) {
  const r = run(o);
  const ok = !!r && !!r.up && !!r.down;
  expect(`${name}: both legs`, ok, show(r));
  if (!ok) return r;
  expect(`${name}: up even`, r.up!.rms < 15, show(r));
  expect(`${name}: down even`, r.down!.rms < 15, show(r));
  expect(`${name}: no big drift`, Math.abs(r.up!.worst?.dev ?? 0) <= DRIFT_CENTS && Math.abs(r.down!.worst?.dev ?? 0) <= DRIFT_CENTS, show(r));
  expect(`${name}: no stalls/jumps`, !r.up!.stalls.length && !r.down!.stalls.length && !r.up!.jumps.length && !r.down!.jumps.length, show(r));
  expect(`${name}: no volume bumps`, r.bumps.length === 0, JSON.stringify(r.bumps));
  expect(`${name}: not lost`, r.lost === null, JSON.stringify(r.lost));
  if (!holds) expect(`${name}: no pause at the top`, r.hold === null, JSON.stringify(r.hold));
  return r;
}

clean("clean third", {});
clean("clean fifth", { interval: 7 });
clean("slow", { up: 15, down: 15 });
clean("fast", { up: 5, down: 5 });
clean("vibrato", { vib: true });
clean("vibrato fifth slow", { vib: true, interval: 7, up: 14, down: 12, seed: 9 });
clean("rounded vibrato fast", { vib: true, roundTurn: true, up: 6, down: 6, seed: 11 });
clean("rounded turn", { roundTurn: true });
{
  const r = clean("onset scoop", { scoop: true });
  expect("onset scoop: start within 25¢", between(r?.startCents, -25, 25), `${r?.startCents}`);
}
clean("volume follows pitch", { volPerCent: 0.005 });
for (let s = 1; s <= 3; s++) clean(`clean seed ${s}`, { seed: 100 + s });

{
  const r = run({ driftAt: 5.5, driftCents: -45 });
  const w = r?.up?.worst;
  expect("mid drift: flagged", !!w && w.dev < -DRIFT_CENTS, show(r));
  expect("mid drift: in the middle", w?.middle === true, JSON.stringify(w));
  expect("mid drift: near D4", w?.near === 62, JSON.stringify(w));
}
{
  const r = run({ stallAt: 4 });
  expect("stall: one on the way up", r?.up?.stalls.length === 1 && between(r.up.stalls[0].t, 3.8, 5), show(r) + JSON.stringify(r?.up?.stalls));
}
{
  const r = run({ jumpAt: 13 });
  expect("jump: one on the way down", r?.down?.jumps.length === 1, show(r) + JSON.stringify(r?.down?.jumps));
  expect("jump: not a crack", r?.lost === null, JSON.stringify(r?.lost));
}
{
  const r = run({ sagAt: 6 });
  expect("sag: found 5.8–6.8 s", !!r && r.bumps.length === 1 && r.bumps[0].kind === "sag" && between(r.bumps[0].t, 5.8, 6.8), JSON.stringify(r?.bumps));
}
{
  const r = run({ overshoot: 40 });
  expect("overshoot 40: top +30…+50", between(r?.topCents, 30, 50), `${r?.topCents}`);
}
{
  const r = run({ endCents: -40 });
  expect("lands flat: end −50…−30", between(r?.endCents, -50, -30), `${r?.endCents}`);
}
{
  const r = run({ hold: 1.5 });
  expect("hold at top: found", !!r?.hold && between(r.hold.to - r.hold.from, 1.2, 2.0), JSON.stringify(r?.hold));
  expect("hold at top: no stalls", !!r?.up && !!r.down && !r.up.stalls.length && !r.down.stalls.length, show(r));
}
{
  const r = run({ upOnly: true });
  expect("up only: no down leg", !!r && !!r.up && r.down === null && r.endCents === null, show(r));
}
{
  let r: GlideResult | null = null;
  let threw = false;
  try {
    r = run({ flat: true });
  } catch (e) {
    threw = true;
    console.log(e);
  }
  expect("no glide: no throw", !threw);
  expect("no glide: no legs", r === null || r.up === null, show(r));
}
{
  // An exact octave slip is a tracker error, not the voice: folded back, so neither crack nor jump.
  const r = run({ slip: 6 });
  expect("octave slip: not a crack", r?.lost === null, JSON.stringify(r?.lost));
  const near = [...(r?.up?.jumps ?? []), ...(r?.down?.jumps ?? [])].filter((j) => Math.abs(j.t - 6) < 0.3);
  expect("octave slip: no jump", near.length === 0, JSON.stringify(near));
}
{
  const r = run({ crackAt: 6 });
  expect("voice crack (+300¢): a crack", r?.lost?.reason === "crack" && between(r.lost.t, 5.9, 6.1), JSON.stringify(r?.lost));
}
// Review findings: real-voice conditions.
clean("vibrato ±60 5 Hz", { vib: true, vibAmp: 60, vibHz: 5 });
clean("vibrato ±70 5.5 Hz", { vib: true, vibAmp: 70, vibHz: 5.5, seed: 21 });
clean("vibrato ±90 6.5 Hz", { vib: true, vibAmp: 90, vibHz: 6.5, seed: 22 });
clean("vibrato ±90 5 Hz fifth", { vib: true, vibAmp: 90, vibHz: 5, interval: 7, seed: 23 });
for (const ms of [30, 60, 110]) {
  const r = run({ slip: 6, slipDur: ms / 1000 });
  const j = [...(r?.up?.jumps ?? []), ...(r?.down?.jumps ?? [])];
  expect(`short slip ${ms} ms: no jump`, j.length === 0, JSON.stringify(j));
}
{
  const r = run({ hold: 2, vib: true, vibAmp: 35 });
  expect("held top with vibrato: hold found", !!r?.hold, JSON.stringify(r?.hold));
  expect("held top with vibrato: no flagged drift", !!r?.up && !!r.down && Math.abs(r.up.worst?.dev ?? 0) <= DRIFT_CENTS && Math.abs(r.down.worst?.dev ?? 0) <= DRIFT_CENTS, show(r));
}
clean("held first and last with vibrato", { settle: 2.5, land: 2.5, vib: true, vibAmp: 35, seed: 31 });
{
  const r = run({ stallAt: 4, vib: true, vibAmp: 30 });
  expect("stall with vibrato: found", r?.up?.stalls.length === 1, show(r) + JSON.stringify(r?.up?.stalls));
}
clean("onset octave error", { onsetOct: true, seed: 41 });
clean("breathy onset", { breathy: true, seed: 42 });
{
  const r = clean("release fall-off", { falloff: true, seed: 43 });
  expect("release fall-off: landing within 15¢", between(r?.endCents, -15, 15), `${r?.endCents}`);
}
clean("scoop −150¢", { scoopCents: -150, scoopDur: 0.3, seed: 44 });
clean("scoop −200¢ over 0.4 s", { scoopCents: -200, scoopDur: 0.4, seed: 45 });
clean("scoop −300¢ over 0.5 s", { scoopCents: -300, scoopDur: 0.5, seed: 46 });
clean("octave errors on the way down", { octErrors: true, seed: 61 });
clean("octave errors, fifth", { octErrors: true, interval: 7, seed: 62 });

// A plateau at the top is fine: hold the top note a while, then come down.
{
  const r = clean("fast up, held top 4 s", { up: 2.5, hold: 4, down: 4, vib: true, vibAmp: 30, holdCreep: 15, seed: 71 }, true);
  expect("fast up, held top 4 s: hold found", !!r?.hold && between(r.hold.to - r.hold.from, 3.4, 4.6), JSON.stringify(r?.hold));
}
{
  const r = clean("slow up, wandering hold 2 s", { up: 10, hold: 2, down: 10, holdWander: 15, seed: 72 }, true);
  expect("slow up, wandering hold 2 s: hold found", !!r?.hold && between(r.hold.to - r.hold.from, 1.5, 2.5), JSON.stringify(r?.hold));
}
{
  const r = run({ hold: 0.6, seed: 73 });
  const ok = !!r?.up && !!r.down && Math.abs(r.up.worst?.dev ?? 0) <= DRIFT_CENTS && Math.abs(r.down.worst?.dev ?? 0) <= DRIFT_CENTS && r.up.rms < 15 && r.down.rms < 15;
  expect("short pause 0.6 s: legs even", ok, show(r));
  expect("short pause 0.6 s: not reported", r?.hold === null, JSON.stringify(r?.hold));
}
{
  const r = run({ hold: 3, holdOffset: -20, seed: 74 });
  expect("held top a little flat: top −30…−10", between(r?.topCents, -30, -10), `${r?.topCents}`);
}

// The no-pitch rule follows the microphone threshold: a quiet phone mic calibrated to −65 dB.
{
  const quiet = glide({ seed: 51 }).map((f) => ({ ...f, db: f.db - 21, cents: f.t > 6 && f.t < 6.4 ? null : f.cents }));
  const r = analyseGlide(quiet, -91, 4, LOW, -65);
  expect("quiet mic, calibrated: dropout is lost pitch", r?.lost?.reason === "no pitch", JSON.stringify(r?.lost));
  const r2 = analyseGlide(quiet.map((f) => ({ ...f, cents: f.t > 6 && f.t < 6.4 ? f.cents : f.cents })), -91, 4, LOW, -65);
  expect("quiet mic, calibrated: glide judged", !!r2?.up && !!r2.down, show(r2));
}
done("glide");
