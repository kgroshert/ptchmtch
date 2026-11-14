/** Tiny helpers for the offline analysis checks (run with tsx). */

/** A seeded random generator (mulberry32), so checks give the same frames every run. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let passed = 0;
const failures: string[] = [];

export function expect(name: string, cond: boolean, detail = ""): void {
  if (cond) passed++;
  else failures.push(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
}

export function done(title: string): void {
  failures.forEach((f) => console.log(f));
  console.log(`${title}: ${passed} passed, ${failures.length} failed`);
  if (failures.length) process.exitCode = 1;
}

export const between = (x: number | null | undefined, lo: number, hi: number) => x != null && x >= lo && x <= hi;
