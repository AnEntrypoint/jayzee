## builtin/fx

Export effect(ctx) from the effect script. Return fx(...populations). Spawn rate is particles per second. lifetime, delay, and window use seconds; size uses meters; rotation uses radians. alpha is 0 to 1. World space is the default. An omitted lifetime does not expire. The effect ends when its owner is removed, or call ctx.destroy(id). A sprite with align: "ground" lies flat on the face attr("normal") names, so a ripple ring or a stamp lies along the slope or wall it hit, with no axis. parent(name) is a when() child's live read of its spawning parent each tick: "p", "v", "age", "life", "size", "rand", "localP", "normal" or the parent's own attribute; a dies child reads its parent as it died.

```ts
emit("fx", { position, script, params, seed, tags, attachTo }): id
getObject(id).fx.params.<k> = v
ctx.pulseFx(id, name, { at, data })
ctx.getFxState(id): per-population { alive, rate, lifetime, expectedAlive }
export function effect(ctx): fx(...pops) | fx({ follow: "player" | "camera" }, ...pops)
pop(name, def)
spawn: { rate, on, burst: { count: [min, max], every: [min, max] } }
spawn: when(other.dies, p) | when(other.dies, { count: N, probability })
spawn: when(other.lives, { rate, count })
spawn: { when: { event: "pulse", name }, count: [1, 1] }
count: N
wrap: [hx, hy, hz]
delay: s, window: [start, end]
space: "local"
floor: "die" | "stick" | "bounce", bounce: 0..1 | range()
collide: "die" | "stick" | "bounce"
lifetime: s | [min, max] | range(min, max)
init: { v, <attr>: field }, inherit: { p: parent.p, v: parent.v.mul(0.5), … }
accel: vec3 field
pos: field, vel: field
color: vec3 (HDR ok) | "oklch(L C H)", alpha: 0..1, size: meters, rotation: radians, aspect: width ÷ height, frame: index, erode: 0..1, uvOffset: vec
attrs: { name: field }
inheritVelocity: 0..1
maxParticles: N
render: sink | sink[]
disc({ r, jitter, lift }), sphere({ radius, lift }), box({ halfExtents, lift }), arc({ radius, angle, lift }), line({ length, axis, lift }), point({ lift }), path(points | points[] | 'M… Q… …' | entity(id), { lift, plane: 'xz' | 'xy', size, viewBox })
range(min, max), curve([t, v], …), noise(input), curl(freq), cone(deg), sphereDir(), time(), floorHeight(), attr(name), count(pop), entity(id), wind(), field({ halfExtents, resolution, data | sample })
attr names: p v age life size rand localP normal + init / inherit / attrs keys + seg along channel (path) + pulse.data.<key>; normal is world up until a floor: or collide: contact, then the face it met, and a when() child starts with its parent's
.add .sub .mul .div .neg .min .max .mix .cross .clamp01 .saturate .normalize .length .to(g) .sin .cos .atan2 .fract .floor .step(edge) .smoothstep(e0, e1) .abs .mod .pow .sqrt .dot .yaw()
flicker(hz, amount = 0.15), firelight(slowHz = 1.2, fastHz = 2), spin(maxRps = 1), envelope(...keys), gravity(), up(speed = 1), buoyancy(k), drag(k), blast(speed), radial(speed), attract(strength), vortex(strength, axis = [0, 1, 0]), hdr(r, g, b), vec3(x, y, z), force(f)
orbit({ radius, rps = 1, phase = 0, around, axis = [0, 1, 0] })
seek(target, speed)
along({ points, t, around })
parent(name)
sprite({ texture | textures: sheet(url), blend: "add" | "alpha" | "multiply" | "subtract" | "distort", align: "full" | "yaw" | "velocity" | "axis" | "segment" | "ground", axis, stretch: 0, soft: meters, lit: true, repeat: [u, v], filter: "pixel" | "linear", glow: 0.1, depthTest: false, sortingLayer: 75, sortingOrder: 2 })
mesh({ shape: "box" | "cylinder" | "sphere" | "card", dims: [x, y, z], align: "velocity", script, blend, soft, material, params })
ribbon({ length, lifetime, fade, emitting, width, color, texture, textureLength, minDistance, segments, maxDistance, facing: "camera" | "ground" | [x, y, z], surfaceOffset, blend, soft, material, params, sortingLayer, sortingOrder })
light({ color, intensity, radius, perParticle })
rgb(r, g, b): vec3
```
