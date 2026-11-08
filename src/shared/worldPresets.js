const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

function cloneData(v) {
  if (Array.isArray(v)) return v.map(cloneData)
  if (isPlainObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, cloneData(x)]))
  return v
}

function mergeSlice(base, over) {
  if (!isPlainObject(base) || !isPlainObject(over)) return over === undefined ? cloneData(base) : over
  const out = cloneData(base)
  for (const [k, v] of Object.entries(over)) out[k] = mergeSlice(base[k], v)
  return out
}

function mergeEntities(base = [], over = []) {
  const byId = new Map(over.filter(e => e?.id !== undefined).map(e => [e.id, e]))
  const kept = base.filter(e => !byId.has(e?.id)).map(e => cloneData(e))
  return [...kept, ...over]
}

function mergeWorld(base, over) {
  const out = mergeSlice(base, over)
  if (base.entities || over.entities) out.entities = mergeEntities(base.entities, over.entities)
  return out
}

export function expandWorldPresets(worldDef, presetTable) {
  if (!isPlainObject(worldDef) || worldDef.presets === undefined) return worldDef
  const { presets, ...own } = worldDef
  if (!Array.isArray(presets)) throw new TypeError(`world presets must be an array of preset names, got ${JSON.stringify(presets)}`)
  if (new Set(presets).size !== presets.length) throw new TypeError(`world presets must not repeat a name, got ${JSON.stringify(presets)}`)
  if (presets.length > 0 && !isPlainObject(presetTable)) throw new TypeError('world presets need a preset table: an object mapping preset names to a preset or a preset function')
  let merged = {}
  for (const name of presets) {
    const preset = presetTable && Object.hasOwn(presetTable, name) ? presetTable[name] : null
    if (!preset) throw new TypeError(`unknown world preset ${JSON.stringify(name)} (known: ${Object.keys(presetTable ?? {}).join(', ')})`)
    const params = own[name]
    if (typeof preset === 'function') {
      if (params !== undefined && !isPlainObject(params)) throw new TypeError(`world preset ${name} parameters must be an object, got ${JSON.stringify(params)}`)
      merged = mergeWorld(merged, preset(params ?? {}))
      delete own[name]
    } else {
      if (params !== undefined) throw new TypeError(`world preset ${name} takes no parameters, but the world sets a ${name} key`)
      merged = mergeWorld(merged, preset)
    }
  }
  return mergeWorld(merged, own)
}
