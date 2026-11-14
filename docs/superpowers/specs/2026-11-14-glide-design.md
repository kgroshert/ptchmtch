# Glide exercise on the Support page — design

Date: 2026-11-14. Status: draft for approval.

## Intent

The singer's voice teacher uses a slow-glide exercise. The singer starts on a note, glides slowly and
continuously up to a third or a fifth above it, and glides back down with no pause at the top. Each
direction takes roughly 10 seconds, but that's only a ballpark. The teacher listens for two things:

1. **Even pitch movement.** The pitch should move at a steady rate, with no stalls, jumps, or drift away
   from an even line, especially in the middle. A drift in the middle usually means something moved,
   for example the tongue position.
2. **Steady breath support.** In the app this shows as volume, which should stay roughly level for the
   whole glide.

The singer wants to practise this at home, with the app showing the glide while they sing and telling
them afterwards where it was uneven.

## Goals

- A second exercise, **Glide**, on the existing Support page, next to Messa di voce.
- **Free pace.** The singer glides in their own time. Evenness is judged against a straight line
  between the points where the singer *actually* started, turned and ended, not against a clock.
- A live graph while singing, and an analysis with ✓/! findings afterwards, in the same style as messa
  di voce.
- A History tab for glide sessions.

## Non-goals (for now)

- **Guided pace.** No moving marker to follow and no "too fast / too slow" judgement. The time for each
  direction is only reported, for information.
- **Patterns with extra turns** such as C–G–E–G–C. These could become an advanced level later. Listing
  in-between notes in a straight glide (C–E–B–E–C) adds nothing, because a straight glide passes through
  them anyway. They appear only as landmarks on the graph.
- **Starting from the top** (gliding down first). It can be added later if the teacher uses it.
- Intervals other than a major third and a perfect fifth.

## Anti-goals (a failure even if it technically works)

- Penalising the singer for being slow or fast.
- Counting normal vibrato as unevenness.
- False alarms at the soft onset and the end of the glide.
- Changing how messa di voce behaves or scores.

## Constraints

- The project is Vite + TypeScript with no framework, and data lives in localStorage. Pitch samples
  arrive about every 15 ms as `PitchSample {time, midi|null, level}` through `SupportTrainer.push`.
- The menu bar is already full on a phone, so there is no new page.
- The level gate of the pitch tracker is RMS 0.008 (about −42 dBFS). Quieter singing gives no pitch.
  This matters less than for messa di voce, because a glide is sung at a steady medium level.
- Volume is relative (it depends on the mic and its distance), so volume findings must be relative to
  the singer's own level in that glide.

## Approaches considered

- **A. Glide as a second exercise inside the Support page — chosen.** A segmented switch
  (Messa di voce / Glide) at the top, like Echo / Syllables on the Audiation page. Glide shares the
  voice picker, ▲▼, the breathe-in floor measurement, mic handling, the phase flow and the result layout
  with messa di voce. It has its own analysis, graph lanes, findings and History tab. It needs a moderate
  tidy-up of `src/support.ts` so that the shared parts aren't messa-specific.
- **B. A separate Glide page.** Fastest, with messa untouched, but it duplicates a lot of code and
  doesn't fit the phone menu bar. Rejected.
- **C. A general exercise framework first, then glides as the first plug-in.** Only worth it if many
  more Support exercises were coming soon, so it's more structure than needed now. Rejected.

## What the singer sees and does

**Settings** (Glide selected):
- **Voice** (shared with messa).
- **Interval:** Third (4 semitones) or Fifth (7 semitones). The default is Third.
- **Start note** with ▲▼ (and the arrow keys). By default the whole interval is centred in the middle
  of the voice's comfortable range (`VOICES` in `src/exercises.ts`), so the low note is
  `round((low + high) / 2 − interval / 2) + offset`. ▲▼ keeps both the low and the top note inside the
  comfortable range.
- A line showing the glide, for example "C4 → E4 → C4".
- **Hear** plays the low note, then the top note, then the low note again (about 1 s each).
- Prefs are saved: exercise, interval and glide offset. Messa keeps its own prefs.

