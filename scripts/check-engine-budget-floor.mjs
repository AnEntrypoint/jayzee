import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { readLayout } from '../src/engine/bridge.js'

const root = resolve(import.meta.dirname, '..')
const MIB = 1024 * 1024
const KRANGE = -2
const PLAYERS_1024 = 1024
const factory = (await import(pathToFileURL(resolve(root, 'engine/out/engine-core-128mib.mjs')).href)).default

const bootAt = async (budgetBytes) => {
  const module = await factory()
  const status = module._engine_init(PLAYERS_1024, 1, budgetBytes)
  return { status, players: status === 0 ? readLayout(module).players : null }
}

const floorMiB = async (low, high) => {
  let lo = low
  let hi = high
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    const { status, players } = await bootAt(mid * MIB)
    if (status === 0 && players === PLAYERS_1024) hi = mid
    else lo = mid
  }
  return hi
}

gate('a 16 MiB arena is refused by engine_init with the range status', async () => {
  assert.equal((await bootAt(16 * MIB)).status, KRANGE)
})

gate('the 128 MiB build boots the 1024-player plan, and not a stepped-down tier', async () => {
  const { status, players } = await bootAt(128 * MIB)
  assert.equal(status, 0)
  assert.equal(players, PLAYERS_1024)
})

gate('the smallest arena that boots the 1024-player plan is between 16 and 128 MiB', async () => {
  const floor = await floorMiB(16, 128)
  assert.ok(floor > 16 && floor <= 128, 'floor ' + floor + ' MiB')
  console.log('INFO minimum arena for the 1024-player plan in the 128 MiB build: ' + floor + ' MiB')
})

finish()
