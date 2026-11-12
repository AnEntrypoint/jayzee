import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { DEVICE_BUDGET_RULES, chooseDeviceBudget, instanceBudgetFor, readDeviceSignals } from '../src/engine/deviceBudget.js'
import { GLUE_TIERS_MIB, GlueReservationError } from '../src/engine/glueTier.js'
import { loadRendererForDevice } from '../src/engine/renderer.js'
import { MATRIX_BYTES } from '../src/engine/vegetation.js'

const MIB = 1048576
const GIB = 1073741824
const browser = (deviceMemory, cores = 8) => readDeviceSignals({ navigatorLike: { deviceMemory, hardwareConcurrency: cores } })

gate('the signals are read from the device once: reported memory in bytes, the core count, and the host totals where a host gives them', () => {
  assert.deepEqual(browser(4, 8), { deviceMemoryBytes: 4 * GIB, cores: 8, totalBytes: 0, freeBytes: 0 })
  assert.deepEqual(readDeviceSignals({ navigatorLike: {}, osLike: { totalmem: () => 8 * GIB, freemem: () => 3 * GIB } }), { deviceMemoryBytes: 0, cores: 0, totalBytes: 8 * GIB, freeBytes: 3 * GIB })
  assert.deepEqual(readDeviceSignals({ navigatorLike: { deviceMemory: 'big', hardwareConcurrency: -2 } }), { deviceMemoryBytes: 0, cores: 0, totalBytes: 0, freeBytes: 0 })
})

gate('the budget is the largest memory tier that fits a quarter of the device memory less the management reserve', () => {
  const table = [[0.25, 64, true], [0.5, 64, false], [1, 128, false], [2, 256, false], [4, 512, false], [8, 512, false]]
  for (const [gib, tier, constrained] of table) {
    const b = chooseDeviceBudget(browser(gib))
    assert.equal(b.tierMiB, tier, gib + ' GiB')
    assert.equal(b.constrained, constrained, gib + ' GiB constrained')
    assert.equal(b.budgetBytes, tier * MIB)
    assert.equal(b.source, 'device-memory')
    assert.equal(b.availableBytes, gib * GIB * DEVICE_BUDGET_RULES.engineShare)
  }
})

gate('room to manage the system is kept outside the budget: at least 32 MiB, an eighth of the share on larger devices, and the tier never spends it', () => {
  for (const gib of [0.5, 1, 2, 4, 8, 16, 64]) {
    const b = chooseDeviceBudget(browser(gib))
    assert.ok(b.reserveBytes >= 32 * MIB)
    assert.ok(b.reserveBytes >= b.availableBytes * DEVICE_BUDGET_RULES.managementShare - 1)
    assert.ok(b.budgetBytes + b.reserveBytes <= b.availableBytes, gib + ' GiB spends the reserve')
  }
  assert.equal(chooseDeviceBudget(browser(4)).reserveBytes, 128 * MIB)
  assert.equal(chooseDeviceBudget(browser(0.5)).reserveBytes, 32 * MIB)
})

gate('the budget never falls as the device memory rises, and is always one of the built tiers', () => {
  let before = 0
  for (let gib = 0.25; gib <= 64; gib *= 2) {
    const b = chooseDeviceBudget(browser(gib))
    assert.ok(GLUE_TIERS_MIB.includes(b.tierMiB))
    assert.ok(b.budgetBytes >= before)
    before = b.budgetBytes
  }
})

gate('a host with little free memory gets the budget its free memory holds, not the one its total would', () => {
  const roomy = chooseDeviceBudget({ totalBytes: 16 * GIB, freeBytes: 12 * GIB })
  assert.equal(roomy.tierMiB, 512)
  assert.equal(roomy.source, 'total-memory')
  const tight = chooseDeviceBudget({ totalBytes: 16 * GIB, freeBytes: 200 * MIB })
  assert.equal(tight.availableBytes, 200 * MIB)
  assert.equal(tight.tierMiB, 128)
  assert.equal(tight.constrained, false)
})

gate('a device that reports no memory is sized by its core count, and one that reports nothing gets the small class', () => {
  assert.deepEqual([chooseDeviceBudget(browser(undefined, 4)).tierMiB, chooseDeviceBudget(browser(undefined, 4)).source], [256, 'core-count'])
  assert.deepEqual([chooseDeviceBudget(browser(undefined, 12)).tierMiB, chooseDeviceBudget(browser(undefined, 12)).source], [512, 'core-count'])
  assert.deepEqual([chooseDeviceBudget({}).tierMiB, chooseDeviceBudget({}).source], [256, 'no-signal'])
  assert.throws(() => chooseDeviceBudget(null), TypeError)
})

gate('the shown-instance budget is a fixed share of the memory budget, so a smaller device shows fewer instances and allocates nothing more', () => {
  const small = instanceBudgetFor(chooseDeviceBudget(browser(0.5)), MATRIX_BYTES)
  const large = instanceBudgetFor(chooseDeviceBudget(browser(8)), MATRIX_BYTES)
  assert.equal(small, (64 * MIB * DEVICE_BUDGET_RULES.displayShare * DEVICE_BUDGET_RULES.shownShare) / MATRIX_BYTES)
  assert.equal(small, 32768)
  assert.equal(large, small * 8)
  assert.throws(() => instanceBudgetFor(chooseDeviceBudget(browser(1)), 0), RangeError)
  assert.throws(() => instanceBudgetFor(null, 64), TypeError)
})

gate('the renderer loads at the tier the device budget chose and steps down when that reservation fails', async () => {
  const asked = []
  const failing = 'data:text/javascript,' + encodeURIComponent('export default () => { throw new Error("WebAssembly.Memory(): could not allocate memory") }')
  await assert.rejects(
    loadRendererForDevice({ canvas: { id: 'engine-canvas' }, navigatorLike: { deviceMemory: 1, hardwareConcurrency: 4 }, requested: 'webgl2', glueFor: (tierMiB) => { asked.push(tierMiB); return failing } }),
    (error) => error instanceof GlueReservationError && error.budgetBytes === 128 * MIB,
  )
  assert.deepEqual(asked, [128, 64])
})

finish()
