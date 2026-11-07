## ObjectPropertiesSpec (full)

physics.capsule height and radius are in the object's own meters, and the object's scale multiplies them like every collider: height 2 on a scale-8.9 body collides 17.8 m tall. height is end to end, caps included.

```ts
ObjectProperties = {
  feetPosition?: PositionSpec,
  rotation?:
    | deg
    | { yaw?, pitch?, roll? }
    | { x, y, z, w }
    | { lookAt: PositionSpec, include?: ["yaw" | "pitch" | "roll", ...] },
  yaw?: deg,
  scale?: num | { x, y, z },
  visible?: bool,
  visibleInFirstPerson?: bool | null,
  castShadow?: bool,
  receiveShadow?: bool,

  primitive?: PrimitiveSpec,
  sprite?: { texture: "/cdn/value.<sha>.png", size?: [x, y], billboard?: "none" | "yaw" | "full", upright?: bool, cutout?: bool, alphaCutoff?: num, pixelsPerUnit?: num, anchor?: [x, y], tint?: Color, opacity?: num, blend?: "alpha" | "add" | "multiply" | "subtract" | "screen", lit?: bool, emissive?: num, normalStrength?: num, flipX?: bool, flipY?: bool, sortingLayer?: num, sortingOrder?: num, ySort?: bool, filter?: "pixel" | "linear", parallax?: [x, y], repeatX?: bool, uvRect?: { x, y, width, height }, events?: Record<string, Record<string, str>> | null, trail?: { interval?: num, life?: num, count?: num, tint?: Color | [Color, Color], fade?: "alpha" | "shrink" | "both", blend?: "normal" | "additive" } | null, material?: ScriptedMaterialSpec },
  room?: { width: num, depth: num, height?: num, wallThickness?: num, floorThickness?: num, ceiling?: bool, material?: MaterialSpec, wallMaterial?: MaterialSpec, floorMaterial?: MaterialSpec, ceilingMaterial?: MaterialSpec, openings?: [{ side: "north" | "south" | "east" | "west", width: num, offset?: num }, ...] },
  path?: { mode?: "tube", points?: [[x, y, z] | PositionSpec, ...], beziers?: [{ from: [x, y, z] | PositionSpec, c1: [x, y, z] | PositionSpec, c2: [x, y, z] | PositionSpec, to: [x, y, z] | PositionSpec }, ...], radius?: num, closed?: bool, samples?: num | "auto", up?: [x, y, z], revision?: num },
  layout?: { box?: { min?: { x?, y?, z? }, max?: { x?, y?, z? } } },

  material?: MaterialSpec,

  physics?: "none" | "static" | "dynamic" | "kinematic" | "character" | false | { body: "none" | "static" | "dynamic" | "kinematic" | "character", collider?: "auto" | "box" | "sphere" | "capsule" | "cylinder" | "mesh" | "none" | str | { kind?: str }, trigger?: bool, mass?: num, density?: num, friction?: num, frictionCombine?: "average" | "min" | "multiply" | "max", restitution?: num, restitutionCombine?: "average" | "min" | "multiply" | "max", linearDamping?: num, angularDamping?: num, gravityScale?: num, lockedAxes?: ["x" | "y" | "z" | "rotX" | "rotY" | "rotZ", ...], layer?: str, autostep?: { maxHeight, minWidth } | false, maxSlopeClimbAngle?: deg , minSlopeSlideAngle?: deg , slideEnabled?: bool, snapToGroundDistance?: num | false , characterMass?: num, applyImpulsesToDynamicBodies?: bool, offset?: num, capsule?: { height?, radius? } , up?: [x, y, z] | { x, y, z } },

  light?: LightSpec,
  audio?: { kind: "vibe" | "program", script: "scripts/file.js", gain?: 0-2, params?: Record<string, any>, bus?: str, spatial?: bool, maxDistance?: num, refDistance?: num, rolloffFactor?: num, priority?: num, paused?: bool } | { kind?: "clip", clip: "cdn/sound.mp3", gain?: 0-2, pitch?: num, loop?: bool, end?: num, loopStart?: num, loopEnd?: num, spatial?: bool, maxDistance?: num, refDistance?: num, rolloffFactor?: num, bus?: str, priority?: num } | null,

  interpolation?: { teleportThreshold: num } | null,

  pivot?: "feet" | "center" | "top" | [x, y, z] | { x, y, z },
  render?: bool,
  visibleRange?: { min?, max? } | null,
  layers?: [str, ...] | null,
  visibleTo?: "all" | "editors",
  vector?: str,
  jiggle?: bool | { amount?: 0-1, bounce?: 0-1, gravity?: 0-1, wind?: { force?: num }, bones?: [str, ...], radius?: num, limit?: deg, colliders?: [{ bone?: str, entity?: str, offset?: [x, y, z], tail?: [x, y, z], radius: num }, ...] } | [{ amount?: 0-1, bounce?: 0-1, gravity?: 0-1, wind?: { force?: num }, bones?: [str, ...], radius?: num, limit?: deg, colliders?: [{ bone?: str, entity?: str, offset?: [x, y, z], tail?: [x, y, z], radius: num }, ...] }, ...] | null,
  morph?: Record<string, num> | null,
  bones?: Record<string, { rotate?: [x, y, z], offset?: [x, y, z], scale?: num, visibleInFirstPerson?: bool, mass?: num, reach?: { x: num, y: num, z: num, rotation?: num | { yaw?, pitch?, roll? } | { x, y, z, w } } | { object: str, offset?: { x, y, z }, rotation?: num | { yaw?, pitch?, roll? } | { x, y, z, w } } | { to: { x: num, y: num, z: num, rotation?: num | { yaw?, pitch?, roll? } | { x, y, z, w } } | { object: str, offset?: { x, y, z }, rotation?: num | { yaw?, pitch?, roll? } | { x, y, z, w } }, pole?: { x, y, z } | { object: str, offset?: { x, y, z } }, weight?: num, blendIn?: num, blendOut?: num }, aim?: { x, y, z } | { object: str, offset?: { x, y, z } } | { to: { x, y, z } | { object: str, offset?: { x, y, z } }, weight?: num, blendIn?: num, blendOut?: num }, ground?: 0-1 }> | null,
  wisp?: { color: str, state?: "unlit" | "idle" | "weaving" | "settling" | "guttering" | "sleeping", expression?: "auto" | "curious" | "happy" | "sleepy", shape?: "classic" | "slender" | "twin", burnStyle?: "calm" | "crackle" | "pulse" | "wave", seed?: num, size?: num, mouth?: 0-1 } | null,
  boxart?: { game: str } | null,
  collider2d?: { outline: [[x, y], ...] },
  ui?: str | null,
  press?: { radius: num, strength?: num, at?: [x, y, z], below?: num } | [{ radius: num, strength?: num, at?: [x, y, z], below?: num }, ...] | null,
  fx?: { script: "scripts/file.js", params?: Record<string, any>, seed?: num, paused?: bool, enabled?: bool },
  voice?: { gain: 0-1 } | null,
  model?: "cdn/model.glb" | { id, offset?: [x, y, z] },
  mixer?: { <channelName>: { clip: string, weight?: num, speed?: num, loop?: "once"|"loop"|"pingpong", blendIn?: num, blendOut?: num, talking?: true } },
  attachment?: { bone: "RightHand" } | { skin: true } | { socket: "muzzle" } | { part: "turret" },
  spline?: SplineSpec,
  scatter?: {
    bounds: ScatterBounds,
    sampling: { strategy: "poisson", minDistance } | { strategy: "grid", spacing, jitter? } | { strategy: "random" } | { strategy: "clustered", clusters, radius } | { strategy: "edge", band? },
    count: num, seed: num,
    templates: [{ ...ObjectPropertiesSpec, weight?, tags?, state?, behavior? }, ...],
    variation?: { scale?: [min, max], yaw?: [min, max] },
    surface?: "terrain" | { y: num },
    filter?: { maxSlope?: num, minSlope?: num, materials?: [terrainMaterialId, ...] },
  },
}
```
