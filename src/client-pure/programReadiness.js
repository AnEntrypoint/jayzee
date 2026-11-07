const READY_POLL_MS = 16

export function runWarmPasses(renderPass, passes = 2) {
  const attempted = Math.max(0, passes | 0)
  let succeeded = 0
  let error = null
  for (let i = 0; i < attempted; i++) {
    try {
      renderPass()
      succeeded++
    } catch (e) {
      if (!error) error = e instanceof Error ? e : new Error(String(e))
    }
  }
  return { attempted, succeeded, failed: attempted - succeeded, error }
}

function pendingPipelineCount(pipelines) {
  const caches = pipelines.caches
  const backend = pipelines.backend
  if (!caches || !backend || typeof backend.get !== 'function') return 0
  let n = 0
  for (const pipeline of caches.values()) {
    const data = backend.get(pipeline)
    if (data.pipeline !== undefined && data.pipeline !== null) continue
    if (data.error === true) continue
    n++
  }
  return n
}

export function pendingProgramCount(renderer, opts = {}) {
  const pipelines = opts.vacuous === true ? null : renderer && renderer._pipelines
  if (pipelines) return pendingPipelineCount(pipelines)
  const programs = renderer && renderer.info && renderer.info.programs
  if (!programs) return 0
  let n = 0
  for (const p of programs) if (typeof p.isReady === 'function' && !p.isReady()) n++
  return n
}

export function createProgramReadiness(opts = {}) {
  const now = typeof opts.now === 'function' ? opts.now : () => performance.now()
  const schedule = typeof opts.schedule === 'function' ? opts.schedule : (fn, ms) => setTimeout(fn, ms)
  const warn = typeof opts.warn === 'function' ? opts.warn : (...args) => console.warn(...args)
  const vacuous = opts.vacuous === true
  const warmWait = { calls: 0, pendingAtStart: null, waitedMs: null, resolvedPending: null, vacuous: false, maxWaitMs: null }

  function recordWarmWait(pendingAtStart, waitedMs, resolvedPending, maxWaitMs) {
    warmWait.calls++
    warmWait.pendingAtStart = pendingAtStart
    warmWait.waitedMs = waitedMs
    warmWait.resolvedPending = resolvedPending
    warmWait.vacuous = vacuous
    warmWait.maxWaitMs = maxWaitMs
  }

  function pending(renderer) {
    return pendingProgramCount(renderer, { vacuous })
  }

  function whenProgramsReady(renderer, maxWaitMs) {
    const t0 = now()
    const pendingAtStart = pending(renderer)
    return new Promise((resolve) => {
      const poll = () => {
        const count = pending(renderer)
        const waitedMs = now() - t0
        if (count === 0) {
          recordWarmWait(pendingAtStart, waitedMs, 0, maxWaitMs)
          resolve(0)
          return
        }
        if (waitedMs >= maxWaitMs) {
          warn(`[shader] ${count} program(s) still compiling after ${maxWaitMs}ms`)
          recordWarmWait(pendingAtStart, waitedMs, count, maxWaitMs)
          resolve(count)
          return
        }
        schedule(poll, READY_POLL_MS)
      }
      poll()
    })
  }

  return { pending, whenProgramsReady, lastWait: () => ({ ...warmWait }) }
}
