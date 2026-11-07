export const createSeededRandom = (seed) => {
  if (!Number.isSafeInteger(seed)) {
    throw new TypeError(`[network-sim] seed must be a safe integer, got ${String(seed)}`)
  }
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}
