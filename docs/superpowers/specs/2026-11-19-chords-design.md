# Chords mode on the Audiation page — design

Date: 2026-11-19. Status: draft for approval.

## Intent

General ear training: hear several notes at once and pull the single notes out of the sound. A
chord (or an interval) sounds on the piano and stops; the singer then sings its notes one after
another from memory. This is audiation, like Echo and Syllables, so it lives on the Audiation page
as a third mode.

## Goals

- A third mode, **Chords**, next to Echo and Syllables on the Audiation page.
- A choice between **On their own** (a random chord at a random pitch in the voice's range) and
  **In a key** (the key's cadence first, then chords from that key, with syllable names). The
  singer chooses.
- Difficulty by level, chosen by the singer or adapting, as in Echo (staircase, new-day warm-up).
- The same result display as Echo: each note right, close (out of tune) or wrong; then the chord
  plays again to compare.
- Its own History tab.

## Non-goals (for now)

- The chord sounding while singing (that needs headphones; the microphone would hear the piano).
- Naming chords (dictation: "which chord was that?"). The task is to sing its notes.
- Chord progressions; one chord per round.

## Anti-goals

- Changing how Echo or Syllables behave or score.
- Chords outside the voice's range, so that the notes can't be sung where they sound.

## Decisions taken with the singer

- **Both contexts**, switchable: *On their own* / *In a key*.
- **The chord stops** before singing; **Hear again** plays it once more.
- **Approach C:** a third mode inside `EchoTrainer` (`src/echo.ts`), reusing the mode switch, round
  flow, judging (`judgeAnswer`), level staircase, note map, result and History pattern; everything
  chord-specific lives in a new `src/chords.ts`. (A: everything in `echo.ts` — rejected, the file
  is already ~1400 lines. B: a separate trainer — rejected, most of Echo would need to be pulled
  out or duplicated.)
- **Levels** (agreed as proposed):

| Level | Heard | Sung |
|---|---|---|
| 1 | Interval: third, fifth or octave | low, then high |
| 2 | Any interval | low, then high |
| 3 | Major or minor triad, root position | bottom to top |
| 4 | Major or minor triad | one voice only: the bottom, top or middle note |
| 5 | Inversions (third or fifth at the bottom) | bottom to top |
| 6 | Seventh chords | bottom to top |

## How it works

**Settings (Chords mode).** Voice (shared with Echo). Context: *On their own* / *In a key*. In a
key: Key and Major/Minor (shared with Echo and Syllables; minor is la-based). Level (fixed or
adapting), as in Echo.

**A round.**
1. In a key: the key's cadence (Echo's `playKey`) before the session's first round and after the
   key changes; *Play key* replays it at any time (as in Echo).
2. The chord sounds on the piano (all notes at once, about 1.5 s) and stops.
3. A short pause (Echo's per-level gap), then the prompt and singing, as in Echo's answer phase:
   "Sing it bottom to top" or "Sing the top note". The prompt never names syllables or notes,
   so nothing about the chord is given away *(decided with the singer)*.
4. The answer is judged against the target notes in order with `judgeAnswer`; the result is shown
   as in Echo, and always names the chord's notes and the chord ("F – A – C", "F major"). In a key
   the syllables and the step are added ("F – A – C · fa – la – do", "F major · IV")
   *(decided with the singer)*. The chord plays again (then its notes one after another) to compare.
5. **Hear again** (before or while singing) replays the chord; the round still counts.
6. Repeats while not in tune, Next, automatic continue, wobble and slide checks: as in Echo.

**Chord content.**
- *On their own:* root random so that the whole chord lies within the voice's comfortable range
  (`VOICES`). Triads major or minor; inversions; sevenths: dominant 7th, major 7th, minor 7th.
  Close position (all notes within an octave, sevenths within a ninth).
- *In a key:* diatonic chords, root position unless the level says otherwise *(my call, check)*:
  - levels 1–2: intervals built on degrees of the key;
  - levels 3–4: the primary chords I, IV, V (major) / i, iv, V with the raised si (minor);
  - level 5: inversions, and the pool grows to all major and minor diatonic triads (major: I ii iii
    IV V vi; minor: i III iv V VI); no diminished chords;
  - level 6: seventh chords only, root position: V7, ii7, Imaj7, IVmaj7 (major); V7, iv7, IIImaj7,
    VImaj7 (minor).
  Syllables use movable do, la-based minor and si for the raised 7th.
- No two identical rounds in a row (as Echo avoids repeating a phrase).

**Judging is octave-exact** in Chords, whatever the global octave-free setting says *(my call)*:
the order (bottom to top), octaves (level 1) and bottom/top notes only make sense with octaves, and
chords are placed in the singer's own range, so there's nothing to sing an octave off.

**History.** A tab **Chords**, key `ptchmtch.chords.sessions`, the same session shape and view as
Echo/Syllables (`EchoSession`), with the context (On their own / key) in the session's context
line. The note map is shared with Echo.

## Code shape

- `src/chords.ts`: the level list and descriptions, chord generation for both contexts (returns the
  notes as MIDI, the target notes in singing order, and the prompt text), syllable naming for key
  mode. Pure functions, checkable offline like the Support analyses.
- `src/echo.ts`: `TrainMode` gains `"chords"`; prefs gain `chords?: LevelState` and
  `chordContext?: "free" | "key"`; the round builds its phrase from `chords.ts` in this mode, plays
  it as one chord, shows the prompt, and adds Hear again. Echo and Syllables paths stay as they are.
- `index.html`: the mode switch gets a third button; the Context setting; Hear again button.
- `src/history.ts` / `src/main.ts`: the Chords tab and its wiring.

## Left to the builder

- Chord and note lengths, the prompt wording, and how the prompt is shown.
- Which intervals level 2 adds beyond level 1 (e.g. all from minor second to octave).
- How "the middle note" is chosen in level 4 when a seventh chord isn't involved (always the third).
- Offline checks for `chords.ts`: every chord within the voice's range, the target order, the
  diatonic chords per key and mode, no immediate repeats.
- README: a Chords section under Audiation.
