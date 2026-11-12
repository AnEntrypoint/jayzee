export let pos = new Float64Array(3)
export let vel = new Float64Array(3)
export let boxes = new Float64Array(6)
export let head = new Int32Array(1)
export let next = new Int32Array(1)
export let cells = new Int32Array(3)
export let occupied = new Int32Array(1)
export let grid = new Int32Array(1)
export let posWords = new Uint32Array(6)
export let velWords = new Uint32Array(6)

export const reserve = (capacity, boxCount, buckets, occupancyWords) => {
  pos = new Float64Array(capacity * 3)
  vel = new Float64Array(capacity * 3)
  boxes = new Float64Array(boxCount * 6)
  head = new Int32Array(buckets * 1)
  next = new Int32Array(capacity * 1)
  cells = new Int32Array(capacity * 3)
  occupied = new Int32Array(occupancyWords * 1)
  grid = new Int32Array(1)
  posWords = new Uint32Array(pos.buffer, pos.byteOffset, capacity * 6)
  velWords = new Uint32Array(vel.buffer, vel.byteOffset, capacity * 6)
}

export const positions = () => pos
export const velocities = () => vel
export const boxTable = () => boxes
