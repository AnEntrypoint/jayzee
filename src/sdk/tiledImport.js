const ORIENTATIONS = Object.freeze(['orthogonal'])

function importError(reasonCode, message) {
  return Object.assign(new Error(`TiledImport: ${message}`), { reasonCode })
}

function requireArray(value, where) {
  if (!Array.isArray(value)) throw importError('tiled-shape', `${where} must be an array`)
  return value
}

function requireObject(value, where) {
  if (!value || typeof value !== 'object') throw importError('tiled-shape', `${where} must be an object`)
  return value
}

function optionalNumber(value, fallback, where) {
  if (value == null) return fallback
  if (!Number.isFinite(value)) throw importError('tiled-object', `${where} must be a finite number`)
  return value
}

function propertyMap(list, where) {
  if (list == null) return {}
  const out = {}
  for (const p of requireArray(list, `${where} properties`)) {
    if (typeof p?.name !== 'string') throw importError('tiled-property', `${where} holds a property without a name`)
    if (p.name === '__proto__') throw importError('tiled-property', `${where} holds a property named __proto__`)
    if (Object.hasOwn(out, p.name)) throw importError('tiled-property', `${where} repeats property "${p.name}"`)
    out[p.name] = p.value
  }
  return out
}

function tileLayerPlacements(layer, tileSize, out) {
  const width = layer.width
  if (!Number.isInteger(width) || width <= 0) throw importError('tiled-layer', `tile layer "${layer.name}" has no width`)
  const data = requireArray(layer.data, `tile layer "${layer.name}" data`)
  for (let i = 0; i < data.length; i++) {
    const gid = data[i]
    if (!Number.isInteger(gid) || gid < 0) throw importError('tiled-gid', `tile layer "${layer.name}" holds a gid that is not a non-negative integer at index ${i}`)
    if (gid === 0) continue
    const col = i % width
    const row = Math.floor(i / width)
    out.push({ kind: 'tile', layer: layer.name, gid, col, row, x: col * tileSize, y: row * tileSize })
  }
}

function objectPlacement(obj, layerName) {
  requireObject(obj, `object layer "${layerName}" entry`)
  if (!Number.isFinite(obj.x) || !Number.isFinite(obj.y)) throw importError('tiled-object', `object ${obj.id} in "${layerName}" has no position`)
  return {
    kind: 'object',
    layer: layerName,
    id: obj.id,
    name: obj.name ?? '',
    type: obj.type ?? '',
    x: obj.x,
    y: obj.y,
    width: optionalNumber(obj.width, 0, `object ${obj.id} in "${layerName}" width`),
    height: optionalNumber(obj.height, 0, `object ${obj.id} in "${layerName}" height`),
    rotation: optionalNumber(obj.rotation, 0, `object ${obj.id} in "${layerName}" rotation`),
    visible: obj.visible !== false,
    gid: obj.gid ?? null,
    properties: propertyMap(obj.properties, `object ${obj.id} in "${layerName}"`),
  }
}

function objectLayerPlacements(layer, out) {
  for (const obj of requireArray(layer.objects, `object layer "${layer.name}" objects`)) {
    out.push(objectPlacement(obj, layer.name))
  }
}

export function importTiledMap(map) {
  requireObject(map, 'map')
  if (!ORIENTATIONS.includes(map.orientation)) throw importError('tiled-orientation', `orientation "${map.orientation}" is not one of ${ORIENTATIONS.join(', ')}`)
  if (!Number.isInteger(map.tilewidth) || map.tilewidth <= 0) throw importError('tiled-tilesize', 'tilewidth must be a positive integer')
  const layers = requireArray(map.layers, 'layers')
  const placements = []
  for (const layer of layers) {
    requireObject(layer, 'layer')
    if (layer.visible === false) continue
    if (layer.type === 'tilelayer') tileLayerPlacements(layer, map.tilewidth, placements)
    else if (layer.type === 'objectgroup') objectLayerPlacements(layer, placements)
  }
  return {
    width: map.width,
    height: map.height,
    tileSize: map.tilewidth,
    properties: propertyMap(map.properties, 'map'),
    placements,
  }
}
