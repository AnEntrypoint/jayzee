# Mobile Controls

Every game gets the draft, projected from inputs at zero effort; a game that deserves designed controls declares inputs.touch.surfaces, complete named documents on the same engine rails, so they keep the engine's feel. You speak channels and intent; the look is yours: inputs.touch.style dresses the parts in the game's own fills, edges and face (as its HUD, with a pressed look that answers the thumb), while the engine keeps each piece's place, hit area, timings and gains (a chip is 56 or 48 px). Never hand-roll a DOM stick or a chip the surface offers. A chip size or layout the surface does not offer is your own HTML control, and sendAction drives it. Phone tilt reaches the HUD page as devicemotion after the player allows it for the world: a listener there asks, then feeds sendAxis.

The draft's contract: the stick projects only from axes literally named moveX/moveZ (moveY in 2D): rename them and the stick vanishes; drag-look from any lookX/lookY binding, pinch-zoom from a wheel axis; every key or mouse action becomes a chip, ranked authored slot → common verb names (jump first) → declaration order, capped at 4: verbs past the cap drop, loudly (a phone on the draft logs each).

A place that lays inputs.touch in its config.yaml (ctx.world.places.<p>.inputs.touch) wears it whole in place of the world's, so change that place's controls there.

```yaml
# world.config.yaml: a shooter on foot, a car when driving; the selector picks the surface per player
inputs:
  axes: { moveX: { keys: "a/d" }, moveZ: { keys: "s/w" }, aimX: {}, aimY: {}, steer: {}, throttle: {}, brake: {} } # aimX: {} = a touch-only axis
  actions: { fire: { mouse: "left" }, dodge: { keys: ["space"] }, exit: { keys: ["e"] } }
  touch:
    surfaces:
      default:
        sticks: [{ x: moveX, y: moveZ }]
        buttons:
          - { action: fire, drag: { x: aimX, y: aimY }, slot: 1, size: primary, icon: "🎯" } # hold aims, release commits; a tap is a plain press
          - { action: dodge, slot: 2 }
      driving:
        sticks: []
        look: false
        pads: [{ x: steer, mode: absolute, zone: left, label: STEER }]
        buttons:
          - { axis: throttle, label: GAS, slot: 1, size: primary }
          - { axis: brake, label: BRAKE, slot: 2 }
          - { action: exit, slot: 3 }
    active: scripts/controls.js
    style: |
      [data-part="button"] { background: oklch(0.95 0.04 85); border: 3px solid oklch(0.45 0.08 60); color: oklch(0.35 0.07 55); font-weight: 800; }
      [data-part="button"][data-pressed] { background: oklch(0.86 0.1 80); transform: translateY(2px); }
      [data-part="stick"] { background: oklch(0.95 0.04 85 / 0.45); border: 3px solid oklch(0.45 0.08 60); }
      [data-part="thumb"] { background: oklch(0.45 0.08 60); border: none; }
```

```js
// scripts/controls.js: the selector (inputs.touch.active below), stateless
export default (ctx) => (ctx.player.state.driving ? "driving" : "default");
// on the body's onInput: const shot = input.actionData?.fire;   // release carries { x, y, magnitude }; a tap carries none
// if (input.pressed.fire) shot?.magnitude > 0.1 ? shootAlong(shot) : shootAuto();   // drag = aimed, tap = assisted quick-fire
// the car reads both worlds: steer = axes.steer || axes.moveX; gas = axes.throttle || Math.max(0, axes.moveZ)
```

Desktop bindings on the same names keep working, so behavior code cannot tell a stick from WASD or a pedal from a key. Twin-stick instead of drag-aim: sticks: [{ x: moveX, y: moveZ }, { x: aimX, y: aimY, zone: right }]. A one-thumb portrait runner: orientation: portrait, sticks: [], look: false, pinch: false, gestures: { tap: jump, hold: slide }: no chrome at all, the whole screen is the button. Compose from the draft in run_script: const draft = ctx.resolveControls().surface; ctx.world.inputs.touch = { surfaces: { default: { ...draft, sticks: [] } } }: "I don't need the joystick" in two lines; the engine never merges surfaces. Per-mode controls are the selector, never a spec edit (that hits every player at once): it reads live state, so reconnects and late joiners land right. More verbs than one screen fits: a { action: "more" } button flips a state flag the selector reads.

