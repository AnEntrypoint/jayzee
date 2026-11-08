import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { OVERLAP_CASE_LABELS, runOverlapScenario } from './lib/overlapScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'src/physics/World.js'
const sourcePath = join(spointRoot, relative)
const joltVersion = JSON.parse(readFileSync(join(spointRoot, 'node_modules', 'jolt-physics', 'package.json'), 'utf8')).version
const { PhysicsWorld } = await import(pathToFileURL(sourcePath).href)

const quiet = console.log
console.log = () => {}
let rows
try {
  const world = new PhysicsWorld({ gravity: [0, -9.81, 0] })
  await world.init()
  const J = world.Jolt
  const np = world.physicsSystem.GetNarrowPhaseQuery()
  const bp = new J.DefaultBroadPhaseLayerFilter(world.jolt.GetObjectVsBroadPhaseLayerFilter(), 1)
  const ol = new J.DefaultObjectLayerFilter(world.jolt.GetObjectLayerPairFilter(), 1)
  const settings = new J.CollideShapeSettings()
  const scale = new J.Vec3(1, 1, 1)
  const base = new J.RVec3(0, 0, 0)
  const bodyFilter = (exclude) => {
    if (exclude == null) return new J.BodyFilter()
    const ids = Array.isArray(exclude) ? exclude : [exclude]
    const known = ids.filter((id) => world.bodies.has(id)).map((id) => world.bodies.get(id).GetID())
    if (known.length === 0) return new J.BodyFilter()
    if (known.length === 1) return new J.IgnoreSingleBodyFilter(known[0])
    const filter = new J.IgnoreMultipleBodiesFilter()
    for (const bid of known) filter.IgnoreBody(bid)
    return filter
  }
  const collide = (shape, centre, exclude) => {
    const hits = []
    const collector = new J.CollideShapeCollectorJS()
    collector.OnBody = () => {}
    collector.AddHit = (ptr) => { hits.push(J.wrapPointer(ptr, J.CollideShapeResult).get_mBodyID2().GetIndexAndSequenceNumber()) }
    const xf = J.RMat44.prototype.sTranslation(new J.Vec3(centre[0], centre[1], centre[2]))
    np.CollideShape(shape, scale, xf, settings, base, collector, bp, ol, bodyFilter(exclude), new J.ShapeFilter())
    return hits.sort((a, b) => a - b)
  }
  const adapter = {
    addBox: (half, position) => world.addStaticBox(half, position),
    addSphere: (radius, position) => world.addBody('sphere', radius, position, 'static'),
    sphere: (centre, radius, exclude) => collide(new J.SphereShape(radius), centre, exclude),
    box: (min, max, exclude) => {
      const half = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
      const centre = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2]
      const cr = Math.min(0.05, Math.min(...half) * 0.1)
      return collide(new J.BoxShape(new J.Vec3(half[0], half[1], half[2]), cr, null), centre, exclude)
    },
    destroy: () => world.destroy(),
  }
  ;({ rows } = runOverlapScenario(adapter))
} finally {
  console.log = quiet
}

const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
    joltPhysics: joltVersion,
    api: 'NarrowPhaseQuery.CollideShape on the spoint PhysicsWorld Jolt system, as spoint has no overlap query',
  },
  labels: OVERLAP_CASE_LABELS,
  rows,
}
const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'overlap.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' with ' + rows.length + ' rows')
