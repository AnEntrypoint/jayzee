# Projectiles

```js
// scripts/player-gun.js: the FIRST-PERSON GUN, yours to write: a viewmodel on the camera, the shot from the eye
import { getInputRay, raycast } from "builtin/physics";
import * as combat from "./lib/combat.js"; // yours: damage(ctx, id, amount, { source })
const RATE_MS = 140, DAMAGE = 22, RANGE = 90, REST = { x: 0.26, y: -0.24, depth: 0.5 };
const feel = (s) => { if (typeof s.kick !== "number") Object.assign(s, { kick: 0, kickV: 0, swayX: 0, swayY: 0, pullX: 0, pullY: 0 }); return s; }; // seeded on every hook, so a re-bind never writes NaN
export function onSpawn(ctx) {
  const s = feel(ctx.self.state);
  if (s.gunId && ctx.getObject(s.gunId)) return; // one gun per body across rejoins
  s.gunId = ctx.spawn({ audience: "local", scope: "session", feetPosition: { attach: "camera", ...REST, fov: 55 }, primitive: { kind: "scripted", script: "scripts/gen/rifle.js", sockets: { muzzle: [0, 0.07, -0.62] } } }); // −Z forward
}
export function onInput(ctx, input) {
  const s = feel(ctx.self.state), a = input.axes, now = ctx.now();
  const yaw = Math.atan2(a.aimYawSin ?? 0, a.aimYawCos ?? 1), pitch = (a.aimPitchN ?? 0) * 1.2;
  if (s.lastYaw != null) { const dyaw = Math.atan2(Math.sin(yaw - s.lastYaw), Math.cos(yaw - s.lastYaw)); s.pullX = Math.max(-0.05, Math.min(0.05, s.pullX + dyaw * 0.9)); s.pullY = Math.max(-0.04, Math.min(0.04, s.pullY - (pitch - s.lastPitch) * 0.7)); } // the look's delta pulls the gun the OTHER way
  s.lastYaw = yaw; s.lastPitch = pitch;
  if (!input.held.fire || s.dead || now < (s.nextShotAt ?? 0)) return; // held = an automatic; pressed = a semi-auto
  s.nextShotAt = now + RATE_MS;
  s.kickV += 9;
  const ray = getInputRay(ctx, input);
  if (!ray) return;
  const muzzle = ctx.getObjectSocket(s.gunId, "muzzle");
  if (muzzle && muzzle.position) ctx.emit("fx", { position: muzzle.position, attachTo: s.gunId, script: "scripts/effects/muzzle-flash.fx.js", params: { dir: ray.direction } }); // born at the socket AND riding the gun
  ctx.emit("cameraPunch", { direction: { x: 0, y: 0.35, z: -1 }, intensity: 0.4 }, { audience: { player: ctx.self.id } });
  ctx.emit("playSound", { clip: "cdn/sfx-rifle-shot.mp3", position: ray.origin, pitch: 0.95 + ctx.random() * 0.1 });
  const hit = raycast(ctx, ray.origin, ray.direction, { distance: RANGE, ignoreEntities: [ctx.self.id, s.gunId] });
  if (!hit) return;
  const t = hit.id ? ctx.getObject(hit.id) : null;
  if (t && t.tags.includes("enemy") && !t.state.dead) { combat.damage(ctx, t.id, DAMAGE, { source: ctx.self.id, kind: "bullet" }); ctx.emit("hitstop", { duration: 0.02 }, { audience: { player: ctx.self.id } }); ctx.emit("playSound", { clip: "cdn/sfx-hitmarker-click.mp3", position: ray.origin, volume: 0.5 }); }
  else { ctx.emit("decal", { position: hit.position, normal: hit.normal, texture: "cdn/decal-bullet-hole-stone.png", size: 0.12, lifetime: 25 }); ctx.emit("fx", { position: hit.position, script: "scripts/effects/impact-dust.fx.js" }); ctx.emit("playSound", { clip: "cdn/sfx-ricochet-stone.mp3", position: hit.position, volume: 0.5 }); }
}
export function update(ctx, dt) {
  const s = feel(ctx.self.state), gun = ctx.getObject(s.gunId);
  if (!gun) return;
  s.kickV += (-180 * s.kick - 14 * s.kickV) * dt; s.kick += s.kickV * dt; // k 180 / c 14: one overshoot, home in ~0.35 s (a pistol: 400 / 22)
  s.pullX *= Math.max(0, 1 - dt * 6); s.pullY *= Math.max(0, 1 - dt * 6); s.swayX += (s.pullX - s.swayX) * Math.min(1, dt * 14); s.swayY += (s.pullY - s.swayY) * Math.min(1, dt * 14);
  const v = s.velocity ?? { x: 0, z: 0 }, w = Math.min(1, Math.hypot(v.x, v.z) / 6), t = ctx.now() / 1000, bobX = Math.sin(t * 9) * 0.012 * w, bobY = Math.abs(Math.cos(t * 9)) * 0.01 * w;
  gun.feetPosition = { attach: "camera", x: REST.x + s.swayX + bobX, y: REST.y + s.swayY + bobY + s.kick * 0.12, depth: REST.depth - s.kick * 0.35, fov: 55 };
  gun.rotation = { yaw: -s.swayX * 140, pitch: s.kick * 45 + s.swayY * 140, roll: -s.swayX * 70 };
}
```