**A round:**
1. **Start** plays the low note, then the top note, about 1.2 s each, so the target is in the ear.
2. **Breathe in…**: 1.5 s of quiet measurement, exactly as in messa.
3. **Sing**: start on the low note, glide up, turn, glide back down, stop. The cue line under the graph
   follows what the singer does, not a clock: "Start on C4" → "Glide up…" (once the pitch is moving up)
   → "Back down…" (after the turn) → "Land on C4".
4. **Auto-finish**: 1 s of silence once the voice has been there at least 2 s, or after a 60 s cap.
   Enter or **Done** also finishes. **Again** starts another round.

**Live graph** (one canvas, two lanes, like messa):
- **Pitch lane**: from 100¢ below the low note to 100¢ above the top note. Horizontal lines and labels
  mark the low and top notes, with fainter lines for the scale notes in between (C D E for a third from
  C, and C D E F G for a fifth, using the major scale on the low note). The tolerance band is shaded
  around the low and top note lines. The pitch trace is drawn live.
- **Volume lane**: dB above the floor, with the trace drawn live. After the glide, a band shows the
  glide's own median level ± 3 dB.
- **Time axis**: starts as a 25 s window, which fits 10 s up, 10 s down and some slack. If the glide is
  longer, the axis grows, so a slow glide never runs off the edge.
- **After the round**, the reference lines are drawn: one straight line from the start point to the
  turn point and one from the turn point to the end point. These are what evenness is measured against.
  Marks are added on top: orange dots for the largest drifts from the line and for volume sags and
  surges, a marker for stalls and jumps, and a red line labelled with the reason if control was lost.

## Analysis (`analyseGlide`)

This is a pure function from frames (`{t, db, cents-from-low-note | null}`), floor dB, low note and
interval to a result. It's testable offline, like `analyseMessa`.

1. **Voiced span:** reuse messa's voice threshold (floor + 8 dB) and smoothing, from the first to the
   last voiced frame.
2. **Pitch smoothing:** average the pitch over a window long enough to remove vibrato (about 0.25 s;
   vibrato is about 5–7 Hz). Evenness is judged on the smoothed pitch. Vibrato is detected separately
   (reuse `analyseVibrato`) and reported for information only.
3. **Key points:**
   - **Start:** where the pitch first settles near the low note, ignoring the first ~0.3 s of the onset.
   - **Turn:** the highest point of the smoothed pitch.
   - **End:** the last stable pitch before the voice stops, ignoring the final ~0.4 s of release.
4. **Accuracy at the key points:**
   - Start pitch vs the low note.
   - Top reached vs the top note, reported as overshoot or undershoot in cents.
   - End pitch vs the low note.
   Each counts as fine within the user's tolerance setting (`host.toleranceCents()`).
