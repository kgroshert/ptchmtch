# ptchmtch

A practice tool for singers. Load a MusicXML score, pick your part, sing along with the other parts, and see how close your pitch is to what is written.

## Running

```bash
npm install
npm run dev
```

Open http://localhost:5173 in Chrome, Edge, Firefox or Safari. The browser only allows microphone access on `localhost` or over HTTPS.

## Using it

The menu bar has three pages, **Score** (singing from a score: everything below), **Audiation** (the Echo trainer, with its Syllables mode) and **Support** (messa di voce), plus **History** and **Settings**, which open over any page, and the **Microphone** toggle with a live level and pitch. The app reopens on the page you used last. History opens on the tab that fits the page: Echo or Syllables on Audiation, Messa di voce on Support, the current score's run-throughs on Score.

- **Open score…** (or drag a file onto the score area) loads `.musicxml`, `.xml` or compressed `.mxl`. **Practice scores ▾** generates an exercise in any key, written out for soprano, alto, tenor, baritone (A2–E4, between tenor and bass) and bass (each in the comfortable middle of its range) plus piano. Choose your voice under **Your part**; the app remembers it for the next exercise:
  - *Scales*: major, natural minor, harmonic minor and chromatic, one octave up, a half rest, and back down.
  - *Warm-ups*: the five-note scale (1-2-3-4-5-4-3-2-1) and arpeggios (1-3-5-8-5-3-1), major and minor, each sung twice.
  - *Triplets* (three notes to a beat): the five-note scale, stepping groups (1-2-3, 2-3-4 … up to the octave and back down), the arpeggio, the octave scale, and the 1.5-octave scale (up to the 5th above the octave and back; the final do is held over into the next beat).
  - *Pieces*: a short SATB chorale.

  Every exercise starts with a half rest, to breathe and find the first note.

  Each exercise has movable-do solfège under the notes (minor is la-based: la ti do re mi fa sol, with si for the raised 7th; the chromatic scale uses di ri fi si li going up and te le se me ra going down) and a piano part with simple I, IV and V chords (a held tonic chord under the chromatic scale). Turn the piano down with **Other parts**, or hide it from the score with **Only my part**. Each exercise and key keeps its own history per part.
- **Play / Pause** (Space): Play continues from where you paused, at the start of that beat, and the run or loop statistics carry on. **⏮** (Home) jumps back to the start of the selection without starting or stopping playback. Changing the part or the bars also starts over from the beginning.
- **Your part** lists every part, and every voice within a part, that contains notes. The selected part is coloured blue in the score. While playing, the cursor moves on every beat, also through long notes and rests.
- **Your part in playback**: *Loud* to learn the notes, *Normal* to sing with it, *Muted* to test yourself. **Other parts** sets the volume of the accompaniment.
- **Tempo** slows the playback down (or speeds it up) without changing pitch.
- **Bars**: type the first and last bar to practise, or drag across the bar numbers above the pitch graph. **All** selects the whole piece. Clicking in the score doesn't change the selection, so double-clicking a note only opens the trainer. **Loop** repeats the selection.
- **Loop** is off whenever you open the app.
- **Only my part** hides the other parts' staves in the score, for more room. For a voice inside a piano part, only the staff it is written on is kept.
- **Pitch graph**: while playing, the graph scrolls along with the music, keeping the playhead at about a third of its width. The line is drawn lightly smoothed (over about 50 ms, never across a change of note), so it shows the pitch you're heard at rather than every wobble; scoring uses the unsmoothed pitch. Drag the handle between the score and the graph to make the graph taller (double-click it to reset). **↕ Fit** fits the pitch axis to the notes in view, for taller rows and thicker lines; switch it off to see the part's whole range. The mouse wheel scrolls in time and ⌘/Ctrl + wheel zooms in time. To zoom the pitch axis, use the wheel over the note names, or ⌥/Alt + wheel anywhere; drag the note names to move up or down, and double-click them to reset.
- **Hide graph while playing** (G) gives the score the whole window during playback. The graph comes back when playback ends or you pause.
- **Count-in** gives one bar of clicks before playback starts; **Starting note** plays your first note during the count-in.
- **Microphone** (M) turns on pitch detection. The readout next to it works as a tuner even when nothing is playing.

