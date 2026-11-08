# ptchmtch

A practice tool for singers. Load a MusicXML score, pick your part, sing along with the other parts, and see how close your pitch is to what is written.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge, Firefox or Safari. The browser only allows microphone access on `localhost` or over HTTPS.

## Using it

- **Open score…** (or drag a file onto the score area) loads `.musicxml`, `.xml` or compressed `.mxl`. **Practice scores ▾** generates an exercise for your voice type (soprano, alto, tenor or bass) in any key:
  - *Scales*: major, natural minor, harmonic minor and chromatic, one octave up and down.
  - *Warm-ups*: the five-note scale (1-2-3-4-5-4-3-2-1) and arpeggios (1-3-5-8-5-3-1), major and minor, each sung twice.
  - *Pieces*: a short SATB chorale.

  The notes are placed in the comfortable middle of the voice's range. Each exercise has movable-do solfège under the notes (minor is la-based: la ti do re mi fa sol, with si for the raised 7th; the chromatic scale uses di ri fi si li going up and te le se me ra going down) and a piano part with simple I, IV and V chords (a held tonic chord under the chromatic scale). Turn the piano down with **Other parts**, or hide it from the score with **Only my part**. Each exercise, voice and key keeps its own history.
- **Play / Pause** (Space): Play continues from where you paused, at the start of that beat, and the run or loop statistics carry on. **⏮** (Home) jumps back to the start of the selection without starting or stopping playback. Changing the part or the bars also starts over from the beginning.
- **Your part** lists every part, and every voice within a part, that contains notes. The selected part is coloured blue in the score.
- **Your part in playback**: *Loud* to learn the notes, *Normal* to sing with it, *Muted* to test yourself. **Other parts** sets the volume of the accompaniment.
- **Tempo** slows the playback down (or speeds it up) without changing pitch.
- **Bars**: type the first and last bar to practise, or drag across the bar numbers above the pitch graph. **All** selects the whole piece. Clicking in the score doesn't change the selection, so double-clicking a note only opens the trainer. **Loop** repeats the selection.
- **Loop** is off whenever you open the app.
- **Only my part** hides the other parts' staves in the score, for more room. For a voice inside a piano part, only the staff it is written on is kept.
- **Pitch graph**: drag the handle between the score and the graph to make the graph taller (double-click it to reset). **↕ Fit** fits the pitch axis to the notes in view, for taller rows and thicker lines; switch it off to see the part's whole range. The mouse wheel scrolls in time and ⌘/Ctrl + wheel zooms in time. To zoom the pitch axis, use the wheel over the note names, or ⌥/Alt + wheel anywhere; drag the note names to move up or down, and double-click them to reset.
- **Hide graph while playing** (G) gives the score the whole window during playback. The graph comes back when playback ends or you pause.
- **Count-in** gives one bar of clicks before playback starts; **Starting note** plays your first note during the count-in.
- **Microphone** (M) turns on pitch detection. The readout next to it works as a tuner even when nothing is playing.

Keyboard: `Space` plays or pauses, `Home` jumps back to the start, `L` toggles looping, `M` turns the microphone on or off, `G` toggles hiding the graph.

### Pitch trainer

Double-click a note in the score (any part) or in the pitch graph to practise that one note. The trainer opens across the full window and shows:

- your pitch against the target over about 60 seconds, with the tolerance band (the line fills from the left, then scrolls)
- a live cents readout ("In tune", "A little flat", …)
- how long you've held the note in tune, your longest hold, and the share in tune over the last 5 seconds

**Stop** (Enter) stops listening, freezes the graph and shows the take's results on the left: share in tune, mean deviation, whether you were flat or sharp on average, steadiness (spread around your own average), longest hold, time sung and vibrato. **Start** clears the graph for a new take. **Play note** (Space) sounds the target note continuously. **Previous** and **Next** (← →) step through the notes of the part. The trainer turns the microphone on if it's off.

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

