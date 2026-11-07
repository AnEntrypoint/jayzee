# Pointer Raycasting

One `onInput` serves mouse and finger, because every gesture delivers the pointer ray at the gesture point.

```js
// world.config.yaml inputs.actions: place: { mouse: "left", touch: { gesture: "tap" } }, cancel: { mouse: "right", touch: { gesture: "hold" } }
import { raycast, getInputRay } from "builtin/physics";

// state: { ghost: null }
export function onInput(ctx, input) {
  const ray = getInputRay(ctx, input); // the cursor's ray: correct origin even under an orthographic camera
  if (!ray) return;
  const s = ctx.self.state;
  const hit = raycast(ctx, ray.origin, ray.direction, { distance: 120, bodies: "static", ignoreEntities: s.ghost ? [s.ghost] : [] }); // the ghost never blocks its own ray; bodies: "static" is the ghost's exception: it lands on the ground through the things that walk. A click that picks a thing casts bare (below)
  const flat = hit && hit.normal.y > 0.5; // ground, not a wall or a ceiling
  if (!s.ghost) s.ghost = ctx.spawn({ tags: ["ghost"], audience: "local", primitive: { kind: "scripted", script: "scripts/gen/watchtower.js" }, material: { opacity: 0.35, transparent: true, depthWrite: false }, feetPosition: { x: 0, y: -100, z: 0 } });
  const ghost = ctx.place.objects[s.ghost];
  if (flat) {
    ghost.feetPosition = hit.position;
    ghost.material.color = "oklch(0.8 0.15 150)";
  } else ghost.material.color = "oklch(0.6 0.2 25)";
  if (input.pressed.place && flat) {
    ctx.spawn({ tags: ["tower", "structure"], feetPosition: hit.position, primitive: { kind: "scripted", script: "scripts/gen/watchtower.js" }, physics: { body: "static" }, state: { health: 100, buildProgress: 0 } });
    ctx.emit("fx", { position: hit.position, script: "scripts/effects/dust-ring.fx.js" }); // author the ring (fx)
    ctx.emit("playSound", { clip: "cdn/sfx-stone-thud.mp3", position: hit.position, pitch: 1 + (ctx.random() - 0.5) * 0.15 });
    ctx.emit("screenShake", { intensity: 0.15, duration: 0.2 });
  }
  if (input.pressed.cancel && s.ghost) {
    ctx.destroy(s.ghost);
    s.ghost = null;
  }
}
```

Click-to-interact and click-to-select are the same ray cast bare: `raycast(ctx, ray.origin, ray.direction, { distance: 120 })` sees every solid body and every visible sprite (`bodies` unnamed = `"all"`: a soldier's capsule, a crate, a paper enemy, the ground only where nothing stands) and `hit.id` is the thing under the cursor, then `ctx.emit("press", { by: ctx.self.id }, { to: hit.id })`. A spring arm casts `bodies: "static"` too. Click-to-move writes `state.goal = hit.position` and `update` walks a `findPath` route with a held `velocity`: walking straight at the hit is the cliff bug. Shoot-from-player-toward-cursor is two casts: the cursor ray finds the world target, then a cast from the player's shoulder (`feetPosition` is the bottom: add ~1.2 m) toward it; a ray composed from camera position + cursor direction breaks under an orthographic camera, where the cursor moves the origin across the view plane, not the direction.

<api>
getInputRay(ctx, input): { origin, direction, source } | null // null = no camera
source "pointer" = the ray this client's input sampled (onInput runs here) // unlocked: the mouse, or a phone gesture's point; locked (pointerLock: true, first person, over-the-shoulder aim): the screen-center crosshair on every device, and a gesture's finger rides `input.pointer`
source "camera" = no pointer ray rode the input (run_script, a hook other than onInput) // the camera's forward ray, never a guess at the hand
raycast(ctx, o, d, { multiple: true }): hit[] // every hit sorted by distance (a piercing shot); ignoreSelf: true is the default
raycast(ctx, o, d, { verdict: true }): { hit, hits, verdict: { queryable, terrain, … } } // queryable false = this machine could not look (run_script has no physics), never "clear"; terrain null = unknown, never empty
hit.id: the ground's id on the ground (terrain/…), not one of your objects
sprites: hit by default (billboards face the origin); text never // physicsOnly: true = colliders only
rays see every solid body: static, dynamic and kinematic (a physics: "character" soldier, a player: capsules): on the machine that simulates the caster // trigger: true is passed, includeSensors: true hits it
raycastRender: this client's picture only // a gameplay verdict is raycast(ctx, …)
touch.gesture: "tap" | "double-tap" | "hold" | "press" // on an action: the world is the button. tap/double-tap = one pulse; with double-tap bound a single tap lands after the 300 ms window. hold = active from 350 ms press-and-still until lift, the finger keeps aiming. A drag past 8 px is camera, never a gesture (drag-look and pinch-zoom coexist)
press = active from the touch until lift, a mouse button held on the world: a brush, a sweep or a dig starts under the finger at once and follows it; a still press also taps. A second finger ends it, and two fingers are the camera (drag looks, pinch zooms). Never beside hold
touch: { gesture, button: true } // a gesture action gets no chip button; button: true keeps one. Desktop bindings on the same action stay: declare both, ship one scheme
mouse: "right" alone is a chip on a phone, with no aim point // give the action a gesture too. Never inputs.touch.enabled: false to hide chips: it kills gestures, the stick and drag-look
overlapPoint / overlapSegment: { objects, approximate, terrain } // probe-grade: exact collider shapes, approximate = bounds where the shape is not loaded here, terrain null = unknown. In 3D a static model's mesh collider is a surface: a point inside it answers nothing. Right at a change (a placement check, a blocked door); wrong per tick
</api>