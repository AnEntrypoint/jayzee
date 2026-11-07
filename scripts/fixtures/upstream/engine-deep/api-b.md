# Engine API reference, second half (api-b)

Source: <upstream checkout>/.spawn/engine/api-reference.md (2277 lines). Covers headings 35 to 68 of 68 by count (lines 426 to 2277). The first half (headings 1 to 34, lines 32 to 425) is covered by the other agent.

## Index

| # | Line | Heading |
|---|------|---------|
| 35 | 426 | State (The Compat Spellings Of Ctx.Self.State) |
| 36 | 434 | Properties (The Compat Spellings Of Ctx.Self.Feetposition / .Rotation) |
| 37 | 441 | World Queries (second heading of that name; the first is line 261) |
| 38 | 449 | Behavior Hooks |
| 39 | 477 | ObjectPropertiesSpec (full) |
| 40 | 543 | PrimitiveSpec (full) |
| 41 | 589 | AtmosphereDef (full) |
| 42 | 619 | TerrainDef heightmap (full) |
| 43 | 634 | Inputs (full) |
| 44 | 643 | ObjectSpec (full) |
| 45 | 653 | Parenting (full) |
| 46 | 659 | UI rules (full) |
| 47 | 665 | Named types (full) |
| 48 | 1930 | builtin/physics |
| 49 | 1955 | builtin/tween |
| 50 | 1963 | builtin/spline |
| 51 | 1973 | builtin/math |
| 52 | 1991 | builtin/vec3 |
| 53 | 2011 | builtin/easing |
| 54 | 2018 | builtin/nav |
| 55 | 2026 | builtin/path |
| 56 | 2039 | builtin/ballistics |
| 57 | 2048 | builtin/room-routing |
| 58 | 2060 | builtin/terrain |
| 59 | 2068 | builtin/noise |
| 60 | 2083 | builtin/voxels |
| 61 | 2105 | builtin/vibe |
| 62 | 2124 | builtin/fx |
| 63 | 2170 | builtin/tsl |
| 64 | 2192 | builtin/three |
| 65 | 2229 | builtin/lighting |
| 66 | 2241 | builtin/water |
| 67 | 2259 | builtin/env |
| 68 | 2265 | builtin/postfx |

## Scripted state and behavior (lines 426 to 476)

**State (compat), line 426.** Purpose: legacy spelling of ctx.self.state. Names: `ctx.self.state`, `ctx.self.state = {…}`, `ctx.self.state.<key> = v`.

**Properties (compat), line 434.** Purpose: legacy spelling of feet position and rotation. Names: `ctx.self.feetPosition`, `ctx.self.rotation` (read and write).

**World Queries, line 441.** A query excludes self by default. Set `ignoreSelf: false` to include it. `ctx.place.players` lists the current place's players.

**Behavior Hooks, line 449.** Exported functions from a behavior module:
- `onSpawn(ctx)`, `onDestroy(ctx)`
- `update(ctx, dt: number)`, `lateUpdate(ctx, dt: number)`
- `onInput(ctx, input: InputState)`. Reads named axes and actions from the world's inputs. `pressed` and `released` apply on the transition; `held` stays true while held.
- `onCollide(ctx, other: ObjectQueryResult, contact: Contact)`
- `onTriggerEnter(ctx, other: ObjectQueryResult)`, `onTriggerExit(ctx, other: ObjectQueryResult)`
- `onCross(ctx, other: ObjectQueryResult, outcome: Extract<CrossOutcome, { crossed: true | "departing" }>)`
- `onRefuse(ctx, other: ObjectQueryResult, verdict: CrossVerdict)`
- `onLiquidEnter` / `onLiquidExit(ctx, other: ObjectQueryResult & { liquidKind?: string; markKind?: string })`
- `onSay(ctx, line: SaidLine)`
- `onSoundEnd(ctx, sound: SoundEndEvent)`
- `onOutOfBounds(ctx, event: OutOfBoundsEvent)`
- `onControlBegin(ctx, player: ObjectQueryResult)`, `onControlEnd(ctx, player: ObjectQueryResult)`
- `editor(ctx, obj: ObjectView)`, `visual(ctx, obj: ObjectView)`

Gotchas stated:
- `updateSchedule` is a data export, not a hook: `export const updateSchedule = { every: N | { seconds: s }, near: { radius } }`.
- `update()` runs only while a player is near the object. The stated locality default is about 500 m. An object with no position always runs. Logic that must advance for everyone regardless of position belongs in sim.js, not `update()`.
- The engine skips `update()` on ticks the schedule declines. `every` runs `update()` every N ticks with a per-entity phase, so cohorts spread automatically.
- `dt` equals the declared cadence step (every × tick dt).
- Declaring `every` replaces a hand-rolled `tick % N` gate. Delete the gate line; never keep both, because the phases rarely coincide and the script mostly stops running.
- A path that must run every tick should declare the gate wide enough in the export. The schedule belongs to the file, not a runtime dial.
- `async` and `import()` in a hook or ear: the part before the first `await` runs in the tick, the rest runs later on the same ctx. `import()` answers an ES module's exports. A file only `import()` names stays out of arrival. Example from the doc: `let seeder; export const ears = { "match:start": async (ctx) => { seeder ??= await import("./lib/seeder.js"); seeder.seedAll(ctx); } };`

## Object spec shapes (lines 477 to 664)

