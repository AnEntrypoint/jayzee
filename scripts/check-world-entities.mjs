import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { MODEL_EMPTY, MODEL_READ_FAILED, bootServer, modelBoxes } from '../src/sdk/staticModelColliders.js'
import { createServer } from '../src/sdk/server.js'
import { buildBoxGlb } from './lib/glbFixture.mjs'
import { clientRig, makeClock, randomFillFrom } from './lib/serverRig.mjs'

const MAP = buildBoxGlb([
  { translation: [0, 1, 0], scale: [20, 1, 20] },
  { translation: [6, 3, 0], scale: [1, 1, 1] },
  { translation: [0, 6, 0], scale: [2, 2, 2], material: 'clip' },
])
const files = { 'apps/tps-game/map.glb': MAP }
const readModel = async (path) => {
  if (!(path in files)) throw new Error('no such file ' + path)
  return files[path]
}

const config = {
  spawnPoint: [0, 5, 0],
  playerModel: 'apps/tps-game/player.vrm',
  entities: [
    { id: 'environment', model: 'apps/tps-game/map.glb', position: [0, 0, 0] },
    { id: 'game', app: 'tps-game', position: [0, 0, 0], config: { rounds: 3 } },
    { id: 'crate', bodyType: 'dynamic', position: [0, 6, 0] },
  ],
}

const boot = async (overrides = {}) => {
  const { clock, now } = makeClock()
  const setups = []
  const apps = { 'tps-game': { server: { setup: (ctx) => setups.push([ctx.entity.name, ctx.config.rounds]) } } }
  const server = await bootServer({ now, randomFill: randomFillFrom(), readModel, apps, config, ...overrides })
  return { server, setups, clock, now, rig: clientRig(server, clock, now) }
}

gate('a GLB map model is read through the injected reader into one world-space box per placed mesh, and skip materials are left out', () => {
  assert.deepEqual(modelBoxes(MAP), [[-20, 0, -20, 20, 2, 20], [5, 2, -1, 7, 4, 1]])
  assert.deepEqual(modelBoxes(MAP, { position: [100, 0, 0] })[1], [105, 2, -1, 107, 4, 1])
  assert.equal(modelBoxes(MAP, { skipMaterials: new Set() }).length, 3)
  assert.throws(() => modelBoxes(new Uint8Array(40)), { reasonCode: 'glb-magic-invalid' })
})

gate('the entities list of the world config spawns the static map model and the app entity, by id, in list order, and the app gets its config', async () => {
  const { server, setups } = await boot()
  assert.deepEqual(server.loadedEntities.map((id) => server.getEntity(id).name), ['environment', 'game', 'crate'])
  assert.equal(server.getEntity('environment').model, 'apps/tps-game/map.glb')
  assert.equal(server.getEntity('environment').body, null)
  assert.deepEqual(setups, [['game', 3]])
  assert.deepEqual(server.staticModels.map((entry) => [entry.id, entry.firstBox, entry.boxCount]), [['environment', 0, 2]])
})

gate('a dynamic body dropped on the map model comes to rest on the top of its floor mesh, not on the world ground under it', async () => {
  const { server } = await boot()
  for (let i = 0; i < 400; i++) server.tick()
  const y = server.getEntity('crate').position[1]
  assert.ok(Math.abs(y - 2.35) < 0.05, 'the crate rests at y ' + y)
})

gate('the control: the same world booted without the model lets the body fall through to the ground plane', () => {
  const { now } = makeClock()
  const server = createServer({ now, config: { entities: [config.entities[2]] } })
  for (let i = 0; i < 400; i++) server.tick()
  const y = server.getEntity('crate').position[1]
  assert.ok(Math.abs(y - 0.35) < 0.05, 'the crate rests at y ' + y)
})

gate('a ray from an app hits the map model and the hit box is traced back to the entity that owns the model', async () => {
  const { server } = await boot()
  const hit = server.appRuntime.contextOf('game').raycast([0, 3, 0], [1, 0, 0], 50)
  assert.deepEqual([hit.hit, hit.kind, hit.distance], [true, 'box', 5])
  assert.equal(server.entityOfBox(hit.id), 'environment')
  assert.equal(server.entityOfBox(99), null)
})

gate('a joining player is placed at the spawnPoint of the world config, and the playerModel is carried on the server', async () => {
  const { server, rig } = await boot()
  const client = rig.join()
  const player = server.tickHost.playerManager.getPlayer(client.playerId)
  assert.deepEqual([player.state.position[0], player.state.position[2]], [0, 0])
  assert.ok(player.state.position[1] <= 5 && player.state.position[1] > 4.5, 'the player joined at y ' + player.state.position[1])
  assert.equal(server.playerModel, 'apps/tps-game/player.vrm')
  assert.deepEqual(server.spawnPoint, [0, 5, 0])
})

gate('a model the reader cannot produce, and a model with no collision mesh, each stop the boot by name', async () => {
  await assert.rejects(boot({ config: { entities: [{ id: 'env', model: 'missing.glb' }] } }), { code: MODEL_READ_FAILED })
  files['empty.glb'] = buildBoxGlb([{ translation: [0, 0, 0], scale: [1, 1, 1], material: 'nodraw' }])
  await assert.rejects(boot({ config: { entities: [{ id: 'env', model: 'empty.glb' }] } }), { code: MODEL_EMPTY })
  await assert.rejects(bootServer({ config }), TypeError)
})

finish()
