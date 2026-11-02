import { OpenSheetMusicDisplay, type Note } from "opensheetmusicdisplay";

/** All positions in the app are measured in quarter-note beats from the start of the piece. */
export interface NoteEvent {
  id: number;
  trackKey: string;
  /** Pitch to play and to sing (see `Score.setIgnoreOctaveShifts`). */
  midi: number;
  /** Semitones an 8va/8vb/15ma/15mb mark adds to the written note (0 outside such marks). */
  octaveShift: number;
  start: number;
  end: number;
  measureIndex: number;
  /** The OSMD notes that make up this event (several when tied). */
  notes: Note[];
}

export interface Track {
  key: string;
  label: string;
  events: NoteEvent[];
  minMidi: number;
  maxMidi: number;
}

export interface Measure {
  index: number;
  number: number;
  start: number;
  end: number;
  /** Seconds from the start of the piece at notated tempo. */
  startSec: number;
  bpm: number;
  beatsPerBar: number;
  /** Length of one counted beat, in quarters (e.g. 0.5 in 6/8). */
  beatLength: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const UNIT_PX = 10; // OSMD units → px at zoom 1

export class Score {
  readonly osmd: OpenSheetMusicDisplay;
  title = "";
  tracks: Track[] = [];
  measures: Measure[] = [];
  totalBeats = 0;
  /** Identifies the piece by its notes, independent of file name or format. */
  fingerprint = "";

  private ignoreOctaveShifts = false;
  /** Each event's pitch as notated, including any 8va/8vb shift. */
  private sounding = new Map<NoteEvent, number>();

  private cursorBeats: number[] = [];
  private cursorIndex = 0;
  /** Notehead centres in OSMD units, one per rendered note (chord notes separately). */
  private heads: { x: number; y: number; ev: NoteEvent }[] = [];

