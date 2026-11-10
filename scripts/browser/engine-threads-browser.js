import { runThreadsScenario, THREADS_BODIES } from '../lib/threadsScenario.mjs'

const result = { done: false, errors: [], crossOriginIsolated: globalThis.crossOriginIsolated === true, sharedArrayBuffer: typeof SharedArrayBuffer, workers: 4, bodies: THREADS_BODIES }
window.engineThreadsResult = result
window.addEventListener('error', (event) => result.errors.push('uncaught ' + event.message))

const THREADED = new URL('../../engine/out/engine-core-64mib-threads.mjs', import.meta.url).href
const FIXED = new URL('../../engine/out/engine-core-64mib.mjs', import.meta.url).href

const run = async () => {
  const threaded = await runThreadsScenario(THREADED, result.workers)
  const again = await runThreadsScenario(THREADED, result.workers)
  const single = await runThreadsScenario(FIXED, 1)
  let worst = 0
  for (let i = 0; i < single.length; i++) worst = Math.max(worst, Math.abs(single[i] - threaded[i]))
  result.repeatable = threaded.every((value, i) => value === again[i])
  result.worstDeviationM = worst
  result.positions = threaded.length
  result.ok = result.crossOriginIsolated && result.sharedArrayBuffer === 'function' && result.repeatable && worst < 1e-3 && result.errors.length === 0
}

run()
  .catch((error) => result.errors.push('thrown ' + (error && error.message ? error.message : String(error))))
  .finally(() => {
    result.done = true
    document.getElementById('result').textContent = JSON.stringify(result)
  })
