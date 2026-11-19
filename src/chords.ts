/**
 * Chords mode (Audiation page): what each level plays and asks for. A chord or interval sounds and
 * stops; the singer then sings its notes from memory, bottom to top, or one named voice. Chords
 * come on their own (any root) or in a key (diatonic, with syllables). Pure: no audio, no DOM.
 */

export type ChordContext = "free" | "key";

export interface ChordLevel {
  label: string;
  /** Seconds of silence between the chord and singing. */
  gap: number;
}

export const CHORD_LEVELS: ChordLevel[] = [
  { label: "thirds, fifths and octaves", gap: 1 },
  { label: "any interval", gap: 1 },
  { label: "major and minor chords, bottom to top", gap: 1 },
  { label: "major and minor chords, one voice", gap: 1 },
  { label: "inversions, bottom to top", gap: 1 },
  { label: "seventh chords, bottom to top", gap: 1 },
];

export function describeChordLevel(i: number): string {
  return `${i + 1}: ${CHORD_LEVELS[i].label}`;
}

export interface ChordSetup {
  context: ChordContext;
  /** The voice's comfortable range (MIDI, inclusive). */
  low: number;
  high: number;
  /** Key (pitch class of the tonic) and mode, for the key context. Minor is la-based. */
  key: number;
  minor: boolean;
}

export interface ChordRound {
  /** MIDI, bottom to top: what sounds. */
  notes: number[];
  /** MIDI, what to sing, in order. */
  targets: number[];
  prompt: string;
  /** "Major third", "F major", "F major, first inversion", "G7", "Cmaj7", "Dm7". */
  name: string;
  /** Per note of `notes`, without the octave, spelled for the chord or key: ["E", "G♯", "B"]. */
  noteNames: string[];
  /** Per note of `notes`, in the key context only (movable do, la-based minor, si). */
  syllables: string[] | null;
  /** The chord's step in the key ("IV", "vi", "V7"), in the key context only. */
  step: string | null;
}

/** One chord tone: semitones and letter steps above the root. */
interface Tone {
  semi: number;
  letter: number;
}

/** A chord or interval to place: its tones bottom to top and how to name it. */
interface Shape {
  tones: Tone[];
  /** Pitch class and letter (0 = C … 6 = B) of the root. */
  rootPc: number;
  rootLetter: number;
  name: (root: string) => string;
  step: string | null;
}

const LETTERS = "CDEFGAB";
const NATURAL = [0, 2, 4, 5, 7, 9, 11];
/** Spelling of a root on its own, and of major and minor tonics. */
const ROOT = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MAJOR_TONIC = ["C", "D♭", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const MINOR_TONIC = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];

const mod = (x: number, m: number) => ((x % m) + m) % m;
/** The other way to spell a black key's root ("C♯" ↔ "D♭"). */
const ENHARMONIC: Record<number, string> = { 1: "D♭", 3: "D♯", 6: "G♭", 8: "G♯", 10: "A♯" };

function spell(letter: number, pc: number): string {
  const l = mod(letter, 7);
  const acc = mod(pc - NATURAL[l] + 6, 12) - 6;
  return LETTERS[l] + (["𝄫", "♭", "", "♯", "𝄪"][acc + 2] ?? "");
}

/** A spelled note name with its octave: "G♯4"; B♯3 and C♭4 keep the octave of their letter. */
export function spelledName(name: string, midi: number): string {
  const pc = mod(midi, 12);
  let octave = Math.floor(midi / 12) - 1;
  if (name[0] === "B" && pc <= 1) octave--;
  if (name[0] === "C" && pc >= 10) octave++;
  return `${name}${octave}`;
}

/** Sharps and flats in a spelling (a double counts twice), to prefer the simpler of two. */
const accidentals = (names: string[]) => names.reduce((n, x) => n + (x.match(/[♯♭]/g)?.length ?? 0) + 2 * (x.match(/[𝄪𝄫]/g)?.length ?? 0), 0);

/** The root's letter for a chord on its own: of the two spellings of a black key, the simpler. */
function freeRootLetter(pc: number, tones: Tone[]): number {
  const letters = [ROOT[pc], ENHARMONIC[pc]].filter(Boolean).map((n) => LETTERS.indexOf(n[0]));
  const cost = (l: number) => accidentals(tones.map((t) => spell(l + t.letter, pc + t.semi)));
  return letters.reduce((best, l) => (cost(l) < cost(best) ? l : best));
}

