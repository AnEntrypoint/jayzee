import { parseDefineSpec } from './specBoundary.js'

const isVec3 = (v) => Array.isArray(v) && v.length >= 3 && v.slice(0, 3).every((n) => Number.isFinite(n))

const isCheckpointSpec = (c) => c !== null && typeof c === 'object' && !Array.isArray(c)
  && isVec3(c.position)
  && (c.radius === undefined || (Number.isFinite(c.radius) && c.radius > 0))

const CHECKPOINT_SCHEMA = Object.freeze({
  spawn: { type: 'custom', required: true, check: isVec3 },
  minY: { type: 'number', default: -50 },
  radius: { type: 'number', min: 0, exclusiveMin: true, default: 3 },
  checkpoints: { type: 'array', default: () => [], check: (list) => list.every(isCheckpointSpec) },
  onCheckpoint: { type: 'function' },
  onRespawn: { type: 'function' },
})

export function defineCheckpoint(spec = {}, host = null) {
  if (!host || typeof host.listPlayers !== 'function' || typeof host.setPlayerPosition !== 'function') {
    throw new TypeError('[checkpoint] a host accessor object with listPlayers and setPlayerPosition is required')
  }
  const config = parseDefineSpec('defineCheckpoint', spec, CHECKPOINT_SCHEMA)
  const spawn = [config.spawn[0], config.spawn[1], config.spawn[2]]
  const volumes = config.checkpoints.map((c, index) => ({
    position: [c.position[0], c.position[1], c.position[2]],
    r2: (c.radius ?? config.radius) ** 2,
    index,
  }))
  const reached = new Map()
  const reachedIndex = new Map()

  return {
    checkpointOf(pid) { return reached.get(pid) || spawn },
    setCheckpoint(pid, pos) {
      if (!isVec3(pos)) throw new TypeError('[checkpoint] setCheckpoint needs a position of three finite numbers')
      reached.set(pid, [pos[0], pos[1], pos[2]])
    },
    reset() {
      reached.clear()
      reachedIndex.clear()
    },
    onChartReanchor({ transfer }) {
      transfer.point(spawn, spawn)
      for (const volume of volumes) volume.position = transfer.point(volume.position)
      for (const pos of reached.values()) transfer.point(pos, pos)
    },
    tick(_dt) {
      for (const player of host.listPlayers()) {
        const pp = player.state?.position
        if (!pp) continue
        for (const volume of volumes) {
          const dx = pp[0] - volume.position[0]
          const dy = pp[1] - volume.position[1]
          const dz = pp[2] - volume.position[2]
          if (dx * dx + dy * dy + dz * dz > volume.r2) continue
          if ((reachedIndex.get(player.id) ?? -1) >= volume.index) continue
          reachedIndex.set(player.id, volume.index)
          reached.set(player.id, [volume.position[0], volume.position[1], volume.position[2]])
          if (config.onCheckpoint) config.onCheckpoint(host.context, player.id, volume.index)
        }
        if (pp[1] < config.minY) {
          host.setPlayerPosition(player.id, reached.get(player.id) || spawn)
          if (config.onRespawn) config.onRespawn(host.context, player.id)
        }
      }
    },
  }
}

export default defineCheckpoint
