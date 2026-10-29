import { OpenSheetMusicDisplay, type Note } from "opensheetmusicdisplay";

/** All positions in the app are measured in quarter-note beats from the start of the piece. */
export interface NoteEvent {
  id: number;
  trackKey: string;
  midi: number;
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

  private cursorBeats: number[] = [];
  private cursorIndex = 0;

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
    this.render();
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
  colorEvent(ev: NoteEvent, color: string | null): void {
    for (const note of ev.notes) {
      const g = this.osmd.EngravingRules.GNote(note) as unknown as { getSVGGElement?: () => SVGGElement } | undefined;
      const el = g?.getSVGGElement?.();
      if (!el) continue;
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
              const ev: NoteEvent = {
                id: nextId++,
                trackKey: key,
                midi,
                start,
                end: start + len,
                measureIndex,
                notes: [note],
              };
              track.events.push(ev);
              track.minMidi = Math.min(track.minMidi, midi);
              track.maxMidi = Math.max(track.maxMidi, midi);
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
