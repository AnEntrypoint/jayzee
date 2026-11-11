import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { bodyPoolCapacity } from '../../src/engine/poolPlan.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const MIB = 1024 * 1024

export const glueUrl = (path) => pathToFileURL(join(root, path)).href

export const SCENARIO_TIERS = Object.freeze([
  Object.freeze({ label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * MIB }),
  Object.freeze({ label: '128 MiB fixed', glue: 'engine/out/engine-core-128mib.mjs', players: 256, workers: 1, budgetBytes: 128 * MIB }),
  Object.freeze({ label: '512 MiB fixed', glue: 'engine/out/engine-core-512mib.mjs', players: 1024, workers: 1, budgetBytes: 512 * MIB }),
  Object.freeze({ label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * MIB }),
])

export const tierWorldOptions = (tier, scene) => ({
  capacity: bodyPoolCapacity(tier.players),
  tickRate: 60,
  gravity: -9.8,
  drag: 0,
  restitution: 0,
  ...scene,
  players: tier.players,
  workers: tier.workers,
  budgetBytes: tier.budgetBytes,
})
