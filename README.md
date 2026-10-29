# ptchmtch

A practice tool for singers. Load a MusicXML score, pick your part, sing along with the other parts, and see how close your pitch is to what is written.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge, Firefox or Safari. The browser only allows microphone access on `localhost` or over HTTPS.

## Using it

- **Open score…** (or drag a file onto the score area) loads `.musicxml`, `.xml` or compressed `.mxl`. **Load sample** opens a short SATB chorale.
- **Your part** lists every part, and every voice within a part, that contains notes. The selected part is coloured blue in the score.
- **Your part in playback**: *Loud* to learn the notes, *Normal* to sing with it, *Muted* to test yourself. **Other parts** sets the volume of the accompaniment.
- **Tempo** slows the playback down (or speeds it up) without changing pitch.
- **Bars**: click a bar in the score to practise only that bar, and shift-click to extend the selection. You can also drag across the bar numbers above the pitch graph, or type bar numbers. **Loop** repeats the selection.
- **Loop** is off whenever you open the app.
- **Hide graph while playing** (G) gives the score the whole window during playback. The graph comes back when playback ends or you press Stop.
- **Count-in** gives one bar of clicks before playback starts; **Starting note** plays your first note during the count-in.
- **Microphone** (M) turns on pitch detection. The readout next to it works as a tuner even when nothing is playing.

Keyboard: `Space` plays or stops, `L` toggles looping, `M` turns the microphone on or off, `G` toggles hiding the graph.

### Pitch trainer

Double-click a note in the score (any part) or in the pitch graph to practise that one note. The trainer shows:

- your pitch against the target over the last 8 seconds, with the tolerance band
- a live cents readout ("In tune", "A little flat", …)
- how long you've held the note in tune, your longest hold, and the share in tune over the last 5 seconds

**Play note** (Space) sounds the target note continuously. **Previous** and **Next** (← →) step through the notes of the part. The trainer turns the microphone on if it's off.

### History

Each time you sing the whole piece to the end with the microphone on, the run is scored from 0 to 100 and saved. A message shows the score compared with your last run. **History** shows a chart and a table of all runs for the selected part: score, notes in tune, mean deviation, sharp/flat tendency, clean onsets and tempo.

Each note scores up to 100 points:

- 50% for how close its median pitch is (0¢ gives full points, 100¢ or more gives none)
- 30% for the share of the note held within tolerance
- 20% for a clean entry (half for a slide, none if it never settled)

Notes you didn't sing count as 0. Runs where less than 30% of the notes were sung aren't recorded. History is kept per piece and part in this browser's local storage, so it survives reloads but not clearing site data, and it isn't shared between browsers or computers.

### Reading the pitch graph

The bars are the written notes of your part, and the shaded band around each bar shows the tolerance. The line is your voice:

- green: within tolerance (±25 cents by default)
- amber: within twice the tolerance
- red: further off
- grey: the previous pass of a loop, for comparison

Once a note has been sung, it is marked with its median deviation (e.g. `−12¢`) and its notehead in the score takes the same colour. Hover over a note to see details.

The pitch score of a note ignores its first moments, so how you *enter* a note is measured separately:

- **Clean**: on pitch straight away. The note's pitch holds within tolerance within the onset window (100 ms by default).
- **Slid up from below / came down from above**: it took longer than the onset window to reach the pitch. A small amber ramp marks these notes in the graph.
- **Never settled**: the pitch never held steady within tolerance.

Hover over a note to see its deviation, where it started (e.g. `started at −140¢`) and how long it took to reach the pitch.

Above the graph, two lines summarise the selected bars. The first covers pitch: notes within tolerance, mean deviation, and whether you tend to sing sharp or flat. The second covers onsets: the share of notes hit cleanly, the number of slides from below and from above, and how long slides take to settle on average.

### Settings

- **Tolerance**: ±10 to ±50 cents.
- **Clean onset**: how quickly a note must be on pitch to count as hit cleanly (60–250 ms).
- **Ignore octave**: counts singing in another octave as correct, e.g. a tenor part sung an octave up.
- **Latency correction**: if your line always looks a little late (or early) compared to the notes, adjust this.
- **Microphone**: choose the input device.

Use headphones. With speakers, the microphone also picks up the playback.

## How it works

| File | Role |
| --- | --- |
| `src/score.ts` | Renders the score with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) and reads parts, voices, notes (ties merged), bars and tempo from its model. Also handles the cursor, bar geometry and notehead colouring. |
| `src/player.ts` | Web Audio scheduler and a simple built-in synth. Handles per-part volume, count-in, metronome and looping. Maps audio time to score position. |
| `src/pitch.ts` | Microphone input with the McLeod pitch method ([pitchy](https://github.com/ianprime0509/pitchy)), with browser voice processing turned off. |
| `src/analysis.ts` | Scores each note: median deviation in cents, share of the note in tune, coverage, and how the note was entered (clean, slide, unsettled). |
| `src/roll.ts` | The pitch graph (canvas). |
| `src/trainer.ts` | Single-note pitch trainer. |
| `src/history.ts` | Stores runs in local storage and draws the history chart and table. |
| `src/main.ts` | UI wiring and state. |

All positions are measured in quarter-note beats, so the graph does not change when you change the tempo.

`npm run sample` regenerates `public/samples/chorale.musicxml` from `scripts/make-sample.mjs`.

## Known limitations

- Repeats and voltas are played straight through, not expanded.
- Tempo changes take effect at bar boundaries only.
- Transposing instruments are played at written pitch.
- Playback uses a simple synthesised tone, not recorded samples.
