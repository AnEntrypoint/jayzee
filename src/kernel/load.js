const FLOAT64_HANDLE_TAG = 0x7ff98007
const LENGTH_HEADER_BYTES = 8
const FLOAT64_BYTES = 8
const BOX_WORDS = 6
const BODY_WORDS = 3

let compiled = null

export const loadKernel = (bytes) => {
  compiled = new WebAssembly.Module(bytes)
  return compiled
}

const readKernelFromDisk = () => {
  const host = globalThis.process
  if (typeof host?.getBuiltinModule !== 'function') {
    throw new Error('kernel bytes are not loaded: call loadKernel(bytes) with the contents of kernel.wasm first')
  }
  const { existsSync, readFileSync } = host.getBuiltinModule('node:fs')
  const { fileURLToPath } = host.getBuiltinModule('node:url')
  const wasm = fileURLToPath(new URL('../../dist/kernel.wasm', import.meta.url))
  if (!existsSync(wasm)) throw new Error('kernel is not built: run npm run build:kernel')
  return readFileSync(wasm)
}

const isPowerOfTwo = (value) => Number.isInteger(value) && value > 0 && (value & (value - 1)) === 0

const viewOf = (memory, handle, words, name) => {
  if (typeof handle !== 'bigint') throw new TypeError('the kernel returned no handle for its ' + name)
  const tag = Number(BigInt.asUintN(32, handle >> 32n))
  const offset = Number(BigInt.asUintN(32, handle))
  if (tag !== FLOAT64_HANDLE_TAG) throw new TypeError('the kernel handle for its ' + name + ' is not a Float64Array handle (tag 0x' + tag.toString(16) + ')')
  const bytes = new Uint32Array(memory.buffer, offset - LENGTH_HEADER_BYTES, 1)[0]
  if (bytes !== words * FLOAT64_BYTES) throw new RangeError('the kernel holds ' + bytes + ' bytes for its ' + name + ', and ' + words * FLOAT64_BYTES + ' were reserved')
  return new Float64Array(memory.buffer, offset, words)
}

export const instantiateKernel = ({ capacity, boxCount, buckets, occupancyWords }) => {
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('capacity must be a whole number of at least 1')
  if (!Number.isInteger(boxCount) || boxCount < 1) throw new RangeError('boxCount must be a whole number of at least 1')
  if (!isPowerOfTwo(buckets)) throw new RangeError('buckets must be a power of two, because the pair search masks its hash')
  if (!isPowerOfTwo(occupancyWords)) throw new RangeError('occupancyWords must be a power of two, because the pair search masks its hash')
  if (compiled === null) loadKernel(readKernelFromDisk())
  const run = new WebAssembly.Instance(compiled, {}).exports
  run.reserve(capacity, boxCount, buckets, occupancyWords)
  return {
    run,
    positions: viewOf(run.memory, run.positions(), capacity * BODY_WORDS, 'positions'),
    velocities: viewOf(run.memory, run.velocities(), capacity * BODY_WORDS, 'velocities'),
    boxes: viewOf(run.memory, run.boxTable(), boxCount * BOX_WORDS, 'boxes'),
  }
}
