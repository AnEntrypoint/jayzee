import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = process.argv[2] || '/workspace/spoint'
const spoint = await import(pathToFileURL(join(spointRoot, 'apps', 'world', '_shared', 'worldDefParse.js')).href)

const verdictOf = (fn) => {
  try {
    fn()
    return { ok: true }
  } catch (error) {
    return { code: error.code, message: error.message }
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const terrainConfigOf = (def) => {
  if (Array.isArray(def.entities)) {
    for (const entity of def.entities) {
      if (entity && entity.app === 'terrain' && isPlainObject(entity.config)) return entity.config
    }
  }
  return isPlainObject(def.terrain) ? def.terrain : null
}

const projectionOf = (def) => {
  const out = {}
  if ('planetRadius' in def) out.planetRadius = def.planetRadius
  const terrain = terrainConfigOf(def)
  if (terrain) {
    const picked = {}
    if ('clusters' in terrain) picked.clusters = terrain.clusters
    if ('radius' in terrain) picked.radius = terrain.radius
    out.terrain = picked
  }
  return out
}

const SYNTHETIC = [
  ['a world def that is not an object is refused', 'nope'],
  ['a world with no planetRadius is refused', {}],
  ['a string planetRadius is refused', { planetRadius: '6000' }],
  ['a negative planetRadius is refused', { planetRadius: -1 }],
  ['a flat world with no terrain is accepted', { planetRadius: 0 }],
  ['a flat world with clusters disabled is accepted', { planetRadius: 0, terrain: { enabled: true, clusters: { enabled: false } } }],
  ['a terrain with no clusters declaration is refused', { planetRadius: 0, terrain: { enabled: true } }],
  ['a clusters flag that is not an object is refused', { planetRadius: 0, terrain: { clusters: 'on' } }],
  ['a null clusters flag is refused as not declared', { planetRadius: 0, terrain: { enabled: true, clusters: null } }],
  ['a terrain radius that is not a number is refused', { planetRadius: 0, terrain: { clusters: { enabled: false }, radius: '6000' } }],
  ['a clusters flag whose enabled is not a boolean is refused', { planetRadius: 0, terrain: { clusters: { enabled: 'yes' } } }],
  ['clusters enabled without a terrain radius is refused', { planetRadius: 0, terrain: { clusters: { enabled: true } } }],
  ['clusters enabled with a zero terrain radius is refused', { planetRadius: 0, terrain: { clusters: { enabled: true }, radius: 0 } }],
  ['clusters enabled on a flat world is refused', { planetRadius: 0, terrain: { clusters: { enabled: true }, radius: 6000 } }],
  ['a sphere with clusters disabled is refused', { planetRadius: 6000, terrain: { clusters: { enabled: false }, radius: 6000 } }],
  ['a sphere with a mismatched terrain radius is refused', { planetRadius: 6000, terrain: { clusters: { enabled: true }, radius: 5000 } }],
  ['a sphere with no terrain config is refused', { planetRadius: 6000 }],
  ['a sphere whose clusters and radius agree is accepted', { planetRadius: 6000, terrain: { clusters: { enabled: true }, radius: 6000 } }],
  ['a sphere whose terrain comes from a terrain entity is accepted', { planetRadius: 6000, entities: [{ id: 'terrain', app: 'terrain', config: { clusters: { enabled: true }, radius: 6000 } }] }],
  ['a terrain entity with no clusters declaration is refused', { planetRadius: 0, entities: [{ id: 'terrain', app: 'terrain', config: { enabled: true } }] }],
]

const synthetic = SYNTHETIC.map(([label, def]) => ({
  label,
  def,
  expect: verdictOf(() => spoint.parseWorldDef('w', def)),
}))

const SHIPPED = ['construct', 'deathrun', 'tps-game', 'tutorial-rpg', 'tutorial']
const shipped = []
for (const world of SHIPPED) {
  const path = join(spointRoot, 'apps', 'world', world + '.js')
  const routed = readFileSync(path, 'utf8').includes('parseWorldDef(')
  const mod = await import(pathToFileURL(path).href)
  const def = mod.default
  shipped.push({
    world,
    routed,
    projection: projectionOf(def),
    expect: verdictOf(() => spoint.parseWorldDef(world, def)),
  })
}

writeFileSync(join(here, 'fixtures', 'spoint', 'world-def-clusters.json'), JSON.stringify({ source: 'spoint apps/world/_shared/worldDefParse.js parseWorldDef and the five shipped apps/world files', synthetic, shipped }, null, 2) + '\n')
for (const item of synthetic) console.log(JSON.stringify(item.expect), item.label)
for (const item of shipped) console.log(JSON.stringify(item.expect), 'shipped', item.world, item.routed ? 'routed' : 'not routed')
