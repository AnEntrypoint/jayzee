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