<api>
ctx.resolveControls(name?): { surface, diagnostics } // no arg or "auto" = the draft as a value, the same document surfaces takes, plus every drop and why (capped chips by name, the suppressed stick with the axis names that caused it); a name = that authored surface with its validation faults. Read it before redesigning and again after
inputs.touch.enabled: false // the kill switch: no touch controls at all, authored included
inputs.touch.surfaces.<name> // a complete document; declaring one replaces the draft whole. "default" is active when no selector picks. Every x/y/axis/action string names a DECLARED entry in inputs.axes/actions: declared-but-unbound is fine; an invalid widget drops with a fault naming the fix, an unusable document parks players to the draft
.orientation: "landscape" | "portrait" | "any" // the way you drew it for; default any. It draws as authored in either orientation; a surface per orientation is the selector's (device.orientation, below)
.sticks: [{ x, y, zone: "left" | "right", anchor: "floating" | "fixed", position: { x, y }, visibility: "fade" | "always", quantize: 4 | 8 }] // ≤ 2, one per zone; floating (default) spawns under the finger anywhere in the pocket; fixed takes a finger on its plate and throw, and the rest of the pocket stays the world's (taps, holds, look); position is for fixed only, 0..1 within the zone pocket (0,0 = the pocket's top-left, default centered): the pocket already dodges safe areas and reserved chrome, so no pixel math (a pocket squeezed below the 112 px plate, a landscape phone's rail-side zone, pins a fixed stick to its center and the plate can overhang); fade (default) ghosts the resting plate until first use; quantize = d-pad, magnitude 0/1
.buttons: [{ action | axis, drag: { x, y }, label, icon, zone, slot, size: "primary" | "secondary", role: "confirm" | "cancel" }] // exactly one of action (press/release edges like a key) or axis (held at 1 while pressed: pedals, ADS); drag composes with action: hold streams radial -1..1 to the axes, release fires the action with actionData { x, y, magnitude }, a sub-slop tap is a plain press; label, icon one glyph; zone default right; slot is ordering, not capacity: 1–4 pin the thumb arc's positions (muscle memory; size is honored off them), a higher number takes the next open one, a fifth right-zone chip starts an overflow row, and what geometry cannot fit (safe area, reservations, 44 px floors) drops loudly from the end: a designed surface is how a fifth verb earns a chip
.pads: [{ x, y, mode: "absolute" | "relative", zone, label }] // absolute: position IS the level (a wheel; omit y for one-axis steer); relative: per-tick deltas in pad fractions, a full-width swipe sums to ~1 (touchpad-look)
.gestures: { tap, "double-tap", hold, press } // the world grammar, a closed set, one action each; timings are engine-owned (the numbers: →pointer-raycasting)
.look: true, .pinch: true // omitted = derived from bindings (lookX/lookY bound, a wheel axis bound)
.symmetric: true // keeps the two analog pockets congruent; default false. Pockets shrink to dodge reserved chrome, and on phones the right-edge rail shortens the RIGHT pocket (uneven twin sticks or pads); symmetric mirrors that onto the left. One analog region per zone (stick or pad; sticks claim first)
inputs.touch.style: css // the controls' look over the engine's own, scoped to them: parts [data-part="button"] (data-action, data-size primary | secondary, data-zone, data-role, data-pressed while held; its word is fitted to the chip unless a rule sets font-size), "stick" (data-resting fade | always on a resting plate) > "thumb" (data-live past the deadzone), "pad", inside the root [data-part="touch"] whose data-surface names the surface; @font-face (an uploaded .woff2 at its /cdn/ URL) and @keyframes work; where a piece stands and its hit area stay the engine's whatever a rule says
inputs.touch.active: script // the selector: default export (ctx) => name, or { surface, labels: { <action or axis>: "Dig" | null } }, per player, at UI cadence; ctx is { player, device: { orientation, coarse } }: player is the same view ui.js gets (state, tags, place, position). labels are the pieces' words now, a chip by its action, a stick or pad by an axis it drives; a word replaces a chip's icon or a pad's label, null takes the piece off the glass, so one surface says what each piece does now, never a surface per word; a words change re-dresses the pieces in place and holds on the rest go on. "auto" names the draft; junk or an unknown name parks that player to the draft with a teaching fault; over 4 swaps a second are suppressed and reported; a swap mid-press gives held fingers clean releases
inputs.actions.<name>.touch: { button, label, slot, gesture } // tunes the DRAFT only: button false excludes, slot 1–4 pins, gesture binds tap/double-tap/hold/press on the world instead of a chip
inputs.actions.<name>.active: script // who holds it: default export (ctx) => boolean per player, ctx.self the player, read-only; falsy = no key, pad button, chip or keys-page row for them, input reads stay booleans; builders only: (ctx) => ctx.self.isEditor
input.axes.touchActive: 1 | 0 // engine-written: 1 while touch is the live input, 0 when mouse or keys take over, never written on desktop: branch feel on it, no device sniffing
input.axes.touchTwist: radians // engine-written: how far the two fingers on the world turned this tick, + clockwise, 0 with one finger: a delta like lookX (pinch is zoomIn); rotate the piece, roll the camera, steer: your math
sendAction("sprint", undefined, { down: true }) / { down: false } // a held button in your own HTML UI; down edges carry no payload
?touch=1 on the game URL // a desktop creator's eye on the live touch layout; look with target "player" and device "phone" shows the phone frame
</api>