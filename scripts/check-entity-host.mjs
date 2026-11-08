import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { createEntityHost } from '../src/apps/entityHost.js'
import { traceEntityOps } from './lib/entityHostScenarios.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/entity-host.json', import.meta.url), 'utf8'))
const world = new World({ capacity: 4 })
const host = createEntityHost(world)
const proxy = host.spawn({ position: fixture.spawn.position, custom: fixture.spawn.custom })
const other = host.spawn({ position: [9, 9, 9] })
const destroyAt = fixture.ops.findIndex((op) => op.op === 'destroy')
const actual = traceEntityOps(proxy, fixture.ops)

gate('identity: an entity id is the World body index, in spawn order', () => {
  if (proxy.id !== 0 || other.id !== 1 || world.count !== 2) throw new Error('ids ' + proxy.id + ',' + other.id + ' count ' + world.count)
})

gate('identity: entityById returns the same handle for a live body', () => {
  if (host.entityById(1) !== other) throw new Error('handle differs')
})

gate('identity: entityById refuses an id that was never spawned', () => {
  let code = null
  try { host.entityById(7) } catch (error) { code = error.name }
  if (code !== 'RangeError') throw new Error('got ' + code)
})

for (let i = 0; i < destroyAt; i++) {
  gate('before destroy, op ' + fixture.trace[i].label + ' matches spoint', () => {
    const want = JSON.stringify(fixture.trace[i]), got = JSON.stringify(actual[i])
    if (want !== got) throw new Error('jayzee ' + got + ' spoint ' + want)
  })
}

gate('destroy is idempotent and matches spoint', () => {
  for (let i = destroyAt; i < destroyAt + 2; i++) {
    if (fixture.trace[i].ok !== true || actual[i].ok !== true) throw new Error('op ' + i + ' not ok')
  }
})

for (let i = destroyAt + 2; i < fixture.ops.length; i++) {
  gate('after destroy, op ' + fixture.trace[i].label + ' is refused (spoint returned a stale value)', () => {
    if (fixture.trace[i].ok !== true) throw new Error('spoint fixture did not return a value at op ' + i)
    if (actual[i].ok !== false || actual[i].code !== 'ENTITY_DESTROYED') throw new Error('jayzee ' + JSON.stringify(actual[i]))
  })
}

gate('destroy parks the body at the park offset with zero velocity', () => {
  const p = world.position(0), v = world.velocity(0)
  if (p[0] !== 0 || p[1] !== -5000 || p[2] !== 0 || v.some((x) => x !== 0)) throw new Error('p ' + p + ' v ' + v)
})

gate('destroy keeps the index: the World body count does not shrink', () => {
  if (world.count !== 2) throw new Error('count ' + world.count)
})

gate('entityById refuses a destroyed body with ENTITY_DESTROYED', () => {
  let code = null
  try { host.entityById(0) } catch (error) { code = error.code }
  if (code !== 'ENTITY_DESTROYED') throw new Error('got ' + code)
})

gate('spawn refuses a non-object custom before it touches the World', () => {
  const before = world.count
  let message = null
  try { host.spawn({ custom: [1] }) } catch (error) { message = error.message }
  if (message !== 'entity.custom must be null or a plain object' || world.count !== before) throw new Error(message + ' count ' + world.count)
})

gate('spawn refuses a bad position with the spoint message', () => {
  let message = null
  try { host.spawn({ position: [1, 2] }) } catch (error) { message = error.message }
  if (message !== 'entity.position must be a length-3 array of finite numbers') throw new Error(message)
})

finish();
