## Named types (full)

A world whose places all have mode "ui" draws nothing, so it opens on a computer or phone with no 3D graphics (no WebGPU). highlightSet width is in pixels of a 1080p picture; when width is omitted, it is 2 for outline and about 16 for glow and pulse.

```ts
ActName = keyof ActPayloads

ActPayloads = {
  damageNumber: { position: Vec3; value?: number; text?: string; color?: Color; crit?: boolean; size?: number = 1; lifetime?: number = 1.5 },
  playSound: { clip: string; position?: Vec3; volume?: number = 1; pitch?: number = 1; loop?: boolean; mode?: "overlap" | "restart"; bus?: string; priority?: number; maxDistance?: number; refDistance?: number; follow?: boolean },
  stopSound: { soundId: string },
  preload: { refs: string[] }, // warms each sound, texture or model before its first use on the machines that hear it (the acting player's by default), so a game loads ahead of a moment it sees coming: emit it when those assets become likely; only machines in the room when it is sent hear it, so a room with no player in it warms no player, and one that joins later is not warmed; fire-and-forget, nothing shown, the world unchanged
  fx: { position: Vec3; script: string; params?: Record<string, unknown>; seed?: number; tags?: string[]; attachTo?: string },
  decal: { position: Vec3; normal: Vec3; texture: string; size?: number | [number, number] | [number | [number, number], number | [number, number]] = 0.5; rotation?: number | [number, number]; lifetime?: number = 30; fade?: number; color?: Color; opacity?: number | [number, number] = 1; attachTo?: string },
  slash: { position: Vec3; size?: number; shape?: "tightUniform" | "broadUniform" | "tightWidening" | "broadWidening" | "crescent" | "longCrescent" | "circle"; noise?: "none" | "forward" | "backward" | "stableDissolve"; glow?: "none" | "light" | "medium" | "intense" | "max"; timing?: "quick" | "standard" | "slow" | "verySlow"; body?: number; edge?: number; fade?: number; edgeColor?: Color; edgeAlpha?: number; bodyColor1?: Color; bodyColor1Alpha?: number; bodyColor2?: Color; bodyColor2Alpha?: number; bodyColor3?: Color; bodyColor3Alpha?: number; outwardGlow?: number; outwardGlowWidth?: number; outwardGlowSpeed?: number; rotation?: { yaw?: number; pitch?: number; roll?: number }; velocity?: { x?: number; y?: number; z?: number }; scaleVelocity?: number; rotationVelocity?: { yaw?: number; pitch?: number; roll?: number } },
  shockwave: { position: Vec3; speed?: number = 0.5; thickness?: number = 0.5; intensity?: number = 0.5; edgeFade?: number = 0.5; scale?: number = 1; easing?: "linear" | "easeOut" | "easeIn" = "linear" },
  screenShake: { intensity: number; duration?: number = 0.2 },
  screenFlash: { color?: Color; duration?: number = 0.15; intensity?: number = 0.35 },
  hitstop: { duration: number },
  cameraPunch: { direction: Vec3; intensity?: number = 0.3 },
  slowMo: { scale: number; duration: number; easing?: boolean | string },
  replay: { from: number; to: number; camera?: ViewCameraPose | { parent: string; eye?: Vec3; aim?: Vec3 | "forward" | string; fov?: number; projection?: "perspective" | "orthographic"; orthoSize?: number; layers?: string[] }; scale?: number; cue?: boolean; hud?: boolean },
  zoomTo: { target: Vec3 | string; duration?: number = 0.5; easing?: string = "easeOut"; offset?: Vec3; hold?: number },
  flash: { target: string; color?: Color; duration?: number = 0.1; intensity?: number = 0.9 },
  shake: { target: string; intensity: number; duration: number },
  squash: { target: string; axis?: "x" | "y" | "z" = "y"; intensity?: number = 0.3; duration?: number = 0.15 },
  impulse: { target: string; impulse?: Vec3; position?: Vec3; angularImpulse?: Vec3 },
  highlightSet: { target: string; color?: Color; style?: "outline" | "glow" | "pulse" | "xray" = "outline"; duration?: number; width?: number; intensity?: number },
  highlightClear: { target: string },
  outlinePage: { color?: Color; duration?: number = 0.45; width?: number = 3; pulses?: number = 1 },
  uiEvent: { name: string; payload?: unknown },
  haptic: { kind: HapticKind | "dual-rumble" | "trigger-rumble"; startDelay?: number; duration?: number; strongMagnitude?: number; weakMagnitude?: number; leftTrigger?: number; rightTrigger?: number },
  milestone: { step?: number; name?: string },
  stat: { name: string; value?: number; by?: string; vs?: string },
  voxelMarkSet: { markId: string; voxel: VoxelCoord; outline?: VoxelMarkOutlineOptions | null; fill?: VoxelMarkFillOptions | null; pulse?: VoxelMarkPulseOptions | null; duration?: number },
  voxelMarkClear: { markId: string },
  partyAdd: { player: string | { readonly id: string } },
  partyLeave: {},
  partyJoin: { player: string | { readonly id: string } },
  partyPortal: {},
  guildAdd: { player: string | { readonly id: string } },
  guildKick: { player: string | { readonly id: string } },
  guildRank: { player: string | { readonly id: string }; rank: "member" | "officer" },
  openSettings: { page?: "sound" | "voice" | "look" | "keys" | "screen" | "live" },
  openAvatarEditor: {},
}

AnimationFrameEvent = {
  name: string,
  animation: string,
  frame: number,
}

AnimationKeyframeValue = number | string | number[] | string[] | { value: number | string; duration?: number; easing?: string }[]

AssetMetadata = {
  boundsVersion?: number,
  triangles?: number,
  skinned?: boolean,
  clips?: string[],
  gait?: Record<string, number>,
  gaitVersion?: number,
  bounds?: { min: [number, number, number]; max: [number, number, number]; size: [number, number, number]; center: [number, number, number] },
  sockets?: Record<string, AssetSocketEntry>,
  parts?: Record<string, AssetPartEntry>,
  partsVersion?: number,
  sprite2d?: AssetSprite2DEntry,
  duration?: number,
  kind?: string,
  name?: string,
  uploadedAt?: string,
  bytes?: number,
}

AssetPartEntry = {
  center: [number, number, number],
  size: [number, number, number],
  groundOffsetY?: number,
  tris: number,
  confidence: number,
  version: number,
}

AssetSocketEntry = {
  position: [number, number, number],
  groundOffsetY: number,
  bone?: string,
  boneOffset?: [number, number, number],
  confidence: number,
  version: number,
}

AssetSprite2DEntry = {
  version: number,
  meta: null | Sprite2DMetaSpec,
}

AtmosphereSunState = {
  direction: [number, number, number],
  rotation: { pitch: number; yaw: number },
  color: number, // 0xRRGGBB.
  intensity: number,
  body: "sun" | "moon",
}

Audience = | { kind: "player"; id: string } | { kind: "nearby"; position: Vec3; radius?: number } | { kind: "all" } | { kind: "place"; placeId?: string }

AuthoredClipFunction = ((t: number) => Record<string, { position?: [number, number, number]; rotation?: [number, number, number]; scale?: [number, number, number] | number }>) & {
  duration?: number,
  fps?: number,
}

BehaviorHealth = {
  broken: BehaviorHookHealth[],
}

BehaviorHookHealth = {
  hook: string,
  script: string,
  error: string,
  line?: string,
  tick: number,
  running: "inert" | "running",
  count?: number,
}

BehaviorRef = ScriptRef | ScriptRef[]

BespokeGeometrySpec = {
  positions: number[],
  indices?: number[],
  normals?: number[],
  uvs?: number[],
  colors?: number[],
  emissive?: number[],
  metalness?: number[],
  roughness?: number[],
  textureRuns?: { texture: string; start: number; count: number }[],
  instances?: { layout?: Record<string, string>; data?: number[]; count?: number; lods?: { indices: [number, number]; distance?: number }[]; bounds?: { min: [number, number, number]; max: [number, number, number] } },
  bounds?: { min: [number, number, number]; max: [number, number, number] },
  revision?: number,
}

BlendEquation = "add" | "subtract" | "reverse-subtract" | "min" | "max"

BlendFactor = "zero" | "one" | "src" | "one-minus-src" | "src-alpha" | "one-minus-src-alpha" | "dst" | "one-minus-dst" | "dst-alpha" | "one-minus-dst-alpha" | "src-alpha-saturated"

BoneInfo = {
  index: number,
  name: string,
  parentName: string | null,
  localPosition: Vec3,
  modelPosition: Vec3,
  currentWorldPosition: Vec3 | null,
  currentWorldRotation: { x: number; y: number; z: number; w: number } | null,
  currentWorldScale: Vec3 | null,
  timestamp: number | null,
  fist: { position: Vec3; grip: Vec3; fingers: Vec3; palm: Vec3 } | null,
}

BoneInfoResult = BoneInfo[]

BoneNamesResult = string[]

CameraAttachPositionSpec = {
  attach: "camera",
  x?: number,
  y?: number,
  depth?: number,
  fov?: number,
}

CameraCommon = {
  fov?: number, // Camera FOV override, in degrees across the screen's short edge: top to bottom on a wide screen, side to side on a screen taller than wide. Unset, 60.
  clip?: { near?: number; far?: number } | null,
  behavior?: BehaviorRef,
  pixelSnap?: boolean,
  projection?: "perspective" | "orthographic",
  layers?: string[],
}

CameraDef = CustomCameraDef | LegacyCameraDef

CameraOrientationDef = {
  source: "look" | "script",
  authoredAxes?: ("yaw" | "pitch")[],
}

CameraTargetView = ObjectView & {
  effectiveScale: Vec3,
}

ClipPlane = {
  normal: [number, number, number],
  constant: number,
}

Color = OklchString

Contact = {
  position?: Vec3,
  normal?: Vec3,
  impulse: number,
}

CreatorTabDef = {
  id: string,
  title: string,
  icon: string,
  script: ScriptRef,
  shortcut?: string,
}

CrossingScopeQueryOptions = {
  scope: "crossings",
  since?: number,
  state?: CrossingTerminalState | readonly CrossingTerminalState[],
  world?: string,
  entityId?: string,
  actorId?: string,
}

CubicBezierSpec = {
  from: SplinePointSpec,
  c1: SplinePointSpec,
  c2: SplinePointSpec,
  to: SplinePointSpec,
}

CustomCameraDef = CameraCommon & {
  kind: "custom",
  state?: TomeCameraState,
  orientation?: CameraOrientationDef,
  sensitivity?: number = 3,
  minPitch?: number, // The lowest pitch of the engine-integrated look, in radians (+ looks up): the mouse, the stick and a `state.pitch` write stop here. Default -1.4 (80° down); -Math.PI / 2 looks straight down.
  maxPitch?: number, // The highest pitch of the engine-integrated look, in radians. Default 1.4 (80° up); Math.PI / 2 looks straight up.
  pointerLock?: boolean | "drag" | { drag: "left" | "right" | "middle" } | { unadjustedMovement: boolean },
  hideLocalPlayer?: boolean,
}

Degrees = number

EngineConfig = {
  networking?: { mode?: "singleplayer" | "multiplayer" },
  ui?: { theme?: { font?: string }; targetFps?: number; referenceHeight?: number },
  graphics?: { perfectPixelArt?: boolean | number; antialias?: boolean },
  playerSettings?: { defaults?: { accessibility?: { reduceFlashing?: boolean; reduceMotion?: boolean } }; caps?: { controls?: { lookSensitivity?: boolean; invertY?: boolean; fov?: boolean } } },
  simulation?: { tickRateHz?: number },
  behaviors?: ScriptRef[],
  crons?: { schedule: string; script: ScriptRef }[],
}

EngineInputAxes = {
  lookX?: number, // The look delta this tick, horizontal: the mouse's movement or a touch drag, never a level.
  lookY?: number, // The look delta this tick, vertical.
  aimYawSin?: number, // The sine of the camera's yaw.
  aimYawCos?: number, // The cosine of the camera's yaw.
  aimPitchN?: number, // The camera's pitch, from -1 (looking down) to 1 (looking up).
  camPosX?: number, // The camera's world position in metres, x.
  camPosY?: number, // The camera's world position in metres, y.
  camPosZ?: number, // The camera's world position in metres, z.
  pointerOriginX?: number, // The pointer's world ray: its origin in metres, x.
  pointerOriginY?: number, // The pointer's world ray: its origin in metres, y.
  pointerOriginZ?: number, // The pointer's world ray: its origin in metres, z.
  pointerDirX?: number, // The pointer's world ray: its unit direction, x.
  pointerDirY?: number, // The pointer's world ray: its unit direction, y.
  pointerDirZ?: number, // The pointer's world ray: its unit direction, z.
  touchActive?: number, // 1 while touch is the live input, 0 on a keyboard and a mouse.
  touchTwist?: number, // The two-finger twist this tick in radians, + clockwise on the screen; 0 with any other finger count.
  pointerLocked?: number, // 1 while the aim is the crosshair (the pointer lock, or a finger under a lock-preferring camera), 0 while the cursor is free. Lock acquisition has no pulse: watch this axis rise. `input.pressed.pointerLockLost` pulses when it falls.
}

EnterPlaceOptions = {
  place: string,
  at?: PositionSpec | "last" | "default",
  createIfMissing?: PlaceCreateOptions,
}

FieldChunkGrid = {
  cellSize: number,
  chunkCells: number,
  quant: number,
}

FieldChunkHandle = {
  cellSize: number,
  chunkCells: number,
  quant: number,
  cells: number[],
  version: number,
}

FieldConfig = {
  retention?: FieldRetention,
}

FieldLayerHandle = {
  [chunkKey: string]: FieldChunkHandle | undefined,
}

FieldRetention = "durable" | "session"

FilesAPI = {
  read(path: string): string | null,
  write(path: string, text: string): void,
  delete(path: string): void,
}

ForceEntrySpec = {
  force?: Vec3,
  position?: Vec3,
  torque?: Vec3,
}

ForwardAxis = "-z" | "+z" | "+x" | "-x"

FxState = {
  populations: Array<{ name: string; rate: number; lifetime: { min: number; max: number } | null; persistentCount: number | null; expectedAlive: number; alive: number | null; maxParticles: number | null; sinks: Array<{ kind: "sprite"; texture: string; blend: "alpha" | "add" | "multiply" | "subtract" | "screen" | "distort" } | { kind: "mesh"; shape: "box" | "cylinder" | "sphere" | "card" } | { kind: "ribbon"; texture: string | null } | { kind: "light"; radius: number; dynamic?: true }>; expectedSize: { start: number; peak: number } }>,
  totalExpectedAlive: number,
  totalAlive: number | null,
}

GameUIDef = UIDef & {
  startScreen?: boolean,
}

GodModeVisualSpec = ObjectProperties & {
  children?: ObjectSpec[],
  tags?: string[],
}

HapticKind = "soft" | "light" | "medium" | "rigid" | "heavy" | "selection" | "success" | "warning" | "error"

InputPointer = {
  x: number, // Screen pixel X coordinate
  y: number, // Screen pixel Y coordinate
  ndcX: number, // Normalized device coordinates X (-1 to 1, left to right)
  ndcY: number, // Normalized device coordinates Y (-1 to 1, bottom to top)
  overUi: boolean,
}

InputState = {
  axes: EngineInputAxes & Record<string, number>,
  held: Record<string, boolean>,
  pressed: Record<string, boolean> & { pointerLockLost?: boolean },
  released: Record<string, boolean>,
  pressedAt: Readonly<Record<string, number>>,
  actionData?: Record<string, unknown>,
  pointer?: InputPointer,
}

InputsDef = {
  axes?: Record<string, InputAxisDef>,
  actions?: Record<string, InputActionDef>,
  touch?: { enabled?: boolean; surfaces?: Record<string, TouchSurfaceDef>; active?: ScriptRef; style?: string },
  reservedAxisAliasesReported?: string[],
}

JobError = {
  message: string,
  code?: string,
  retriable?: boolean,
  attempts: number,
  deadlineExceeded?: boolean,
  retryAfterMs?: number,
  details?: unknown,
}

JobOptions = {
  priority?: "low" | "normal" | "high" = "normal",
  deadlineMs?: number, // Deadline in ms before job is treated as stale. A platform job (llm:, image:, jev:) waits at most 800000 ms.
  dedupeKey?: string,
  retries?: number,
  onPart?: (part: unknown) => void,
  count?: number,
  room?: string,
}

JobResult = {
  ok: boolean,
  data?: T,
  error?: JobError,
  durationMs: number,
}

JointBreakEvent = {
  jointId: string,
  type: JointType,
  cause: "force" | "torque" | "force-and-torque",
  force: number, // Peak constraint reaction force this tick (N).
  torque: number, // Peak constraint reaction torque this tick (N·m).
}

JointOptions = {
  anchor?: Vec3, // Anchor on THIS body: metres in its own frame, from its feet (default: [0,0,0])
  targetAnchor?: Vec3, // Anchor on the other body (`to`): metres in its own frame, from its feet (default: [0,0,0])
  axis?: Vec3,
  limits?: [number, number] | { cone?: number; twist?: [number, number] }, // Min/max limits: revolute, radians `to` turns against this body about axis, 0 where the two frames agree (this body's own turn stops at -max); prismatic, metres along axis; spring, metres between the anchors. A spherical joint takes { cone, twist }, both measured from the pose the two bodies stand in when the form is set (at the mint for a joint made with it): cone the half-angle in radians `to` swings off that pose, twist [min, max] radians it turns about its line (a ragdoll shoulder: { cone: 1.2, twist: [-0.8, 0.8] }); a half left out stays free
  motor?: { velocity: number; maxForce: number },
  target?: number | { x: number; y: number; z: number; w: number }, // The pose the joint's drive pulls to, measured as `limits` are: revolute, radians; prismatic, metres along axis; spherical, a rotation `{ x, y, z, w }` (a THREE.Quaternion works) from the pose the two bodies stand in when the first target is set. Spring and fixed joints take none.
  strength?: number, // 0..1: how firmly the joint pulls to its target (0 or absent: no drive). It eases there like a critically damped spring, with no overshoot; 1 holds firm. A driven joint keeps its bodies awake while its target moves, and they cost what any moving body costs, every tick; a still target lets them sleep.
  restLength?: number, // Spring rest length in meters (spring joints only, default: 0)
  stiffness?: number, // Spring stiffness in N/m (spring joints only). Unset, 0: the spring pulls nothing and its damping is unread, so only its limits hold the two bodies (a rope).
  damping?: number, // Spring damping in N·s/m (spring joints only), read only while stiffness is above 0. Unset, 0.
  contactsEnabled?: boolean,
  breakForce?: number, // Break when peak joint reaction force exceeds this many newtons. 0 breaks under any load; unset (or Infinity) never breaks.
  breakTorque?: number, // Break when peak joint reaction torque exceeds this many newton-metres. 0 breaks under any load; unset (or Infinity) never breaks.
}

JointType = "revolute" | "fixed" | "spherical" | "prismatic" | "spring"

JumpCheckFloor = {
  top: number,
  by: string,
}

JumpCheckMover = {
  id: string,
  side: "from" | "to" | "both",
  period: number | null,
  periodFit?: number,
  sampledSeconds: number,
  share: number,
  windows: [number, number][],
  closest?: { rise: number; run: number; maxRun?: number; reason: JumpCheckReason; in: number },
}

JumpCheckReason = "rise_exceeds_apex" | "run_exceeds_reach" | "no_floor_at_from" | "no_floor_at_to" | "terrain_unloaded"

JumpCheckResult = {
  reachable: boolean,
  reason?: JumpCheckReason,
  floorFrom: JumpCheckFloor | null,
  floorTo: JumpCheckFloor | null,
  rise?: number, // floorTo.top − floorFrom.top, metres (when both stand)
  run: number, // Horizontal metres from `from` to `to`
  apex: number, // Metres the arc rises above the take-off floor
  maxRun?: number, // Horizontal metres the feet carry before they come down to the landing's height; absent when the rise is above the apex
  time?: number, // Seconds in the air to the landing's height
  approximate: string[],
  exact?: string,
  mover?: JumpCheckMover,
  params: { speed: number; jumpSpeed: number; gravity: number; capsuleRadius: number; capsuleHeight: number; maxStep: number; body: string | null },
}

LegacyCameraDef = CameraCommon & {
  kind?: undefined,
  state?: TomeCameraState,
  pointerLock?: boolean | "drag" | { drag: "left" | "right" | "middle" } | { unadjustedMovement: boolean },
  hideLocalPlayer?: boolean,
}

LightAimSpec = "down" | "forward" | PositionSpec

LightSpec = | { kind: "ambient"; color?: Color; intensity?: number } | { kind: "hemisphere"; skyColor?: Color; groundColor?: Color; intensity?: number } | { kind: "directional"; color?: Color; intensity?: number; aim?: LightAimSpec; shadow?: { enabled?: boolean; softness?: number }; followCamera?: boolean } | { kind: "point"; color?: Color; intensity?: number; distance?: number; decay?: number; fan?: [number, number][]; passes?: ("screen" | "camera")[]; shadow?: { enabled?: boolean } } | { kind: "spot"; color?: Color; intensity?: number; distance?: number; angle?: number; penumbra?: number; decay?: number; aim?: LightAimSpec; passes?: ("screen" | "camera")[]; shadow?: { enabled?: boolean } } | { kind: "rect"; color?: Color; intensity?: number; width?: number; height?: number; distance?: number; aim?: LightAimSpec; passes?: ("screen" | "camera")[] }

LinePrimitiveSpec = {
  kind: "line",
  points?: [number, number, number][],
  segments?: boolean,
  count?: number,
  bounds?: { min: [number, number, number]; max: [number, number, number] },
}

MaterialOverridesSpec = DrawMaterialOverrides

MaterialSpec = StandardMaterialSpec | WaterMaterialSpec | ScriptedMaterialSpec

MorphTargetNamesResult = string[]

NoiseEvent = {
  position: Vec3,
  radius: number, // Emit radius in meters (before the listener's hearing multiplier).
  kind: string,
  sourceId: string,
  tick: number,
  data?: unknown,
}

NotifyDmOptions = {
  wake?: boolean,
  to?: string | { userId?: string | null },
  link?: string,
  upstream?: string | { userId?: string | null },
}

ObjectAttachmentSpec = {
  bone?: string,
  skin?: true | { map?: Record<string, string> },
  socket?: string,
  part?: string,
}

ObjectAudience = "local" | "near" | "all"

ObjectQueryOptions = {
  radius?: number, // meters from center to each row's feetPosition
  center?: Vec3,
  tags?: string[],
  anyTags?: string[],
  excludeTags?: string[],
  ignoreSelf?: boolean,
  place?: string,
  select?: "objects" | "ids",
  objectId?: string,
}

ObjectQueryResult = {
  id: string,
  tags: string[],
  feetPosition: Vec3,
  state: Record<string, unknown>,
  userId?: string | null,
  objectId?: string,
}

ObjectRetention = "none"

ObjectView = ObjectQueryResult & Omit<Partial<ObjectProperties>, keyof ObjectQueryResult> & {
  worldFeetPosition: Vec3,
  worldRotation: { readonly x: number; readonly y: number; readonly z: number; readonly w: number; readonly yaw: number; readonly pitch: number; readonly roll: number },
  place: string,
  audience: ObjectAudience,
  visibility: ObjectVisibility | null,
  scope: "session" | "world",
  retention: ObjectRetention | "current",
  lifetime?: number, // Seconds left before the engine destroys this object: the row's `lifetime`, counted down live; `undefined` when the row carries none. Read and write, on ctx.self and every handle: `bolt.lifetime = 480` re-stamps the countdown from now (0 ends it at the next tick), `= null` clears it and the object lives on. `spawn({ lifetime: 5, … })` stamps it at birth. Non-enumerable: a dump never pays for the read.
  template?: string,
  name: string | null,
  simulatedBy: string | null, // Who runs it now: `"server"` (Spawn's machine for the room), `"platform"` (a row set to `"platform"`, below), a player's client id (that player's machine: their body's id is `"player/" + clientId`, so `player.id === "player/" + thing.simulatedBy` names them), or `null` when no machine runs it now (as when it rests far from every player). Read and write on ctx.self and every handle. `bank.simulatedBy = "platform"` keeps it running on the machine that runs sim.js, even with no player near, and saves that choice. `= null` restores ordinary behavior. No other value can be assigned.
  sleeping: boolean | null,
  awake: boolean | null,
  measure: { readonly volume: number; readonly mass: number } | null,
  triangles: number | null, // The triangles of the mesh this thing's geometry built (a `geometry(ctx)` generator, a custom geometry): its finished mesh, what it draws up close, the count the engine holds from the build, so nothing runs again to read it. An instance set reads its near level once per copy it draws. `null` until the mesh is built, and on a thing drawn from no geometry of its own (a model's count is `ctx.world.assets[ref].triangles`; a box or a sphere). Read-only; the same dot on ctx.self; non-enumerable.
  skeleton: BoneInfoResult,
  destination: { readonly onlineCount: number | null } | null,
  env: EnvView,
  velocity: Vec3,
  angularVelocity: Vec3,
  forces: Record<string, ForceEntrySpec | null | undefined>,
  controller: string | null,
  controlling: ObjectView | null,
  anim: Record<string, unknown>,
  behavior: string[],
  behaviorHealth?: BehaviorHealth,
  spectating: boolean,
  gains?: Partial<Record<Bus, number>>,
  parent: ObjectView | null,
  children: ObjectView[],
}

ObjectVisibility = "owner" | "platform"

OklchString = string

OutOfBoundsEvent = {
  bottom: number, // The bound that was crossed (`worldBounds.bottom`, or the place's default: 64 m under its lowest floor: a heightmap's built ground, a voxel volume's floor, else the spawn point or the origin plane).
  position: Vec3,
  placeId: string,
  respawnPoint: Vec3,
}

OverlapOptions = {
  place?: string,
  ignoreSelf?: boolean,
  ignoreEntities?: string[],
  tags?: string[],
  anyTags?: string[],
  excludeTags?: string[],
  includeSensors?: boolean,
}

OverlapResult = {
  objects: string[],
  approximate: string[],
  terrain: boolean | null,
}

PivotSpec = "feet" | "center" | "top" | [u: number, v: number, w: number] | Vec3

PlaceCreateOptions = PlaceDef & {
  persistence: PlacePersistence,
}

PlaceDef = {
  mode?: PlaceMode,
  gravity?: Vec3,
  tickBase?: number, // Hz. The room steps every place at ONE rate, the default place's tickBase; another place's tickBase is kept and read back, and steps nothing.
  damping?: number,
  terrain?: TerrainDef,
  atmosphere?: AtmosphereDef,
  camera?: CameraDef,
  material?: MaterialSpec,
  lighting?: string,
  sky?: string,
  inputs?: InputsDef,
  ui?: GameUIDef,
  listenerEntity?: string,
  acoustics?: { reverb?: number },
  fields?: Record<string, SerializedField>,
  fieldConfig?: Record<string, FieldConfig>,
  objects?: ObjectSpec[],
  defaultSpawnPoint?: PositionSpec,
  defaultSpawnRotation?: RotationSpec,
  arrival?: string,
  returnDoor?: false | { lifetime?: number },
  pregenerate?: boolean,
  mintedFrom?: string,
  instance?: PlaceInstance,
  persistence?: PlacePersistence,
  policy?: { admits?: string; onArrive?: string; onLeave?: string },
  worldBounds?: WorldBoundsDef,
}

PlaceFieldHandle = {
  runtime: FieldLayerHandle,
  authored: FieldLayerHandle,
  grid: FieldChunkGrid,
  changes(at?: number): { readonly chunks: string[]; readonly at: number },
}

PlaceFieldsHandle = {
  [fieldName: string]: PlaceFieldHandle,
}

PlaceInstance = "shared" | "party" | "solo"

PlaceMode = "3d" | "2d-side" | "2d-top" | "ui"

PlaceObjectsCollection = Iterable<ObjectView> & {
  [objectId: string]: ObjectView | undefined,
}

PlacePersistence = "ephemeral" | "session" | "persistent"

PlaceScopeHandle = {
  id: string,
  name: string,
  players: PlayerQueryResult[],
  playerCount: number, // Everyone standing in this place, the players past `players`' 64 included. Read-only.
  objects: PlaceObjectsCollection,
  state: Record<string, unknown>,
  atmosphere: Record<string, unknown> & { readonly sunState?: AtmosphereSunState | null },
  terrain: Record<string, unknown> & { readonly marks: Record<string, unknown>; readonly materials: Record<string, unknown> | Array<Record<string, unknown> & { id: string }>; runtimeEdits?: undefined; readonly spacing: number | null; heightAt(x: number, z: number): number | null; materialAt(x: number, z: number): string | null; colorAt(x: number, y: number, z: number, normal: Vec3 | readonly [number, number, number]): { color: Color; roughness: number; metalness: number; emissive: Color; emissiveIntensity: number } | null; scatterIn(min: { x: number; z: number }, max: { x: number; z: number }): ScatterInstance[]; stroke(field: string, brush: TerrainBrush): TreeOpsVerdict | undefined },
  voxels: { readonly [x: number]: { readonly [y: number]: { [z: number]: string | null } }; solid(x: number, y: number, z: number): boolean | null; raycast(origin: Vec3, direction: Vec3, options?: VoxelRaycastOptions): VoxelRaycastHit | null; fill(min: Vec3, max: Vec3, material: string | null, opts?: VoxelFillOptions): boolean; stamp(structure: VoxelStructureSource, cell: Vec3, opts?: PlaceStructureOptions): boolean; query(options: VoxelQueryOptions): VoxelQueryHit[]; interact(x: number, y: number, z: number): boolean; read(min: Vec3 | readonly [number, number, number], max: Vec3 | readonly [number, number, number]): { min: [number, number, number]; size: [number, number, number]; palette: Array<string | null>; cells: Int16Array; states: Uint16Array } },
  tiles: { readonly [x: number]: { [y: number]: number | null } },
  fields: PlaceFieldsHandle,
  mode: PlaceMode | undefined,
  gravity: Vec3,
  tickBase: number,
  damping: number,
  listenerEntity: string | undefined,
  acoustics: Record<string, unknown>,
  fieldConfig: Record<string, unknown>,
  defaultSpawnPoint: Record<string, unknown>,
  defaultSpawnRotation: Record<string, unknown>,
  arrival: string | undefined,
  returnDoor: false | Record<string, unknown>,
  pregenerate: boolean | undefined,
  persistence: PlacePersistence | undefined,
  policy: Record<string, unknown>,
  worldBounds: Record<string, unknown>,
  mintedFrom: string | undefined,
  owner: string | null,
  timeScale: number, // The rate this place's simulation runs at, the same for everyone in it: 0 stops it, 1 is normal speed, 2 is twice it. Scripts' `dt`, sim.js `ctx.dtMs`, physics, `after()` timers, `animate`, clips, sprites, particles, effects, the water, the sky's clouds and stars, foliage sway and a material's `time` here run at it; `ctx.now()`, the camera, UI and sound do not. Room state, saved with the room; delete / = null returns it to 1.
}

PlaceStructureOptions = {
  place?: string,
  author?: boolean,
  id?: string,
}

PlacesCollection = Iterable<PlaceScopeHandle> & {
  [placeName: string]: PlaceScopeHandle | undefined,
}

PlayerFriend = {
  userId: string,
  displayName: string,
  portraitUrl: string | null,
}

PlayerGuild = {
  id: string,
  name: string,
  rank: "member" | "officer" | "leader",
}

PlayerMail = {
  id: string,
  from: PlayerMailPerson,
  to: PlayerMailPerson,
  topic: string,
  text: string,
  at: number,
  read: boolean,
  retracted: boolean,
}

PlayerMailPerson = {
  userId: string,
  displayName: string,
}

PlayerParty = {
  id: string,
  leader: boolean,
}

PlayerProfile = {
  displayName: string,
  userId?: string,
  avatarUrl?: string,
  outfit?: SessionOutfit,
  wisps?: readonly SessionWisp[],
  den?: string,
  portraitUrl?: string,
  isGuest?: boolean,
  isTestAccount?: boolean,
}

PlayerQueryResult = ObjectQueryResult & {
  displayName: string | null,
  userId: string | null,
  portraitUrl: string | null,
  place: string,
  isLocal: boolean,
  isEditor: boolean,
  isGodMode: boolean,
  isGuest: boolean,
  isTestAccount: boolean,
  party: PlayerParty | null,
  partyMembership: PlayerParty | null | undefined,
  guild: PlayerGuild | null,
  latencyMs: number | null, // This player's ping: this machine's round trip to the room's server, whole ms, refreshed every few seconds; a number on the machine whose eyes this player is (`ctx.self.latencyMs` in ui.js and in a player behavior; the players row where `isLocal` is true), null on every other player's row, on the server and before the first measurement. Read-only: the wire measures it, a game never writes it.
  inputHeld: boolean,
  talking: boolean,
  mail: readonly PlayerMail[],
  friends: readonly PlayerFriend[],
  spectating: boolean,
  wisps: readonly SessionWisp[],
  den: string | null,
  region: EdgeHint | null,
}

PointsPrimitiveSpec = {
  kind: "points",
  count: number, // how many points, one round point a copy (instanceIndex 0 to count − 1), each placed by the object's PointsNodeMaterial (builtin/three): positionNode, sizeNode in CSS pixels
  bounds?: { min: [number, number, number]; max: [number, number, number] },
}

PositionSpec = { x: number; z: number } | { x: number; y: number; z: number } | { x: number; z: number; y: TerrainOffset } | { x: number; z: number; y: "surface" } | { tile: [number, number]; offset?: [number, number, number] } | CameraAttachPositionSpec

PresenceRow = {
  userId: string,
  world: string | null | undefined,
  room: string | null | undefined,
}

PrimitiveSockets = Record<string, Vec3 | [number, number, number] | { position: Vec3 | [number, number, number]; direction?: Vec3 | [number, number, number] }>

RaycastHit = {
  position: Vec3,
  normal: Vec3,
  distance: number,
  id: string | null,
  world?: string,
  address?: string,
  durableId?: string | null,
  doors?: ReadonlyArray<{ id: string; link: string; world: string; exit: string | null }>,
  far?: { position: Vec3; normal: Vec3 },
  door?: { link: string; verdict: "through-spent" | "unheld" | "no-exit"; message: string },
  approximate?: true,
  faceIndex?: number, // on a drawn-triangle hit (hits: "geometry" or "both"): the triangle's index in the thing's one list of faces (a model's meshes in order), the same triangle at rest or posed; absent on a collider, sprite or bounds hit
  bone?: { name: string; position: Vec3; normal: Vec3 }, // on a drawn-triangle hit (hits: "geometry" or "both") on a rigged thing: the bone the skin at the hit rides most (`name`), and the hit's `position` and `normal` in that bone's frame, the frame `attachment: { bone: name }` places a child in; absent on a collider, sprite or bounds hit and on a thing with no rig
}

RaycastProbeResult = {
  hit: RaycastHit | null,
  hits: RaycastHit[],
  verdict: RaycastVerdict,
}

RaycastVerdict = { queryable: false; reason: "colliders-not-loaded"; message: string; terrain: boolean | null; pendingGeometry?: string[] } | { queryable: true; pendingColliders: string[]; pendingColliderCount: number; terrain: boolean | null; pendingGeometry?: string[] }

RectangleSplineShapeSpec = {
  kind: "rectangle",
  center: SplinePointSpec,
  width: number,
  depth: number,
  yaw?: number,
}

RoadHedgesSpec = {
  sides?: RoadsideFeatureSides,
  width?: number,
  height?: number,
  gap?: number,
  style?: "trimmed" | "wild",
}

RoadLampPostsSpec = {
  sides?: RoadsideFeatureSides,
  spacing?: number,
  offset?: number,
  poleHeight?: number,
  style?: | "streetlight-classic" | "streetlight-curved" | "streetlight-lantern" | "streetlight-double" | "streetlight-globe" | "streetlight-modern" | "streetlight-pendant" | "streetlight-industrial" | "streetlight-victorian" | "streetlight-art-deco" | "streetlight-harbor" | "streetlight-park" | "streetlight-neon" | "streetlight-rustic" | "streetlight-campus" | "streetlight-gaslamp" | "streetlight-boulevard" | "streetlight-solar" | "streetlight-transit" | "streetlight-pagoda",
}

RoadMarkingsSpec = {
  centerLine?: boolean,
  edgeLines?: boolean,
  dashLength?: number,
  gapLength?: number,
  width?: number,
  color?: Color,
}

RoadRoadsideSpec = {
  sidewalks?: boolean | RoadSidewalksSpec,
  hedges?: boolean | RoadHedgesSpec,
  lampPosts?: boolean | RoadLampPostsSpec,
  markings?: boolean | RoadMarkingsSpec,
}

RoadSidewalksSpec = {
  sides?: RoadsideFeatureSides,
  width?: number,
  height?: number,
  gap?: number,
}

RoadsideFeatureSides = "left" | "right" | "both"

RotationSpec = number | { yaw?: number; pitch?: number; roll?: number } | { x: number; y: number; z: number; w: number } | { lookAt: PositionSpec; include?: ("yaw" | "pitch" | "roll")[] }

RoutingDef = {
  script?: ScriptRef,
  maxPlayers?: number,
  persistence?: PlacePersistence,
  alwaysOn?: boolean,
}

SaidLine = {
  text: string,
  scope: string,
  by: PlayerQueryResult,
  kind: string,
  at: number,
  nonce: string,
  picture?: SharedPicture,
}

ScatterBounds = | { shape: "circle"; radius: number } | { shape: "rectangle"; width: number; depth: number } | { shape: "polygon"; points: [number, number][] } | { shape: "ring"; innerRadius: number; outerRadius: number } | { shape: "path"; points: [number, number][]; width: number } | { shape: "field"; field: string; threshold?: number; density?: number }

ScatterInstance = {
  id: string | null,
  bed: string,
  feetPosition: Vec3 | null,
  yaw: number | null,
  scale: Vec3 | null,
  bounds: { min: Vec3; max: Vec3; size: Vec3; center: Vec3 },
}

ScriptRef = string

ScriptedMaterialSpec = {
  kind: "scripted",
  color?: Color,
  emissive?: Color,
  emissiveIntensity?: number,
  metalness?: number,
  roughness?: number,
  opacity?: number,
  transparent?: boolean,
  alphaTest?: number, // three's alphaTest: the alpha cutoff (0..1) under which a texel is cut
  side?: "front" | "back" | "double",
  depthWrite?: boolean,
  depthTest?: boolean,
  renderOrder?: number, // draw order among transparent things (higher draws later)
  polygonOffset?: boolean,
  polygonOffsetFactor?: number,
  polygonOffsetUnits?: number,
  blending?: "none" | "normal" | "additive" | "subtractive" | "multiply" | "custom",
  blendSrc?: BlendFactor,
  blendDst?: BlendFactor,
  blendEquation?: BlendEquation,
  blendSrcAlpha?: BlendFactor,
  blendDstAlpha?: BlendFactor,
  blendEquationAlpha?: BlendEquation,
  premultipliedAlpha?: boolean,
  colorWrite?: boolean,
  clippingPlanes?: ClipPlane[] | null,
  clipIntersection?: boolean,
  clipShadows?: boolean,
  underwater?: UnderwaterSpec,
  drawsOver?: string[] | { parts: string[]; strength?: number; angle?: number },
  outline?: boolean | { color?: Color; width?: number; warm?: number; lightness?: number } | null,
  script: ScriptRef,
  params?: Record<string, number | boolean | string | DrawMaterialParamTable>,
  view?: { link: string; oneWay?: boolean; spill?: number; sound?: number } | { camera: ViewCamera; cadence?: string } | null,
}

SerializedVoxelTemplate = {
  version: 1,
  bounds: [[number, number, number], [number, number, number]],
  palette: string[],
  voxels: Array<[number, number, number, number] | [number, number, number, number, number]>,
}

SharedPicture = {
  url: string,
  width: number,
  height: number,
}

SoundEndEvent = {
  soundId: string,
  clip: string,
  durationSeconds: number, // The clip's decoded length, or the span its `audio:` clip row played, from where it began to its `end` or the clip's end (before pitch: it played for durationSeconds ÷ pitch).
}

SplineLightStripsSpec = {
  color?: Color,
  intensity?: number,
  width?: number,
}

SplinePointSpec = [number, number, number] | PositionSpec

SplineSample = {
  position: Vec3,
  tangent: Vec3,
  normal: Vec3,
  lateral: Vec3,
  rotation: { x: number; y: number; z: number; w: number },
  distance: number, // Distance along the spline in meters.
  progress: number, // Normalized progress along the spline from 0 to 1.
}

SplineShapeSpec = RectangleSplineShapeSpec

SplineSpec = {
  kind: "road" | "pipe" | "fence" | "hedge" | "powerline" | "wall" | "guardrail" | "handrail" | "railway" | "streetlight" | "stringlight" | "bannerline" | "conveyor" | "canal" | "curb" | "stairs" | "boardwalk" | "bollard" | "barrier" | "zipline" | "aqueduct" | "coaster" | "data-only" | "scripted",
  script?: ScriptRef,
  params?: Record<string, unknown>,
  seed?: number,
  points?: SplinePointSpec[],
  beziers?: CubicBezierSpec[],
  shape?: SplineShapeSpec,
  samples?: number | "auto",
  closed?: boolean,
  cornerMode?: "smooth" | "hard",
  style?: SplineStyle,
  snapToTerrain?: boolean,
  yOffset?: number,
  up?: [number, number, number],
  width?: number | number[],
  radius?: number,
  spacing?: number, // meters between posts / bulbs / bollards
  bulbSpacing?: number, // Distance in meters between bulbs along a stringlight strand (default 0.4: a dense warm festoon), on both the draped and `poles: true` layouts. `spacing` never thins the bulbs: that field is the support pitch (poles every `spacing` when supports exist).
  overlap?: number,
  beltSpeed?: number,
  lightStrips?: boolean | SplineLightStripsSpec,
  roadside?: RoadRoadsideSpec,
  tangentAxis?: "x" | "z",
  height?: number,
  thickness?: number,
  poleHeight?: number, // Wire height for the wire kinds (powerline, stringlight, bannerline, zipline, streetlight). `points` above the terrain ARE the wire line; points at terrain height hang the wire ~`poleHeight` above the ground. When poles exist (default on powerline, `poles: true` on stringlight/bannerline, always on streetlight/zipline) each pole runs from the terrain under it up to the line.
  poles?: boolean,
  wireCount?: number,
  wireHeight?: number,
  wireSag?: number, // Strand looseness for the wire kinds. On a draped wire (stringlight and bannerline without `poles: true`, a powerline with `poles: false`) it is meters of droop per 10 m of span, default 0.8: sag scales with each span's length (a 0.6 run dips ~1 m on a 17 m crossing and ~1.8 m on a 30 m one), so long building-to-building runs hang deep and short hops stay tidy. Where poles stand (a powerline by default, `poles: true` on stringlight/bannerline, always on streetlight/zipline) it is absolute meters of droop per pole-to-pole span instead, since generated pole spans are uniform `spacing`-sized: default 0.35 on a powerline, 0.18 on a zipline, 0.45 on the others.
  wireRadius?: number,
  rolls?: number[],
  revision?: number,
}

SplineStyle = | "picket" | "privacy" | "post-and-rail" | "split-rail" | "iron" | "chain-link" | "trimmed" | "wild" | "wood-distribution" | "steel-transmission" | "metal" | "old-wood" | "streetlight-classic" | "streetlight-curved" | "streetlight-lantern" | "streetlight-double" | "streetlight-globe" | "streetlight-modern" | "streetlight-pendant" | "streetlight-industrial" | "streetlight-victorian" | "streetlight-art-deco" | "streetlight-harbor" | "streetlight-park" | "streetlight-neon" | "streetlight-rustic" | "streetlight-campus" | "streetlight-gaslamp" | "streetlight-boulevard" | "streetlight-solar" | "streetlight-transit" | "streetlight-pagoda"

Sprite2DMetaSpec = {
  outline?: [number, number][],
  world_height?: number,
  target_size?: number,
  style?: "pixel" | "non-pixel",
  kind?: "sprite" | "texture",
  anchor_uv?: [number, number],
  view?: string,
  content_box?: [number, number, number, number],
}

SqlAPI = {
  size(): Promise<number>,
  backup(label: string): Promise<{ label: string; bookmark: string; ts: number }>,
  restore(target: string | number | { label?: string; ts?: number }): Promise<{ restoredTo: string }>,
}

StandardMaterialSpec = {
  texture?: string | null,
  time?: number, // The .mp4 clip's playhead in seconds: every player's screen shows `paused ? time : time + speed * (ctx.now() - timeAt) / 1000`, and a write jumps every screen. One address is one clip: the newest write on any surface wearing it moves it. An .m3u8 plays its live point.
  timeAt?: number, // World-clock milliseconds (ctx.now()) at which `time` applies; the engine stamps it for you.
  paused?: boolean,
  speed?: number, // The .mp4 clip's playback speed on every player's screen (default 1; 0.5 is half speed): a write keeps the frame it shows and plays on at the new speed.
  view?: { link: string; oneWay?: boolean; spill?: number; sound?: number } | { camera: ViewCamera; cadence?: string } | null,
  canvas?: string | null,
  pbr?: boolean | "fal1",
  normalMap?: string,
  roughnessMap?: string,
  metalnessMap?: string,
  alphaMap?: string,
  normalScale?: number,
  alphaTest?: number, // three's alphaTest: the alpha cutoff (0..1) under which a texel is cut
  color?: Color,
  repeat?: [number, number],
  textureScale?: number, // meters per tile under wrap: "repeat" (divides the 1-tile-per-meter density; default 1); without wrap: "repeat" it reads nothing
  wrap?: "repeat" | "clamp",
  filter?: "pixel" | "linear",
  metalness?: number,
  roughness?: number,
  opacity?: number,
  transparent?: boolean,
  emissive?: Color,
  emissiveIntensity?: number,
  emissiveMap?: string,
  unlit?: boolean,
  dissolve?: number, // 0 intact → 1 gone; tween it for a spawn-in / death-out
  side?: "front" | "back" | "double",
  vertexColors?: boolean,
  depthWrite?: boolean,
  depthTest?: boolean,
  renderOrder?: number, // draw order among transparent things (higher draws later); in a 2D place it is a mesh's layer among sprite sortingLayers; a part that must read through another part of its own character wears drawsOver instead
  drawsOver?: string[] | { parts: string[]; strength?: number; angle?: number },
  outline?: boolean | { color?: Color; width?: number; warm?: number; lightness?: number } | null,
  polygonOffset?: boolean,
  polygonOffsetFactor?: number,
  polygonOffsetUnits?: number,
  blending?: "none" | "normal" | "additive" | "subtractive" | "multiply" | "custom",
  blendSrc?: BlendFactor,
  blendDst?: BlendFactor,
  blendEquation?: BlendEquation,
  blendSrcAlpha?: BlendFactor,
  blendDstAlpha?: BlendFactor,
  blendEquationAlpha?: BlendEquation,
  premultipliedAlpha?: boolean,
  colorWrite?: boolean,
  clippingPlanes?: ClipPlane[] | null,
  clipIntersection?: boolean,
  clipShadows?: boolean,
  overrides?: MaterialOverridesSpec,
}

TerrainBrush = {
  center: Vec3,
  radius: number,
  fn: (p: { x: number; z: number }, inset: number, current: number) => number, // returns the cell's new value; `inset` is metres in from the rim (`radius` at the centre, 0 at the edge), so a 0..1 falloff is `inset / radius`; `current` is the cell's value now
}

TerrainOffset = {
  terrain: number,
}

TomeCameraState = Record<string, unknown> & {
  orthoSize?: number, // The orthographic view's half-height in metres, the dial a 2D place's rig zooms with: default 12 (20 in a "2d-top" place).
  orthoSqueeze?: number, // The orthographic view's height scale (1 or unset: no squeeze): the view keeps its width and shows `orthoSize × orthoSqueeze` metres above and below its centre. For an eye looking down at angle a below the horizon, `Math.sin(a)` draws a metre of ground depth as tall as a metre across; at 45° (`Math.SQRT1_2`) a metre of height too.
}

TomeEars = Readonly<Record<string, TomeEventHandler>>

TomeEventHandler = (ctx: ObjectAPI, payload: unknown, meta: TomeEventMeta) => void

TomeEventMeta = {
  name: string,
  sourceId: string,
  placeId: string,
  to?: string,
  origin?: { world: string; actor: string; script: string | null; door: string | null; exit: string | null; address: string },
}

TomeEventOptions = {
  place?: string,
  once?: boolean,
}

TradeReceipt = { offered: true; id: string; give: string; with: string; for: string } | { offered: false; refused: "unknown-target" | "not-held" | "not-mine" | "same-party" | "withdrawn"; message: string }

TraverseCheckBlockReason = "riser_exceeds_autostep" | "slope_exceeds_max" | "gap" | "ceiling" | "destination_below_floor" | "terrain_unloaded"

TraverseCheckOptions = {
  place?: string,
  body?: string,
  includeDynamicBodies?: boolean,
  ignoreEntities?: string[],
}

TraverseCheckResult = {
  traversable: boolean,
  blockedAt?: Vec3,
  reason?: TraverseCheckBlockReason,
  blockedBy?: string,
  detail?: { riser?: number; maxStep?: number; slopeDeg?: number; maxSlopeDeg?: number; clearance?: number; requiredClearance?: number; drop?: number },
  approximate: string[],
  exact?: string,
  params: { maxStep: number; maxSlopeDeg: number; capsuleRadius: number; capsuleHeight: number; body: string | null },
}

UIDef = {
  render?: ScriptRef,
}

UnderwaterSpec = {
  enabled?: boolean,
  depth?: number,
  color?: Color,
  visibility?: number,
  scatter?: number,
  distortion?: number,
}

UpdateSchedule = {
  every?: number | { seconds: number },
  near?: UpdateScheduleNearRule | readonly UpdateScheduleNearRule[],
}

UpdateScheduleNearRule = {
  tag?: string,
  radius: number,
}

Vec3 = {
  x: number,
  y: number,
  z: number,
}

ViewAPI = {
  camera: ViewCameraPose | { parent: string; eye?: Vec3; aim?: Vec3 | "forward" | string; fov?: number; projection?: "perspective" | "orthographic"; orthoSize?: number; layers?: string[] } | null,
  pixel: number, // the angle in radians one screen pixel spans at the middle of this machine's picture (its fov over its rows). A level whose smallest cube is c metres hands over at c / ctx.view.pixel metres. Read-only.
  fps: number, // the frames this machine's picture presented in its last second, a whole number. 0 before the first second and on a machine with no picture (the server). Read-only.
  drawCalls: number, // the draw calls this machine's picture made in its last frame, as three's renderer.info.render.calls counts them: every pass, the shadow maps included; read again once a second. 0 before the first second and on a machine with no picture (the server). Read-only.
  triangles: number, // the triangles this machine's picture drew in its last frame, in its view and its shadow maps. Read-only.
  cpuMs: number, // the milliseconds of CPU this machine's renderer spent on each frame, the mean over the frames its last second drew, fractional: the work before the GPU (the game's scripts and physics run apart and are not counted). A second that drew no frame keeps the reading before it. 0 before the first second and on a machine with no picture (the server). Read-only.
  gpuMs: number, // the milliseconds each frame of this machine's picture took on the GPU, the mean over the frames its last second drew by the GPU's own timer, fractional, kept as cpuMs is. 0 where the adapter has no GPU timer (timestamp queries), before the first second and on a machine with no picture. Read-only.
  frames: { cpuMs: number; gpuMs?: number }[], // each frame this machine's picture drew since this handle's last read, oldest first, as `{ cpuMs, gpuMs }`: its CPU milliseconds as cpuMs measures them, and its GPU milliseconds by the GPU's own timer, absent where the adapter has no GPU timer or the timer did not read that frame. Frames arrive about once a second, so a read between arrivals is `[]`. A read empties this handle's list. A handle unread for about a second holds nothing and starts over at its next read. [] on a machine with no picture. Read-only.
  memoryMB: number | null, // the memory Spawn uses, in whole megabytes, at the engine's newest reading: in the Spawn app, all of the app's memory on this machine; in Chrome and Edge, only the game page's JavaScript memory, which can be a minute or more old. null in Safari, on iPhone and iPad, in Firefox, before the first reading and on the server. Read-only.
  gpuMemoryMB: number, // the GPU memory this machine's picture holds, in whole megabytes: every texture and buffer its renderer made, as the engine counts what it asked the GPU for, read again once a second. 0 before the first second and on a machine with no picture (the server). Read-only.
  renderScale: number, // the share, on each side, of this machine's full picture at which the engine draws the world: 1 at full, 0.5 at half the width and height, below 1 while it draws smaller to keep frames fast. Full is the engine's own full picture, on a dense screen fewer pixels than the screen. The HUD (ui.js) is not scaled. Read again once a second, to a thousandth. 0 before the first second and on a machine with no picture (the server). Read-only.
  netInBytes: number, // the bytes this machine's connection to its room took in over its last whole second: every message the room sent it (the game's state, other players' moves, the room's answer to this machine's heartbeat, one message every 5 s). Downloads of models, pictures and sounds are not counted. 0 before the first second, with no room and on a machine with no picture (the server). Read-only.
  netOutBytes: number, // the bytes this machine's connection to its room sent over its last whole second, counted as netInBytes is: every message it sent the room (its inputs, the state of what it simulates, its heartbeat, one message every 5 s). Read-only.
  netInMessages: number, // the messages this machine's connection to its room took in over its last whole second, the same messages netInBytes counts the bytes of, one for each. Read-only.
  netOutMessages: number, // the messages this machine's connection to its room sent over its last whole second, the same messages netOutBytes counts the bytes of, one for each. Read-only.
  site: string | null, // the site whose page holds this machine's picture when it is not Spawn's own: the host of the page framing the game, as the browser names that page ("x.com" under a page at x.com, "platform.twitter.com" under X's embedded post on another site, a creator's own domain on their site); "" when the browser names no page around the frame. null on spawn.co's own pages, in the Spawn app, and on a machine with no picture (the server). Read-only.
}

ViewCamera = "mirror" | { mirror: true; layers?: string[] } | (ViewCameraPose & { place?: string }) | { parent: string; eye?: Vec3; aim?: Vec3 | "forward" | string; fov?: number; projection?: "perspective" | "orthographic"; orthoSize?: number; layers?: string[]; place?: string }

ViewCameraPose = {
  eye: Vec3,
  aim: Vec3 | string,
  fov?: number,
  projection?: "perspective" | "orthographic",
  orthoSize?: number,
  layers?: string[],
}

VoxelCoord = {
  x: number,
  y: number,
  z: number,
  place?: string,
}

VoxelFillOptions = {
  state?: number,
  place?: string,
}

VoxelMarkFillOptions = {
  color?: Color,
  opacity?: number = 0.14, // Fill opacity from 0 to 1.
  inset?: number = 0.08, // Offset from the voxel faces, as a share of the cell's side: 0.05 on a 0.5 m cell is 2.5 cm, inward in an open cell, outward round a block.
}

VoxelMarkOutlineOptions = {
  color?: Color,
  opacity?: number = 1, // Outline opacity from 0 to 1.
  inflate?: number = 0.03, // Extra world-space size added outside the voxel bounds, in meters.
}

VoxelMarkPulseOptions = {
  speed?: number = 2, // Pulses per second.
  intensity?: number = 0.18, // Pulse intensity as a multiplier amount (0..1; at 1 the mark fades out fully at each dip).
}

VoxelQueryHit = {
  x: number,
  y: number,
  z: number,
  material: string,
  state: number,
}

VoxelQueryOptions = {
  tag: string,
  radius: number, // Search radius in world meters from origin. Cells beyond this distance are excluded.
  center?: Vec3,
  place?: string,
}

VoxelRaycastHit = {
  position: Vec3,
  normal: Vec3,
  distance: number,
  voxel: Vec3,
  adjacentVoxel: Vec3 | null,
  materialId: string,
  state: number,
}

VoxelRaycastOptions = {
  distance?: number, // Maximum distance to cast (default: 64)
  includeLiquids?: boolean,
  place?: string,
}

VoxelStructureSource = string | SerializedVoxelTemplate | Record<string, unknown> | (() => unknown)

WaterMaterialSpec = {
  kind: "water",
  underwater?: UnderwaterSpec,
  color?: Color,
  opacity?: number,
  waveIntensity?: number,
  waveFrequency?: number, // Unitless spatial scale; default 7.3728 for this water material. Higher values make shorter waves; lower values make longer waves. Each wave stays at full strength up to half the sheet's smaller X/Z span, fades from half to one span, and is absent beyond that span.
  waveHeightScale?: number, // Wave height multiplier; 0 makes a flat sheet.
  flowDirection?: [number, number], // Flow direction in world X/Z on a level sheet. It is normalized. On a face steeper than 60° (a fall, a standing capsule's side) the water runs down the face under gravity whatever this says.
  flowSpeed?: number, // Flow speed control; 0.1 moves foam about 1.2 metres per second.
  roughness?: number, // Surface roughness, 0 to 1.
  normalScale?: number, // Ripple detail scale; larger values make smaller ripples.
  detailNormalStrength?: number, // Ripple normal strength; 0 removes small ripples.
  foamColor?: Color,
  foamStrength?: number, // Overall foam strength; 0 removes foam on a level sheet. A fall (a face steeper than 60°) is aerated by its flow whatever this says: flowSpeed 0 is a still glass sheet.
  foamScale?: number, // Foam pattern scale; larger values make smaller patches.
  contactFoamWidth?: number, // Contact band width in metres.
  shorelineFoamStrength?: number,
  shorelineFoamSoftness?: number,
  crestFoamCoverage?: number, // Fraction of wave crests that can foam, 0 to 1.
  crestFoamStrength?: number,
  causticsEnabled?: boolean,
  causticStrength?: number,
  causticScale?: number,
  depthColorDistance?: number, // Distance in metres over which water takes its deep color.
  refractionStrength?: number, // Strength of the surface view distortion; 0 disables it.
  swellAmplitude?: number, // Height of long sea swells in metres; 0 disables them.
  swellDirection?: [number, number], // Long swell direction in world X/Z. It is normalized.
  surfWidth?: number, // Width of the breaking surf zone in metres.
  wakeSeconds?: number, // How long, in seconds, the wake a body leaves on this water stays in the picture: the drawn rings and foam fade, and are gone this long after the last body nearby stops moving. Unset: the wake this water draws by default.
}

WorldBoundsDef = {
  bottom?: number | false,
}
```
