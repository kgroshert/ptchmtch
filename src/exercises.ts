/**
 * Generated practice scores: scales and warm-ups for a voice type and key, as MusicXML, with
 * movable-do solfège under the notes and a piano part of simple chords.
 */

export type VoiceType = "soprano" | "alto" | "tenor" | "bass";
export type ExerciseId =
  | "major-scale"
  | "natural-minor-scale"
  | "harmonic-minor-scale"
  | "chromatic-scale"
  | "five-note-major"
  | "five-note-minor"
  | "arpeggio-major"
  | "arpeggio-minor";

export const VOICES: { id: VoiceType; label: string; low: number; high: number }[] = [
  // Comfortable ranges (MIDI), not the extremes.
  { id: "soprano", label: "Soprano", low: 62, high: 81 },
  { id: "alto", label: "Alto", low: 55, high: 74 },
  { id: "tenor", label: "Tenor", low: 48, high: 67 },
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
const rest = (len: number): Step => ({ len });
const twice = (s: Step[]) => [...s, ...s];

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
      ...CHROM_UP.map((deg) => ({ scale: [deg], deg: 0, len: 1 })),
      { scale: MAJOR, deg: 7, len: 1 },
      ...[...CHROM_DOWN].reverse().slice(0, -1).map((deg) => ({ scale: [deg], deg: 0, len: 1 })),
      { scale: MAJOR, deg: 0, len: 4 },
    ],
  },
  {
    id: "five-note-major",
    label: "Five-note scale (major)",
    mode: "major",
    tempo: 96,
    steps: () => twice([...seq(MAJOR, [0, 1, 2, 3, 4, 3, 2, 1]), { scale: MAJOR, deg: 0, len: 2 }, rest(2)]),
  },
  {
    id: "five-note-minor",
    label: "Five-note scale (minor)",
    mode: "minor",
    tempo: 96,
    steps: () => twice([...seq(NAT_MINOR, [0, 1, 2, 3, 4, 3, 2, 1]), { scale: NAT_MINOR, deg: 0, len: 2 }, rest(2)]),
  },
  {
    id: "arpeggio-major",
    label: "Arpeggio (major)",
    mode: "major",
    tempo: 80,
    steps: () => twice([...seq(MAJOR, [0, 2, 4, 7, 4, 2]), { scale: MAJOR, deg: 0, len: 2 }]),
  },
  {
    id: "arpeggio-minor",
    label: "Arpeggio (minor)",
    mode: "minor",
    tempo: 80,
    steps: () => twice([...seq(NAT_MINOR, [0, 2, 4, 7, 4, 2]), { scale: NAT_MINOR, deg: 0, len: 2 }]),
  },
];

/** One octave up and back down, ending on a half note. */
function scale(s: Degree[]): Step[] {
  return [...seq(s, [0, 1, 2, 3, 4, 5, 6, 7, 6, 5, 4, 3, 2, 1]), { scale: s, deg: 0, len: 2 }];
}

const degreeOf = (st: Required<Pick<Step, "scale" | "deg">>): { semis: number; fifths: number; syl: string } => {
  const base = st.scale[st.deg % 7];
  return { ...base, semis: base.semis + 12 * Math.floor(st.deg / 7) };
};

/**
 * The tonic placed so the exercise (spanning `lo`–`hi` semitones above it) sits in the middle of
 * the voice's range, staying within the range where possible.
 */