- The shot is a `noise` the hunter's ear hears (the always-on `noise` line).
- Hitscan is the default for guns and lasers: no entity, no travel time: `getInputRay` then `raycast` from the EYE. A shot lands where the shooter aimed only through `raycast` or a trigger; `query()` + distance shoots through walls. The default cast meets a body's own collider, which no clip moves (a `character`: an upright capsule); `hits: "geometry"` meets what is drawn, the posed skin and the ground, and names a rig's bone (`hit.bone`).
- AN ARC IS SOLVED: `solveShot(muzzle, mark, speed, g, lead)`, null when out of range: name the miss, fire nothing. The mark is the look ray's hit or where the look meets the sea; a shot fired along the look ray drops g·t²/2 short. Solve with the g the ball flies under: a ball moved by hand falls at the g YOU write in its `update` (`s.vel.y -= s.g * dt`), a dynamic body at the place's. The ball is born a metre clear of the muzzle, its own hull in `ignoreEntities`.
- An arrow, a shell, a fireball is an ENTITY the shooter's `onInput` spawns at the true muzzle: `{ tags: ["projectile"], lifetime: 8, state: { vel, ownerId: ctx.self.id }, rotation: rotationFromDirection(vel), behavior: "scripts/arrow.js" }`: a script you write whose `update` puts gravity into `s.vel`, casts `raycast(ctx, feet, dir, { distance: step * 1.5, ignoreEntities: [s.ownerId] })` BEFORE the move so a fast shot never tunnels, and on a hit damages with `source: s.ownerId`, spawns the impact fx + decal at `hit.position` and `destroy()`s; else moves by `vel·dt` and writes `rotation = rotationFromDirection(dir)`: the nose is the modelled forward, −Z. `lifetime` is the backstop. Bullet-hell: the place's `sim.js` fires kinematic trigger spheres (`physics: { body: "kinematic", trigger: true }`, damage in `onTriggerEnter`), short-lived and capped.
- A tracer is an EFFECT, drawn by the flash program: one `path()` segment particle from the muzzle to the mark, additive, gone in a tenth of a second, a wider dim halo on the same path; a flying projectile's tracer rides the entity (`inheritVelocity`). A cylinder spawned and re-laid each tick is a thing in the world that pops in and out (→fx).
- A door is a hole in space for a ray as for a walker: a hitscan that meets an open portal continues out of the far gate; `getObject(hit.id)` reads the far thing from here. It is not in your `ctx.place.objects`, so the damage is a word through the same door: `emit("hit", { damage, by: ctx.self.id }, { to: hit.address, via: hit.doors[0].id })`, and the target's own `ctx.on("hit", (ctx, payload, meta) => …)` over there applies the health convention and spawns the impact in its own frame; the muzzle stays here. A physics ENTITY crosses through the door's trigger and its `cross()`: a round trip that hides it for a moment: fine for a lobbed grenade, wrong for a bullet.

<api>
feetPosition: { attach: "camera", x, y, depth, fov } // the viewmodel: camera-frame metres (x right, y up, depth forward); fov gives the subtree its own projection over the world (held guns ~50–55, the world 60–75); a per-tick write carries fov every time; audience "local" + scope "session": my screen only
getObjectSocket(id, "muzzle"): { position, direction, … } | null // the socket's WORLD point as this screen draws it (a viewmodel's corrected for its fov) and the barrel's unit direction; walks the parent chain; no declared socket → the forward end
fx / decal: … attachTo: <id> // the effect or the mark rides that object: a flash on the GUN (unattached, a viewmodel's flash draws where the barrel was a tick ago), a burn on the target it hit
solveShot(from, to, speed, g, lead?) → { vel, time } | null // builtin/ballistics; g a magnitude in m/s² (the place's gravity.y works as is); elevation(speed, g, distance, rise) beside it
hit.bone: { name, position, normal } // the bone the skin there rides, the hit in its frame; a mark spawned { parent: hit.id, attachment: { bone: hit.bone.name }, feetPosition: hit.bone.position } rides the limb
hit.world, hit.address, hit.doors: { id, link, world, exit }[] // only beyond a door (`through` doors deep, default 1), nearest first; address is "world:<id> +place#thing". hit.door: { link, verdict: "unheld" | "through-spent" | "no-exit", message }: the ray stopped AT a door: not held here yet, the hop budget spent, or no exit
meta.origin = { world, actor, script, door, exit, address } // the far ear's, through a door: answer with emit(name, payload, { to: meta.origin.address })
</api>