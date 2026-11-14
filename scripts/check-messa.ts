/** Offline check of the messa di voce analysis on synthetic swells: the baseline the refactor must keep. */
import { analyseMessa, type MessaFrame } from "../src/messa";
import { between, done, expect, rng } from "./check-util";

const GATE = 20 * Math.log10(0.008);
type Opts = { peakAt?: number; dipAt?: number; drift?: number; breakAt?: number; crackAt?: number; lostAt?: number; vib?: boolean };

function make(opts: Opts = {}, seed = 1): MessaFrame[] {
  const rand = rng(seed);
  const out: MessaFrame[] = [];
  const T = 10, start = 0.5, end = start + T, pk = start + T * (opts.peakAt ?? 0.5);
  for (let t = 0; t < end + 1.2; t += 0.015) {
    let db = -70 + (rand() - 0.5) * 2;
    let cents: number | null = null;
    if (t >= start && t <= end) {
      const q = t < pk ? (t - start) / (pk - start) : (end - t) / (end - pk);
      db = -50 + 32 * q + (rand() - 0.5) * 1.5;
      if (opts.dipAt && Math.abs(t - opts.dipAt) < 0.3) db -= 6;
      if (opts.breakAt && t > opts.breakAt && t < opts.breakAt + 0.3) db = -70;
      cents = (opts.drift ?? 0) * q + (rand() - 0.5) * 6 + (opts.vib ? 40 * Math.sin(2 * Math.PI * 5.5 * t) : 0);
      if (opts.crackAt && t > opts.crackAt && t < opts.crackAt + 0.3) cents += 250;
      if (opts.lostAt && t > opts.lostAt && t < opts.lostAt + 0.5) cents = null;
      if (db < GATE) cents = null;
    }
    out.push({ t, db, cents });
  }
  return out;
}

const run = (f: MessaFrame[]) => analyseMessa(f, -70, 10)!;

{
  const r = run(make());
  expect("ideal: range 25–35", between(r.range, 25, 35), `${r.range.toFixed(1)}`);
  expect("ideal: peak 45–55%", between(r.peakPos, 0.45, 0.55), `${r.peakPos.toFixed(2)}`);
  expect("ideal: no bumps", r.bumps.length === 0, JSON.stringify(r.bumps));
  expect("ideal: not lost", r.lost === null, JSON.stringify(r.lost));
}
{
  const r = run(make({ peakAt: 0.3 }));
  expect("early peak: before 35%", r.peakPos < 0.35, `${r.peakPos.toFixed(2)}`);
}
{
  const r = run(make({ dipAt: 3 }));
  expect("dip 3s: dip found 2.4–3.2 s", r.bumps.some((b) => b.kind === "dip" && between(b.t, 2.4, 3.2)), JSON.stringify(r.bumps));
}
{
  const r = run(make({ drift: 35 }));
  expect("sharp loud: drift 10–35¢", between(r.drift, 10, 35), `${r.drift}`);
}
{
  const r = run(make({ breakAt: 9 }));
  expect("break 9s", r.lost?.reason === "break" && between(r.lost.t, 8.9, 9.1), JSON.stringify(r.lost));
}
{
  const r = run(make({ crackAt: 8 }));
  expect("crack 8s", r.lost?.reason === "crack" && between(r.lost.t, 7.9, 8.1), JSON.stringify(r.lost));
}
{
  const r = run(make({ lostAt: 4.5 }));
  expect("no pitch 4.5s", r.lost?.reason === "no pitch" && between(r.lost.t, 4.4, 4.6), JSON.stringify(r.lost));
}
{
  const r = run(make({ vib: true }));
  expect("vibrato detected", r.vibrato?.kind === "vibrato", JSON.stringify(r.vibrato));
}
// A fade that ends right at the edge of the noise floor, with level jitter: no false break.
for (let s = 0; s < 5; s++) {
  const rand = rng(100 + s);
  const fade = make({}, 50 + s).map((f) => (f.t >= 0.5 && f.t <= 10.5 ? { ...f, db: f.db + (f.t > 9.5 ? -(f.t - 9.5) * 12 : 0) + (rand() - 0.5) * 6 } : f));
  const r = run(fade.map((f) => ({ ...f, db: f.db + (rand() - 0.5) * 2 })));
  expect(`fade-out ${s}: not lost`, r.lost === null, JSON.stringify(r.lost));
}
done("messa");
