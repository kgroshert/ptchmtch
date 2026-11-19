/** Offline check of the Chords mode's content: levels, chords for both contexts, prompts and names. */
import { CHORD_LEVELS, chordRound, spelledName, type ChordRound, type ChordSetup } from "../src/chords";
import { VOICES } from "../src/exercises";
import { done, expect, rng } from "./check-util";

const steps = (r: ChordRound) => r.notes.slice(1).map((n) => n - r.notes[0]);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const alto = VOICES.find((v) => v.id === "alto")!;
const free: ChordSetup = { context: "free", low: alto.low, high: alto.high, key: 0, minor: false };
const inKey = (key: number, minor: boolean): ChordSetup => ({ context: "key", low: alto.low, high: alto.high, key, minor });
const many = (level: number, setup: ChordSetup, n = 300, seed = 1) => {
  const rand = rng(seed);
  return Array.from({ length: n }, () => chordRound(level, setup, rand));
};

expect("six levels", CHORD_LEVELS.length === 6, `${CHORD_LEVELS.length}`);

// Every chord fits every voice's range, in every level, key and context.
{
  const rand = rng(2);
  let bad = "";
  for (const v of VOICES)
    for (let level = 0; level < CHORD_LEVELS.length; level++)
      for (let key = 0; key < 12; key++)
        for (const minor of [false, true])
          for (const context of ["free", "key"] as const)
            for (let k = 0; k < 4; k++) {
              const r = chordRound(level, { context, low: v.low, high: v.high, key, minor }, rand);
              if (![...r.notes, ...r.targets].every((m) => m >= v.low && m <= v.high)) bad ||= `${v.id} L${level} key ${key} ${minor} ${context}: ${r.notes}`;
            }
  expect("fits every voice", !bad, bad);
}

// What to sing, and the prompt.
for (let level = 0; level < 6; level++)
  for (const setup of [free, inKey(2, false), inKey(9, true)]) {
    for (const r of many(level, setup, 100, 10 + level)) {
      if (level === 3) {
        const which = /top/.test(r.prompt) ? r.notes[2] : /bottom/.test(r.prompt) ? r.notes[0] : /middle/.test(r.prompt) ? r.notes[1] : NaN;
        expect(`L3 sings one voice (${r.prompt})`, r.targets.length === 1 && r.targets[0] === which, `${r.prompt} ${r.notes} → ${r.targets}`);
      } else expect(`L${level} targets in order`, same(r.targets, r.notes), `${r.notes} → ${r.targets}`);
      expect(`L${level} prompt never names notes`, !/\b(do|re|mi|fa|sol|la|ti|si)\b|\b[A-G][♯♭]?\b/i.test(r.prompt.replace(/^Sing /, "")), r.prompt);
      expect(`L${level} names per note`, r.noteNames.length === r.notes.length && (setup.context === "free" ? r.syllables === null && r.step === null : r.syllables?.length === r.notes.length && !!r.step), JSON.stringify(r));
    }
  }

// On their own.
expect("free intervals L0", many(0, free).every((r) => r.notes.length === 2 && [3, 4, 7, 12].includes(steps(r)[0])));
expect("free intervals L1", many(1, free).every((r) => r.notes.length === 2 && steps(r)[0] >= 1 && steps(r)[0] <= 12));
expect("free intervals L1 vary", new Set(many(1, free).map((r) => steps(r)[0])).size >= 10);
expect("free triads L2", many(2, free).every((r) => same(steps(r), [4, 7]) || same(steps(r), [3, 7])));
const inversions = [[3, 8], [5, 9], [4, 9], [5, 8]];
expect("free inversions L4", many(4, free).every((r) => inversions.some((s) => same(steps(r), s))), JSON.stringify(many(4, free, 5).map(steps)));
expect("free sevenths L5", many(5, free).every((r) => [[4, 7, 10], [4, 7, 11], [3, 7, 10]].some((s) => same(steps(r), s))));
{
  const f = many(2, free, 600, 3).find((r) => r.noteNames[0] === "F" && same(steps(r), [4, 7]));
  expect("names: F major", f?.name === "F major" && same(f.noteNames, ["F", "A", "C"]), JSON.stringify(f));
  const e = many(2, free, 600, 4).find((r) => r.noteNames[0] === "E" && same(steps(r), [4, 7]));
  expect("names: E major spelled with G♯", same(e?.noteNames, ["E", "G♯", "B"]), JSON.stringify(e));
  const t = many(0, free, 300, 5).find((r) => steps(r)[0] === 7);
  expect("names: perfect fifth", t?.name === "Perfect fifth", JSON.stringify(t));
}

