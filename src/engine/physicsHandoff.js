import { attachPoseRegion, poseRegionBuffers } from './poseRegion.js'
import { createPoseHandoffCore } from './poseHandoffCore.js'

export const HANDOFF_POOL = 3

export const createPhysicsHandoff = ({ module, glue, players, budgetBytes, workers = 1, solverIterations, path, pool = HANDOFF_POOL }) => {
  const worker = new Worker(new URL('./physicsWorker.js', import.meta.url), { type: 'module' })
  const poseBytes = module._engine_pose_bytes()
  const reserve = module._engine_pose_reserve()
  const buffers = poseRegionBuffers({ slots: pool, poseBytes })
  const region = attachPoseRegion(buffers, { owner: true })
  const core = createPoseHandoffCore({ module, region, reserve, send: (slot) => worker.postMessage(slot) })
  const handoff = core.handoff
  handoff.poseBytes = poseBytes

  const onPose = (event) => {
    const message = event.data
    if (typeof message !== 'number') return fail(message.message)
    core.receive(message)
    if (handoff.failure) worker.terminate()
  }

  const fail = (message) => {
    handoff.failure = message
    worker.terminate()
  }

  handoff.ready = new Promise((resolve, reject) => {
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

  worker.postMessage({ type: 'boot', glue, players, budgetBytes, workers, solverIterations, path, pose: buffers })
  handoff.requestFrame = core.request
  handoff.close = () => worker.terminate()
  return handoff
}
