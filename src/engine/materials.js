export const MATERIAL_STRIDE_BYTES = 40
export const MATERIAL_WORDS = 10
export const MATERIAL_ALBEDO_WORD = 9
export const MATERIAL_FIELD_WORDS = 9
export const TEXTURE_FORMAT = Object.freeze({ RGBA8_UNORM: 1, RGBA8_SRGB: 2 })
export const TABLE_STATUS = Object.freeze({ OK: 0, FULL: -1, RANGE: -2, NOT_CONFIGURED: -3, BAD_ID: -4 })

const requireModule = (module) => {
  if (module === null || typeof module !== 'object') throw new TypeError('the wasm module is required')
}

export const createMaterials = (module, layout) => {
  requireModule(module)
  if (layout === null || typeof layout !== 'object') throw new TypeError('createMaterials needs the layout view offsets')
  const { offset, count, stride } = layout
  if (!Number.isInteger(offset) || offset < 0 || offset % 4 !== 0) throw new RangeError('material view offset must be a whole byte offset divisible by 4, got ' + String(offset))
  if (stride !== MATERIAL_STRIDE_BYTES) throw new RangeError('material stride must be ' + MATERIAL_STRIDE_BYTES + ' bytes, got ' + String(stride))
  if (!Number.isInteger(count) || count < 1) throw new RangeError('material table is not bound: count ' + String(count))
  if (module._engine_material_count() !== count) throw new RangeError('material count ' + String(count) + ' does not match the wasm table')
  if (offset + count * stride > module.HEAPU8.length) throw new RangeError('material table runs past the wasm memory')
  const base = offset / 4
  const end = base + count * MATERIAL_WORDS
  const data = module.HEAPF32.subarray(base, end)
  const words = module.HEAPU32.subarray(base, end)

  return Object.freeze({
    capacity: count,
    data,
    words,
    add: (r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo = 0) =>
      module._engine_material_add(r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo),
    set: (handle, r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo = 0) =>
      module._engine_material_set(handle, r, g, b, a, roughness, metallic, emissiveR, emissiveG, emissiveB, albedo),
    remove: (handle) => module._engine_material_remove(handle),
    isLive: (handle) => module._engine_material_is_live(handle) === 1,
    slot: (handle) => module._engine_material_slot(handle),
    liveCount: () => module._engine_material_live_count()
  })
}

export const createTextures = (module) => {
  requireModule(module)
  const capacity = module._engine_texture_count()
  if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('texture table is not bound: count ' + String(capacity))

  return Object.freeze({
    capacity,
    add: (width, height, format = TEXTURE_FORMAT.RGBA8_UNORM) => module._engine_texture_add(width, height, format),
    remove: (handle) => module._engine_texture_remove(handle),
    isLive: (handle) => module._engine_texture_is_live(handle) === 1,
    layer: (handle) => module._engine_texture_layer(handle),
    liveCount: () => module._engine_texture_live_count()
  })
}
