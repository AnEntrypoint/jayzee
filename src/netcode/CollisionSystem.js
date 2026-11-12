import { separationPush } from './separationPush.js'

export const COLLISION_LAG_INPUTS = 16

const EMPTY = -1
const GRID_STRIDE = 65536
const PRUNE_MASK = 63
const planPush = [0, 0, 0, 0]
let planPruneTick = 0

function pushQueueOf(player) {
  if (!player.pushQueue) player.pushQueue = new Array(COLLISION_LAG_INPUTS).fill(null)
  return player.pushQueue
}

function addPendingPush(player, sign, push) {
  const pending = player.pendingPush || (player.pendingPush = [0, 0, 0, 0])
  pending[0] += sign * push[0]
  pending[1] += sign * push[1]
  pending[2] += sign * push[2]
  pending[3] += sign * push[3]
}

export function advancePushQueue(player, physicsIntegration) {
  const queue = pushQueueOf(player)
  queue.push(player.pendingPush || null)
  player.pendingPush = null
  const due = queue.shift()
  if (!due) return false
  const position = player.state.position, velocity = player.state.velocity
  position[0] += due[0]
  position[2] += due[1]
  velocity[0] += due[2]
  velocity[2] += due[3]
  physicsIntegration.setPlayerPosition(player.id, position)
  return true
}

export function planPlayerCollisions(players, grid, gridCells, cellSz, minDist2, minDist, dt) {
  grid.clear()
  for (const p of players) {
    const ck = Math.floor(p.state.position[0] / cellSz) * GRID_STRIDE + Math.floor(p.state.position[2] / cellSz)
    let cell = grid.get(ck)
    if (!cell) {
      cell = gridCells.get(ck)
      if (!cell) {
        cell = []
        gridCells.set(ck, cell)
      } else {
        cell.length = 0
      }
      grid.set(ck, cell)
    }
    cell.push(p)
  }
  if ((++planPruneTick & PRUNE_MASK) === 0 || gridCells.size > players.length * 4) {
    for (const k of gridCells.keys()) if (!grid.has(k)) gridCells.delete(k)
  }
  for (const player of players) {
    const px = player.state.position[0], py = player.state.position[1], pz = player.state.position[2]
    const cx = Math.floor(px / cellSz), cz = Math.floor(pz / cellSz)
    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddz = -1; ddz <= 1; ddz++) {
        const neighbors = grid.get((cx + ddx) * GRID_STRIDE + (cz + ddz))
        if (!neighbors) continue
        for (const other of neighbors) {
          if (other.id <= player.id) continue
          const dx = other.state.position[0] - px, dy = other.state.position[1] - py, dz = other.state.position[2] - pz
          if (dx * dx + dy * dy + dz * dz >= minDist2 || !separationPush(dx, dy, dz, minDist, dt, planPush)) continue
          addPendingPush(player, -1, planPush)
          addPendingPush(other, 1, planPush)
        }
      }
    }
  }
}

export function pushWindowOf(player) {
  return pushQueueOf(player).slice(0, COLLISION_LAG_INPUTS)
}

export function resetPushQueue(player) {
  pushQueueOf(player).fill(null)
  player.pendingPush = null
}
const CELL_LIMIT = 1 << 29

const cellOf = (coordinate, cellSize) => {
  const cell = Math.floor(coordinate / cellSize)
  if (!(cell > -CELL_LIMIT && cell < CELL_LIMIT)) throw new RangeError('CollisionSystem player coordinate ' + String(coordinate) + ' is outside the grid of ' + CELL_LIMIT + ' cells each way')
  return cell | 0
}

const tableSizeFor = (capacity) => {
  let size = 16
  while (size < capacity * 4) size *= 2
  return size
}

