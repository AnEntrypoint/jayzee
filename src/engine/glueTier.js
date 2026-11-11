const MIB = 1048576

export const GLUE_TIERS_MIB = Object.freeze([64, 128, 256, 512])

export class GlueReservationError extends RangeError {
  constructor(budgetBytes, tried, cause) {
    super('no engine memory tier could be reserved for a budget of ' + budgetBytes + ' bytes (tried ' + tried.join(', ') + ' MiB)')
    this.name = 'GlueReservationError'
    this.code = 'glue-reservation-failed'
    this.budgetBytes = budgetBytes
    this.tried = tried
    this.cause = cause
  }
}

export const glueTierFor = (budgetBytes) => {
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) throw new RangeError('budgetBytes must be a positive finite number')
  const tier = GLUE_TIERS_MIB.find((mib) => mib * MIB >= budgetBytes)
  if (tier === undefined) throw new RangeError('a budget of ' + budgetBytes + ' bytes is above the largest memory tier, ' + GLUE_TIERS_MIB[GLUE_TIERS_MIB.length - 1] + ' MiB')
  return tier
}

export const glueChain = (budgetBytes) => {
  const top = GLUE_TIERS_MIB.indexOf(glueTierFor(budgetBytes))
  return GLUE_TIERS_MIB.slice(0, top + 1).reverse().map((tierMiB) => Object.freeze({ tierMiB, budgetBytes: Math.min(budgetBytes, tierMiB * MIB) }))
}

export const isReservationFailure = (error) => error instanceof Error && /could not allocate memory|out of memory|WebAssembly\.Memory/i.test(error.message)

export const instantiateWithinBudget = async ({ budgetBytes, instantiate }) => {
  if (typeof instantiate !== 'function') throw new TypeError('instantiateWithinBudget needs an instantiate function')
  const tried = []
  let last = null
  for (const step of glueChain(budgetBytes)) {
    tried.push(step.tierMiB)
    try {
      return { tierMiB: step.tierMiB, budgetBytes: step.budgetBytes, loweredFrom: tried.length > 1 ? tried[0] : null, value: await instantiate(step) }
    } catch (error) {
      if (!isReservationFailure(error)) throw error
      last = error
    }
  }
  throw new GlueReservationError(budgetBytes, tried, last)
}
