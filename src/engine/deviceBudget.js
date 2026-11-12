import { GLUE_TIERS_MIB } from './glueTier.js'

const MIB = 1048576
const GIB = 1073741824

export const DEVICE_BUDGET_RULES = Object.freeze({
  engineShare: 0.25,
  managementShare: 0.125,
  managementFloorBytes: 32 * MIB,
  displayShare: 0.0625,
  shownShare: 0.5,
  unknownSmallBytes: 2 * GIB,
  unknownLargeBytes: 4 * GIB,
  unknownSmallCores: 4,
})

const positive = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

export const readDeviceSignals = ({ navigatorLike = globalThis.navigator, osLike = null } = {}) => ({
  deviceMemoryBytes: navigatorLike ? positive(navigatorLike.deviceMemory) * GIB : 0,
  cores: navigatorLike ? positive(navigatorLike.hardwareConcurrency) : 0,
  totalBytes: osLike ? positive(osLike.totalmem()) : 0,
  freeBytes: osLike ? positive(osLike.freemem()) : 0,
})

const ramOf = (signals, rules) => {
  if (positive(signals.totalBytes) > 0) return { bytes: signals.totalBytes, source: 'total-memory' }
  if (positive(signals.deviceMemoryBytes) > 0) return { bytes: signals.deviceMemoryBytes, source: 'device-memory' }
  const cores = positive(signals.cores)
  if (cores > 0 && cores <= rules.unknownSmallCores) return { bytes: rules.unknownSmallBytes, source: 'core-count' }
  if (cores > 0) return { bytes: rules.unknownLargeBytes, source: 'core-count' }
  return { bytes: rules.unknownSmallBytes, source: 'no-signal' }
}

export const chooseDeviceBudget = (signals, rules = DEVICE_BUDGET_RULES) => {
  if (signals === null || typeof signals !== 'object') throw new TypeError('chooseDeviceBudget needs the device signals, read once at start')
  const ram = ramOf(signals, rules)
  const share = Math.floor(ram.bytes * rules.engineShare)
  const free = positive(signals.freeBytes)
  const availableBytes = free > 0 && free < share ? Math.floor(free) : share
  const reserveBytes = Math.max(rules.managementFloorBytes, Math.floor(availableBytes * rules.managementShare))
  const usableBytes = Math.max(0, availableBytes - reserveBytes)
  let tierMiB = GLUE_TIERS_MIB[0]
  for (const mib of GLUE_TIERS_MIB) if (mib * MIB <= usableBytes) tierMiB = mib
  const budgetBytes = tierMiB * MIB
  return Object.freeze({
    source: ram.source,
    ramBytes: ram.bytes,
    availableBytes,
    reserveBytes,
    usableBytes,
    tierMiB,
    budgetBytes,
    constrained: budgetBytes > usableBytes,
    displayBytes: Math.floor(budgetBytes * rules.displayShare),
  })
}

export const instanceBudgetFor = (budget, bytesPerInstance, rules = DEVICE_BUDGET_RULES) => {
  if (!Number.isInteger(bytesPerInstance) || bytesPerInstance < 1) throw new RangeError('bytesPerInstance must be a whole number at least 1')
  if (!budget || !(budget.displayBytes >= 0)) throw new TypeError('instanceBudgetFor needs a budget from chooseDeviceBudget')
  return Math.floor((budget.displayBytes * rules.shownShare) / bytesPerInstance)
}