export class CollisionSystem {
  constructor({ capacity, cellSize, minDist }) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('CollisionSystem capacity must be a positive integer, got ' + String(capacity))
    if (!(Number.isFinite(cellSize) && cellSize > 0)) throw new RangeError('CollisionSystem cellSize must be a positive finite number, got ' + String(cellSize))
    if (!(Number.isFinite(minDist) && minDist > 0)) throw new RangeError('CollisionSystem minDist must be a positive finite number, got ' + String(minDist))
    this.capacity = capacity
    this.cellSize = cellSize
    this.minDist = minDist
    this.minDist2 = minDist * minDist
    this.tableSize = tableSizeFor(capacity)
    this.tableMask = this.tableSize - 1
    this.slotStamp = new Uint32Array(this.tableSize)
    this.slotCx = new Int32Array(this.tableSize)
    this.slotCz = new Int32Array(this.tableSize)
    this.slotHead = new Int32Array(this.tableSize)
    this.slotTail = new Int32Array(this.tableSize)
    this.next = new Int32Array(capacity)
    this.push = [0, 0, 0, 0]
    this.stamp = 0
    this.stats = { passes: 0, pairsPushed: 0, cellsUsed: 0 }
  }

  slotOf(cx, cz, claim) {
    let slot = (Math.imul(cx, 0x9e3779b1) ^ Math.imul(cz, 0x85ebca6b)) & this.tableMask
    for (;;) {
      if (this.slotStamp[slot] !== this.stamp) {
        if (!claim) return EMPTY
        this.slotStamp[slot] = this.stamp
        this.slotCx[slot] = cx
        this.slotCz[slot] = cz
        this.slotHead[slot] = EMPTY
        this.slotTail[slot] = EMPTY
        this.stats.cellsUsed++
        return slot
      }
      if (this.slotCx[slot] === cx && this.slotCz[slot] === cz) return slot
      slot = (slot + 1) & this.tableMask
    }
  }

  bucket(players, dt) {
    const count = players.length
    if (count > this.capacity) throw new RangeError('CollisionSystem holds ' + this.capacity + ' players, got ' + count)
    if (!(Number.isFinite(dt) && dt > 0)) throw new RangeError('CollisionSystem dt must be a positive finite number, got ' + String(dt))
    const cellSize = this.cellSize, next = this.next
    this.stamp++
    if (this.stamp === 0xffffffff) { this.slotStamp.fill(0); this.stamp = 1 }
    this.stats.passes++
    this.stats.cellsUsed = 0
    for (let i = 0; i < count; i++) {
      const position = players[i].state.position
      const slot = this.slotOf(cellOf(position[0], cellSize), cellOf(position[2], cellSize), true)
      next[i] = EMPTY
      if (this.slotHead[slot] === EMPTY) this.slotHead[slot] = i
      else next[this.slotTail[slot]] = i
      this.slotTail[slot] = i
    }
    return count
  }

  pairs(players, dt, physicsIntegration) {
    const count = this.bucket(players, dt)
    const cellSize = this.cellSize, minDist = this.minDist, minDist2 = this.minDist2, push = this.push, next = this.next
    const deferred = physicsIntegration === null
    let pushed = 0
    for (let i = 0; i < count; i++) {
      const player = players[i]
      const px = player.state.position[0], py = player.state.position[1], pz = player.state.position[2]
      const cx = cellOf(px, cellSize), cz = cellOf(pz, cellSize)
      for (let ddx = -1; ddx <= 1; ddx++) {
        for (let ddz = -1; ddz <= 1; ddz++) {
          const slot = this.slotOf(cx + ddx, cz + ddz, false)
          if (slot === EMPTY) continue
          for (let j = this.slotHead[slot]; j !== EMPTY; j = next[j]) {
            const other = players[j]
            if (other.id <= player.id) continue
            const dx = other.state.position[0] - px, dy = other.state.position[1] - py, dz = other.state.position[2] - pz
            if (dx * dx + dy * dy + dz * dz >= minDist2 || !separationPush(dx, dy, dz, minDist, dt, push)) continue
            pushed++
            if (deferred) {
              addPendingPush(player, -1, push)
              addPendingPush(other, 1, push)
              continue
            }
            player.state.position[0] -= push[0]
            player.state.position[2] -= push[1]
            player.state.velocity[0] -= push[2]
            player.state.velocity[2] -= push[3]
            other.state.position[0] += push[0]
            other.state.position[2] += push[1]
            other.state.velocity[0] += push[2]
            other.state.velocity[2] += push[3]
            physicsIntegration.setPlayerPosition(player.id, player.state.position)
            physicsIntegration.setPlayerPosition(other.id, other.state.position)
          }
        }
      }
    }
    this.stats.pairsPushed += pushed
    return pushed
  }

  apply(players, dt, physicsIntegration) {
    if (!physicsIntegration || typeof physicsIntegration.setPlayerPosition !== 'function') throw new TypeError('CollisionSystem.apply needs physicsIntegration.setPlayerPosition')
    return this.pairs(players, dt, physicsIntegration)
  }

  plan(players, dt) {
    return this.pairs(players, dt, null)
  }

  advance(players, physicsIntegration) {
    let applied = 0
    for (let i = 0; i < players.length; i++) if (advancePushQueue(players[i], physicsIntegration)) applied++
    return applied
  }
}
