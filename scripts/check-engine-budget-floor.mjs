import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'

const root = resolve(import.meta.dirname, '..')
const MIB = 1024 * 1024
const KRANGE = -2
const factory = (await import(pathToFileURL(resolve(root, 'engine/out/engine-core-64mib.mjs')).href)).default

const initAt = async (budgetBytes) => {
  const module = await factory()
  return module._engine_init(1024, 1, budgetBytes)
}

const floorMiB = async (low, high) => {
  let lo = low
  let hi = high
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if ((await initAt(mid * MIB)) === 0) hi = mid
    else lo = mid
  }
  return hi
}

gate('a 16 MiB arena is refused by engine_init with the range status and nothing is bound', async () => {
  assert.equal(await initAt(16 * MIB), KRANGE)
})

gate('a 48 MiB arena boots the 1024-player plan', async () => {
  assert.equal(await initAt(48 * MIB), 0)
})

gate('the smallest arena that boots the 1024-player plan is between 16 and 48 MiB', async () => {
  const floor = await floorMiB(16, 48)
  assert.ok(floor > 16 && floor <= 48, 'floor ' + floor + ' MiB')
  console.log('INFO minimum arena for the 1024-player plan in this build: ' + floor + ' MiB')
})

finish()
