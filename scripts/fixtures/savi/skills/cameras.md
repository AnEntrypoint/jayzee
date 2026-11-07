# Cameras

Def: `camera: templates/camera.js#camera` in `world.config.yaml`. Rig `scripts/camera.js`: `onInput(ctx, input)` at no fixed rate (held-key motion integrates in `update` on `dt`; `ctx.now()` moves only per tick); `update(ctx, dt)` once a tick (120/s while it poses its target or what that rides, or a live look rig ignores `dt` or poses `interpolation = null` viewmodels). `ctx.self` IS the rig: `.state.*` · `.target` (the hull while driven: `.feetPosition`, `.rotation` in degrees) · `.view.yaw/.pitch` (radians, +pitch looks UP, undefined before frame 1) · `.feetPosition` · `.rotation = { yaw, pitch, roll }` in degrees | a quaternion | `{ lookAt: p, include: ["yaw", "pitch"] }` · `.hideLocalPlayer/.pointerLock/.fov/.clip/.orientation` (the rig's layer: each stands until rewritten or the rig dies; `= undefined` clears). `ctx.world.camera.aspect`: this screen's width ÷ height, live (<1 on an upright phone; undefined before frame 1); `.insetRight` the width share Spawn's rail covers (keep the player left of it): `.fov` spans the short edge and `state.orthoSize` the half-height in m (half-width = orthoSize × aspect; widen the rig on a tall screen). `ctx.place`: the target's. k = `2×ctx.player.bounds.obb.halfExtents.y/1.8` scales body lengths. Yaw 0 faces −Z; an eye behind the look = `pivot + (sin yaw·cos pitch, −sin pitch, cos yaw·cos pitch)·dist`.

ON AN AXIS THE LOOK HOLDS, A WRITE (`state.yaw` / `.pitch`, radians) turns the look by its offset from `view` and the mouse keeps turning it (recoil = `view.pitch + kick`), but a rig reading `lookX` / `lookY` sees its write exactly; unwritten, the axis is the mouse's within `minPitch` / `maxPitch`. A cutscene holds axes: `orientation = { source: "look", authoredAxes: ["yaw", "pitch"] }`, then `{ source: "look" }`.

`{ source: "look" }` + `pointerLock: true` = the engine's live orbit around `target`: pivot = feet + `state.heightOffset` (1.8), slid `state.lateralOffset` (0) m right of the look with the aim (over the shoulder); arm = min(`state.desiredDist` (6), `state.collisionDist`); aim = feet + `state.lookOffsetY` (1.5). Leave `collisionDist` unwritten: the engine casts the arm from the pivot (walls, crates, ground stop it; characters never). Write it only to own the cast (`raycast` from "builtin/physics", `minSize: 1`: posts, coins, branches never stop it). What the arm passes through fades on this screen alone: `ctx.player.faded = { [id]: 0.35 }` (opacity, eased; `{ opacity, fade: 0 }` snaps; `{}` shows all; collider and shadow stay), ids from a `multiple: true` raycast aim to eye, on change. Arm ≤ half the narrowest space walked (4 m tunnel: `desiredDist` ≤ 2 over the shoulder, or first person); longer casts short at every wall. A look rig still writes `feetPosition` + `rotation` every tick: that ROW (the eye before the cast) is what play tests and readers see; aim from `ctx.world.camera`, the drawn frame ~2 ticks behind.

`{ source: "script" }` + `pointerLock: false`: the rig authors the whole pose each tick; the mouse arrives only as `input.axes.lookX/lookY`, 0.0006 rad a pixel (×1.75 while a drag turns the look: the right button here, any under `"drag"`, the named one under `{ drag: "left" }`) times the player's look sensitivity (`lookY` follows invert-Y); the def's `sensitivity` is the look rig's alone (times the player's setting, one channel for mouse and touch: 1.5–2 deliberate, <1 broken): scale by the rig's `sens` (`yaw -= lookX * sens`; 3 matches the def's default) and clamp pitch yourself.

Layers: `player.camera.pointerLock = false` changes one field, keeps the rig; `player.camera = {…}` is the player's whole camera (name its `behavior` or no rig follows); `null` = hard cut (the incoming rig owns any glide); `ctx.world.camera` swaps everyone durably. A mount sets the layer in the hull's `onControlBegin(ctx, player)`, clears it in `onControlEnd`. Toggled modes (chase/hood/cockpit) = ONE script, `state.mode`, per-mode numbers sprung toward; never a script swap, never `state = {…}` (wipes yaw/pitch).

