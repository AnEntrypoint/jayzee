import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { finish, gate } from './lib/gate.mjs'
import { GLUE_TIERS_MIB, GlueReservationError, glueChain, glueTierFor, instantiateWithinBudget, isReservationFailure } from '../src/engine/glueTier.js'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'

const MIB = 1048576
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (tierMiB) => pathToFileURL(resolve(root, 'engine/out/engine-core-' + tierMiB + 'mib.mjs')).href

gate('every memory tier in the table is a fixed glue that engine/CMakeLists.txt can build and that exists in engine/out', () => {
  assert.deepEqual([...GLUE_TIERS_MIB], [64, 128, 256, 512])
  for (const tierMiB of GLUE_TIERS_MIB) assert.ok(readFileSync(resolve(root, 'engine/out/engine-core-' + tierMiB + 'mib.mjs')).byteLength > 0)
})

gate('a budget selects the smallest tier that holds it', () => {
  assert.equal(glueTierFor(1), 64)
  assert.equal(glueTierFor(64 * MIB), 64)
  assert.equal(glueTierFor(64 * MIB + 1), 128)
  assert.equal(glueTierFor(200 * MIB), 256)
  assert.equal(glueTierFor(512 * MIB), 512)
})

gate('a budget above the largest tier, zero, a negative, NaN and a string are refused', () => {
  for (const bad of [512 * MIB + 1, 0, -1, NaN, Infinity, '64']) assert.throws(() => glueTierFor(bad), RangeError, String(bad))
})

gate('the chain steps down from the selected tier and caps the budget at each tier', () => {
  assert.deepEqual(glueChain(512 * MIB), [{ tierMiB: 512, budgetBytes: 512 * MIB }, { tierMiB: 256, budgetBytes: 256 * MIB }, { tierMiB: 128, budgetBytes: 128 * MIB }, { tierMiB: 64, budgetBytes: 64 * MIB }])
  assert.deepEqual(glueChain(100 * MIB), [{ tierMiB: 128, budgetBytes: 100 * MIB }, { tierMiB: 64, budgetBytes: 64 * MIB }])
  assert.deepEqual(glueChain(64 * MIB), [{ tierMiB: 64, budgetBytes: 64 * MIB }])
})

gate('a device that cannot reserve 512 or 256 MiB lands on 128 MiB with the budget lowered to it', async () => {
  const calls = []
  const outcome = await instantiateWithinBudget({
    budgetBytes: 512 * MIB,
    instantiate: async (step) => {
      calls.push(step.tierMiB)
      if (step.tierMiB > 128) throw new RangeError('WebAssembly.Memory(): could not allocate memory')
      return 'module-' + step.tierMiB
    },
  })
  assert.deepEqual(calls, [512, 256, 128])
  assert.deepEqual(outcome, { tierMiB: 128, budgetBytes: 128 * MIB, loweredFrom: 512, value: 'module-128' })
})

gate('a device that reserves the first tier is not lowered', async () => {
  const outcome = await instantiateWithinBudget({ budgetBytes: 64 * MIB, instantiate: async (step) => step.tierMiB })
  assert.deepEqual(outcome, { tierMiB: 64, budgetBytes: 64 * MIB, loweredFrom: null, value: 64 })
})

gate('a failure that is not a reservation failure is thrown at once and no smaller tier is tried', async () => {
  const calls = []
  await assert.rejects(instantiateWithinBudget({
    budgetBytes: 512 * MIB,
    instantiate: async (step) => {
      calls.push(step.tierMiB)
      throw new TypeError('engine_init refused the memory plan')
    },
  }), TypeError)
  assert.deepEqual(calls, [512])
  assert.equal(isReservationFailure(new TypeError('engine_init refused the memory plan')), false)
  assert.equal(isReservationFailure(new Error('Out of memory')), true)
  assert.equal(isReservationFailure(new RangeError('players must be an integer in 1..1024')), false)
})

gate('when no tier can be reserved the error is typed and names every tier tried', async () => {
  await assert.rejects(instantiateWithinBudget({ budgetBytes: 256 * MIB, instantiate: async () => { throw new RangeError('could not allocate memory') } }), (error) => {
    assert.ok(error instanceof GlueReservationError)
    assert.equal(error.code, 'glue-reservation-failed')
    assert.deepEqual(error.tried, [256, 128, 64])
    return true
  })
})

gate('the real 64 MiB and 128 MiB glues load through the chain at the budget the chain gives them', async () => {
  for (const budgetBytes of [64 * MIB, 128 * MIB]) {
    const outcome = await instantiateWithinBudget({ budgetBytes, instantiate: (step) => loadEngineModule(glueUrl(step.tierMiB), resolvePlan({ players: 64, budgetBytes: step.budgetBytes })) })
    assert.equal(outcome.tierMiB, budgetBytes / MIB)
    assert.equal(outcome.loweredFrom, null)
    assert.equal(Number(outcome.value._engine_memory_bytes()), budgetBytes)
  }
})

finish()