export function tonicFor(voice: VoiceType, keyPc: number, lo = 0, hi = 12): number {
  const v = VOICES.find((x) => x.id === voice)!;
  const centre = (v.low + v.high) / 2 - (lo + hi) / 2;
  const fits = (m: number) => m + lo >= v.low - 2 && m + hi <= v.high + 2;
  let best = -1;
  for (let m = keyPc; m < 100; m += 12) {
    if (best < 0) best = m;
    const better = Math.abs(m - centre) < Math.abs(best - centre);
    if ((fits(m) && (!fits(best) || better)) || (!fits(best) && better)) best = m;
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

const TYPES: [number, string, boolean][] = [
  [4, "whole", false],
  [3, "half", true],
  [2, "half", false],
  [1.5, "quarter", true],
  [1, "quarter", false],
  [0.5, "eighth", false],
];
const typeXml = (len: number) => {
  const t = TYPES.find(([l]) => l === len) ?? TYPES[4];
  return `<type>${t[1]}</type>${t[2] ? "<dot/>" : ""}`;
};

/** Chords as scale degrees of the tonic (0-based, 7-note scale). */
const CHORDS = { I: [0, 2, 4], IV: [3, 5, 0], V: [4, 6, 1] };

export interface GeneratedScore {
  title: string;
  xml: string;
}

export function generateExercise(id: ExerciseId, voice: VoiceType, keyPc: number): GeneratedScore {
  const ex = EXERCISES.find((e) => e.id === id)!;
  const v = VOICES.find((x) => x.id === voice)!;
  const keyFifths = (ex.mode === "major" ? MAJOR_FIFTHS : MINOR_FIFTHS)[keyPc];
  // Line-of-fifths position of the tonic: a major key's tonic is its signature; a minor tonic is 3 fifths up.
  const tonicPos = keyFifths + (ex.mode === "minor" ? 3 : 0);
  const steps = ex.steps();
  const semis = steps.flatMap((st) => (st.scale === undefined ? [] : [degreeOf(st as Required<Step>).semis]));
  const tonic = tonicFor(voice, keyPc, Math.min(...semis), Math.max(...semis));
  const keyName = spellName(tonicPos);
  const title = `${ex.label} in ${keyName}${ex.mode === "minor" && !/minor/.test(ex.label) ? " minor" : ""} · ${v.label}`;

  // Pack into 4/4 bars; every exercise is written to fill whole bars.
  const bars: Step[][] = [];
  let bar: Step[] = [];
  let used = 0;
  for (const st of steps) {
    bar.push(st);
    used += st.len;
    if (used >= 4) {
      bars.push(bar);
      bar = [];
      used = 0;
    }
  }
  if (bar.length) {
    bar.push(rest(4 - used));
    bars.push(bar);
  }

  const clef =
    voice === "bass"
      ? "<clef><sign>F</sign><line>4</line></clef>"
      : voice === "tenor"
        ? "<clef><sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change></clef>"
        : "<clef><sign>G</sign><line>2</line></clef>";
  const attrs = (clefXml: string) =>
    `<attributes><divisions>2</divisions><key><fifths>${keyFifths}</fifths><mode>${ex.mode}</mode></key>` +
    `<time><beats>4</beats><beat-type>4</beat-type></time>${clefXml}</attributes>`;
  const tempo = `<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${ex.tempo}</per-minute></metronome></direction-type><sound tempo="${ex.tempo}"/></direction>`;

  const voiceXml = bars
    .map((b, i) => {
      const notes = b
        .map((st) => {
          const dur = `<duration>${st.len * 2}</duration><voice>1</voice>${typeXml(st.len)}`;
          if (st.scale === undefined) return `<note><rest/>${dur}</note>`;
          const deg = degreeOf(st as Required<Step>);
          return (
            `<note>${pitchXml(tonic + deg.semis, tonicPos + deg.fifths)}${dur}` +
            `<lyric number="1"><syllabic>single</syllabic><text>${deg.syl}</text></lyric></note>`
          );
        })
        .join("");
      return `<measure number="${i + 1}">${i === 0 ? attrs(clef) + tempo : ""}${notes}</measure>`;
    })
    .join("\n");

  // Piano: a chord per half bar, chosen to fit the melody; root in the bass.
  const scaleForChords = ex.mode === "major" ? MAJOR : HARM_MINOR;
  const pianoXml = bars
    .map((b, i) => {
      const halves: (keyof typeof CHORDS | null)[] = [0, 1].map((h) => (ex.drone ? "I" : chooseChord(b, h, scaleForChords)));
      // Hold the previous chord through a rest; merge equal halves.
      if (halves[0] === null) halves[0] = halves[1] ?? "I";
      if (halves[1] === null) halves[1] = halves[0];
      const parts = halves[0] === halves[1] ? [[halves[0]!, 4] as const] : halves.map((c) => [c!, 2] as const);
      const notes = parts
        .map(([name, len]) => {
          const degs = CHORDS[name];
          const root = scaleForChords[degs[0]];
          const rootMidi = 36 + ((((keyPc + root.semis) % 12) + 12) % 12); // C2–B2
          const tones = [
            { midi: rootMidi, pos: tonicPos + root.fifths },
            ...degs.map((g) => {
              const dg = scaleForChords[g];
              let m = 48 + ((((keyPc + dg.semis) % 12) + 12) % 12); // close position from C3
              if (m < rootMidi + 12) m += 12;
              return { midi: m, pos: tonicPos + dg.fifths };
            }),
          ].sort((a, b) => a.midi - b.midi);
          return tones
            .map(
              (t, k) =>
                `<note>${k ? "<chord/>" : ""}${pitchXml(t.midi, t.pos)}<duration>${len * 2}</duration><voice>1</voice>${typeXml(len)}</note>`,
            )
            .join("");
        })
        .join("");
      return `<measure number="${i + 1}">${i === 0 ? attrs("<clef><sign>F</sign><line>4</line></clef>") : ""}${notes}</measure>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
<work><work-title>${title}</work-title></work>
<part-list>
<score-part id="P1"><part-name>${v.label}</part-name></score-part>
<score-part id="P2"><part-name>Piano</part-name></score-part>
</part-list>
<part id="P1">
${voiceXml}
</part>
<part id="P2">
${pianoXml}
</part>
</score-partwise>`;
  return { title, xml };
}

/** The chord (I, IV or V) that contains most of the melody in half `h` of the bar, by length. */
function chooseChord(bar: Step[], h: number, sc: Degree[]): keyof typeof CHORDS | null {
  const weight = { I: 0, IV: 0, V: 0 };
  let t = 0;
  let any = false;
  for (const st of bar) {
    const from = Math.max(t, h * 2);
    const to = Math.min(t + st.len, h * 2 + 2);
    if (to > from && st.scale !== undefined) {
      any = true;
      const pc = ((degreeOf(st as Required<Step>).semis % 12) + 12) % 12;
      for (const [name, degs] of Object.entries(CHORDS) as [keyof typeof CHORDS, number[]][])
        if (degs.some((g) => sc[g].semis % 12 === pc)) weight[name] += to - from;
    }
    t += st.len;
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