const INTERVALS: { semi: number; letter: number; name: string }[] = [
  { semi: 1, letter: 1, name: "Minor second" },
  { semi: 2, letter: 1, name: "Major second" },
  { semi: 3, letter: 2, name: "Minor third" },
  { semi: 4, letter: 2, name: "Major third" },
  { semi: 5, letter: 3, name: "Perfect fourth" },
  { semi: 6, letter: 3, name: "Tritone" },
  { semi: 7, letter: 4, name: "Perfect fifth" },
  { semi: 8, letter: 5, name: "Minor sixth" },
  { semi: 9, letter: 5, name: "Major sixth" },
  { semi: 10, letter: 6, name: "Minor seventh" },
  { semi: 11, letter: 6, name: "Major seventh" },
  { semi: 12, letter: 7, name: "Octave" },
];
const intervalName = (semi: number) => INTERVALS.find((i) => i.semi === semi)!.name;

const QUALITY: Record<string, { semis: number[]; name: (r: string) => string }> = {
  major: { semis: [0, 4, 7], name: (r) => `${r} major` },
  minor: { semis: [0, 3, 7], name: (r) => `${r} minor` },
  dom7: { semis: [0, 4, 7, 10], name: (r) => `${r}7` },
  maj7: { semis: [0, 4, 7, 11], name: (r) => `${r}maj7` },
  m7: { semis: [0, 3, 7, 10], name: (r) => `${r}m7` },
};

const chordTones = (semis: number[]): Tone[] => semis.map((semi, i) => ({ semi, letter: 2 * i }));

/** Moves the lowest `n` tones up an octave: the n-th inversion. */
function invert(tones: Tone[], n: number): Tone[] {
  const t = tones.map((x) => ({ ...x }));
  for (let i = 0; i < n; i++) {
    const low = t.shift()!;
    t.push({ semi: low.semi + 12, letter: low.letter + 7 });
  }
  return t;
}
const INVERSION = ["", ", first inversion", ", second inversion"];

// --- the key context ---

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** The scale degree's semitones above the tonic (degrees may run past the octave). */
function degreeSemi(deg: number, minor: boolean, raised7 = false): number {
  const scale = minor ? MINOR_SCALE : MAJOR_SCALE;
  const d = mod(deg, 7);
  const s = minor && raised7 && d === 6 ? 11 : scale[d];
  return s + 12 * Math.floor(deg / 7);
}

/** A diatonic chord on `deg` (0 = tonic), with `count` tones in thirds; V and V7 in minor take si. */
function keyChord(setup: ChordSetup, deg: number, count: 3 | 4): Shape {
  const raise = setup.minor && deg === 4;
  const root = degreeSemi(deg, setup.minor, raise);
  const tones: Tone[] = [];
  for (let i = 0; i < count; i++) tones.push({ semi: degreeSemi(deg + 2 * i, setup.minor, raise) - root, letter: 2 * i });
  const tonicLetter = LETTERS.indexOf((setup.minor ? MINOR_TONIC : MAJOR_TONIC)[setup.key][0]);
  const minorThird = tones[1].semi === 3;
  const quality =
    count === 3 ? (minorThird ? "minor" : "major") : minorThird ? "m7" : tones[3].semi === 11 ? "maj7" : "dom7";
  const roman = minorThird ? ROMAN[deg].toLowerCase() : ROMAN[deg];
  return {
    tones,
    rootPc: mod(setup.key + root, 12),
    rootLetter: tonicLetter + deg,
    name: QUALITY[quality].name,
    step: roman,
  };
}

/** A diatonic interval on `deg` spanning `span` letter steps. */
function keyInterval(setup: ChordSetup, deg: number, span: number): Shape {
  const root = degreeSemi(deg, setup.minor);
  const top = degreeSemi(deg + span, setup.minor) - root;
  const tonicLetter = LETTERS.indexOf((setup.minor ? MINOR_TONIC : MAJOR_TONIC)[setup.key][0]);
  return {
    tones: [
      { semi: 0, letter: 0 },
      { semi: top, letter: span },
    ],
    rootPc: mod(setup.key + root, 12),
    rootLetter: tonicLetter + deg,
    name: () => intervalName(top),
    // Scale degrees, e.g. "1–3" for do–mi in major.
    step: `${deg + 1}–${mod(deg + span, 7) + 1}`,
  };
}

const MAJOR_TRIADS = [0, 1, 2, 3, 4, 5];
const MINOR_TRIADS = [0, 2, 3, 4, 5];
const MAJOR_SEVENTHS = [4, 1, 0, 3];
const MINOR_SEVENTHS = [4, 3, 2, 5];

