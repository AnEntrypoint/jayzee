import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { ArenaSealedError, createEngineWorld, loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { PLANET } from '../src/engine/sceneSetup.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const ENGINE_OK = 0
const ENGINE_SEALED = -9
const CHARACTER = Object.freeze({ radius: 0.4, halfHeight: 0.6 })
const PLAY_TICKS = 120
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const refusal = (call) => {
  try {
    call()
  } catch (error) {
    return { sealed: error instanceof ArenaSealedError, code: error.code, status: error.status, name: error.name }
  }
  return { sealed: false, code: 'accepted', status: ENGINE_OK, name: 'none' }
}

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  const surface = PLANET.radius
  const rest = surface + CHARACTER.radius + CHARACTER.halfHeight
  world.configurePlanet(PLANET)
  world.follow([0, surface, 0])
  world.addBox([4, surface, -1, 6, surface + 1, 1])
  world.addTrunk([-5, surface + 1, 0], 0.3, 1)
  world.configureVegetation({ origin: -64, cellSize: 4 })
  world.attachVegetation()
  const character = world.addCharacter({ position: [0, rest + 0.05, 0], ...CHARACTER })
  const body = world.spawn([2, surface + 3, 2])
  for (let t = 0; t < 30; t++) world.step()
  const before = { sealed: world.sealed, bodies: world.physicsBodies(), arena: world.arenaUsed() }
  world.markWarmup()
  world.seal()
  const refusals = {
    box: refusal(() => world.addBox([8, surface, -1, 9, surface + 1, 1])),
    trunk: refusal(() => world.addTrunk([-8, surface + 1, 0], 0.3, 1)),
    character: refusal(() => world.addCharacter({ position: [3, rest, 3], ...CHARACTER })),
    planet: refusal(() => world.configurePlanet(PLANET)),
    vegetation: refusal(() => world.attachVegetation()),
  }
  const down = world.raycast([4.5, surface + 10, 0], [0, -1, 0], 20)
  const boxHit = down === null ? null : { kind: down.kind, distance: down.distance }
  for (let t = 0; t < PLAY_TICKS; t++) {
    world.setCharacterVelocity(character, [1, 0, 0])
    world.step()
  }
  const second = world.spawn([-2, surface + 3, -2])
  world.despawn(second)
  const walked = world.characterBodyPosition(character)
  return {
    before, refusals, boxHit, walked,
    after: { sealed: world.sealed, bodies: world.physicsBodies(), arena: world.arenaUsed(), allocations: world.allocationsSinceWarmup(), failures: world.allocationFailures(), supported: world.characterSupported(character), bodyAltitude: Math.hypot(...world.position(body)) - surface },
  }
}

const rawStatuses = async (tier) => {
  const module = await loadEngineModule(glueUrl(tier.glue), resolvePlan({ players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }))
  const configure = () => module._engine_world_configure(bodyPoolCapacity(tier.players), 60, -9.8, 0, 0.5, 0, 8)
  const open = configure()
  module._engine_mark_warmup()
  module._engine_arena_seal()
  return {
    open,
    sealed: module._engine_arena_sealed(),
    configure: configure(),
    box: module._engine_world_add_box(0, 0, 0, 1, 1, 1),
    trunk: module._engine_world_add_trunk(0, 1, 0, 0.3, 1),
    character: module._engine_character_add(0, 2, 0, 0.4, 0.6),
    planet: module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight),
    vegetation: module._engine_veg_attach(),
    allocations: Number(module._engine_allocations_since_warmup()),
    failures: Number(module._engine_allocation_failures()),
  }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { world: await scenario(tier), raw: await rawStatuses(tier) })
}

for (const tier of TIERS) {
  const { world, raw } = runs.get(tier.label)
  gate(tier.label + ': before the seal a box, a trunk, the vegetation body, a character and the planet are all accepted', () => {
    assert.equal(world.before.sealed, false)
    assert.ok(world.before.bodies >= 4, 'physics bodies before the seal: ' + world.before.bodies)
    assert.equal(raw.open, ENGINE_OK)
  })
  gate(tier.label + ': after the seal addBox, addTrunk, addCharacter, configurePlanet and attachVegetation each throw ArenaSealedError with status ' + ENGINE_SEALED, () => {
    assert.equal(world.after.sealed, true)
    for (const [name, outcome] of Object.entries(world.refusals)) {
      assert.deepEqual(outcome, { sealed: true, code: 'arena-sealed', status: ENGINE_SEALED, name: 'ArenaSealedError' }, name + ' was not refused: ' + JSON.stringify(outcome))
    }
  })
  gate(tier.label + ': after the seal the raw exports return ' + ENGINE_SEALED + ' for world configure, box, trunk, character, planet and vegetation', () => {
    assert.equal(raw.sealed, 1)
    for (const name of ['configure', 'box', 'trunk', 'character', 'planet', 'vegetation']) assert.equal(raw[name], ENGINE_SEALED, name + ' returned ' + raw[name])
    assert.equal(raw.allocations, 0)
    assert.equal(raw.failures, 0)
  })
  gate(tier.label + ': the refused calls change nothing: the body count and the arena size are the same, nothing is carved after warm-up and no allocation fails', () => {
    assert.equal(world.after.bodies, world.before.bodies)
    assert.equal(world.after.arena, world.before.arena)
    assert.equal(world.after.allocations, 0)
    assert.equal(world.after.failures, 0)
  })
  gate(tier.label + ': play goes on after the seal: ' + PLAY_TICKS + ' ticks step, the character walks, a body spawns and despawns from the pool, and a ray cast still hits the box added before the seal', () => {
    assert.deepEqual(world.boxHit === null ? null : world.boxHit.kind, 'static')
    assert.ok(Math.abs(world.boxHit.distance - 9) <= 1e-3, 'box hit at ' + world.boxHit.distance)
    assert.equal(world.after.supported, true)
    assert.ok(world.walked[0] > 1.5, 'character walked to x ' + world.walked[0])
    assert.ok(Math.abs(world.after.bodyAltitude - 0.5) <= 0.05, 'the spawned body rests at altitude ' + world.after.bodyAltitude)
  })
}

finish()
