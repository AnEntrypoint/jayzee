const KINDS = Object.freeze({ f32: Float32Array, f64: Float64Array, u32: Uint32Array, u8: Uint8Array })

export const canArenaAllocate = (module) => typeof module?._engine_arena_carve === 'function' && module.HEAPU8 !== undefined

export const arenaAllocator = (module) => {
  if (!canArenaAllocate(module)) throw new TypeError('arenaAllocator needs a module with _engine_arena_carve and HEAPU8')
  return (kind, length) => {
    const Kind = KINDS[kind]
    if (!Kind) throw new RangeError('unknown allocation kind: ' + kind)
    if (!Number.isInteger(length) || length < 0) throw new RangeError('length must be a whole number, not ' + length)
    const bytes = length * Kind.BYTES_PER_ELEMENT
    const ptr = module._engine_arena_carve(bytes, kind === 'f32' ? 16 : 8)
    if (ptr === 0) throw new RangeError('the engine arena has no room for ' + bytes + ' bytes, used ' + Number(module._engine_arena_used()))
    return new Kind(module.HEAPU8.buffer, ptr, length)
  }
}
