import { register } from 'node:module'
import { writeFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { ENTITY_SPAWN, ENTITY_OPS, traceEntityOps } from './lib/entityHostScenarios.mjs'

register('./lib/threeStubHooks.mjs', import.meta.url)
const spoint = process.argv[2] ?? '/workspace/spoint'
const { AppContext } = await import(pathToFileURL(spoint + '/src/apps/AppContext.js').href)
const entity = {
  id: 'entity_7', model: null, bodyType: 'dynamic',
  position: [...ENTITY_SPAWN.position], rotation: [0, 0, 0, 1], scale: [1, 1, 1],
  velocity: [0, 0, 0], mass: 1, collider: null, custom: { ...ENTITY_SPAWN.custom },
  parent: null, children: new Set(),
}
const runtime = {
  entities: new Map([[entity.id, entity]]),
  destroyCalls: 0,
  destroyEntity(id) {
    this.destroyCalls += 1
    if (!this.entities.has(id)) return
    this.entities.delete(id)
  },
  getWorldTransform() { return null },
}
const ctx = new AppContext(entity, runtime)
const fixture = {
  source: 'spoint src/apps/AppContext.js entity proxy (_buildEntityProxy) over a fake runtime whose destroyEntity removes the entity',
  spawn: ENTITY_SPAWN,
  ops: ENTITY_OPS,
  trace: traceEntityOps(ctx.entity, ENTITY_OPS),
  runtimeDestroyCalls: runtime.destroyCalls,
}
writeFileSync(new URL('./fixtures/spoint/entity-host.json', import.meta.url), JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote entity-host.json with ' + fixture.trace.length + ' ops')
