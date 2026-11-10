export const HANDOFF_POOL = 3

export const createPhysicsHandoff = ({ module, glue, players, budgetBytes, workers = 1, solverIterations, path, pool = HANDOFF_POOL }) => {
  const worker = new Worker(new URL('./physicsWorker.js', import.meta.url), { type: 'module' })
  const poseBytes = module._engine_pose_bytes()
  const reserve = module._engine_pose_reserve()
  const free = Array.from({ length: pool }, () => new ArrayBuffer(poseBytes))
  const queued = []
  const handoff = { imported: -1, tickMs: [], failure: null, poseBytes, pending: 0 }

  const pump = () => {
    while (free.length > 0 && queued.length > 0) {
      const frame = queued.shift()
      const buffer = free.pop()
      worker.postMessage({ type: 'tick', frame, buffer }, [buffer])
      handoff.pending += 1
    }
  }

  const fail = (message) => {
    handoff.failure = message
    worker.terminate()
  }

  const ready = new Promise((resolve, reject) => {
    worker.onerror = (event) => reject(new Error('physics worker: ' + event.message))
    worker.onmessage = (event) => {
      const message = event.data
      if (message.type === 'ready') {
        if (message.poseBytes !== poseBytes) return reject(new Error('pose bytes differ: worker ' + message.poseBytes + ' page ' + poseBytes))
        worker.onmessage = onPose
        resolve(handoff)
      } else reject(new Error(message.message))
    }
  })

  const onPose = (event) => {
    const message = event.data
    if (message.type === 'error') return fail(message.message)
    handoff.pending -= 1
    module.HEAPU8.set(new Uint8Array(message.buffer), reserve)
    const status = module._engine_pose_import(reserve, poseBytes)
    if (status !== 0) return fail('engine_pose_import status ' + status)
    handoff.imported = message.frame
    handoff.tickMs.push(message.tickMs)
    free.push(message.buffer)
    pump()
  }

  worker.postMessage({ type: 'boot', glue, players, budgetBytes, workers, solverIterations, path })

  handoff.ready = ready
  handoff.requestFrame = (frame) => {
    if (handoff.failure) throw new Error('physics handoff failed: ' + handoff.failure)
    queued.push(frame)
    pump()
  }
  handoff.close = () => worker.terminate()
  return handoff
}