/** The shapes a level can play, and the inversions they may come in. */
function shapes(level: number, setup: ChordSetup): { shape: Shape; inversion: number }[] {
  const out: { shape: Shape; inversion: number }[] = [];
  if (setup.context === "free") {
    for (let pc = 0; pc < 12; pc++) {
      const add = (tones: Tone[], name: (r: string) => string, inversion = 0) =>
        out.push({ shape: { tones, rootPc: pc, rootLetter: freeRootLetter(pc, tones), name, step: null }, inversion });
      if (level <= 1)
        for (const iv of INTERVALS)
          if (level === 1 || [3, 4, 7, 12].includes(iv.semi))
            add(
              [
                { semi: 0, letter: 0 },
                { semi: iv.semi, letter: iv.letter },
              ],
              () => iv.name,
            );
      if (level === 2 || level === 3) for (const q of ["major", "minor"]) add(chordTones(QUALITY[q].semis), QUALITY[q].name);
      if (level === 4) for (const q of ["major", "minor"]) for (const inv of [1, 2]) add(chordTones(QUALITY[q].semis), QUALITY[q].name, inv);
      if (level === 5) for (const q of ["dom7", "maj7", "m7"]) add(chordTones(QUALITY[q].semis), QUALITY[q].name);
    }
    return out;
  }
  if (level <= 1) {
    for (let deg = 0; deg < 7; deg++)
      for (const span of level === 0 ? [2, 4, 7] : [1, 2, 3, 4, 5, 6, 7]) {
        const s = keyInterval(setup, deg, span);
        // Level 1: only perfect fifths (not the diminished one on ti).
        if (level === 0 && span === 4 && s.tones[1].semi !== 7) continue;
        out.push({ shape: s, inversion: 0 });
      }
    return out;
  }
  if (level === 2 || level === 3) for (const deg of [0, 3, 4]) out.push({ shape: keyChord(setup, deg, 3), inversion: 0 });
  if (level === 4) for (const deg of setup.minor ? MINOR_TRIADS : MAJOR_TRIADS) for (const inv of [1, 2]) out.push({ shape: keyChord(setup, deg, 3), inversion: inv });
  if (level === 5) for (const deg of setup.minor ? MINOR_SEVENTHS : MAJOR_SEVENTHS) out.push({ shape: keyChord(setup, deg, 4), inversion: 0 });
  return out;
}

/** "V7", "ii7", "Imaj7": the step of a seventh chord, from its triad step and quality. */
function seventhStep(shape: Shape): string {
  return shape.tones[3].semi === 11 ? `${shape.step!.toUpperCase()}maj7` : `${shape.step}7`;
}

const SYLLABLE: Record<number, string> = { 0: "do", 2: "re", 4: "mi", 5: "fa", 7: "sol", 9: "la", 11: "ti", 8: "si" };

/** A new round at `level` (0-based) for the singer's range. */
export function chordRound(level: number, setup: ChordSetup, rand: () => number = Math.random): ChordRound {
  const lv = Math.max(0, Math.min(CHORD_LEVELS.length - 1, level));
  // Every way the level's shapes fit the range; one is picked, so nothing ever falls outside it.
  const options: { shape: Shape; tones: Tone[]; root: number; inversion: number }[] = [];
  for (const { shape, inversion } of shapes(lv, setup)) {
    const tones = invert(shape.tones, inversion);
    const lo = tones[0].semi;
    const hi = tones[tones.length - 1].semi;
    for (let root = setup.low - lo; root + hi <= setup.high; root++) if (mod(root, 12) === shape.rootPc) options.push({ shape, tones, root, inversion });
  }
  const { shape, tones, root, inversion } = options[Math.floor(rand() * options.length)];
  const notes = tones.map((t) => root + t.semi);
  const rootName = spell(shape.rootLetter, shape.rootPc);
  const noteNames = tones.map((t) => spell(shape.rootLetter + t.letter, mod(shape.rootPc + t.semi, 12)));
  const isInterval = notes.length === 2;
  const name = shape.name(rootName) + (isInterval ? "" : INVERSION[inversion]);

  let targets = notes;
  let prompt = isInterval ? "Sing the low note, then the high one" : "Sing them bottom to top";
  if (lv === 3) {
    const which = Math.floor(rand() * 3);
    targets = [notes[[0, 2, 1][which]]];
    prompt = ["Sing the bottom note", "Sing the top note", "Sing the middle note"][which];
  }

  let syllables: string[] | null = null;
  let step: string | null = null;
  if (setup.context === "key") {
    const doPc = mod(setup.key + (setup.minor ? 3 : 0), 12);
    syllables = notes.map((m) => SYLLABLE[mod(m - doPc, 12)] ?? "?");
    step = notes.length === 4 ? seventhStep(shape) : shape.step;
  }
  return { notes, targets, prompt, name, noteNames, syllables, step };
}
