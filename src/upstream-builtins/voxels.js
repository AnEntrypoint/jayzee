const VERSION = 1
const SHAPE_BUILDERS = Object.freeze(['fill', 'hollowBox', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus', 'line'])

const refuse = (what) => {
  throw new RangeError(what + ' has no documented headless behaviour in upstream; refused as a scoped negative')
}

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

const onlyKeys = (value, allowed, label) => {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) refuse(label + ' option ' + key)
  }
}

const coordinate = (value, label) => {
  if (!Number.isSafeInteger(value)) throw new RangeError(label + ' is a whole number')
  return value
}

const triple = (value, label) => {
  if (!Array.isArray(value) || value.length !== 3) throw new TypeError(label + ' is [x, y, z]')
  return value.map((component, i) => coordinate(component, label + ' component ' + i))
}

const cellKey = (x, y, z) => x + ',' + y + ',' + z

const materialId = (value) => {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('material id is a non-empty string')
  return value
}

const idList = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) throw new TypeError('ids is a non-empty list of material ids')
  return Object.freeze(ids.map(materialId))
}

const weightList = (weights, count) => {
  if (weights === undefined) return null
  if (!Array.isArray(weights) || weights.length !== count) throw new RangeError('weights are one number per id')
  for (const weight of weights) {
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) throw new RangeError('weights are zero or more numbers')
  }
  if (weights.reduce((sum, weight) => sum + weight, 0) <= 0) throw new RangeError('weights sum to more than zero')
  return Object.freeze([...weights])
}

const seedValue = (value) => {
  if (Number.isSafeInteger(value)) return value
  if (typeof value === 'string' && value.length > 0) return value
  throw new TypeError('seed is a whole number or a non-empty string')
}

export const material = (id) => Object.freeze({ kind: 'material', id: materialId(id) })

export const checker = (a, b) => Object.freeze({ kind: 'checker', a: materialId(a), b: materialId(b) })

export const random = (ids, weights) => {
  const list = idList(ids)
  return Object.freeze({ kind: 'random', ids: list, weights: weightList(weights, list.length) })
}

export const noise = (ids, opts = {}) => {
  const list = idList(ids)
  if (!isPlainObject(opts)) throw new TypeError('noise options is an object')
  onlyKeys(opts, ['scale', 'seed', 'weights'], 'noise')
  const scale = opts.scale === undefined ? null : opts.scale
  if (scale !== null && (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0)) throw new RangeError('scale is a positive finite number')
  const seed = opts.seed === undefined ? null : seedValue(opts.seed)
  return Object.freeze({ kind: 'noise', ids: list, scale, seed, weights: weightList(opts.weights, list.length) })
}

const resolveMaterial = (brush) => {
  if (!isPlainObject(brush) || typeof brush.kind !== 'string') throw new TypeError('material is a Brush')
  if (brush.kind !== 'material') refuse(brush.kind + ' brush')
  return materialId(brush.id)
}

const boundsOf = (triples) => {
  if (triples.length === 0) return null
  const low = [Infinity, Infinity, Infinity]
  const high = [-Infinity, -Infinity, -Infinity]
  for (const [x, y, z] of triples) {
    const point = [x, y, z]
    for (let axis = 0; axis < 3; axis++) {
      if (point[axis] < low[axis]) low[axis] = point[axis]
      if (point[axis] > high[axis]) high[axis] = point[axis]
    }
  }
  return [low, high]
}

const readSerialized = (data) => {
  if (!isPlainObject(data)) throw new TypeError('a serialized part is an object')
  onlyKeys(data, ['version', 'bounds', 'palette', 'voxels'], 'serialized part')
  if (data.version !== VERSION) throw new RangeError('serialized version is 1')
  if (!Array.isArray(data.palette)) throw new TypeError('palette is a list of material ids')
  const palette = data.palette.map(materialId)
  if (!Array.isArray(data.voxels)) throw new TypeError('voxels is a list of [x, y, z, paletteIndex]')
  const seen = new Set()
  const voxels = data.voxels.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 4) throw new TypeError('a voxel is [x, y, z, paletteIndex]')
    const [x, y, z] = triple(entry.slice(0, 3), 'voxel')
    const index = entry[3]
    if (!Number.isSafeInteger(index) || index < 0 || index >= palette.length) throw new RangeError('palette index ' + index + ' is not in the palette')
    const cell = cellKey(x, y, z)
    if (seen.has(cell)) throw new RangeError('duplicate voxel at ' + cell)
    seen.add(cell)
    return [x, y, z, index]
  })
  if (data.bounds === undefined) throw new TypeError('bounds is required, null for an empty part')
  const expected = boundsOf(voxels.map(([x, y, z]) => [x, y, z]))
  if (JSON.stringify(data.bounds) !== JSON.stringify(expected)) throw new RangeError('bounds do not match the voxels')
  return { palette, voxels }
}

const refusedShape = (name, spec) => {
  if (!isPlainObject(spec)) throw new TypeError(name + ' options is an object')
  resolveMaterial(spec.material)
  return refuse(name)
}

export const part = () => {
  const cells = new Map()

  const put = (x, y, z, id) => {
    const cell = coordinate(x, 'x') + ',' + coordinate(y, 'y') + ',' + coordinate(z, 'z')
    cells.set(cell, { x, y, z, id })
  }

  const entries = () => [...cells.values()].sort((a, b) => a.x - b.x || a.y - b.y || a.z - b.z)

  const self = {
    set(spec) {
      if (!isPlainObject(spec)) throw new TypeError('set options is an object')
      onlyKeys(spec, ['x', 'y', 'z', 'material'], 'set')
      const x = coordinate(spec.x, 'x')
      const y = coordinate(spec.y, 'y')
      const z = coordinate(spec.z, 'z')
      put(x, y, z, resolveMaterial(spec.material))
      return self
    },
    add(source, options = {}) {
      if (!isPlainObject(options)) throw new TypeError('add options is an object')
      onlyKeys(options, ['at'], 'add')
      const offset = options.at === undefined ? [0, 0, 0] : triple(options.at, 'at')
      const data = typeof source?.serialize === 'function' ? source.serialize() : readSerialized(source)
      for (const [x, y, z, index] of data.voxels) {
        const moved = [x + offset[0], y + offset[1], z + offset[2]]
        for (const component of moved) coordinate(component, 'moved coordinate')
        put(moved[0], moved[1], moved[2], data.palette[index])
      }
      return self
    },
    bounds() {
      return boundsOf(entries().map((entry) => [entry.x, entry.y, entry.z]))
    },
    serialize() {
      const sorted = entries()
      const palette = [...new Set(sorted.map((entry) => entry.id))].sort()
      const index = new Map(palette.map((id, i) => [id, i]))
      return {
        version: VERSION,
        bounds: boundsOf(sorted.map((entry) => [entry.x, entry.y, entry.z])),
        palette,
        voxels: sorted.map((entry) => [entry.x, entry.y, entry.z, index.get(entry.id)]),
      }
    },
  }

  for (const name of SHAPE_BUILDERS) {
    self[name] = (spec) => refusedShape(name, spec)
  }

  return Object.freeze(self)
}

export const SHAPE_BUILDER_NAMES = SHAPE_BUILDERS
