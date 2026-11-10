/**
 * Generated practice scores: scales and warm-ups for a voice type and key, as MusicXML, with
 * movable-do solfège under the notes and a piano part of simple chords.
 */

export type VoiceType = "soprano" | "alto" | "tenor" | "baritone" | "bass";
export type ExerciseId =
  | "major-scale"
  | "natural-minor-scale"
  | "harmonic-minor-scale"
  | "chromatic-scale"
  | "five-note-major"
  | "five-note-minor"
  | "arpeggio-major"
  | "arpeggio-minor"
  | "triplets-five-note"
  | "triplets-stepping"
  | "triplets-arpeggio"
  | "triplets-octave"
  | "triplets-octave-half";

export const VOICES: { id: VoiceType; label: string; low: number; high: number }[] = [
  // Comfortable ranges (MIDI), not the extremes.
  { id: "soprano", label: "Soprano", low: 62, high: 81 },
  { id: "alto", label: "Alto", low: 55, high: 74 },
  { id: "tenor", label: "Tenor", low: 48, high: 67 },
  { id: "baritone", label: "Baritone", low: 45, high: 64 },
  { id: "bass", label: "Bass", low: 41, high: 60 },
];

/** Keys by pitch class of the tonic. */
export const KEYS = ["C", "C♯/D♭", "D", "E♭", "E", "F", "F♯/G♭", "G", "A♭", "A", "B♭", "B"];

/** A scale degree: semitones above the tonic, position on the line of fifths relative to it, solfège. */
interface Degree {
  semis: number;
  fifths: number;
  syl: string;
}
const d = (semis: number, fifths: number, syl: string): Degree => ({ semis, fifths, syl });

// Movable do; minor is la-based (the tonic is "la"), as in Kodály teaching.
const MAJOR = [d(0, 0, "do"), d(2, 2, "re"), d(4, 4, "mi"), d(5, -1, "fa"), d(7, 1, "sol"), d(9, 3, "la"), d(11, 5, "ti")];
const NAT_MINOR = [d(0, 0, "la"), d(2, 2, "ti"), d(3, -3, "do"), d(5, -1, "re"), d(7, 1, "mi"), d(8, -4, "fa"), d(10, -2, "sol")];
const HARM_MINOR = [...NAT_MINOR.slice(0, 6), d(11, 5, "si")];
/** The major scale's degrees (semitones above do, solfège), for other trainers. */
export const MAJOR_SCALE: readonly { semis: number; syl: string }[] = MAJOR;
const CHROM_UP = [
  d(0, 0, "do"), d(1, 7, "di"), d(2, 2, "re"), d(3, 9, "ri"), d(4, 4, "mi"), d(5, -1, "fa"),
  d(6, 6, "fi"), d(7, 1, "sol"), d(8, 8, "si"), d(9, 3, "la"), d(10, 10, "li"), d(11, 5, "ti"),
];
const CHROM_DOWN = [
  d(0, 0, "do"), d(1, -5, "ra"), d(2, 2, "re"), d(3, -3, "me"), d(4, 4, "mi"), d(5, -1, "fa"),
  d(6, -6, "se"), d(7, 1, "sol"), d(8, -4, "le"), d(9, 3, "la"), d(10, -2, "te"), d(11, 5, "ti"),
];

type Mode = "major" | "minor";
/** Key signature (fifths) for a tonic pitch class. */
const MAJOR_FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
const MINOR_FIFTHS = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2];

/** One melody note: scale and degree index (7 = the octave above), or a rest; length in quarters. */
interface Step {
  scale?: Degree[];
  deg?: number;
  len: number;
  /** Tied into the next step (same pitch), e.g. a triplet note held over into the next beat. */
  tieNext?: boolean;
}

interface ExerciseDef {
  id: ExerciseId;
  label: string;
  mode: Mode;
  tempo: number;
  /** The tonic chord held throughout instead of changing chords (for chromatic lines). */
  drone?: boolean;
  steps: () => Step[];
}

const seq = (scale: Degree[], degs: number[], len = 1): Step[] => degs.map((deg) => ({ scale, deg, len }));
/** Notes as triplet eighths: three to a beat. */
const trip = (scale: Degree[], degs: number[]): Step[] => seq(scale, degs, 1 / 3);
const rest = (len: number): Step => ({ len });
const twice = (s: Step[]) => [...s, ...s];
/** Every exercise starts with a half rest, to breathe and find the note. */
const BREATH = rest(2);