5. **Evenness, per direction (up and down separately):**
   - The RMS deviation, in cents, of the smoothed pitch from the straight line between that direction's
     endpoints.
   - The **largest drift**: the biggest deviation, with its time and the nearest note name ("went flat
     near D4"). It's flagged when it exceeds a threshold (starting value 30¢).
   - Whether it fell in the **middle** (the middle 60% of the direction), because that's what the
     teacher looks for. The finding then says so: "drift in the middle — check that nothing moved
     (tongue, jaw)".
6. **Stalls and jumps, per direction:**
   - **Stall:** the local glide speed stays below about 25% of that direction's average speed, or goes
     backwards, for at least 0.5 s.
   - **Jump:** more than 60¢ of movement in under 0.1 s.
   - Each is reported with its time and nearest note.
7. **Turn:** report a hold at the top longer than about 1 s ("you paused at the top"). This is
   information only, not a failure.
8. **Steady support:**
   - Take the median dB of the voiced span, without the onset and release edges.
   - Report the RMS variation around it.
   - Report sags and surges of 3 dB or more (reuse `BUMP_DB`) lasting at least 0.3 s, with their time
     and nearest note. A sag that lines up with a pitch drift is worth saying explicitly, because they
     likely share a cause.
9. **Lost control:** reuse messa's break, crack and no-pitch detection, with the same edge rules. A crack
   is judged against the expected straight line, not a running median of a fixed note.
10. **Timing (info only):** seconds up and seconds down, for example "up 9.4 s, down 11.2 s".

**Thresholds** (30¢, 25%, 60¢ in 0.1 s, 3 dB) are starting values. The builder should tune them on
synthetic glides so that a clean glide gives no false flags.

## Result panel

The result is a short headline ("An even glide" or the most important problem), then ✓/! items:

- Evenness up
- Evenness down
- Largest drift
- Stalls / jumps
- Top note reached
- Landed back on the low note
- Steady volume
- Lost control, if it happened
- Times (info)
- Vibrato (info)

## History

- A new tab, **Glides**, with key `ptchmtch.glide.sessions`, following the `MessaSession` / `MESSA_VIEW`
  pattern in `src/history.ts`.
- A session row holds: date, context ("C4–E4 · Alto"), rounds, minutes, mean evenness up (¢), mean
  evenness down (¢), mean largest drift (¢), mean volume variation (dB), mean top error (¢), mean glide
  length (s), and rounds with lost control.
- Metrics are evenness up, evenness down, largest drift, volume steadiness, top accuracy and glide
  length (neutral, no "better" direction).
- A session is saved the same way as messa: when the exercise is stopped or switched, the page is left,
  or on pagehide.

## Code shape (decided)

- Everything stays in the Support page (`section#support`, `src/support.ts`, `src/main.ts` wiring).
- An exercise switch (`#mvExercise`, segmented) shows the right settings. Switching stops a running
  round and saves the session.
- `SupportTrainer` keeps the shared parts. The exercise-specific parts are prompt/cue, analysis,
  drawing of lanes and marks, result items, per-session stats and the History row. They are split per
  exercise so that messa's code path is unchanged in behaviour.
- `analyseGlide` and its result type are exported, so they can be tested offline like `analyseMessa`.

## Calls made without the singer (check these)

- **Interval:** major third and perfect fifth only, with Third as the default.
- **Voice:** one setting shared by both exercises. Changing it resets both start-note offsets.
- **Cues:** the cue words follow what the singer is doing, not a clock.
- **Pause at the top:** a hold of more than about 1 s splits the turn into a hold start and a hold end.
  It's reported as information and never flagged as a stall or drift.
- **Start fallback:** if the pitch never settles near the low note, the start is taken right after the
  onset is skipped.
- **Overlap:** where a jump and a crack overlap, it is reported once, as a crack.
- **Timing:** the seconds up and down are shown for information only.
- **Volume:** judged against the glide's own median level, not a fixed target.
- **Range check:** every voice in `VOICES` spans 19 semitones, so a fifth always fits.

## Left to the builder

- The exact internal split in `support.ts` (an internal exercise interface, two small classes, or
  branches). Keep it no bigger than two exercises need.
- Exact smoothing windows and thresholds, tuned on synthetic data.
- Colours and styling, following the existing messa styles.
- README: a short Glide section under Support.

## Testing

- **Offline scripts** with synthetic glides, like the existing messa script, for these cases:
  - a clean even glide (no flags);
  - a mid-glide drift;
  - a stall;
  - a jump;
  - a volume sag;
  - overshooting the top;
  - landing flat;
  - vibrato on an otherwise even glide (no evenness flag);
  - slow (15 s) and fast (5 s) clean glides (no flags).
- **Messa baseline before the refactor.** The earlier messa offline cases live in a session scratch
  script (`messa.ts`, run with `npx tsx`), not in the repo. The first step is to move them into the repo
  as `scripts/check-messa.ts`, with a seeded random generator and assertions on the detected findings.
  The cases are: ideal, early peak, dip, drift, break, crack, no pitch, vibrato and fade-outs. Record
  what the current `analyseMessa` returns for each of them before touching `support.ts`. The same check
  must still pass after the refactor. *(Builder-check answer; moving it into the repo is my call.)*
- The glide cases go in `scripts/check-glide.ts` the same way.
- **Browser:** a fake mic driven by an oscillator ramp. Check the live graph, the result, the History
  tab and phone width. Back up and restore localStorage as in earlier tests.
