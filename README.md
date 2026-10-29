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
- **Count-in** gives one bar of clicks before playback starts; **Starting note** plays your first note during the count-in.
- **Microphone** (M) turns on pitch detection. The readout next to it works as a tuner even when nothing is playing.

Keyboard: `Space` plays or stops, `L` toggles looping, `M` turns the microphone on or off.

### Reading the pitch graph

The bars are the written notes of your part, and the shaded band around each bar shows the tolerance. The line is your voice:

- green: within tolerance (±25 cents by default)
- amber: within twice the tolerance
- red: further off
- grey: the previous pass of a loop, for comparison

Once a note has been sung, it is marked with its median deviation (e.g. `−12¢`) and its notehead in the score takes the same colour. Hover over a note to see details. The line above the graph summarises the selected bars, including whether you tend to sing sharp or flat.

### Settings

- **Tolerance**: ±10 to ±50 cents.
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
| `src/analysis.ts` | Scores each note: median deviation in cents, share of the note in tune, coverage. |
| `src/roll.ts` | The pitch graph (canvas). |
| `src/main.ts` | UI wiring and state. |

All positions are measured in quarter-note beats, so the graph does not change when you change the tempo.

`npm run sample` regenerates `public/samples/chorale.musicxml` from `scripts/make-sample.mjs`.

## Known limitations

- Repeats and voltas are played straight through, not expanded.
- Tempo changes take effect at bar boundaries only.
- Transposing instruments are played at written pitch.
- Playback uses a simple synthesised tone, not recorded samples.
