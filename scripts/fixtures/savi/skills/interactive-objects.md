# Interactive Objects

Five shapes: a proximity query in `update()` (coins, a door that wakes as you walk up) · a `press` ear (chests, levers, NPCs) · a trigger volume (plates, tripwires, traps) · a state write on another handle (plate → gate) · animated motion of a `kinematic` body (lifts, doors).

- No interact action ships: declare one, `world.inputs.actions.interact = { keys: ["e"] }`, and a phone projects it as a chip that carries the action's own word, INTERACT; the player's `onInput` reads `input.pressed.interact`, queries `interactable` within 3 m, `ctx.emit("press", { by: ctx.self.id }, { to: nearest.id })`: `to` rings one ear (`ctx.on("press", …)` in the target's `onSpawn`); `ctx.getObject(by)` is the presser. A prompt is your game UI: the engine draws none; it names the act the thing takes (Open, Talk, Take), and the control beside it is the device's own, read live from `ctx.world.inputs.actions.interact.label`. Write it in the game's HTML (→game-ui) with your own near-and-facing rule: the player's `update()` picks the interactable within 3 m nearest the camera's forward and writes its act to player state, the UI binds it on the thing (`data-world-anchor="<id>"`, →game-ui) and fades it. A thing with a face (a pad, a stall's board) switches and SELLS through its own `ui` plate: `<button id="buy-sword">` rings `ctx.on("ui:buy-sword", (ctx, { by }) => …)`, the buyer's `state.gold` pays, a bound `{{ state.sold }}` follows, never a proximity prompt for a shop.
- Hinge = `pivot`: `[0, 0.5, 0.5]` the left edge (0..1 per local axis, v up; `[0.5, 0.5, 0]` + pitch a lid). Ignored on dynamic bodies: a swinging door is `physics: "kinematic"` (moves AND blocks; the collider rides the leaf); write `rotation` (a slab: `feetPosition`) yourself, eased in `update()` ~300 °/s. Author closed, facing the doorway, `yaw: 0`; the open state on the door's own row: one door for every player.
- Plate = TWO entities: an invisible trigger (`physics: { body: "static", trigger: true }`, ~1.5 m tall so a body reliably enters) over the visible plate; `onTriggerEnter/Exit` → an `overlapping` map, down while ANY key stands; the link = one write on the other handle, `ctx.place.objects["gate-1"].state.open = true`, read in the gate's own `update()`. `playSound` at `ctx.self.worldFeetPosition` on open AND close. Trap = the same trigger + `ctx.emit("impulse", { target: other.id, impulse })` on the body that entered (a kick a player's own motor cannot ease away; `hurt` is your own event, heard by the body's `ctx.on`) + a re-arm timer on its own state.
- A flat coin (`cylinder`) is invisible edge-on → `rotation: { pitch: 90 }`; `ctx.after(0.12, "vanish")` so the pop covers the disappearance. Lift = kinematic motion toward `stops[]`; the engine carries riders and releases them with momentum. Belt = `physics: { body: "static", surfaceVelocity: [0, 0, 2] }`, m/s in its own frame. Dialog: the `press` ear copies the tree's node into the PLAYER's state and frees the pointer (`player.camera.pointerLock = false`); `update()` ends it (`player.camera = null`) when they walk off. Held thing = `spawn({ parent: ctx.self.id, tags: ["carried"], attachment: { bone: "RightHand" } })` seated in its `fist` (→uploaded-models), read back as that row, never player state (a room change re-creates the body). Swap = `ctx.trade(mine, { with: theirBodyId, for: theirItemId })` from each side; both marks standing → both hands change in ONE tick, else nothing, never a lock, a timer, an escrow object.

```js
// scripts/door.js: one entity IS the door: a kinematic box, pivot [0, 0.5, 0.5] (the hinge = its left edge), tags ["door", "interactable"], state { open: false, yaw: 0 }
export const ears = {
  press: (ctx, { by }) => {
    const open = (ctx.self.state.open = !ctx.self.state.open);
    ctx.emit("playSound", { clip: open ? "cdn/sfx-door-creak-open.mp3" : "cdn/sfx-door-shut.mp3", position: ctx.self.worldFeetPosition, volume: 0.5 });
  },
};
export function update(ctx, dt) {
  // ease the yaw at 300 °/s toward 100 open / 0 shut; the collider swings too
  const target = ctx.self.state.open ? 100 : 0,
    yaw = ctx.self.state.yaw ?? 0;
  if (yaw !== target) ctx.self.rotation = { yaw: (ctx.self.state.yaw = yaw + Math.sign(target - yaw) * Math.min(Math.abs(target - yaw), 300 * dt)) };
}
```

<api>
ears.press = (ctx, { by }) => … // the ear, declared; by = the presser's id; the press is ctx.emit("press", { by }, { to }) from the player's onInput on an interact action you declare
ctx.trade(mine, { with, for } | null): { offered, id, give, with, for } | { offered: false, refused: "unknown-target" | "not-held" | "not-mine" | "same-party" | "withdrawn", message } // both sides call it; null withdraws; the mark rides state.__trade { to, for, verdict }
</api>