Keyboard: `Space` plays or pauses, `Home` jumps back to the start, `L` toggles looping, `M` turns the microphone on or off, `G` toggles hiding the graph.

### Echo trainer (audiation)

The **Audiation** page (the Echo trainer) trains hearing a phrase in your head and singing it back:

1. The piano plays the key once (I–IV–V–I), then there is a short silence.
2. **Listen**: a short phrase plays (piano by default; change it under *Phrase sound*).
3. **Hold it in your mind**: a silence of 1.5–4 s, longer at higher levels (other notes in between would disturb the memory; silence doesn't).
4. **Sing it back**, in your own time. Only the notes count, not when you start or how long each note is: the answer is split into the phrase's notes wherever they fall, and each note is judged on its steady middle (the way into and out of it is left out). The answer ends after about a second of silence, or press Enter / **Done**.
5. The result: each note right and in tune (within your tolerance), right but out of tune (within 50 cents), or wrong (with the note you sang), plus your line against the targets. The phrase plays again so you can compare. If not every note was in tune, the same phrase comes again, up to 3 more times (*Repeat until in tune*; **New phrase** skips ahead). With **Repeat on wobble** (off, 1 lenient, 2, 3 strict) a note that is in tune but unsteady also brings the phrase back. Steadiness is measured without the way into and out of the note: the spread of the pitch around its centre and the largest swing away from it (level 1 allows a spread of ±22¢ and a swing of 70¢, level 2 ±14¢ and 50¢, level 3 ±9¢ and 35¢). An even vibrato never counts as wobble. A wobbly note is marked orange with its spread. **Repeat on slide** works the same way for landing: how long a note takes from its start until it settles within ±20¢ (or your tolerance, if wider) of its pitch for 0.1 s, and whether it came from above or below. Only a start at least 40¢ off counts as sliding in; level 1 allows 0.3 s, level 2 0.2 s, level 3 0.12 s. The note card then says e.g. "slid in from above · 0.4 s" (any slide over 0.3 s is shown even with the setting off), and the Echo history tracks the average landing time. **Practice again** (Space) runs one more listen-and-sing round on the same phrase whenever you like. Unticking *Continue automatically* takes effect at once, so you can stay on a phrase and practise it by hand; **Next round** (Enter) moves on.

No pitch is shown while you sing, so you learn to judge by ear (live feedback helps at first but makes you depend on it). With **Rate yourself first** you say how it sounded (flat, in tune, sharp, wrong notes) before you see the result, and the session counts how often you heard it right.

The level adapts: 3 right rounds in a row move you up, 2 wrong ones down (or pick a fixed level). On a new day it starts again at level 1 and warms up: each right round moves straight up a level until you're back where you left off, after which the usual rule applies. Levels go from single notes through 2–5 notes, from steps to thirds and leaps, then chord outlines (do-mi-sol, sol-ti-re, la-do-mi …) and scale runs, and longer silences. The phrases are in the key you choose, major or minor, in your voice's range, and new every round. Minor is la-based: the same syllables as its relative major, so a phrase in minor centres on la; the key is played as i–iv–V–i, with the raised si in the V chord. The level and settings are remembered in this browser.

### Syllables (solfège)

**Syllables**, switched at the top right of the Audiation page, trains movable-do solfège the other way round from Echo: you see the syllables and sing them without hearing them first. The key plays once at the start; then for each phrase:

**Help** sets how much the app helps, so you can move through the usual steps of learning solfège:

- **Learn: hear it first** (the default): the phrase plays while each card lights up in turn, then you sing it back. This ties the sound to the syllable, the first step in Kodály and Gordon teaching.
- **Hint: on request**: you read the phrase and sing when ready (Enter or **Sing now**; nothing starts by itself). If lost, **Hint** (H) plays the first note, and pressed again the whole phrase. A phrase heard whole as a hint doesn't count towards the level.
- **Test: read cold**: nothing plays until afterwards.

After 6 of the last 8 phrases right, the result suggests moving to less help, with a button to switch. Each kind of help is its own session in History (shown with the key and voice).

1. *Before each phrase*: the home note plays (do in major, la in minor), shown as its own faded card marked "home", set apart from the phrase and lit while it sounds, followed by a short pause; or the whole key; or nothing.
2. **Read it**: the syllables appear with Curwen's hand signs, each raised by its pitch as the hand rises with the tones (low and high octaves are marked). Hear them in your head.
3. **Sing it**: after the phrase in Learn, when you're ready in Hint, after a moment in Test (or at once with Enter). The syllables stay up while you sing. Judging, repeats, wobble and slide work as in Echo, and afterwards the phrase plays so you hear how it should have sounded.

Its levels follow the Kodály order of tone sets: sol mi; sol mi la; do mi sol la; the pentatonic do re mi sol la; with low la and low sol; up to high do with leaps; adding fa; adding ti (the whole scale); the whole scale with leaps. From the third level on, phrases often end on the home tone. Syllables has its own level (with the same new-day warm-up) and its own History tab; the note map is shared.

The **note map** on the left is a bar from red through yellow to green for each pitch in your range: how well that note has gone over its last 20 or so tries (1 in tune, falling to ½ at 50 cents off, 0 for a wrong or missed note). It counts first tries only, since a repeated phrase has been heard more often; notes tried only a few times are faint. Hover for the numbers; **Reset** clears it.

### Messa di voce (Support)

The **Support** page trains breath support with messa di voce: one sustained note, starting softly, swelling evenly to your loudest in the middle and fading evenly back to soft, all on the same pitch.

- **Voice** picks the note: the middle of the voice's comfortable range. **▲ / ▼** (or the arrow keys) move it by a semitone within the range, so you can work through it. **Length** is the whole swell: 6, 8, 10, 12 or 15 s.
- A round: the note plays, then **Breathe in** for 1.5 s while the room's quiet is measured, then sing. A line moves across the graph, with cues (Start softly, Grow, Loudest, Fade, Softly). It ends after a second of silence, or with Enter / **Done**. **Again** (Enter) sings another.
- The graph shows **volume** (dB above the room's quiet) and **pitch** (cents from the note) live, against a target arch: straight in dB up to the middle and back, scaled to your previous swell.
- The result lists:
  - **range**: the loudest point above the softer of the two soft ends;
  - **where the peak fell**: within 35–65% of the note counts as the middle;
  - **evenness** of the crescendo and the diminuendo: how far each strays from a steady line, plus any **sag** while growing or **swell** while fading of 3 dB or more (orange dots on the graph);
  - **pitch soft against loud**: going sharp as it grows usually means pushing, going flat when soft means sagging;
  - overall **sharp/flat**;
  - **where control gave out**: the voice stopped for 0.12 s, the pitch cracked (jumped more than 80 cents), or the pitch was lost while the voice still sounded (a red line on the graph; coming from and fading into silence at the ends doesn't count);
  - whether you held the full length;
  - **vibrato** or wobble in the loud part.

Volume is relative: it depends on the microphone and your distance to it, so keep the same distance to compare swells and days. Very soft singing (below about −42 dB of full scale) is too quiet for the pitch tracker, so the pitch line starts a little after the volume line, which is normal. Each session (until you stop, change the note or length, or leave the page) goes into **History**.

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

**History** has six tabs. Each one has a chart where you can pick the metric, plus a table; the bin icon at the end of a row deletes that entry (e.g. a test). Charts with a typical healthy range show it as a shaded band.

- **Run-throughs**: each time you sing the whole piece to the end with the microphone on. Metrics: score (0–100), share in tune (by note length), mean deviation, clean onsets, vibrato rate, width and regularity, and the share of notes with a wobble. A message after each run compares it with the last one.
- **Loop practice**: recorded when you stop after at least three passes of a loop. Metrics: accuracy of your best pass (average deviation; passes with fewer than 80% of the notes sung don't count) and spread between passes (precision). The message compares it with your last session on the same bars.
- **Long notes**: every note practised in the trainer for at least 2 seconds of singing, across all pieces. Metrics: share in tune, longest hold, mean deviation and vibrato.
- **Syllables**: the same, for the Syllables mode, on its own ladder of 9 levels.
- **Messa di voce**: each Support session: mean and best dynamic range, evenness, how far the peak was off-centre, the pitch change from soft to loud, the share of the length held, and how many swells lost control.
- **Echo**: each Echo trainer session with at least one round, saved when you stop, close the trainer, change key or voice, or leave the page. Counts first tries only. Metrics: share of phrases right (every note within 50 cents) and in tune, highest level, mean deviation and landing time of the right notes, and how often your own rating matched.

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
- **Playback sound**: the instrument for your part and for the other parts: piano (default), soft tone, organ, strings, or a choir singing "aah". Piano and choir are recorded (see Credits); the others are synthesised in the browser. The trainer's **Play note** and the starting note use your part's sound (the soft tone instead of piano, since a piano note dies away).
- **Pitch detection → Change…**: choose how pitch is detected (see below).

Use headphones. With speakers, the microphone also picks up the playback.

### Pitch detection

Five methods are available. While the dialog is open, all of them run on your voice side by side: the table shows each one's note, its confidence (with a mark at its threshold) and the share of the last 3 seconds of sound it detected. Click a row to use that method.

| Method | How it works | Good for |
| --- | --- | --- |
| **McLeod (MPM)** (default) | Normalised autocorrelation | Clean, steady singing; the most precise and the fastest. |
| **YIN** | Normalised difference function | Voice in general; a little more tolerant of breathy or uneven sound. |
| **pYIN** | Probabilistic YIN: every plausible pitch per frame, then the most likely line over time (hidden Markov model) | Singing with octave flicker or stray readings, e.g. a weak fundamental in low or soft notes. Shows the pitch about 75 ms late (timing is still scored correctly). |
| **Harmonic spectrum** | Finds the note whose harmonics carry most of the energy | Buzzy or noisy sounds such as lip trills, tongue trills and breathy tone. |
| **Cepstrum** | Finds the regular spacing of the harmonics | Also buzzy sounds; needs a rich tone, so it misses very low, pure notes. |

The pitch trainer has the same settings in a row under its title (method, minimum confidence, window), so you can switch while practising a note; both places stay in sync. Each method has its own **minimum confidence**: lower it to fill gaps, raise it if stray readings appear. The **analysis window** trades response time against steadiness: 1024 samples reacts fastest but can't follow notes below about 100 Hz; 4096 is steadiest and best for low voices.

A lip trill makes the sound flutter on and off about 20–30 times a second, with breath noise in between, so the autocorrelation methods see too little regularity and reject it. pYIN (Mauch & Dixon, 2014) is the established choice for transcribing singing. Instead of trusting each frame's best guess, it keeps every candidate pitch with a probability and decodes the most plausible line, deciding each frame 5 frames (about 75 ms) later, once the following frames confirm it. On a synthetic voice with a weak, fluctuating fundamental, the frame-by-frame methods flickered an octave up in a third to all of the frames, while pYIN stayed on the right note throughout.

In tests with a synthetic lip trill, McLeod detected almost none of it, YIN about half, and both spectral methods nearly all, while all four stayed within a few cents on steady tone. Recordings loaded onto the pitch graph are still analysed with McLeod.

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
| `src/detectors.ts` | Pitch detection methods: McLeod ([pitchy](https://github.com/ianprime0509/pitchy)), YIN, pYIN (with online fixed-lag Viterbi decoding), harmonic spectrum and cepstrum. |
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

## Credits

The piano samples in `public/samples/piano/` are from the [Salamander Grand Piano](https://archive.org/details/SalamanderGrandPianoV3) V3 by Alexander Holm (a Yamaha C5), as converted for [Tone.js](https://github.com/Tonejs/audio), under the [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) licence.

The choir "aah" samples in `public/samples/choir-aah/` come from the FluidR3_GM soundfont by Frank Wen (instrument 53, "Choir Aahs"), as rendered to MP3 by the [midi-js-soundfonts](https://github.com/gleitz/midi-js-soundfonts) project, under the [Creative Commons Attribution 3.0](https://creativecommons.org/licenses/by/3.0/) licence.

The hand-sign pictures in `public/signs/` are cut from John Curwen's "Manual Signs of Tone in Key", *The Standard Course* (London, 1884), via [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Curwen_Hand_Signs_MT.jpg); public domain.

## Known limitations

- Repeats and voltas are played straight through, not expanded.
- Tempo changes take effect at bar boundaries only.
- Transposing instruments are played at written pitch.
- Playback sounds are synthesised, not recorded samples, so they only approximate the real instruments.