**ObjectPropertiesSpec (full), line 477.** Full property shape of an object. Top-level keys include: `feetPosition`, `rotation`, `yaw`, `scale` (`num | { x, y, z }`), `visible`, `visibleInFirstPerson` (`bool | null`), `castShadow`, `receiveShadow`, `primitive`, `sprite`, `room`, `path`, `layout`, `material`, `physics`, `light`, `audio`, `interpolation`, `pivot`, `render`, `visibleRange`, `layers`, `visibleTo` (`"all" | "editors"`), `vector`, `jiggle`, `morph`, `bones`, `wisp`, `boxart`, `collider2d`, `ui`, `press`, `fx`, `voice`, `model`, `mixer`, `attachment`, `spline`, `scatter`.
- `rotation` accepts `deg`, `{ yaw?, pitch?, roll? }`, `{ x, y, z, w }`, or `{ lookAt: PositionSpec, include?: [...] }`.
- `physics` accepts `"none" | "static" | "dynamic" | "kinematic" | "character" | false` or an object `{ body, collider?, trigger?, mass?, density?, friction?, frictionCombine?, restitution?, restitutionCombine?, linearDamping?, angularDamping?, gravityScale?, lockedAxes?, layer?, autostep?, maxSlopeClimbAngle?, minSlopeSlideAngle?, slideEnabled?, snapToGroundDistance?, characterMass?, applyImpulsesToDynamicBodies?, offset?, capsule?, up? }`.
- `collider` options: `"auto" | "box" | "sphere" | "capsule" | "cylinder" | "mesh" | "none" | str | { kind?: str }`.
- `scatter` takes `bounds`, `sampling` (`poisson`, `grid`, `random`, `clustered`, `edge`), `count`, `seed`, `templates`, `variation`, `surface`, `filter`.
- Gotcha: `physics.capsule` `height` and `radius` are in the object's own meters. The object's scale multiplies them like any collider. Example from the doc: height 2 on a scale-8.9 body collides 17.8 m tall. `height` is end to end, caps included.

**PrimitiveSpec (full), line 543.** A union of `kind` variants, each `& PrimitiveBase`. Kinds: `cube`, `box`, `sphere`, `cylinder`, `capsule`, `plane`, `torus`, `octahedron`, `tube`, `cone`, `ring`, `tetrahedron`, `icosahedron`, `dodecahedron`, `pyramid`, `lathe`, `extrude`, `circle`, `torusKnot`, `frustum`, `ellipsoid`, `superellipsoid`, `hollowCylinder`, `hemisphere`, `arch`, `archway`, `squareArch`, `wall`, `line`, `custom`, `scripted`, `points`.
- Example signatures: `{ kind: "cube"; size?: number; segments?: number }`, `{ kind: "wall"; width: number; height: number; depth: number; holes?: ...; facing?: "z" | "x" | "y" }`, `{ kind: "scripted"; script: ScriptRef; params?; seed?; forward?; sockets? }`.
- `PrimitiveBase = { materialKey?, overrides?: DrawMaterialOverrides, sockets? }`.
- Note: a scripted primitive's `collider()` may return a heightfield, one collider for an object's ground from a grid of heights (`spawn api ColliderHeightfield`).

**AtmosphereDef (full), line 589.** `atmosphere: { sky?, ground?, fog?, sun?, ambient?, hemisphere?, environmentIntensity?, clouds?, stars?, moon?, wind?, wet?, rain?, timeOfDay?, cycle?, look? }`.
- `sky.kind`: `"color"`, `"gradient"`, `"rayleigh"`, or `"realistic"` with `model: "rayleigh" | "hosek"`.
- `fog.kind`: `"linear"` (`near`, `far`) or `"exp2"` (`density`).
- `timeOfDay?: 0-24`.
- `cycle` forms: `{ periodMs, epoch, bands? }`, `{ frozen: 0-24 }`, `{ lengthSeconds, startTime?, anchorHour?, anchorTick? }`.
- `look.toneMapping`: `"aces" | "neutral" | "none" | "linear" | "reinhard" | "cineon" | "agx"`.

**TerrainDef heightmap (full), line 619.** `terrain: { kind: "heightmap", seed?, materials?, generator?: "scripts/file.js", verticalRange?, marks?, water?, material? }`.
- `marks` kinds: `sea`, `lake`, `river`, `path`, `road`, `flatten`, `clear-scatter`, `hole`. Each has its own fields (for example `lake`: `at`, `radius`, `level?`, `depth?`, `bedMaterial?`, `liquid?`).
- `flatten.falloffCurve`: `"smooth" | "cliff" | "linear"`.
- The doc gives no defaults for these mark fields.

**Inputs (full), line 634.** Keys are case-insensitive. A key may be a letter, a digit (`"1"` is the number row), a name (`space`, `shift`, `ctrl`, `alt`, `enter`, `escape`, `backspace`, `delete`, `f1`-`f12`, `up`/`down`/`left`/`right`), or any KeyboardEvent.code (`KeyE`, `Digit1`, `Numpad0`, `ArrowUp`). Gotcha: Tab is reserved. Gamepad triggers are analog axes `Gamepad:LT` and `Gamepad:RT` (0 to 1).
- `InputAxisDef = { keys?, mouse?: "deltaX" | "deltaY" | "wheelY" | "wheelX", gamepad?, deadzone?: 0-1 }`.
- `InputActionDef = { keys?, mouse?, gamepad?, modifiers?, activeOn?: "keydown" | "hold" | "keyup", touch?, active? }`.
- Gamepad gotcha: a binding reads every connected controller as one. `ui.js` reads each controller separately with `navigator.getGamepads()`. A behavior script has no gamepad access.

**ObjectSpec (full), line 643.** `{ id?, tags?, state?, behavior?: "scripts/file.js" | [...], parent?, children?: ObjectSpec[], ...ObjectPropertiesSpec, place?, audience?: "near" | "all" | "local", visibility?: "owner" | "platform", lifetime?: num, tick?: { phase?: "pre" | "post", order? } }`.

