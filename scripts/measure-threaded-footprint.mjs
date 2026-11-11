import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readLayout } from '../src/engine/bridge.js'
import { resolvePlan } from '../src/engine/EngineWorld.js'
import { PLANET, TIER_1024, GROUND } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glue = pathToFileURL(join(root, process.argv[2] ?? 'engine/out/engine-core-512mib-threads.mjs')).href
const workers = Number(process.argv[3] ?? 8)
const budgetBytes = Number(process.argv[4] ?? 150 * 1024 * 1024)
const plan = resolvePlan({ players: 1024, workers, budgetBytes })

const factory = (await import(glue)).default
const module = await factory()
const sites = []
const mark = (site) => sites.push({ site, inUseBytes: module._engine_heap_inuse_bytes(), arenaBytes: module._engine_heap_arena_bytes() })
mark('factory: pool threads and runtime base')
const status = module._engine_init(plan.players, plan.workers, plan.budgetBytes)
if (status !== 0) throw new Error('engine_init status ' + status)
mark('engine_init: planned arena and primed pools')
const layout = readLayout(module)
const iterations = solverIterationsFor(layout.players)
const configured = module._engine_world_configure(TIER_1024.capacity, TIER_1024.tickRate, TIER_1024.gravity, TIER_1024.drag, TIER_1024.radius, TIER_1024.restitution, iterations)
if (configured !== 0) throw new Error('engine_world_configure status ' + configured)
mark('world configure: job system and worker threads')
module._engine_world_add_box(...GROUND)
for (let i = 0; i < TIER_1024.bodies; i++) module._engine_spawn((i % 100) * 0.6 - 30, 1 + (i % 5), Math.floor(i / 100) * 0.6 - 30, 0, 0, 0)
mark('spawns: body storage')
const planetStatus = module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight)
if (planetStatus !== 0) throw new Error('engine_planet_configure status ' + planetStatus)
mark('planet configure: page and height state')

const stages = sites.map((entry, i) => ({ site: entry.site, inUseBytes: entry.inUseBytes, growthBytes: i === 0 ? entry.inUseBytes : entry.inUseBytes - sites[i - 1].inUseBytes, arenaBytes: entry.arenaBytes }))
const highWaterBytes = Math.max(...sites.map((entry) => entry.inUseBytes))
process.stdout.write(JSON.stringify({ workers, budgetBytes, players: layout.players, bodies: layout.bodies, iterations, highWaterBytes, stages }) + '\n')
