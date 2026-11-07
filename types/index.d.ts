export interface WorldOptions {
  capacity?: number
  tickRate?: number
  gravity?: number
  drag?: number
  radius?: number
  restitution?: number
  solverIterations?: number
  boxes?: ReadonlyArray<readonly [number, number, number, number, number, number]>
}

export type Vec3 = readonly [number, number, number]

export interface State {
  tick: number
  count: number
  positions: Float64Array
  velocities: Float64Array
}

export interface Snapshot {
  tick: number
  count: number
  positions: Float64Array
}

export declare class World {
  constructor(options?: WorldOptions)
  readonly count: number
  readonly tick: number
  readonly stepSeconds: number
  spawn(position: Vec3, velocity?: Vec3): number
  position(id: number): [number, number, number]
  velocity(id: number): [number, number, number]
  setVelocity(id: number, velocity: Vec3): void
  step(): void
  advance(seconds: number): number
  hash(): number
  snapshot(): Snapshot
  setPosition(id: number, position: Vec3): void
  exportState(): State
  importState(state: State): void
}

export interface InputRecord {
  sequence: number
  moveX: number
  moveZ: number
  yaw: number
  buttons: number
}

export declare const INPUT_VERSION: number
export declare const MAX_INPUT_RECORDS: number
export declare function encodeInputs(records: readonly InputRecord[]): ArrayBuffer
export declare function decodeInputs(buffer: ArrayBuffer): InputRecord[]

export declare const SNAPSHOT_VERSION: number
export declare function encodeSnapshot(snapshot: { tick: number; count: number; positions: ArrayLike<number> }): ArrayBuffer
export declare function decodeSnapshot(buffer: ArrayBuffer): Snapshot

export declare const STATE_VERSION: number
export declare function encodeState(state: State): ArrayBuffer
export declare function decodeState(buffer: ArrayBuffer): State

export interface InputBufferOptions {
  window?: number
  maxHold?: number
}

export type InputSource = 'input' | 'held' | 'neutral'
export type PushOutcome = 'accepted' | 'duplicate' | 'stale'

export interface InputBufferStats {
  accepted: number
  duplicate: number
  stale: number
  skipped: number
  input: number
  held: number
  neutral: number
}

export declare class InputBuffer {
  constructor(options?: InputBufferOptions)
  readonly next: number
  readonly pending: number
  readonly stats: InputBufferStats
  push(record: InputRecord): PushOutcome
  take(): { source: InputSource; input: InputRecord }
}

export declare function canonicalInput(record: InputRecord): InputRecord
export declare function applyMovement(world: World, id: number, input: InputRecord, speed: number): void

export interface PredictorOptions {
  world: World
  body: number
  speed: number
}

export declare class Predictor {
  constructor(options: PredictorOptions)
  readonly pending: number
  readonly acked: number
  predict(intent: { moveX: number; moveZ: number; yaw: number; buttons?: number }): InputRecord
  reconcile(state: State): boolean
}

export interface AuthorityOptions {
  world: World
  speed: number
}

export declare class Authority {
  constructor(options: AuthorityOptions)
  readonly tick: number
  addPlayer(id: number, body: number, options?: InputBufferOptions): void
  receive(id: number, packet: ArrayBuffer): void
  stats(id: number): InputBufferStats
  step(): void
  state(): State
}

export declare const DELTA_VERSION: number
export declare function encodeDelta(state: State, base?: State | null): ArrayBuffer
export declare function decodeDelta(buffer: ArrayBuffer, lookup?: (tick: number) => State | null): State

export declare const ACK_VERSION: number
export declare function encodeAck(tick: number): ArrayBuffer
export declare function decodeAck(buffer: ArrayBuffer): number

export interface StateSenderOptions {
  depth?: number
}

export declare class StateSender {
  constructor(options?: StateSenderOptions)
  readonly acked: number | null
  send(state: State): ArrayBuffer
  acknowledge(tick: number): boolean
}

export interface StateReceiverOptions {
  depth?: number
}

export declare class StateReceiver {
  constructor(options?: StateReceiverOptions)
  readonly latest: number | null
  receive(buffer: ArrayBuffer): State
  ack(): ArrayBuffer
}

export declare function decodeName(name: string): string
export declare function readFrames(bytes: Uint8Array): Uint8Array[]
export declare function sha256Hex(bytes: Uint8Array): string
export declare function verifyContent(hash: string, bytes: Uint8Array): boolean

export interface SpawnHead {
  v: number
  worldHex: string
  commit: string
  tree: string
  seq: number
  manifest: string
  sheet: string
  [key: string]: unknown
}

export declare function parseHead(text: string): SpawnHead

export interface SpawnManifest {
  index: { v: number; hashes: Record<string, string> }
  sheet: { v: number; [key: string]: unknown }
  sheetHash: string
  frames: Uint8Array[]
}

export declare function parseManifest(bytes: Uint8Array, head?: SpawnHead | null): SpawnManifest

export interface SpawnFeedEntry {
  world: string
  adventure: string
  name: string
  creator: string
  app: string
  sort: string
}

export interface FeedPageRequest {
  offset: number
  limit: number
}

export interface FeedWalkOptions {
  step?: number
  limit?: number
  emptyPagesToStop?: number
  maxPages?: number
}

export declare function normalizeFeedEntry(entry: unknown): SpawnFeedEntry
export declare function walkFeed(
  fetchPage: (request: FeedPageRequest) => Promise<unknown[]>,
  options?: FeedWalkOptions
): Promise<{ entries: SpawnFeedEntry[]; pages: number }>
