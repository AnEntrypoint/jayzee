export const ISOLATION_SHIM_URL = './coi-sw.js'

export const ISOLATION_HEADERS = Object.freeze({
  COEP: 'Cross-Origin-Embedder-Policy',
  COEP_VALUE: 'require-corp',
  COOP: 'Cross-Origin-Opener-Policy',
  COOP_VALUE: 'same-origin',
})

export const VARIANT = Object.freeze({ THREADED: 'threaded', SINGLE: 'single' })

export const isolationPlan = ({ crossOriginIsolated = false, serviceWorkerSupported = false, threadsRequested = true } = {}) => {
  if (!threadsRequested) return Object.freeze({ variant: VARIANT.SINGLE, register: false, reason: 'threads not requested' })
  if (crossOriginIsolated === true) return Object.freeze({ variant: VARIANT.THREADED, register: false, reason: 'page is cross-origin isolated' })
  if (serviceWorkerSupported === true) {
    return Object.freeze({ variant: VARIANT.SINGLE, register: true, reason: 'the isolation shim takes hold on the next load' })
  }
  return Object.freeze({ variant: VARIANT.SINGLE, register: false, reason: 'no service worker, so isolation is unavailable' })
}

export const registerIsolationShim = async (navigatorLike, url = ISOLATION_SHIM_URL) => {
  if (!navigatorLike || !navigatorLike.serviceWorker || typeof navigatorLike.serviceWorker.register !== 'function') return 'unsupported'
  await navigatorLike.serviceWorker.register(url)
  return 'registered'
}