// In a key.
{
  const c = many(2, inKey(0, false));
  expect("major key chords: I, IV, V only", c.every((r) => ["I", "IV", "V"].includes(r.step!)), JSON.stringify([...new Set(c.map((r) => r.step))]));
  expect("major key chords: C, F, G major", c.every((r) => ["C major", "F major", "G major"].includes(r.name)), JSON.stringify([...new Set(c.map((r) => r.name))]));
  const iv = c.find((r) => r.step === "IV");
  expect("major key chords: IV is fa la do", same(iv?.syllables, ["fa", "la", "do"]), JSON.stringify(iv));
}
{
  const a = many(2, inKey(9, true));
  const v = a.find((r) => r.step === "V");
  expect("minor key chords: V is E G♯ B", same(v?.noteNames, ["E", "G♯", "B"]) && v?.name === "E major", JSON.stringify(v));
  expect("minor key chords: V is mi si ti", same(v?.syllables, ["mi", "si", "ti"]), JSON.stringify(v));
  const iv = a.find((r) => r.step === "iv");
  expect("minor key chords: iv is re fa la", same(iv?.syllables, ["re", "fa", "la"]) && iv?.name === "D minor", JSON.stringify(iv));
  const iii = many(4, inKey(9, true), 600).find((r) => r.step === "III");
  expect("minor key chords: III is C major", iii?.name.startsWith("C major") && [...iii.noteNames].sort().join() === "C,E,G", JSON.stringify(iii));
  expect("minor key: no diminished", many(4, inKey(9, true), 600).every((r) => !/dim|°/.test(r.name + r.step)));
}
{
  const g = many(5, inKey(0, false), 600).find((r) => r.step === "V7");
  expect("sevenths: V7 in C is G7, sol ti re fa", g?.name === "G7" && same(g.syllables, ["sol", "ti", "re", "fa"]), JSON.stringify(g));
  const s = many(5, inKey(0, false), 600);
  expect("sevenths in a key: V7 ii7 Imaj7 IVmaj7", s.every((r) => ["V7", "ii7", "Imaj7", "IVmaj7"].includes(r.step!)), JSON.stringify([...new Set(s.map((r) => r.step))]));
  const m = many(5, inKey(9, true), 600);
  expect("sevenths in minor: V7 iv7 IIImaj7 VImaj7", m.every((r) => ["V7", "iv7", "IIImaj7", "VImaj7"].includes(r.step!)), JSON.stringify([...new Set(m.map((r) => r.step))]));
}
{
  const k = many(0, inKey(0, false));
  expect("key intervals L0 are diatonic thirds, fifths, octaves", k.every((r) => [3, 4, 7, 12].includes(steps(r)[0]) && r.notes.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(n % 12))), JSON.stringify(k.slice(0, 3)));
  const k1 = many(1, inKey(0, false));
  expect("key intervals L1 are diatonic", k1.every((r) => r.notes.every((n) => [0, 2, 4, 5, 7, 9, 11].includes(n % 12)) && steps(r)[0] >= 1 && steps(r)[0] <= 12));
}
// Spelling on their own: the simpler of the two enharmonic roots, never double sharps or flats.
{
  const all = [0, 1, 2, 3, 4, 5].flatMap((l) => many(l, free, 600, 40 + l));
  const doubles = all.filter((r) => r.noteNames.some((n) => /𝄫|𝄪/.test(n)));
  expect("free: no double sharps or flats", doubles.length === 0, JSON.stringify(doubles.slice(0, 3).map((r) => [r.name, r.noteNames])));
  const names = new Set(all.map((r) => r.name.replace(/,.*/, "")));
  expect("free: G♯ minor, not A♭ minor", names.has("G♯ minor") && !names.has("A♭ minor"), [...names].filter((n) => /minor/.test(n)).join(" "));
  expect("free: D♭ major, not C♯ major", names.has("D♭ major") && !names.has("C♯ major"), [...names].filter((n) => /major/.test(n)).join(" "));
}
// Spelled note names with the right octave.
expect("spelled: G♯4", spelledName("G♯", 68) === "G♯4", spelledName("G♯", 68));
expect("spelled: B♯3 is MIDI 60", spelledName("B♯", 60) === "B♯3", spelledName("B♯", 60));
expect("spelled: C♭4 is MIDI 59", spelledName("C♭", 59) === "C♭4", spelledName("C♭", 59));
done("chords");