- **Run-throughs**: each time you sing the whole piece to the end with the microphone on. Metrics: score (0–100), share in tune (by note length), mean deviation, clean onsets, vibrato rate, width and regularity, and the share of notes with a wobble. A message after each run compares it with the last one.
- **Loop practice**: recorded when you stop after at least three passes of a loop. Metrics: accuracy of your best pass (average deviation; passes with fewer than 80% of the notes sung don't count) and spread between passes (precision). The message compares it with your last session on the same bars.
- **Long notes**: every note practised in the trainer for at least 2 seconds of singing, across all pieces. Metrics: share in tune, longest hold, mean deviation and vibrato.

Each note in a run scores up to 100 points:

- 50% for how close its median pitch is (0¢ gives full points, 100¢ or more gives none)
- 30% for the share of the note held within tolerance
- 20% for a clean entry (half for a slide, none if it never settled)

The run score weighs each note by its length, so a whole note counts as much as four quarter notes. The same goes for the share in tune, the mean deviation, and loop accuracy and spread. Onsets and vibrato are counted per note. Notes you didn't sing count as 0. Runs where less than 30% of the notes were sung aren't recorded. History is kept in this browser's local storage, so it survives reloads but not clearing site data, and it isn't shared between browsers or computers.

### Recording on the pitch graph

**Load recording…** (above the pitch graph) shows the pitch of an audio file (mp3, m4a, wav and so on), such as a singer's version of your part, on the graph instead of your own takes:

- The pitch is found with the same method as for the microphone. A solo voice works best; with accompaniment, only the loudest line is followed.
- **Auto-align** finds where the score starts in the file, the recording's tempo relative to the notated tempo, and its key. The line is folded into your part's octave, so a different voice type still lines up. **Starts at**, **Tempo** and **Transpose** fine-tune the result. Alignment assumes a steady tempo; if the singer takes a lot of liberties, adjust **Starts at** for the passage you're practising.
- **Clear** removes it and brings your takes back.


When several bars are selected, the summary above the pitch graph ends with **Practise:** and up to four bars or ranges that need the most work, most points lost first. A bar counts as weak when its length-weighted note score is below 60 and below the median bar of the selection; weak neighbours are grouped into ranges of up to four bars. Click one to select it with Loop on, then press Play. All suggestions then move to the **Practise** list on the right, so they stay at hand while you practise one of them. Each entry shows its score when it was listed and, once you've sung it again, its current score. **All bars** returns to the whole piece; **×** closes the list. The list is kept per piece and part.

### Take diagnosis

When a result looks wrong, **Diagnose** (above the pitch graph) checks the last take of the selected bars:

- **Timing**: shifts your pitch line up to ±400 ms against the score and finds where it fits best. If a shift helps a lot, you sang consistently early or late, or the latency setting is off, and it suggests a latency correction.
- **Octave**: lists notes sung, or detected, about an octave away from the target, and shows the mean deviation without them.
- **Typical deviation**: compares the median with the mean, so you can tell whether a few far-off notes pull the result down.
- **Furthest off**: the notes with the largest deviation, with what was sung, the onset and the note length.

**Export take…** saves the take (notes, results, settings and every pitch sample) as a JSON file, for example to report a scoring problem.

### Settings

- **Tolerance**: ±10 to ±50 cents.
- **Clean onset**: how quickly a note must be on pitch to count as hit cleanly (60–250 ms).
- **Ignore octave**: counts singing in another octave as correct, e.g. a tenor part sung an octave up.
- **Ignore 8va / 8vb marks**: plays and scores notes under octave marks as written, without the octave shift. Use it when a mark is only there for readability, or is a mistake in the score. History is unaffected.
- **Latency correction**: lines up your pitch line with the notes. Use **Calibrate…** to measure it (see below), or adjust it by hand if your line always looks a little late or early.
- **Microphone**: choose the input device.
- **Pitch detection → Change…**: choose how pitch is detected (see below).

Use headphones. With speakers, the microphone also picks up the playback.

### Pitch detection

Four methods are available. While the dialog is open, all four run on your voice side by side: the table shows each one's note, its confidence (with a mark at its threshold) and the share of the last 3 seconds of sound it detected. Click a row to use that method.

| Method | How it works | Good for |
| --- | --- | --- |
| **McLeod (MPM)** (default) | Normalised autocorrelation | Clean, steady singing; the most precise and the fastest. |
| **YIN** | Normalised difference function | Voice in general; a little more tolerant of breathy or uneven sound. |
| **Harmonic spectrum** | Finds the note whose harmonics carry most of the energy | Buzzy or noisy sounds such as lip trills, tongue trills and breathy tone. |
| **Cepstrum** | Finds the regular spacing of the harmonics | Also buzzy sounds; needs a rich tone, so it misses very low, pure notes. |

The pitch trainer has the same settings in a row under its title (method, minimum confidence, window), so you can switch while practising a note; both places stay in sync. Each method has its own **minimum confidence**: lower it to fill gaps, raise it if stray readings appear. The **analysis window** trades response time against steadiness: 1024 samples reacts fastest but can't follow notes below about 100 Hz; 4096 is steadiest and best for low voices.

A lip trill makes the sound flutter on and off about 20–30 times a second, with breath noise in between, so the autocorrelation methods see too little regularity and reject it. In tests with a synthetic lip trill, McLeod detected almost none of it, YIN about half, and both spectral methods nearly all, while all four stayed within a few cents on steady tone. Recordings loaded onto the pitch graph are still analysed with McLeod.

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
| `src/pitch.ts` | Microphone input, with browser voice processing turned off. |
| `src/detectors.ts` | Pitch detection methods: McLeod ([pitchy](https://github.com/ianprime0509/pitchy)), YIN, harmonic spectrum and cepstrum. |
| `src/analysis.ts` | Scores each note (median deviation, share in tune, coverage, onset, vibrato) and computes precision across passes. |
| `src/roll.ts` | The pitch graph (canvas). |
| `src/trainer.ts` | Single-note pitch trainer. |
| `src/exercises.ts` | Generates the practice scores (scales and warm-ups) as MusicXML. |
| `src/calibration.ts` | Latency calibration: plays the beats, detects syllable onsets, computes the correction. |
| `src/vibrato.ts` | Vibrato rate, width, regularity and classification; vibrato centre line. |
| `src/diagnosis.ts` | Take diagnosis: timing fit, octave slips, worst notes. |
| `src/recording.ts` | Pitch tracking of audio files and their alignment to the score. |
| `src/history.ts` | Stores runs, loop sessions and trainer sessions in local storage; charts and tables. |
| `src/main.ts` | UI wiring and state. |

All positions are measured in quarter-note beats, so the graph does not change when you change the tempo.

`npm run sample` regenerates `public/samples/chorale.musicxml` from `scripts/make-sample.mjs`.

## Known limitations

- Repeats and voltas are played straight through, not expanded.
- Tempo changes take effect at bar boundaries only.
- Transposing instruments are played at written pitch.
- Playback uses a simple synthesised tone, not recorded samples.