export const EXERCISES: ExerciseDef[] = [
  { id: "major-scale", label: "Major scale", mode: "major", tempo: 80, steps: () => scale(MAJOR) },
  { id: "natural-minor-scale", label: "Natural minor scale", mode: "minor", tempo: 80, steps: () => scale(NAT_MINOR) },
  { id: "harmonic-minor-scale", label: "Harmonic minor scale", mode: "minor", tempo: 80, steps: () => scale(HARM_MINOR) },
  {
    id: "chromatic-scale",
    label: "Chromatic scale",
    mode: "major",
    tempo: 72,
    drone: true,
    steps: () => [
      BREATH,
      ...CHROM_UP.map((deg) => ({ scale: [deg], deg: 0, len: 1 })),
      { scale: MAJOR, deg: 7, len: 1 },
      rest(2),
      ...[...CHROM_DOWN].reverse().slice(0, -1).map((deg) => ({ scale: [deg], deg: 0, len: 1 })),
      { scale: MAJOR, deg: 0, len: 4 },
    ],
  },
  {
    id: "five-note-major",
    label: "Five-note scale (major)",
    mode: "major",
    tempo: 96,
    steps: () => twice([BREATH, ...seq(MAJOR, [0, 1, 2, 3, 4, 3, 2, 1]), { scale: MAJOR, deg: 0, len: 2 }]),
  },
  {
    id: "five-note-minor",
    label: "Five-note scale (minor)",
    mode: "minor",
    tempo: 96,
    steps: () => twice([BREATH, ...seq(NAT_MINOR, [0, 1, 2, 3, 4, 3, 2, 1]), { scale: NAT_MINOR, deg: 0, len: 2 }]),
  },
  {
    id: "arpeggio-major",
    label: "Arpeggio (major)",
    mode: "major",
    tempo: 80,
    steps: () => twice([BREATH, ...seq(MAJOR, [0, 2, 4, 7, 4, 2]), { scale: MAJOR, deg: 0, len: 2 }]),
  },
  {
    id: "arpeggio-minor",
    label: "Arpeggio (minor)",
    mode: "minor",
    tempo: 80,
    steps: () => twice([BREATH, ...seq(NAT_MINOR, [0, 2, 4, 7, 4, 2]), { scale: NAT_MINOR, deg: 0, len: 2 }]),
  },
  {
    id: "triplets-five-note",
    label: "Five-note scale in triplets",
    mode: "major",
    tempo: 76,
    steps: () => twice([BREATH, ...trip(MAJOR, [0, 1, 2, 3, 4, 3, 2, 1, 0]), { scale: MAJOR, deg: 0, len: 3 }]),
  },
  {
    id: "triplets-stepping",
    label: "Stepping triplets (1-2-3, 2-3-4 …)",
    mode: "major",
    tempo: 72,
    steps: () => [
      BREATH,
      ...[0, 1, 2, 3, 4, 5].flatMap((d) => trip(MAJOR, [d, d + 1, d + 2])),
      rest(2),
      ...[7, 6, 5, 4, 3, 2].flatMap((d) => trip(MAJOR, [d, d - 1, d - 2])),
      { scale: MAJOR, deg: 0, len: 4 },
    ],
  },
  {
    id: "triplets-arpeggio",
    label: "Arpeggio in triplets",
    mode: "major",
    tempo: 76,
    steps: () => twice([BREATH, ...trip(MAJOR, [0, 2, 4, 7, 4, 2]), { scale: MAJOR, deg: 0, len: 2 }]),
  },
  {
    id: "triplets-octave",
    label: "Octave scale in triplets",
    mode: "major",
    tempo: 72,
    steps: () => twice([BREATH, ...trip(MAJOR, [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1, 0]), { scale: MAJOR, deg: 0, len: 3 }]),
  },
  {
    id: "triplets-octave-half",
    label: "1.5-octave scale in triplets",
    mode: "major",
    tempo: 72,
    // Up to the 5th above the octave and back: 23 notes, so the last do takes two triplet slots
    // and is held on into the next beat.
    steps: () =>
      twice([
        BREATH,
        ...trip(MAJOR, [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
        { scale: MAJOR, deg: 0, len: 2 / 3, tieNext: true },
        { scale: MAJOR, deg: 0, len: 2 },
      ]),
  },
];

/** One octave up, a half rest, back down, ending on a half note. */
function scale(s: Degree[]): Step[] {
  return [BREATH, ...seq(s, [0, 1, 2, 3, 4, 5, 6, 7]), rest(2), ...seq(s, [6, 5, 4, 3, 2, 1]), { scale: s, deg: 0, len: 2 }];
}

const degreeOf = (st: Required<Pick<Step, "scale" | "deg">>): { semis: number; fifths: number; syl: string } => {
  const base = st.scale[((st.deg % 7) + 7) % 7];
  return { ...base, semis: base.semis + 12 * Math.floor(st.deg / 7) };
};

/**
 * The tonic placed so the exercise (spanning `lo`–`hi` semitones above it) sits in the middle of
 * the voice's range, staying within the range where possible.
 */
export function tonicFor(voice: VoiceType, keyPc: number, lo = 0, hi = 12): number {
  const v = VOICES.find((x) => x.id === voice)!;
  const centre = (v.low + v.high) / 2 - (lo + hi) / 2;
  // How far the exercise leaves the range; going too low counts double (low notes simply don't
  // sound, high ones can still be sung in head voice).
  const overflow = (m: number) => 2 * Math.max(0, v.low - 2 - (m + lo)) + Math.max(0, m + hi - (v.high + 2));
  let best = -1;
  for (let m = keyPc; m < 100; m += 12) {
    if (best < 0) best = m;
    const o = overflow(m);
    const ob = overflow(best);
    if (o < ob || (o === ob && Math.abs(m - centre) < Math.abs(best - centre))) best = m;
  }
  return best;
}

// --- MusicXML ------------------------------------------------------------

const LETTERS = "FCGDAEB";
const NATURAL_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Spells a pitch from its MIDI number and its position on the line of fifths (0 = C). */
function pitchXml(midi: number, fifthsPos: number): string {
  const letter = LETTERS[(((fifthsPos + 1) % 7) + 7) % 7];
  const alter = Math.floor((fifthsPos + 1) / 7);
  const octave = Math.round((midi - alter - NATURAL_PC[letter]) / 12) - 1;
  return `<pitch><step>${letter}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

/** MusicXML divisions per quarter: 6, so both eighths (3) and triplet eighths (2) are whole numbers. */
const DIV = 6;
const BAR = 4 * DIV;
const ticksOf = (len: number) => Math.round(len * DIV);

/** Note types by length in ticks: [ticks, type, dotted, triplet]. */
const TYPES: [number, string, boolean, boolean][] = [
  [24, "whole", false, false],
  [18, "half", true, false],
  [12, "half", false, false],
  [9, "quarter", true, false],
  [6, "quarter", false, false],
  [4, "quarter", false, true],
  [3, "eighth", false, false],
  [2, "eighth", false, true],
];
const typeXml = (ticks: number) => {
  const t = TYPES.find(([l]) => l === ticks) ?? TYPES[4];
  return (
    `<type>${t[1]}</type>${t[2] ? "<dot/>" : ""}` +
    (t[3] ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : "")
  );
};
const isTriplet = (ticks: number) => TYPES.find(([l]) => l === ticks)?.[3] ?? false;

/** A step as written in one bar: a note crossing a barline is split into tied pieces. */
interface Piece {
  st: Step;
  ticks: number;
  tieStart: boolean;
  tieStop: boolean;
}

/** Chords as scale degrees of the tonic (0-based, 7-note scale). */
const CHORDS = { I: [0, 2, 4], IV: [3, 5, 0], V: [4, 6, 1] };

export interface GeneratedScore {
  title: string;
  xml: string;
}

/** Packs steps into 4/4 bars (in ticks, so triplets add up exactly). A note crossing a barline is
 * split into tied pieces; the last bar is filled with rests. */
function pack(steps: Step[]): Piece[][] {
  const bars: Piece[][] = [];
  let bar: Piece[] = [];
  let used = 0;
  const close = () => {
    bars.push(bar);
    bar = [];
    used = 0;
  };
  let tiedIn = false;
  for (const st of steps) {
    let left = ticksOf(st.len);
    let first = true;
    while (left > 0) {
      const room = BAR - used;
      const take = Math.min(left, room);
      const last = take >= left;
      bar.push({
        st,
        ticks: take,
        tieStop: !first || (first && tiedIn),
        tieStart: st.scale !== undefined && (!last || !!st.tieNext),
      });
      used += take;
      left -= take;
      first = false;
      if (used >= BAR) close();
    }
    tiedIn = !!st.tieNext;
  }
  while (used > 0 && used < BAR) {
    const fill = [12, 6, 3, 2].find((t) => t <= BAR - used && (used % t === 0 || t === 2))!;
    bar.push({ st: rest(fill / DIV), ticks: fill, tieStart: false, tieStop: false });
    used += fill;
    if (used >= BAR) close();
  }
  return bars;
}

const clefOf = (voice: VoiceType) =>
  voice === "bass" || voice === "baritone"
    ? "<clef><sign>F</sign><line>4</line></clef>"
    : voice === "tenor"
      ? "<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
      : "<clef><sign>G</sign><line>2</line></clef>";
const BASS_CLEF = "<clef><sign>F</sign><line>4</line></clef>";

/** Key, time and tonic spelling shared by every part of a generated score. */
interface Setting {
  keyPc: number;
  keyFifths: number;
  mode: Mode;
  /** Line-of-fifths position of the tonic. */
  tonicPos: number;
  tempo: number;
}

function settingFor(keyPc: number, mode: Mode, tempo: number): Setting {
  const keyFifths = (mode === "major" ? MAJOR_FIFTHS : MINOR_FIFTHS)[keyPc];
  // A major key's tonic is its signature; a minor tonic is 3 fifths up.
  return { keyPc, keyFifths, mode, tempo, tonicPos: keyFifths + (mode === "minor" ? 3 : 0) };
}

const attrsXml = (s: Setting, clefXml: string) =>
  `<attributes><divisions>${DIV}</divisions><key><fifths>${s.keyFifths}</fifths><mode>${s.mode}</mode></key>` +
  `<time><beats>4</beats><beat-type>4</beat-type></time>${clefXml}</attributes>`;
const tempoXml = (s: Setting) =>
  `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${s.tempo}</per-minute></metronome></direction-type><sound tempo="${s.tempo}"/></direction>`;

/** The measures of a sung part, with triplet brackets, beams, ties and solfège. */
function melodyXml(bars: Piece[][], s: Setting, clefXml: string, tonic: number): string {
  return bars
    .map((b, i) => {
      const beams = tripletBeams(b);
      let inTriplet = 0;
      const notes = b
        .map((pc, k) => {
          const { st, ticks } = pc;
          const notations: string[] = [];
          const beam = beams[k] ? `<beam number="1">${beams[k]}</beam>` : "";
          // Triplets are bracketed in threes.
          if (isTriplet(ticks)) {
            if (inTriplet === 0) notations.push('<tuplet type="start" bracket="yes"/>');
            inTriplet += ticks;
            if (inTriplet >= DIV) {
              notations.push('<tuplet type="stop"/>');
              inTriplet = 0;
            }
          }
          const ties = (pc.tieStop ? '<tie type="stop"/>' : "") + (pc.tieStart ? '<tie type="start"/>' : "");
          if (pc.tieStop) notations.unshift('<tied type="stop"/>');
          if (pc.tieStart) notations.unshift('<tied type="start"/>');
          const tail =
            `<voice>1</voice>${typeXml(ticks)}${beam}` + (notations.length ? `<notations>${notations.join("")}</notations>` : "");
          if (st.scale === undefined) return `<note><rest/><duration>${ticks}</duration>${tail}</note>`;
          const deg = degreeOf(st as Required<Step>);
          return (
            `<note>${pitchXml(tonic + deg.semis, s.tonicPos + deg.fifths)}<duration>${ticks}</duration>${ties}${tail}` +
            (pc.tieStop ? "" : `<lyric number="1"><syllabic>single</syllabic><text>${deg.syl}</text></lyric>`) +
            `</note>`
          );
        })
        .join("");
      return `<measure number="${i + 1}">${i === 0 ? attrsXml(s, clefXml) + tempoXml(s) : ""}${notes}</measure>`;
    })
    .join("\n");
}

/** A piano chord (root in the bass, close position above) lasting `len` ticks. */
function chordXml(name: keyof typeof CHORDS, len: number, s: Setting, sc: Degree[]): string {
  const degs = CHORDS[name];
  const root = sc[degs[0]];
  const rootMidi = 36 + ((((s.keyPc + root.semis) % 12) + 12) % 12); // C2–B2
  const tones = [
    { midi: rootMidi, pos: s.tonicPos + root.fifths },
    ...degs.map((g) => {
      const dg = sc[g];
      let m = 48 + ((((s.keyPc + dg.semis) % 12) + 12) % 12); // close position from C3
      if (m < rootMidi + 12) m += 12;
      return { midi: m, pos: s.tonicPos + dg.fifths };
    }),
  ].sort((a, b) => a.midi - b.midi);
  return tones
    .map(
      (t, k) => `<note>${k ? "<chord/>" : ""}${pitchXml(t.midi, t.pos)}<duration>${len}</duration><voice>1</voice>${typeXml(len)}</note>`,
    )
    .join("");
}

function scoreXml(title: string, parts: { name: string; measures: string }[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${title}</work-title></work>
<part-list>
${parts.map((p, i) => `<score-part id="P${i + 1}"><part-name>${p.name}</part-name></score-part>`).join("\n")}
</part-list>
${parts.map((p, i) => `<part id="P${i + 1}">\n${p.measures}\n</part>`).join("\n")}
</score-partwise>`;
}

/** The exercise for every voice type (each in its own comfortable range, same key) plus piano. */
export function generateExercise(id: ExerciseId, keyPc: number): GeneratedScore {
  const ex = EXERCISES.find((e) => e.id === id)!;
  const s = settingFor(keyPc, ex.mode, ex.tempo);
  const steps = ex.steps();
  const semis = steps.flatMap((st) => (st.scale === undefined ? [] : [degreeOf(st as Required<Step>).semis]));
  const keyName = spellName(s.tonicPos);
  const title = `${ex.label} in ${keyName}${ex.mode === "minor" && !/minor/.test(ex.label) ? " minor" : ""}`;
  const bars = pack(steps);

  // Piano: a chord per half bar, chosen to fit the melody; root in the bass.
  const sc = ex.mode === "major" ? MAJOR : HARM_MINOR;
  const pianoXml = bars
    .map((b, i) => {
      const halves: (keyof typeof CHORDS | null)[] = [0, 1].map((h) => (ex.drone ? "I" : chooseChord(b, h, sc)));
      // Hold the previous chord through a rest; merge equal halves.
      if (halves[0] === null) halves[0] = halves[1] ?? "I";
      if (halves[1] === null) halves[1] = halves[0];
      const parts = halves[0] === halves[1] ? [[halves[0]!, BAR] as const] : halves.map((c) => [c!, BAR / 2] as const);
      const notes = parts.map(([name, len]) => chordXml(name, len, s, sc)).join("");
      return `<measure number="${i + 1}">${i === 0 ? attrsXml(s, BASS_CLEF) : ""}${notes}</measure>`;
    })
    .join("\n");

  const lo = Math.min(...semis);
  const hi = Math.max(...semis);
  const xml = scoreXml(title, [
    ...VOICES.map((v) => ({ name: v.label, measures: melodyXml(bars, s, clefOf(v.id), tonicFor(v.id, keyPc, lo, hi)) })),
    { name: "Piano", measures: pianoXml },
  ]);
  return { title, xml };
}

/**
 * Beams for the triplet eighths of a bar: within each triplet (one beat), consecutive eighth notes
 * are beamed together; a lone eighth (next to a triplet quarter) gets none.
 */
function tripletBeams(bar: Piece[]): (string | null)[] {
  const out: (string | null)[] = bar.map(() => null);
  let group: number[] = [];
  let acc = 0;
  const flush = () => {
    let run: number[] = [];
    const end = () => {
      if (run.length >= 2) run.forEach((k, i) => (out[k] = i === 0 ? "begin" : i === run.length - 1 ? "end" : "continue"));
      run = [];
    };
    for (const k of group) {
      if (bar[k].ticks === 2 && bar[k].st.scale !== undefined) run.push(k);
      else end();
    }
    end();
    group = [];
    acc = 0;
  };
  bar.forEach((pc, k) => {
    if (!isTriplet(pc.ticks)) return;
    group.push(k);
    acc += pc.ticks;
    if (acc >= DIV) flush();
  });
  return out;
}

/** The chord (I, IV or V) that contains most of the melody in half `h` of the bar, by length. */
function chooseChord(bar: Piece[], h: number, sc: Degree[]): keyof typeof CHORDS | null {
  const weight = { I: 0, IV: 0, V: 0 };
  let t = 0;
  let any = false;
  const half = BAR / 2;
  for (const { st, ticks } of bar) {
    const from = Math.max(t, h * half);
    const to = Math.min(t + ticks, (h + 1) * half);
    if (to > from && st.scale !== undefined) {
      any = true;
      const pc = ((degreeOf(st as Required<Step>).semis % 12) + 12) % 12;
      for (const [name, degs] of Object.entries(CHORDS) as [keyof typeof CHORDS, number[]][])
        if (degs.some((g) => sc[g].semis % 12 === pc)) weight[name] += to - from;
    }
    t += ticks;
  }
  if (!any) return null;
  // Ties go to I, then V.
  return weight.I >= weight.V && weight.I >= weight.IV ? "I" : weight.V >= weight.IV ? "V" : "IV";
}

function spellName(pos: number): string {
  const letter = LETTERS[(((pos + 1) % 7) + 7) % 7];
  const alter = Math.floor((pos + 1) / 7);
  return letter + (alter > 0 ? "♯".repeat(alter) : "♭".repeat(-alter));
}
