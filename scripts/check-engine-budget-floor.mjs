import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { readLayout } from '../src/engine/bridge.js'

const root = resolve(import.meta.dirname, '..')
const MIB = 1024 * 1024
const KRANGE = -2
const PLAYERS_1024 = 1024
const factory = (await import(pathToFileURL(resolve(root, 'engine/out/engine-core-512mib.mjs')).href)).default

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

gate('the 512 MiB build boots the 1024-player plan, and a 128 MiB budget steps it down to 256', async () => {
  const full = await bootAt(512 * MIB)
  assert.equal(full.status, 0)
  assert.equal(full.players, PLAYERS_1024)
  const stepped = await bootAt(128 * MIB)
  assert.equal(stepped.status, 0)
  assert.equal(stepped.players, 256)
})

gate('the smallest arena that boots the 1024-player plan is between 128 and 512 MiB', async () => {
  const floor = await floorMiB(128, 512)
  assert.ok(floor > 128 && floor <= 512, 'floor ' + floor + ' MiB')
  console.log('INFO minimum arena for the 1024-player plan in the 512 MiB build: ' + floor + ' MiB')
})

finish()
