const BLOCKED_SOURCE_PATTERNS = [
  'process.exit', 'child_process', '__proto__',
  'Object.prototype', 'globalThis', 'import(',
  'require(', 'eval(', 'Function(',
  'WebAssembly.', 'new Worker',
]

const LOCKDOWN_OPTIONS = Object.freeze({
  errorTaming: 'unsafe',
  stackFiltering: 'verbose',
  overrideTaming: 'severe',
})

const refused = (reasonCode, cause = null) => ({ ok: false, Compartment: null, reasonCode, cause })

const isAlreadyLockedDown = (e) => String(e?.message).includes('SES_ALREADY_LOCKED_DOWN')

const noSesInjected = async () => { throw new Error('no SES module was injected') }

const refusal = ({ reasonCode, cause }) => Object.assign(
  new Error(cause?.message ? `${reasonCode}: ${cause.message}` : reasonCode, { cause: cause ?? undefined }),
  { reasonCode },
)

export class SandboxUnavailableError extends Error {
  constructor(appName, cause) {
    super(`[SESCompartmentEvaluator] refusing to evaluate untrusted app "${appName}": SES is unavailable (${cause?.message ?? cause}); untrusted code has no non-SES isolation tier`, { cause })
    this.name = 'SandboxUnavailableError'
    this.code = 'SANDBOX_UNAVAILABLE'
    this.reasonCode = cause?.reasonCode ?? 'ses-unavailable'
    this.appName = appName
  }
}

export async function preflightSes({
  importSes = noSesInjected,
  lockdown = null,
  getCompartment = null,
  isFrozen = null,
} = {}) {
  let ses
  try {
    ses = await importSes()
  } catch (cause) {
    return refused('ses-not-installed', cause)
  }
  const lock = lockdown ?? ses?.lockdown ?? globalThis.lockdown
  if (typeof lock !== 'function') return refused('lockdown-missing')
  try {
    lock(LOCKDOWN_OPTIONS)
  } catch (cause) {
    if (!isAlreadyLockedDown(cause)) return refused('lockdown-failed', cause)
  }
  const Compartment = getCompartment ? getCompartment(ses) : (ses?.Compartment ?? globalThis.Compartment)
  if (typeof Compartment !== 'function') return refused('compartment-missing')
  const hardened = isFrozen ? isFrozen(Object.prototype) : Object.isFrozen(Object.prototype)
  if (!hardened) return refused('intrinsics-not-hardened')
  return { ok: true, Compartment, reasonCode: 'ok', cause: null }
}

const buildEndowments = (maxSteps) => {
  const endowments = {
    console: {
      log: (...args) => console.log('[sandbox]', ...args),
      warn: (...args) => console.warn('[sandbox]', ...args),
      error: (...args) => console.error('[sandbox]', ...args),
      info: (...args) => console.info('[sandbox]', ...args),
      debug: (...args) => console.debug('[sandbox]', ...args),
    },
    __sandboxSteps: 0,
    __sandboxMaxSteps: maxSteps,
  }
  endowments.__checkBudget = () => {
    endowments.__sandboxSteps++
    if (endowments.__sandboxSteps > endowments.__sandboxMaxSteps) {
      throw new Error('[Sandbox] CPU budget exceeded')
    }
  }
  return endowments
}

const wrapSource = (source) => {
  const body = source.trim()
  if (body.startsWith('export default ')) return '(' + body.slice('export default '.length).trim() + ')'
  if (body.startsWith('export {')) return '(' + body + ')'
  return body
}

const findBlockedPattern = (source) => BLOCKED_SOURCE_PATTERNS.find((pattern) => source.includes(pattern))

export function createSesEvaluator({ maxStepsPerTick = 1000000, ...sesOptions } = {}) {
  let settlement = null

  const settle = () => {
    settlement ??= preflightSes(sesOptions).catch((cause) => refused('preflight-threw', cause))
    return settlement
  }

  return {
    async evaluate(source, name = '<sandbox>') {
      if (typeof source !== 'string' || source.length === 0) {
        console.error(`[SESCompartmentEvaluator] empty source for "${name}"`)
        return null
      }

      const result = await settle()
      if (!result.ok) throw new SandboxUnavailableError(name, refusal(result))

      const blocked = findBlockedPattern(source)
      if (blocked) {
        console.error(`[SESCompartmentEvaluator] blocked pattern "${blocked}" in "${name}"`)
        return null
      }

      try {
        const compartment = new result.Compartment(buildEndowments(maxStepsPerTick), {}, { name: `sandbox-${name}` })
        const appDef = compartment.evaluate(wrapSource(source))

        if (!appDef || typeof appDef !== 'object') {
          console.error(`[SESCompartmentEvaluator] "${name}" did not return a valid app definition`)
          return null
        }

        return { default: appDef }
      } catch (e) {
        console.error(`[SESCompartmentEvaluator] evaluation error in "${name}": ${e.message}`)
        return null
      }
    },
  }
}