**Parenting (full), line 653.** Example: `api.spawn({ parent: 'pole-0', feetPosition: {x:0, y:3, z:0}, primitive: {kind:'sphere', radius:0.25} });`

**UI rules (full), line 659.** In `ui.js`, `document.documentElement.requestFullscreen()` on a press fills the screen with game, HUD and rail. `document.exitFullscreen()` leaves. `document.fullscreenEnabled` is true on computers and Android phones, and never on iPhone.

## Named types (lines 665 to 1929)

Gotchas stated at the top of the section:
- A world whose places all have `mode "ui"` draws nothing. It opens on a computer or phone with no 3D graphics (no WebGPU).
- `highlightSet` width is in pixels of a 1080p picture. When `width` is omitted it is 2 for `outline` and about 16 for `glow` and `pulse`.

**ActPayloads (line 672).** `ActName = keyof ActPayloads`. Each act is a key mapping to a payload shape. Notable entries with stated defaults:
- `damageNumber`: `size = 1`, `lifetime = 1.5`.
- `playSound`: `volume = 1`, `pitch = 1`, `mode: "overlap" | "restart"`, `follow?: boolean`.
- `preload: { refs: string[] }`. Warms sounds, textures or models before first use on the machines that hear it (the acting player's by default). Only machines in the room when it is sent are warmed. A player who joins later is not warmed. Fire-and-forget; nothing is shown and the world is unchanged.
- `decal`: `size = 0.5`, `lifetime = 30`, `opacity = 1`.
- `slash`: many optional visual fields (`shape`, `noise`, `glow`, `timing`, body/edge colors, velocities).
- `shockwave`: `speed = 0.5`, `thickness = 0.5`, `intensity = 0.5`, `edgeFade = 0.5`, `scale = 1`, `easing = "linear"`.
- `screenShake`: `duration = 0.2`. `screenFlash`: `duration = 0.15`, `intensity = 0.35`.
- `hitstop: { duration: number }`. `cameraPunch`: `intensity = 0.3`.
- `slowMo`: `{ scale, duration, easing? }`.
- `replay`: `{ from, to, camera?, scale?, cue?, hud? }`.
- `zoomTo`: `duration = 0.5`, `easing = "easeOut"`, `hold?`.
- `flash`: `duration = 0.1`, `intensity = 0.9`.
- `squash`: `axis = "y"`, `intensity = 0.3`, `duration = 0.15`.
- `highlightSet`: `style = "outline"`.
- `outlinePage`: `duration = 0.45`, `width = 3`, `pulses = 1`.
- `haptic`: `kind: HapticKind | "dual-rumble" | "trigger-rumble"`.
- Party and guild acts: `partyAdd`, `partyLeave`, `partyJoin`, `partyPortal`, `guildAdd`, `guildKick`, `guildRank` (`rank: "member" | "officer"`).
- `openSettings`: `page?: "sound" | "voice" | "look" | "keys" | "screen" | "live"`.

**Other named types (lines 701 to 1929), selected exact shapes:**
- `AnimationFrameEvent = { name, animation, frame }`. `AnimationKeyframeValue = number | string | number[] | string[] | { value, duration?, easing? }[]`.
- `AssetMetadata`: `boundsVersion?`, `triangles?`, `skinned?`, `clips?`, `gait?`, `bounds?`, `sockets?`, `parts?`, `sprite2d?`, `duration?`, `kind?`, `name?`, `uploadedAt?`, `bytes?`.
- `AtmosphereSunState = { direction, rotation, color: number // 0xRRGGBB, intensity, body: "sun" | "moon" }`.
- `Audience = { kind: "player"; id } | { kind: "nearby"; position; radius? } | { kind: "all" } | { kind: "place"; placeId? }`.
- `BehaviorHealth = { broken: BehaviorHookHealth[] }`. `BehaviorHookHealth = { hook, script, error, line?, tick, running: "inert" | "running", count? }`.
- `BehaviorRef = ScriptRef | ScriptRef[]`. `ScriptRef = string`.
- `BespokeGeometrySpec`: `positions` required; `indices`, `normals`, `uvs`, `colors`, `emissive`, `metalness`, `roughness`, `textureRuns`, `instances`, `bounds`, `revision` optional.
- `BlendEquation`, `BlendFactor`: string unions as spelled (for example `"src-alpha-saturated"`).
- `BoneInfo`, `BoneInfoResult = BoneInfo[]`, `BoneNamesResult = string[]`.
- `CameraCommon`: `fov?` (degrees across the short edge; unset means 60), `clip?`, `behavior?`, `pixelSnap?`, `projection?`, `layers?`.
- `CameraDef = CustomCameraDef | LegacyCameraDef`.
- `CustomCameraDef`: `kind: "custom"`, `sensitivity?` (default 3), `minPitch?` (default -1.4, which is 80° down), `maxPitch?` (default 1.4, which is 80° up), `pointerLock?`, `hideLocalPlayer?`.
- `Color = OklchString`. `Degrees = number`.
- `EngineConfig`: `networking?`, `ui?`, `graphics?`, `playerSettings?`, `simulation?: { tickRateHz? }`, `behaviors?`, `crons?`.
- `EngineInputAxes`: `lookX`, `lookY`, `aimYawSin/Cos`, `aimPitchN`, `camPos*`, `pointerOrigin*`, `pointerDir*`, `touchActive`, `touchTwist`, `pointerLocked` (all optional numbers). `pointerLocked` gotcha: lock acquisition has no pulse; watch the axis rise. `input.pressed.pointerLockLost` pulses when it falls.
- `EnterPlaceOptions = { place, at?: PositionSpec | "last" | "default", createIfMissing? }`.
- `FieldRetention = "durable" | "session"`. `FieldConfig = { retention? }`. `FieldChunkGrid = { cellSize, chunkCells, quant }`.
- `FilesAPI = { read(path): string | null; write(path, text): void; delete(path): void }`.
- `ForwardAxis = "-z" | "+z" | "+x" | "-x"`.
- `HapticKind = "soft" | "light" | "medium" | "rigid" | "heavy" | "selection" | "success" | "warning" | "error"`.
- `InputPointer = { x, y, ndcX, ndcY, overUi }`. `ndcX` and `ndcY` run from -1 to 1.
- `InputState = { axes, held, pressed, released, pressedAt, actionData?, pointer? }`.
- `InputsDef = { axes?, actions?, touch?, reservedAxisAliasesReported? }`.
- `JobError = { message, code?, retriable?, attempts, deadlineExceeded?, retryAfterMs?, details? }`.
- `JobOptions`: `priority?: "low" | "normal" | "high" = "normal"`, `deadlineMs?` (a platform job `llm:`, `image:`, `jev:` waits at most 800000 ms), `dedupeKey?`, `retries?`, `onPart?`, `count?`, `room?`.
- `JobResult = { ok, data?, error?, durationMs }`.
- `JointOptions`: `anchor?` (default [0,0,0]), `targetAnchor?` (default [0,0,0]), `axis?`, `limits?`, `motor?: { velocity, maxForce }`, `target?`, `strength?`, `restLength?` (default 0), `stiffness?` (default 0), `damping?` (default 0), `contactsEnabled?`, `breakForce?`, `breakTorque?`.
  - `limits` by joint type: revolute takes `[min, max]` radians; prismatic takes `[min, max]` metres along axis; spherical takes `{ cone, twist }`.
  - Gotcha: a `strength` of 0 or absent means no drive. A driven joint keeps its bodies awake while its target moves.
  - Gotcha: `breakForce` and `breakTorque` of 0 break under any load. Unset or Infinity never breaks.
- `JointType = "revolute" | "fixed" | "spherical" | "prismatic" | "spring"`.
- `JointBreakEvent = { jointId, type, cause, force, torque }`.
- `JumpCheckResult = { reachable, reason?, floorFrom, floorTo, rise?, run, apex, maxRun?, time?, approximate, exact?, mover?, params }`. `JumpCheckReason = "rise_exceeds_apex" | "run_exceeds_reach" | "no_floor_at_from" | "no_floor_at_to" | "terrain_unloaded"`.
- `LightSpec` kinds: `ambient`, `hemisphere`, `directional`, `point`, `spot`, `rect`. `LightAimSpec = "down" | "forward" | PositionSpec`.
- `MaterialSpec = StandardMaterialSpec | WaterMaterialSpec | ScriptedMaterialSpec`.
- `NoiseEvent = { position, radius, kind, sourceId, tick, data? }`. Radius is in meters, before the listener's hearing multiplier.
- `NotifyDmOptions = { wake?, to?, link?, upstream? }`.
- `ObjectAttachmentSpec = { bone?, skin?, socket?, part? }`. `ObjectAudience = "local" | "near" | "all"`.
- `ObjectQueryOptions`: `radius?` (meters from center to each row's feetPosition), `center?`, `tags?`, `anyTags?`, `excludeTags?`, `ignoreSelf?`, `place?`, `select?: "objects" | "ids"`, `objectId?`.
- `ObjectQueryResult = { id, tags, feetPosition, state, userId?, objectId? }`.
- `ObjectView`: a full view of an object. Notable fields:
  - `lifetime?`: seconds left, read and write. `= null` clears it.
  - `simulatedBy: string | null`: `"server"`, `"platform"`, a client id, or `null`. Writable only as `"platform"` or `null`. The doc says `bank.simulatedBy = "platform"` keeps it running on the sim.js machine with no player near.
  - `triangles: number | null`, `measure`, `skeleton`, `velocity`, `angularVelocity`, `forces`, `controller`, `controlling`, `anim`, `behavior`, `behaviorHealth?`, `spectating`, `gains?`, `parent`, `children`.
- `ObjectVisibility = "owner" | "platform"`. `ObjectRetention = "none"`.
- `OutOfBoundsEvent = { bottom, position, placeId, respawnPoint }`. Default `bottom` is 64 m under the lowest floor: a heightmap's built ground, a voxel volume's floor, else the spawn point or the origin plane.
- `OverlapOptions`, `OverlapResult = { objects, approximate, terrain }`.
- `PlaceDef`: `mode?` (`PlaceMode = "3d" | "2d-side" | "2d-top" | "ui"`), `gravity?`, `tickBase?` (Hz; the room steps every place at one rate, the default place's `tickBase`), `damping?`, `terrain?`, `atmosphere?`, `camera?`, `material?`, `lighting?`, `sky?`, `inputs?`, `ui?`, `listenerEntity?`, `acoustics?`, `fields?`, `fieldConfig?`, `objects?`, `defaultSpawnPoint?`, `defaultSpawnRotation?`, `arrival?`, `returnDoor?`, `pregenerate?`, `mintedFrom?`, `instance?`, `persistence?`, `policy?`, `worldBounds?`.
- `PlacePersistence = "ephemeral" | "session" | "persistent"`. `PlaceInstance = "shared" | "party" | "solo"`.
- `PlaceScopeHandle`: `id`, `name`, `players`, `playerCount` (read only; includes players past the first 64), `objects`, `state`, `atmosphere`, `terrain`, `voxels`, `tiles`, `fields`, `mode`, `gravity`, `tickBase`, `damping`, `timeScale`.
  - Gotcha: `timeScale` is the rate this place's simulation runs at. 0 stops it, 1 is normal, 2 is double. `ctx.now()`, the camera, UI and sound do not scale with it. Delete or `= null` returns it to 1.
- `PlacesCollection`, `PlaceStructureOptions = { place?, author?, id? }`.
- `PlayerQueryResult`: extends `ObjectQueryResult` with `displayName`, `userId`, `portraitUrl`, `place`, `isLocal`, `isEditor`, `isGodMode`, `isGuest`, `isTestAccount`, `party`, `partyMembership`, `guild`, `latencyMs`, `inputHeld`, `talking`, `mail`, `friends`, `spectating`, `wisps`, `den`, `region`.
  - `latencyMs` is a number only on the local player's row; null elsewhere, on the server and before the first measurement.
- `PlayerProfile`, `PlayerParty`, `PlayerGuild` (rank `"member" | "officer" | "leader"`), `PlayerMail`, `PlayerFriend`.
- `PointsPrimitiveSpec = { kind: "points"; count; bounds? }`. One round point per copy.
- `PositionSpec`: `{ x, z }`, `{ x, y, z }`, `{ x, z, y: TerrainOffset }`, `{ x, z, y: "surface" }`, `{ tile: [number, number], offset? }`, or `CameraAttachPositionSpec`.
- `RaycastHit = { position, normal, distance, id, world?, address?, durableId?, doors?, far?, door?, approximate?, faceIndex?, bone? }`.
  - `faceIndex` is on a drawn-triangle hit only. `bone` is on a drawn-triangle hit on a rigged thing only.
- `RaycastProbeResult = { hit, hits, verdict }`. `RaycastVerdict` has `queryable: false` (reason `"colliders-not-loaded"`) or `queryable: true`.
- `RotationSpec = number | { yaw?, pitch?, roll? } | { x, y, z, w } | { lookAt, include? }`. A bare number means yaw.
- `RoutingDef = { script?, maxPlayers?, persistence?, alwaysOn? }`.
- `SaidLine = { text, scope, by, kind, at, nonce, picture? }`.
- `ScatterBounds`: `circle`, `rectangle`, `polygon`, `ring`, `path`, `field`. `ScatterInstance = { id, bed, feetPosition, yaw, scale, bounds }`.
- `ScriptedMaterialSpec = { kind: "scripted", script, params?, ... }` with the full set of PBR and blend options. Gotchas:
  - `alphaTest`: the alpha cutoff (0..1) below which a texel is cut (three's alphaTest).
  - `renderOrder`: higher draws later among transparent things.
- `SerializedVoxelTemplate = { version: 1, bounds, palette: string[], voxels }`.
- `SharedPicture = { url, width, height }`.
- `SoundEndEvent = { soundId, clip, durationSeconds }`. Before pitch, the clip plays for `durationSeconds ÷ pitch`.
- `SplinePointSpec = [number, number, number] | PositionSpec`.
- `SplineSample = { position, tangent, normal, lateral, rotation, distance, progress }`. `distance` is meters; `progress` runs from 0 to 1.
- `SplineSpec`: `kind` (road, pipe, fence, hedge, powerline, wall, guardrail, handrail, railway, streetlight, stringlight, bannerline, conveyor, canal, curb, stairs, boardwalk, bollard, barrier, zipline, aqueduct, coaster, data-only, scripted), plus points, beziers, shape, samples, closed, style, width, radius, spacing, and more.
  - Gotchas with stated defaults: `bulbSpacing` default 0.4 for stringlight. `wireSag` is meters per 10 m of span on draped wires, default 0.8. On pole wires it is absolute meters per span: default 0.35 on powerline, 0.18 on zipline, 0.45 on the others.
  - `spacing` sets the support pitch only. It never thins the bulbs.
- `Sprite2DMetaSpec`: `outline?`, `world_height?`, `target_size?`, `style?`, `kind?`, `anchor_uv?`, `view?`, `content_box?`.
- `SqlAPI = { size(): Promise<number>; backup(label): Promise<{ label, bookmark, ts }>; restore(target): Promise<{ restoredTo }> }`.
- `StandardMaterialSpec`: main PBR and blend options. Gotchas stated:
  - `time`: the `.mp4` clip's playhead in seconds. A write jumps every screen. One address is one clip.
  - `speed`: default 1 (0.5 is half speed).
  - `textureScale`: meters per tile under `wrap: "repeat"`. Default 1. Without wrap it reads nothing.
  - `dissolve`: 0 intact to 1 gone.
- `TerrainBrush = { center, radius, fn }`. `fn` receives `inset`, which is metres in from the rim.
- `TomeCameraState`: `orthoSize` (default 12, or 20 in a `2d-top` place) and `orthoSqueeze`.
- `TomeEventMeta`, `TomeEventOptions = { place?, once? }`, `TomeEventHandler = (ctx: ObjectAPI, payload, meta) => void`.
- `TradeReceipt`: `offered: true` or `offered: false` with `refused` reasons `"unknown-target" | "not-held" | "not-mine" | "same-party" | "withdrawn"`.
- `TraverseCheckBlockReason`, `TraverseCheckOptions = { place?, body?, includeDynamicBodies?, ignoreEntities? }`, `TraverseCheckResult`.
- `UnderwaterSpec = { enabled?, depth?, color?, visibility?, scatter?, distortion? }`.
- `UpdateSchedule = { every?, near? }`. `UpdateScheduleNearRule = { tag?, radius }`.
- `ViewAPI`: read-only machine stats. `pixel` (radians one screen pixel spans), `fps`, `drawCalls`, `triangles`, `cpuMs`, `gpuMs`, `frames`, `memoryMB` (null in Safari, iPhone, iPad, Firefox), `gpuMemoryMB`, `renderScale`, `netInBytes`, `netOutBytes`, `netInMessages`, `netOutMessages`, `site`. All are read-only. Each is measured on the machine and is 0 or null on the server.
  - Gotcha: `pixel` is "a level whose smallest cube is c metres hands over at c / ctx.view.pixel metres."
- `ViewCamera`, `ViewCameraPose = { eye, aim, fov?, projection?, orthoSize?, layers? }`.
- `VoxelCoord`, `VoxelFillOptions = { state?, place? }`.
- `VoxelMarkFillOptions`: `opacity = 0.14`, `inset = 0.08`. `VoxelMarkOutlineOptions`: `opacity = 1`, `inflate = 0.03` (meters). `VoxelMarkPulseOptions`: `speed = 2` (pulses per second), `intensity = 0.18`.
- `VoxelQueryHit`, `VoxelQueryOptions = { tag, radius, center?, place? }`.
- `VoxelRaycastHit`, `VoxelRaycastOptions`: `distance` defaults to 64.
- `VoxelStructureSource = string | SerializedVoxelTemplate | Record<string, unknown> | (() => unknown)`.
- `WaterMaterialSpec = { kind: "water", ... }`. Stated defaults and gotchas:
  - `waveFrequency` default 7.3728. Higher values give shorter waves.
  - `waveHeightScale`: 0 gives a flat sheet.
  - `flowDirection` and `swellDirection`: normalized X/Z vectors. On a face steeper than 60°, water runs down the face under gravity regardless of `flowDirection`.
  - `foamStrength`: a fall (a face steeper than 60°) is aerated by its flow whatever this says. `flowSpeed` 0 is a still glass sheet.
  - `flowSpeed`: 0.1 moves foam about 1.2 m/s.
  - `wakeSeconds`: how long the wake stays in the picture.
- `WorldBoundsDef = { bottom?: number | false }`.

## builtin modules (lines 1930 to 2277)

**builtin/physics (line 1930).** Pass `ctx` first. Gotchas stated:
- `raycast` defaults to 200 meters and ignores the caller.
- `physicsOnly: true` selects colliders only.
- `overlapPoint` and `overlapSegment` return intersecting collider volumes.
- `traverseCheck` default step height is 0.3 m.
- `getInputRay` uses the sampled pointer ray, or the camera forward ray when no pointer ray is available.
- `createWorld(opts)` takes no ctx. It gives a physics world apart from the place. It moves only when `step(dt)` is called.
- `save()` returns the full state as bytes; `restore(bytes)` rewinds to it. The world is deterministic on one engine build, so a rollback game restores the late input's frame and steps again to the present.
- Cost: on a phone, a 50-body step costs about 1.5 ms.

Signatures: `raycast(ctx, origin, direction, opts?)`, `overlapPoint(ctx, point, opts?)`, `overlapSegment(ctx, a, b, opts?)`, `traverseCheck(ctx, from, to, opts?)`, `jumpCheck(ctx, from, to, { speed, jumpSpeed, ... })`, `getInputRay(ctx, input?)`, `createWorld(opts?: { gravity? }): Promise<PhysicsWorld>`. `PhysicsWorld.add(...)`, `.step(dt?)`, `.save(...)`, `.restore(bytes, bodies?)`, `.remove(body)`. `PhysicsBody` exposes `position`, `rotation`, `velocity`, `angularVelocity`.

**builtin/tween (line 1955).** `animate(ctx, target, keyframes, opts?: { duration?, easing?, delay?, direction?: "normal" | "reverse" | "alternate", loop?: boolean | number }): void`. Keyframes use dot paths into target fields. Values can be scalar, waypoints, relative strings like `+=5`, or per-segment objects. `duration` and `delay` are seconds.

**builtin/spline (line 1963).** `splineLength(ctx, id): number` returns meters, or 0 for a non-spline id. `sampleSpline(ctx, id, at, opts?)` where `at` is 0 to 1 by default and `space: "distance"` uses meters. `projectToSpline(ctx, id, point, opts?)`. Assign `object.spline = { id, at }` to place an object on a spline.

**builtin/math (line 1973).** `clamp`, `clamp01`, `lerp` (number and OKLCH string overloads), `smoothstep`, `inverseLerp`, `remap`, `shortestArc(fromDeg, toDeg)` returns degrees in (-180, 180]. `stepAngle(currentDeg, targetDeg, dt, opts?: { smoothing?, maxDegPerSec? })`: `smoothing` defaults to 0.06 seconds; 0 turns at once. `degToRad`, `radToDeg`.

**builtin/vec3 (line 1991).** Vectors accept `{x,y,z}` or `[x,y,z]`. Rotations are in degrees; a bare number means yaw. Euler order is yaw, pitch, roll about +Y, +X, +Z. Yaw 0 faces -Z. `rotationFromDirection(direction, axis?)` defaults to the -z axis. Names: `add`, `sub`, `scale`, `dot`, `length`, `normalize`, `distance`, `cross`, `directionFromYawPitch(yaw, pitch?)`, `rotate(rotation, v)`, `rotationFromDirection`, `rotationFromEuler`, `eulerFromRotation`.

**builtin/easing (line 2011).** `linear(t)` plus `easeIn`/`easeOut`/`easeInOut` variants of Quad, Cubic, Quart, Quint, Sine, Expo, Circ, and `easeOutBounce(t)`. Each takes t in [0, 1] and returns a number.

**builtin/nav (line 2018).** `findPath(ctx, from, to, opts?)` returns `{ points, ok, partial? }`.
- `ok: false` means a cut-off path ending at the reachable spot nearest the goal.
- `partial: true` means the search is still reading the ground; ask again on a later tick.
- An empty list without `partial` means no path was found.
- Defaults use the caller's body size, step height and slope limit. `maxDrop` defaults to 3 m. `bodies` defaults to `'all'`.
- Call from a behavior with the place's physics available.

**builtin/path (line 2026).** `createPath(points, opts?: { closed?, smooth?, spacing? })`. `spacing` defaults to 2 m. `closed` adds the return segment; do not repeat the first point. `PathHandle` has `points`, `closed`, `length`, `distance(x, z, within?)` (returns Infinity beyond `within`), `nearest(x, z, within?)` (returns null beyond `within`), and `at(arcLength)` (wraps when closed, clamps when open).

**builtin/ballistics (line 2039).** `solveShot(from, to, speed, g, lead?)` returns `{ vel, time }` or null when unreachable. `speed` is m/s; `g` is the magnitude of acceleration. `elevation(speed, g, distance, rise)` returns the low angle in radians, or null.

**builtin/room-routing (line 2048).** Use only in a routing script that exports `pickRoom(ctx)`. `pickRoom(ctx: { player, rooms, requestedRoomId, game, rejectedRooms })` returns a room name, `{ room, persistence }`, or null. Helpers: `firstOpenRoom(ctx)`, `mostFullWithSpace(ctx)` (null when none has space), `nextRoomName(rooms, exclude?)`, `roomFor(key)` (stable room name for a key).

**builtin/terrain (line 2060).** `shore(height, level, opts?)` changes heights near a water level. Defaults: `apron` 6, `berm` 0.3, `grade` 0.06, `rejoin` 24, `shelf` 2.2, `shelfReach` 6, `drop` 20, `scale` 1. Heights and distances are in meters.

**builtin/noise (line 2068).** `simplex2`, `simplex3`, `fbm2`, `ridged`, `billowed2`, `gradient2`, `domainWarp2`, `voronoi2` (returns `{ f1, f2, cell }`), `white2`, `makeSeededRng(seed)` (returns `next`, `double`, `int32`, `uint32`, `range`). Option objects carry `frequency?`, `amplitude?`, `seed?`, plus octave, gain and lacunarity options for the fractal forms. No defaults are stated in the doc.

**builtin/voxels (line 2083).** A `VoxelPart` builder: `part()`, `.set`, `.fill`, `.hollowBox`, `.sphere`, `.cylinder`, `.cone`, `.pyramid`, `.torus`, `.line`, `.add(source, { at? })`, `.bounds()`, `.serialize()` (returns `{ version: 1, bounds, palette, voxels }`). Brushes: `material(id)`, `checker(a, b)`, `random(ids, weights?)`, `noise(ids, opts?)`. `filled?` and `axis?` are optional on the shape methods.

**builtin/vibe (line 2105).** Export `pattern(ctx)` from the audio script. `ctx.params` holds the audio parameters. Tempo is set with `ctx.setBpm(n)`, `ctx.setCps(n)`, or `ctx.setSwing(amount)`. The default bus is Music. `gain` runs 0 to 2; `paused: true` stops the transport. Sample names are listed in `/cdn/vibe-samples/manifest.json`.
- Gotcha: `.s()` takes a name exactly as the manifest spells it. An instrument word alone (`violins`, `harp`) is a silent voice and a vibe.sample.unknown DM.
- Gotcha: pitched banks each have a pitch range; transpose or switch, never shift past an octave.
- Pattern methods (selected): `.s`, `.gain`, `.pan`, `.lpf`, `.hpf`, `.fast`, `.slow`, `.every`, `.swing`, `.humanize`, `.rate`, `.prob`, `.room`, `.reverbBus`, `.delaytime`, `.delayfeedback`, `.drive`, `.crush`, `.attack`, `.decay`, `.sustain`, `.release`, `.channel`, `.scale`, `.when`.
- Helpers: `arrange`, `scale(key, degrees)`, `progression(romans, key)`, `arp(chords, mode)`, `chord(name, octave = 3)`, `clamp01`, `lerp`, `smoothstep`, `above`, `below`, `between` (fade defaults 0.05), `mapRange`.

**builtin/fx (line 2124).** Export `effect(ctx)` from the effect script; return `fx(...populations)`. `spawn: { rate, ... }` rate is particles per second. `lifetime`, `delay`, `window` are seconds. `size` is meters. `rotation` is radians. `alpha` is 0 to 1. World space is the default. An omitted `lifetime` does not expire. The effect ends when its owner is removed, or on `ctx.destroy(id)`.
- Gotcha: a sprite with `align: "ground"` lies flat on the face that `attr("normal")` names.
- Gotcha: `parent(name)` in a `when()` child is a live read of its spawning parent each tick. A `dies` child reads its parent as it died.
- Engine calls: `emit("fx", { position, script, params, seed, tags, attachTo })`, `ctx.pulseFx(id, name, { at, data })`, `ctx.getFxState(id)`.
- Population and constructors: `pop(name, def)`, `when(other.dies, ...)`, `when(other.lives, ...)`, `disc`, `sphere`, `box`, `arc`, `line`, `point`, `path`, `sprite`, `mesh`, `ribbon`, `light`, `rgb`.

**builtin/tsl (line 2170).** Shader time is `(ctx.now() / 1000) % 3600` seconds. `uv()` reads the first UV set; `uv(1)` through `uv(3)` select later sets. Gotchas:
- A requested attribute must exist on the geometry.
- `audioLevel` and `audioSpectrum(x)` read the sound the player hears, each 0 to 1. `x` runs from 20 Hz at 0 to 20 kHz at 1.
- `objectWorldMatrix(id)`, `objectPosition(id)`, `objectScale(id)`, `objectDirection(id)` read the pose on screen (interpolated), not the last tick. A thing not rendered reads 0.
- Atomics return the element's previous value.

**builtin/three (line 2192).** Export `material(ctx)` from the material script; it returns a material. `ctx.param(name, default)` is a shader node; scale it with `.mul()`, never JS `*`. Opacity is 0 to 1. Set `transparent` when the material uses alpha.
- Gotcha: `PointsNodeMaterial` draws round, unlit points. Use a `points` row for a crowd of dots a pixel or two wide, never copies of a tiny mesh. `sizeNode` is in CSS pixels; `sizeAttenuation` scales by nearness.
- Gotcha: a `line` row wears `LineBasicNodeMaterial` or `Line2NodeMaterial`. `linewidth` is in CSS pixels at every distance.
- Context: `ctx.params`, `ctx.texture(cdn)`, `ctx.field(name).sampleWorld()`, `ctx.terrain.heightAt(xz, orElse?)`, `ctx.tile`, `ctx.sprite`, `ctx.view(offset)`, `ctx.portal`, `ctx.fx`, `ctx.device` (`class`, `coarse`, `maxTextures`, `quality`), `ctx.quality`.

**builtin/lighting (line 2229).** Read-only shader nodes: `sunDirection`, `sunRadiance`, `ambientRadiance`, `wet`, `rain`, `windDirection`, `windSpeed`, `windTravel`. Functions: `fogColor(toward)`, `sunVisibility(P)`, `lightsAt(P, { shadow }?)`, `lightCount(P)`, `lightRadiance(P, i)`, `lightPosition(P, i)`.

**builtin/water (line 2241).** Shader helpers: `waterRippleSlope`, `waterFoam` (`softness` defaults 0.08), `waterFoamField`, `waterFoamFieldLod`, `waterFoamCoverage`, `waterTransmittance`, `waterMedium`, `waterUnderwaterDistortion`, `waterRayBoxDistance`, `waterCaustics`, `waterCausticsAt`, `waterCausticsRefracted`, `waterFresnel(nDotV, f0)`. `scale` defaults to 1 where shown.

**builtin/env (line 2259).** `envAt(ctx, point)` returns `{ wind, rain, light, charge, water: { depth, flow }, cloud }`.

**builtin/postfx (line 2265).** A look export returns the final color and starts from `ctx.scene`.
- Gotcha: `vignette` defaults to roundness 2 and feather 0.45.
- Gotcha: `dof` `focusDistance` and `focusRange` are meters; `bokehScale` is pixels and defaults to 1.
- Gotcha: `blur` amount is 0 to 1.
- Gotcha: put frame resamplers before color adjustments.
- Gotcha: `bloom` returns the existing color. Configure it with the look's `bloomStrength`, `bloomRadius`, `bloomThreshold` parameters.
- Gotcha: antialiasing is each player's own setting, not part of a look ("no (slow)" in Settings turns it on). A look carries no edge pass.
- Functions: `grade(color, {...})`, `vignette`, `grain`, `film`, `tint`, `scanlines`, `dotScreen`, `chromaticAberration`, `dof`, `pixelate`, `blur`, `bloom`. Context: `ctx.scene`, `ctx.depth`, `ctx.viewZ`, `ctx.normal(uv)`, `ctx.worldPosition(uv)`, `ctx.skyVisibility(P, N?)`, `ctx.previousUv(P)`, `ctx.velocity`, `ctx.target(name, options)`, `ctx.pass(target, fn)`, `ctx.cube`, `ctx.cover`, `ctx.data`.

## Gaps

- Types referenced but not defined in this span: `Quat`, `Vec3Like`, `Seconds`, `PhysicsBody` (as a full type), `ObjectAPI`, `Bus`, `EdgeHint`, `SessionOutfit`, `SessionWisp`, `DrawMaterialOverrides`, `DrawMaterialParamTable`, `CrossOutcome`, `CrossVerdict`, `CrossingTerminalState`, `PlayerMailPerson` (defined), `ScriptRef` (defined as string), `TouchSurfaceDef`, `UnderwaterSpec` (defined), `ViewCamera` (defined), `WaterMaterialSpec` (defined), `PlaceObjectsCollection` (defined), `MarkShape`, `TerrainMarkSpec`, `LiquidSpec`, `EnvView`, `EnvFlow`, `ObjectAPI`, `ScatterInstance` (defined).
- The doc does not state defaults for most `builtin/noise` options, `builtin/water` options, `builtin/three` helpers, or the terrain mark fields.
- The doc does not say what `ctx` is in `builtin/physics` for `createWorld`, beyond that it takes no ctx.
- The doc does not state what `CameraCommon.behavior` or `layers` default to.
- Inferred, not stated: `ObjectView.parent` and `children` are the object's parent and child views (names suggest this; the doc gives no detail).
- The engine clone is documentation only; the kernel source is not present, so no internal behavior is verified here.

## Counts

Files: 1 (this output, plus the one source file read). Facts: about 230 named items and gotchas recorded above.

{"files": 1, "facts": 230, "gaps": ["Quat, Vec3Like, Seconds, ObjectAPI, Bus, EdgeHint, SessionOutfit, SessionWisp, DrawMaterialOverrides, DrawMaterialParamTable, CrossOutcome, CrossVerdict, CrossingTerminalState, TouchSurfaceDef, MarkShape, TerrainMarkSpec, LiquidSpec, EnvView, EnvFlow undefined in docs", "Most builtin/noise, builtin/water, builtin/three and terrain mark field defaults not stated", "CameraCommon.behavior and layers defaults not stated", "ObjectView.parent and children semantics only inferred from names", "kernel source absent from engine clone; no internals verified"]}