Chase (car, boat, mount): a LOOK rig on the hull; `ctx.self.frame` = the eased heading each tick, `state.yaw` unwritten, so the mouse turns the view every frame (`view.yaw`: its swing); the recenter eases the frame. Hulls only (a walking body's eye is the orbit above). No starter carries it; write it whole:

```js
// scripts/chase-camera.js; hull onControlBegin: player.camera = { kind: "custom", behavior: ["scripts/chase-camera.js"], orientation: { source: "look" }, pointerLock: true }; onControlEnd: player.camera = null
var DIST = 7, HEIGHT = 3.7, AIM = 1.4, HEADING_RATE = 5, RECENTER = 1.5, REST = 0.35;
var wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
export function update(ctx, dt) {
  var t = ctx.self.target, s = ctx.self.state, v = ctx.self.view; if (!t) return;
  var goal = t.rotation.yaw * Math.PI / 180, h = s.heading ?? goal;
  s.heading = wrap(h + wrap(goal - h) * (1 - Math.exp(-HEADING_RATE * dt)));
  var hand = v ? v.yaw : 0;
  if (hand !== s.hand) { s.hand = hand; s.rest = 0; } else s.rest = (s.rest ?? REST) + dt;
  if (s.rest > REST) s.bias = wrap((s.bias ?? 0) + hand) * Math.exp(-RECENTER * dt) - hand;
  var base = s.heading + (s.bias ?? 0);
  ctx.self.frame = { yaw: base * 180 / Math.PI };
  s.heightOffset = HEIGHT; s.desiredDist = DIST; s.lookOffsetY = AIM;
  var yaw = base + hand, pitch = v ? v.pitch : 0, cp = Math.cos(pitch), f = t.feetPosition;
  ctx.self.feetPosition = { x: f.x + Math.sin(yaw) * cp * DIST, y: f.y + HEIGHT - Math.sin(pitch) * DIST, z: f.z + Math.cos(yaw) * cp * DIST };
  ctx.self.rotation = { lookAt: { x: f.x, y: f.y + AIM, z: f.z }, include: ["yaw", "pitch"] };
}
```

Never `{ source: "script" }` + `pointerLock: false` on a driven hull: boarding frees the cursor and kills the look.

Seat in a moving car or cockpit: `ctx.self.parent = ctx.self.frame = carId`, `feetPosition` = the eye in its metres, no rotation: the mouse looks round.

First person = the starter: eye at feet + `1.6k`, `rotation` from `view` in degrees, `hideLocalPlayer = true` per tick (`false` shows that eye the body, not its head), the wheel unbound, the body facing where it walks (`turnTo: movement` in `player.yml`, under every rig: keys down it turns toward them; keys up it holds while the look swings, turning in place past `turnInPlace`). `walk`: a standing body never turns. `camera`: always faces the look. A body's own `state.turnTo` outranks the yml (per place). Held item, ADS, bob, sway, recoil →projectiles. Query rows and `target.state` land at tick rate: smooth them before the eye, `x += (goal − x)·(1 − exp(−rate·dt))`, 5–12/s. Not `target.feetPosition`: its row steps per tick, but the engine lays that eye on the drawn body each frame.

Iso: `{ source: "script" }`, `pointerLock: false`, `projection: "orthographic"` (the wheel moves `state.orthoSize`), yaw 0.785, pitch 0.615 (positive), distance 2 × orthoSize (nearer clips the foreground; fog and shadows count from the eye), pivot +1.5, `rotation = { lookAt: pivot, include: ["yaw", "pitch"] }`. W walks up-screen (aim basis: presented yaw), Q/E a `rotateCamera` axis into `state.yaw`. Top-down 3D: `rotation = { yaw: 0, pitch: -90 }` (no lookAt: a hair off vertical swings yaw), height 15, follow 8/s. Pixel-art 3D: orthographic, `rotation = { yaw: 0, pitch: -45 }`, `state.orthoSqueeze = Math.SQRT1_2`, `perfectPixelArt`. One eye over bodies alike: mark the player's own with a YOU plate anchored on `ctx.self.id` (→game-ui). 2D (`mode: 2d-top | 2d-side`, orthographic): the same rig, `pixelSnap: true`, camera z only clips; 2d-side's starter camera.js IS the rig (dead zone, look-ahead, per-axis follow, `state.worldBounds = { left, right, bottom, top }` from the `"level"`-tagged entity's onSpawn). Sprites, parallax, `?facing=` →2d-mode.

`zoomIn: { mouse: wheelY }` under `inputs.axes` (feeds pinch too; + is IN (wheel up, pinch out, ≈0.5 a notch), so `distance -= zoomIn × sens`). Engine axes: `lookX/lookY/aimYawSin/aimYawCos/aimPitchN`. `"a/d"` reads −1/+1.

<samples>
A fresh 3D world's camera pieces (Edit against these bytes):
templates/camera.js: export const camera = { behavior: ["scripts/camera.js"], kind: "custom", orientation: { source: "look" }, sensitivity: 3, state: { pitch: 0, yaw: 0 } }; (pretty-printed under a marker line): replace it whole for third person.
scripts/camera.js: the first-person eye above, reading ./lib/data/camera.yml (eyeHeight 1.6); replace it whole.
scripts/lib/data/player.yml: acceleration 80, deceleration 120, jumpSpeed 10, turnInPlace 90, turnSmoothing 0.06, turnSpeed 900, turnTo movement, walkSpeed 6; humanoid-locomotion.js reads turnTo and turnInPlace.
world.config.yaml inputs (two-space YAML): actions: jump: { keys: [space] }; axes: moveX: { keys: a/d }, moveZ: { keys: s/w }.
The 2D starters' defs: 2d-side {"behavior":["scripts/camera.js"],"kind":"custom","orientation":{"source":"script"},"pixelSnap":true,"pointerLock":false,"state":{"orthoSize":5.625}}; 2d-top the same with orthoSize 12, its dials in scripts/lib/data/camera.yml (orthoSize 12, minOrthoSize 5, maxOrthoSize 30, follow 8) and zoomIn: { mouse: wheelY } declared.
</samples>