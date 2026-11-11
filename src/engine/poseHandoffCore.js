const QUEUE_CAPACITY = 4096

export const createPoseHandoffCore = ({ module, region, reserve, send }) => {
  const queued = new Int32Array(QUEUE_CAPACITY)
  const queue = { head: 0, count: 0 }
  const heapPose = new Uint8Array(module.HEAPU8.buffer, reserve, region.poseBytes)
  const handoff = { imported: -1, failure: null, pending: 0 }

  const pump = () => {
    while (queue.count > 0) {
      const slot = region.acquire()
      if (slot < 0) return
      const frame = queued[queue.head]
      queue.head = (queue.head + 1) % QUEUE_CAPACITY
      queue.count -= 1
      region.setFrame(slot, frame)
      handoff.pending += 1
      send(slot)
    }
  }

  const receive = (slot) => {
    handoff.pending -= 1
    heapPose.set(region.view(slot))
    const status = module._engine_pose_import(reserve, region.poseBytes)
    if (status !== 0) {
      handoff.failure = 'engine_pose_import status ' + status
      return
    }
    handoff.imported = region.frameOf(slot)
    region.release(slot)
    pump()
  }

  const request = (frame) => {
    if (handoff.failure) throw new Error('physics handoff failed: ' + handoff.failure)
    if (queue.count === QUEUE_CAPACITY) throw new RangeError('physics handoff queue full')
    queued[(queue.head + queue.count) % QUEUE_CAPACITY] = frame
    queue.count += 1
    pump()
  }

  return { handoff, request, receive }
}

export const RELEASE_VIEW_COS = 0.6
export const RELEASE_VIEW_RANGE_M = 400
const SCRATCH_VIEW_TARGET = 4
const SCRATCH_VIEW_COS = 7
const SCRATCH_VIEW_RANGE = 8

export const createPoseStepper = ({ module, streamer, region, reserve }) => {
  const heapPose = new Uint8Array(module.HEAPU8.buffer, reserve, region.poseBytes)
  const { poseBytes } = region
  const at = module._engine_frame_scratch() >> 3
  const heap = module.HEAPF64
  const viewed = typeof module._engine_release_view_scratch === 'function' && Boolean(streamer.viewTarget)
  if (viewed) {
    heap[at + SCRATCH_VIEW_TARGET] = streamer.viewTarget[0]
    heap[at + SCRATCH_VIEW_TARGET + 1] = streamer.viewTarget[1]
    heap[at + SCRATCH_VIEW_TARGET + 2] = streamer.viewTarget[2]
    heap[at + SCRATCH_VIEW_COS] = RELEASE_VIEW_COS
    heap[at + SCRATCH_VIEW_RANGE] = RELEASE_VIEW_RANGE_M
  }
  return (slot) => {
    const frame = region.frameOf(slot)
    const spot = streamer.step(frame)
    heap[at] = spot[0]
    heap[at + 1] = spot[1]
    heap[at + 2] = spot[2]
    if (module._engine_follow_scratch() !== 0) throw new Error('engine_follow refused at frame ' + frame)
    if (viewed && module._engine_release_view_scratch() !== 0) throw new Error('engine_release_view_scratch refused at frame ' + frame)
    module._engine_tick(1)
    if (module._engine_pose_export(reserve, poseBytes) !== poseBytes) throw new Error('engine_pose_export refused at frame ' + frame)
    region.view(slot).set(heapPose)
    return slot
  }
}
