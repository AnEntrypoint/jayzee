import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createJoltHost } from '../src/collision/joltHost.js'
import { JoltLimitsError, joltReservationBytes } from '../src/motion-pure/joltLimits.js'

const fx = JSON.parse(readFileSync(new URL('./fixtures/spoint/collision-host.json', import.meta.url), 'utf8'))
const pickRay = (r) => ({ hit: r.hit, distance: r.distance, bodyId: r.bodyId, normal: r.normal, position: r.position })
const same = (got, want, what) => {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a !== b) throw new Error(what + ' differs from spoint: got ' + a.slice(0, 200) + ' want ' + b.slice(0, 200))
}
const LIMITS = { maxBodies: 2, maxBodyPairs: 16, maxContactConstraints: 16 }

const host = await createJoltHost({ gravity: fx.gravity })
const ids = fx.scene.map((body) => host.addStaticTriangles(body.vertices, body.indices, body.position))
const index = host.enableStaticTiles()
const bounds = ids.map((id) => host.boundsOf(id))
const rays = fx.rays.map((r) => pickRay(host.castRay(r.origin, r.direction, r.maxDistance)))
const tiles = fx.tiles.map((q) => {
  const t = index.get(q.tx, q.tz, 0)
  return { tx: t.tx, tz: t.tz, hash: t.hash, floats: t.verts.length, bodies: [...t.bodies].sort((a, b) => a - b) }
})
const bodyCount = host.bodyCount()

const limited = await createJoltHost({ joltLimits: LIMITS })
limited.addStaticTriangles(fx.scene[0].vertices, fx.scene[0].indices)
limited.addStaticTriangles(fx.scene[0].vertices, fx.scene[0].indices)
let refusal = null
try { limited.addStaticTriangles(fx.scene[0].vertices, fx.scene[0].indices) } catch (error) { refusal = error }

let badLimit = null
try { await createJoltHost({ joltLimits: { ...LIMITS, maxBodies: 0 } }) } catch (error) { badLimit = error }

gate('the host gives the fixture body ids, in spoint order', () => same(ids, fx.ids, 'body ids'))
gate('the host holds the fixture body count', () => {
  if (bodyCount !== fx.bodyCount) throw new Error('body count ' + bodyCount + ', spoint ' + fx.bodyCount)
})
gate('body world bounds match spoint for every body', () => same(bounds, fx.bounds, 'body bounds'))
gate('raycast answers (hit, distance, body, normal, position) match spoint', () => same(rays, fx.rays.map((r) => r.expect), 'raycasts'))
gate('the fixture scene has both hitting and missing rays', () => {
  const hits = fx.rays.filter((r) => r.expect.hit).length
  if (hits < 4 || hits === fx.rays.length) throw new Error(hits + ' hits of ' + fx.rays.length)
})
gate('tile answers (tile, hash, float count, body set) match spoint', () => same(tiles, fx.tiles.map((q) => q.expect), 'tile answers'))
gate('a body past joltLimits.maxBodies is refused with code jolt-body-limit', () => {
  if (!(refusal instanceof JoltLimitsError) || refusal.code !== 'jolt-body-limit') throw new Error('got ' + String(refusal))
})
gate('a non-positive joltLimits entry is refused with jolt-limits-invalid', () => {
  if (!badLimit || badLimit.code !== 'jolt-limits-invalid') throw new Error('got ' + String(badLimit))
})
gate('reservationBytes is joltReservationBytes of the limits', () => {
  const want = joltReservationBytes(LIMITS)
  if (limited.reservationBytes !== want) throw new Error(limited.reservationBytes + ' vs ' + want)
})
gate('destroy releases the hosts without error', () => {
  host.destroy()
  limited.destroy()
})
finish()