  constructor(private container: HTMLElement) {
    this.osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false,
      backend: "svg",
      drawTitle: true,
      drawComposer: true,
      drawPartNames: true,
      followCursor: true,
      cursorsOptions: [{ type: 0, color: "#2f6fde", alpha: 0.3, follow: true }],
    });
  }

  async load(content: string | Blob): Promise<void> {
    await this.osmd.load(content);
    this.title = this.osmd.Sheet.TitleString || "Untitled";
    this.extractMeasures();
    this.extractTracks();
    // Fingerprint the pitches as notated, so the history doesn't depend on the 8va setting.
    this.fingerprint = fingerprint(this.title, this.tracks);
    this.applyOctaveShifts();
    this.render();
  }

  /**
   * With `ignore`, notes under 8va/8vb (15ma/15mb) marks sound as written, without the shift. Useful
   * when a mark is only there for readability or is an error in the score.
   */
  setIgnoreOctaveShifts(ignore: boolean): void {
    if (ignore === this.ignoreOctaveShifts) return;
    this.ignoreOctaveShifts = ignore;
    this.applyOctaveShifts();
  }

  /** Whether the loaded score contains any 8va/8vb marks. */
  get hasOctaveShifts(): boolean {
    return this.tracks.some((t) => t.events.some((ev) => ev.octaveShift));
  }

  private applyOctaveShifts(): void {
    for (const t of this.tracks) {
      t.minMidi = 127;
      t.maxMidi = 0;
      for (const ev of t.events) {
        // The notated pitch includes the shift; keep the original in `sounding`.
        ev.midi = this.sounding.get(ev)! - (this.ignoreOctaveShifts ? ev.octaveShift : 0);
        t.minMidi = Math.min(t.minMidi, ev.midi);
        t.maxMidi = Math.max(t.maxMidi, ev.midi);
      }
    }
  }

  /** (Re-)lays out the score. Any notehead colouring must be re-applied afterwards. */
  render(): void {
    this.osmd.render();
    this.osmd.cursor.show();
    this.cursorBeats = [];
    this.osmd.cursor.reset(); // creates a fresh iterator
    const it = this.osmd.cursor.Iterator;
    while (!it.EndReached) {
      this.cursorBeats.push(it.currentTimeStamp.RealValue * 4);
      it.moveToNext();
    }
    this.osmd.cursor.reset();
    this.cursorIndex = 0;

    this.heads = [];
    for (const t of this.tracks)
      for (const ev of t.events)
        for (const note of ev.notes) {
          const pos = this.osmd.EngravingRules.GNote(note)?.PositionAndShape?.AbsolutePosition;
          if (pos) this.heads.push({ x: pos.x, y: pos.y, ev });
        }
  }

  /**
   * The note whose head is nearest to a point on screen. Hit-testing by position rather than by
   * SVG element also works inside hollow noteheads and for each note of a chord, which share one element.
   */
  eventAtPoint(clientX: number, clientY: number): NoteEvent | null {
    const svg = this.container.querySelector("svg");
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    const scale = UNIT_PX * this.osmd.zoom;
    const x = (clientX - r.left) / scale;
    const y = (clientY - r.top) / scale;
    let best: NoteEvent | null = null;
    let bestDist = Infinity;
    for (const h of this.heads) {
      const dx = Math.abs(h.x - x);
      const dy = Math.abs(h.y - y);
      // A notehead is about 1.2 units wide and 1 unit high; allow a little slack around it.
      if (dx > 1.2 || dy > 0.9) continue;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = h.ev;
      }
    }
    return best;
  }

  trackOf(ev: NoteEvent): Track | undefined {
    return this.tracks.find((t) => t.key === ev.trackKey);
  }

  // --- time ---------------------------------------------------------------

  beatToSec(beat: number): number {
    const m = this.measureAt(beat);
    return m.startSec + ((beat - m.start) * 60) / m.bpm;
  }

  secToBeat(sec: number): number {
    let m = this.measures[0];
    for (const mm of this.measures) {
      if (mm.startSec > sec) break;
      m = mm;
    }
    return m.start + ((sec - m.startSec) * m.bpm) / 60;
  }

  measureAt(beat: number): Measure {
    let m = this.measures[0];
    for (const mm of this.measures) {
      if (mm.start > beat + 1e-9) break;
      m = mm;
    }
    return m;
  }

  // --- cursor -------------------------------------------------------------

  setCursorBeat(beat: number): void {
    let target = 0;
    while (target + 1 < this.cursorBeats.length && this.cursorBeats[target + 1] <= beat + 1e-6) target++;
    if (target === this.cursorIndex) return;
    const cursor = this.osmd.cursor;
    if (target < this.cursorIndex) {
      cursor.reset();
      this.cursorIndex = 0;
    }
    while (this.cursorIndex < target) {
      cursor.Iterator.moveToNext();
      this.cursorIndex++;
    }
    cursor.update();
  }

  // --- geometry -----------------------------------------------------------

  /** Bounding boxes of every measure (spanning all staves), relative to the container. */
  measureBoxes(): Box[] {
    const svg = this.container.querySelector("svg");
    if (!svg) return [];
    const base = this.container.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const ox = svgRect.left - base.left + this.container.scrollLeft;
    const oy = svgRect.top - base.top + this.container.scrollTop;
    const scale = UNIT_PX * this.osmd.zoom;
    return this.osmd.GraphicSheet.MeasureList.map((staves) => {
      const ms = staves.filter(Boolean);
      if (!ms.length) return { x: 0, y: 0, w: 0, h: 0 };
      const first = ms[0].PositionAndShape;
      const last = ms[ms.length - 1].PositionAndShape;
      // Staff lines span 4 units below a staff's origin; this keeps boxes in one system aligned.
      const top = first.AbsolutePosition.y - 1;
      const bottom = last.AbsolutePosition.y + 5;
      return {
        x: ox + first.AbsolutePosition.x * scale,
        y: oy + top * scale,
        w: first.Size.width * scale,
        h: (bottom - top) * scale,
      };
    });
  }

  /** Colours the noteheads of an event; null restores the engraved colour. */
  private noteElements(ev: NoteEvent): SVGGElement[] {
    const els: SVGGElement[] = [];
    for (const note of ev.notes) {
      const g = this.osmd.EngravingRules.GNote(note) as unknown as { getSVGGElement?: () => SVGGElement } | undefined;
      const el = g?.getSVGGElement?.();
      if (el) els.push(el);
    }
    return els;
  }

  colorEvent(ev: NoteEvent, color: string | null): void {
    for (const el of this.noteElements(ev)) {
      const heads = el.querySelectorAll<SVGElement>(".vf-notehead path, .vf-notehead");
      const targets = heads.length ? heads : el.querySelectorAll<SVGElement>("path");
      targets.forEach((p) => {
        if (color) p.setAttribute("fill", color);
        else p.removeAttribute("fill");
      });
    }
  }

  // --- extraction ---------------------------------------------------------

  private extractMeasures(): void {
    const sheet = this.osmd.Sheet;
    let bpm = sheet.DefaultStartTempoInBpm || 100;
    let sec = 0;
    this.measures = sheet.SourceMeasures.map((sm, index) => {
      if (sm.TempoInBPM > 0) bpm = sm.TempoInBPM;
      const start = sm.AbsoluteTimestamp.RealValue * 4;
      const len = sm.Duration.RealValue * 4;
      const ts = sm.ActiveTimeSignature;
      const denom = ts?.Denominator || 4;
      // Compound meters (6/8, 9/8, 12/8) are counted in dotted beats.
      const compound = denom === 8 && ts.Numerator % 3 === 0 && ts.Numerator > 3;
      const beatLength = compound ? 1.5 : 4 / denom;
      const m: Measure = {
        index,
        number: sm.MeasureNumber,
        start,
        end: start + len,
        startSec: sec,
        bpm,
        beatsPerBar: Math.max(1, Math.round(len / beatLength)),
        beatLength,
      };
      sec += (len * 60) / bpm;
      return m;
    });
    const last = this.measures[this.measures.length - 1];
    this.totalBeats = last ? last.end : 0;
  }

  private extractTracks(): void {
    const byKey = new Map<string, Track>();
    const eventOf = new Map<Note, NoteEvent>();
    let nextId = 0;
    const instruments = this.osmd.Sheet.Instruments;
    const staves = this.osmd.Sheet.Staves;
    this.sounding = new Map();

    // 8va/8vb ranges per staff. MusicXML pitches already include the shift; OSMD only uses it for drawing.
    const shifts: { staff: number; from: number; to: number; semitones: number }[] = [];
    for (const sm of this.osmd.Sheet.SourceMeasures) {
      sm.StaffLinkedExpressions.forEach((list, staff) => {
        for (const me of list) {
          const os = me.OctaveShiftStart;
          if (!os) continue;
          const end = os.ParentEndMultiExpression;
          // OctaveEnum: VA8, VB8, MA15, MB15, NONE
          const semitones = [12, -12, 24, -24, 0][os.Type] ?? 0;
          shifts.push({ staff, from: me.AbsoluteTimestamp.RealValue * 4, to: end ? end.AbsoluteTimestamp.RealValue * 4 : Infinity, semitones });
        }
      });
    }

    this.osmd.Sheet.SourceMeasures.forEach((sm, measureIndex) => {
      const mStart = sm.AbsoluteTimestamp.RealValue * 4;
      for (const container of sm.VerticalSourceStaffEntryContainers) {
        for (const se of container.StaffEntries) {
          if (!se) continue;
          for (const ve of se.VoiceEntries) {
            if (ve.IsGrace) continue;
            const start = mStart + ve.Timestamp.RealValue * 4;
            for (const note of ve.Notes) {
              if (note.isRest() || !note.Pitch) continue;
              const len = note.Length.RealValue * 4;
              const tie = note.NoteTie;
              if (tie && tie.StartNote && tie.StartNote !== note) {
                const startEv = eventOf.get(tie.StartNote);
                if (startEv) {
                  startEv.end = Math.max(startEv.end, start + len);
                  startEv.notes.push(note);
                  eventOf.set(note, startEv);
                  continue;
                }
              }
              const voice = ve.ParentVoice;
              const instrument = voice.Parent;
              const instIndex = instruments.indexOf(instrument);
              const key = `${instIndex}:${voice.VoiceId}`;
              let track = byKey.get(key);
              if (!track) {
                track = { key, label: "", events: [], minMidi: 127, maxMidi: 0 };
                byKey.set(key, track);
              }
              const midi = Math.round(69 + 12 * Math.log2(note.Pitch.Frequency / 440));
              const staff = staves.indexOf(se.ParentStaff);
              const shift = shifts.find((r) => r.staff === staff && start >= r.from - 1e-6 && start < r.to - 1e-6);
              const ev: NoteEvent = {
                id: nextId++,
                trackKey: key,
                midi,
                octaveShift: shift?.semitones ?? 0,
                start,
                end: start + len,
                measureIndex,
                notes: [note],
              };
              track.events.push(ev);
              track.minMidi = Math.min(track.minMidi, midi);
              track.maxMidi = Math.max(track.maxMidi, midi);
              this.sounding.set(ev, midi);
              eventOf.set(note, ev);
            }
          }
        }
      }
    });

    const tracks = [...byKey.values()];
    // Label: instrument name, plus voice number when an instrument carries several voices.
    const perInstrument = new Map<string, number>();
    for (const t of tracks) {
      const inst = t.key.split(":")[0];
      perInstrument.set(inst, (perInstrument.get(inst) ?? 0) + 1);
    }
    for (const t of tracks) {
      const [inst, voiceId] = t.key.split(":");
      const name = instruments[+inst]?.Name?.trim() || `Part ${+inst + 1}`;
      t.label = (perInstrument.get(inst) ?? 0) > 1 ? `${name} · voice ${voiceId}` : name;
      t.events.sort((a, b) => a.start - b.start || b.midi - a.midi);
    }
    tracks.sort((a, b) => {
      const [ia, va] = a.key.split(":").map(Number);
      const [ib, vb] = b.key.split(":").map(Number);
      return ia - ib || va - vb;
    });
    this.tracks = tracks;
  }
}

function fingerprint(title: string, tracks: Track[]): string {
  // FNV-1a over the title and every note, so a re-exported file of the same piece keeps its history.
  let h = 0x811c9dc5;
  const add = (str: string) => {
    for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 0x01000193);
  };
  add(title);
  for (const t of tracks) for (const ev of t.events) add(`${t.key}|${ev.midi}|${ev.start}|${ev.end};`);
  return (h >>> 0).toString(36);
}
