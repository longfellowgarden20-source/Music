# StemAI DAW — Feature Test Checklist

How to use: open `/daw?id=<song>` in the browser (hard-refresh first: Cmd+Shift+R).
Go down the list. Mark each: **✅ works** · **❌ broken** · **➖ partial** (note what).
Send it back and I'll fix every ❌/➖ in priority order.

> Tip: most "for show" bugs we've found = a control sending a *neutral/wrong value*
> or a *stale state*. So for each, actually listen / watch for a real change.

---

## 1. Transport  (top bar)
- [ ] Play / Pause (Space) — audio starts/stops
- [ ] Stop (Esc) — stops and returns to start
- [ ] Playhead moves while playing
- [ ] Drag playhead on the time ruler — playback follows to the new spot
- [ ] BPM field changes tempo / metronome
- [ ] Loop toggle — playback loops the set range
- [ ] Metronome toggle — you hear a click
- [ ] Undo (⌘Z) / Redo (⌘⇧Z)

## 2. Track lane controls  (left headers)
- [ ] VOL slider — that stem gets louder/quieter
- [ ] PAN slider — stem moves left/right in the stereo field
- [ ] M (mute) — stem goes silent
- [ ] S (solo) — only that stem plays
- [ ] R (arm) — lights up (used when recording over it)
- [ ] Reorder tracks (drag up/down arrows) — order changes
- [ ] Recolor track — color changes

## 3. Clip / region editing  (timeline)
- [ ] Drag a clip left/right — block moves AND audio plays at new spot
- [ ] Trim clip edge — clip shortens, audio matches
- [ ] Fade in / out handles — audible fade
- [ ] Right-click clip lane (no selection) → Track menu appears
- [ ] Drag-select a region (SELECT mode or hold Alt) — highlight appears

## 4. Track context menu  (right-click a lane)
- [ ] Duplicate Track (⌘D) — a copy appears and plays
- [ ] Mute / Solo from menu
- [ ] Rename — name changes
- [ ] Color swatch — color changes
- [ ] Delete Track (Del) — track removed, its audio stops

## 5. Region context menu  (right-click inside a highlight)
For each: pick a value on the slider, Apply, then play the region.
- [ ] Edit → Gain — region louder/quieter
- [ ] Edit → Fade In / Fade Out
- [ ] Edit → Silence — region goes silent
- [ ] Edit → Reverse — region plays backwards
- [ ] Edit → Normalize
- [ ] Edit → Duplicate / Delete / Crop / Insert Silence  (length changes)
- [ ] Time → Pitch (set semitones) — pitch shifts
- [ ] Time → Stretch / Half-Time / Double-Time
- [ ] Time → Stutter / Tape Stop
- [ ] Time → Pitch→Scale (pick a scale)
- [ ] EQ → Low-Pass / High-Pass / Band-Pass (set Hz) — tone changes
- [ ] EQ → EQ Low / Mid / High (set dB) — tone changes
- [ ] EQ → De-Ess / Mud Cut / Telephone
- [ ] Mix → Compress / Limit / Gate / Tremolo / Auto Gain
- [ ] Bounce to New Track — new track from the selection
- [ ] AI Regenerate — replaces region via AI

## 6. Effects rack  (Effects tab, per selected track)
Add each, toggle it on, and listen. Then move a knob — sound should change.
- [ ] EQ3 (eq3)
- [ ] Compressor
- [ ] Reverb
- [ ] Delay
- [ ] Chorus
- [ ] Distortion
- [ ] Pitch
- [ ] Doubler
- [ ] De-Esser
- [ ] Echo
- [ ] Param EQ
- [ ] Gate
- [ ] Saturation
- [ ] Widener
- [ ] Add / Remove / Toggle / reorder effects
- [ ] Vocal preset chains (apply a preset)
- [ ] Auto-Tune (on a vocal track)

## 7. Panels / tabs (bottom)
- [ ] Mixer — faders + meters move with audio
- [ ] Spectrum analyzer — reacts to playback
- [ ] LUFS meter — shows loudness while playing
- [ ] Piano-roll — shows detected notes
- [ ] Score — shows notation
- [ ] E-Piano — plays (FM / Grand / GM bank)
- [ ] Record — captures mic to a new track

## 8. Add Layer / File
- [ ] Add Layer → Import audio file — appears as a track and plays
- [ ] Add Layer → Duplicate selected track
- [ ] Detect chord progression
- [ ] File → Export Mixdown (WAV downloads & sounds right)
- [ ] File → Export Stems
- [ ] File → Save Project (.json downloads)
- [ ] File → Open Project (restores)
- [ ] File → Revert to Original

## 9. Persistence  (the new autosave)
- [ ] Make edits, refresh page — edits are restored ("✓ saved" shows)
- [ ] Revert to Original — back to pristine stems

## 10. Keyboard shortcuts
- [ ] Space play/pause · Esc stop · R record · Shift+M marker
- [ ] M mute · S solo · ⌘D duplicate · Del delete (on selected track)
- [ ] ⌘Z / ⌘⇧Z undo/redo

---

### Notes / broken items (write freely):
-
