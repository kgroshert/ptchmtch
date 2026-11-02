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
- **Play / Pause** (Space): Play continues from where you paused, at the start of that beat, and the run or loop statistics carry on. **⏮** (Home) jumps back to the start of the selection without starting or stopping playback. Changing the part or the bars also starts over from the beginning.
- **Your part** lists every part, and every voice within a part, that contains notes. The selected part is coloured blue in the score.
- **Your part in playback**: *Loud* to learn the notes, *Normal* to sing with it, *Muted* to test yourself. **Other parts** sets the volume of the accompaniment.
- **Tempo** slows the playback down (or speeds it up) without changing pitch.
- **Bars**: click a bar in the score to practise only that bar, and shift-click to extend the selection. You can also drag across the bar numbers above the pitch graph, or type bar numbers. **Loop** repeats the selection.
- **Loop** is off whenever you open the app.
- **Hide graph while playing** (G) gives the score the whole window during playback. The graph comes back when playback ends or you pause.
- **Count-in** gives one bar of clicks before playback starts; **Starting note** plays your first note during the count-in.
- **Microphone** (M) turns on pitch detection. The readout next to it works as a tuner even when nothing is playing.

Keyboard: `Space` plays or pauses, `Home` jumps back to the start, `L` toggles looping, `M` turns the microphone on or off, `G` toggles hiding the graph.

### Pitch trainer

Double-click a note in the score (any part) or in the pitch graph to practise that one note. The trainer shows:

- your pitch against the target over the last 8 seconds, with the tolerance band
- a live cents readout ("In tune", "A little flat", …)
- how long you've held the note in tune, your longest hold, and the share in tune over the last 5 seconds

**Play note** (Space) sounds the target note continuously. **Previous** and **Next** (← →) step through the notes of the part. The trainer turns the microphone on if it's off.

### Vibrato

Every note held for at least 0.6 s is checked for vibrato. Its rate (Hz), width (± cents) and regularity (how evenly it repeats) are measured, and the note is classed as:

| Class | What it means |
| --- | --- |
| even vibrato | about 5–7.5 Hz, up to about ±110¢: the healthy range in singing research (Seashore, Sundberg, Prame) |
| wobble | slower than about 4.8 Hz or wider than about ±110¢; typical of tired or ageing voices and too much pressure |
| fast vibrato (bleat) | faster than about 7.5 Hz |
| straight tone | less than ±15¢ of movement |
| unsteady pitch | moving, but without a regular oscillation |

On notes with vibrato, tolerance and onsets are judged on the **centre** of the vibrato (averaged over one cycle), since that's the pitch listeners hear. Short notes borrow the vibrato rate of the singer's recent notes. Hover over a note in the graph to see its vibrato. The note trainer shows your vibrato live, and judges "held in tune" on its centre.

### Precision across loop passes

When you loop a section, each note's pitch is compared across passes. **Precision** is how consistently a note comes out the same each time. That's a different skill from **accuracy**, how close it is on average (Pfordresher et al., 2010). The summary shows the spread between passes, and hovering over a note lists its deviation in each pass.

### History

**History** has three tabs. Each one has a chart where you can pick the metric, plus a table. Charts with a typical healthy range show it as a shaded band.

- **Run-throughs**: each time you sing the whole piece to the end with the microphone on. Metrics: score (0–100), notes in tune, mean deviation, clean onsets, vibrato rate, width and regularity, and the share of notes with a wobble. A message after each run compares it with the last one.
- **Loop practice**: recorded when you stop after at least three passes of a loop. Metrics: accuracy of your best pass (average deviation; passes with fewer than 80% of the notes sung don't count) and spread between passes (precision). The message compares it with your last session on the same bars.
- **Long notes**: every note practised in the trainer for at least 2 seconds of singing, across all pieces. Metrics: share in tune, longest hold, mean deviation and vibrato.

Each note in a run scores up to 100 points:

- 50% for how close its median pitch is (0¢ gives full points, 100¢ or more gives none)
- 30% for the share of the note held within tolerance
- 20% for a clean entry (half for a slide, none if it never settled)

Notes you didn't sing count as 0. Runs where less than 30% of the notes were sung aren't recorded. History is kept in this browser's local storage, so it survives reloads but not clearing site data, and it isn't shared between browsers or computers.

### Settings

- **Tolerance**: ±10 to ±50 cents.
- **Clean onset**: how quickly a note must be on pitch to count as hit cleanly (60–250 ms).
- **Ignore octave**: counts singing in another octave as correct, e.g. a tenor part sung an octave up.
- **Latency correction**: lines up your pitch line with the notes. Use **Calibrate…** to measure it (see below), or adjust it by hand if your line always looks a little late or early.
- **Microphone**: choose the input device.

Use headphones. With speakers, the microphone also picks up the playback.

### Latency calibration

Between a note being played and your voice reaching the app there are several delays: the headphones (often 150–250 ms with Bluetooth), your own timing, and the microphone. **Settings → Calibrate…** measures them all together:

1. You hear four clicks, then 16 short notes.
2. Say a short **"ba"** on each note, at any pitch, as you would when singing along.
3. The app finds the start of each "ba" in the raw microphone signal (to about 1 ms), ignores the first two, and takes the median delay.
4. It shows the result and how consistent you were. **Apply** sets the latency correction.

Calibrate again whenever you change headphones or microphone.

## How it works

| File | Role |
| --- | --- |
| `src/score.ts` | Renders the score with [OpenSheetMusicDisplay](https://opensheetmusicdisplay.org/) and reads parts, voices, notes (ties merged), bars and tempo from its model. Also handles the cursor, bar geometry and notehead colouring. |
| `src/player.ts` | Web Audio scheduler and a simple built-in synth. Handles per-part volume, count-in, metronome and looping. Maps audio time to score position. |
| `src/pitch.ts` | Microphone input with the McLeod pitch method ([pitchy](https://github.com/ianprime0509/pitchy)), with browser voice processing turned off. |
| `src/analysis.ts` | Scores each note (median deviation, share in tune, coverage, onset, vibrato) and computes precision across passes. |
| `src/roll.ts` | The pitch graph (canvas). |
| `src/trainer.ts` | Single-note pitch trainer. |
| `src/calibration.ts` | Latency calibration: plays the beats, detects syllable onsets, computes the correction. |
| `src/vibrato.ts` | Vibrato rate, width, regularity and classification; vibrato centre line. |
| `src/history.ts` | Stores runs, loop sessions and trainer sessions in local storage; charts and tables. |
| `src/main.ts` | UI wiring and state. |

All positions are measured in quarter-note beats, so the graph does not change when you change the tempo.

`npm run sample` regenerates `public/samples/chorale.musicxml` from `scripts/make-sample.mjs`.

## Known limitations

- Repeats and voltas are played straight through, not expanded.
- Tempo changes take effect at bar boundaries only.
- Transposing instruments are played at written pitch.
- Playback uses a simple synthesised tone, not recorded samples.
