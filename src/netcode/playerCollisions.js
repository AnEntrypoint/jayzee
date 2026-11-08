import { separationPush } from './separationPush.js'

const GRID_STRIDE = 65536
const PRUNE_MASK = 63
const push = [0, 0, 0, 0]
let pruneTick = 0

const cellKey = (cx, cz) => cx * GRID_STRIDE + cz

function bucketPlayers(players, grid, gridCells, cellSz) {
  grid.clear()
  for (const p of players) {
    const cx = Math.floor(p.state.position[0] / cellSz)
    const cz = Math.floor(p.state.position[2] / cellSz)
    const ck = cellKey(cx, cz)
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
}

function pruneCells(players, grid, gridCells) {
  if ((++pruneTick & PRUNE_MASK) === 0 || gridCells.size > players.length * 4) {
    for (const k of gridCells.keys()) {
      if (!grid.has(k)) gridCells.delete(k)
    }
  }
}

function pushPair(player, other, physicsIntegration) {
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

export function applyPlayerCollisions(players, grid, gridCells, cellSz, minDist2, minDist, dt, physicsIntegration) {
  bucketPlayers(players, grid, gridCells, cellSz)
  pruneCells(players, grid, gridCells)
  for (const player of players) {
    const px = player.state.position[0], py = player.state.position[1], pz = player.state.position[2]
    const cx = Math.floor(px / cellSz), cz = Math.floor(pz / cellSz)
    for (let ddx = -1; ddx <= 1; ddx++) {
      for (let ddz = -1; ddz <= 1; ddz++) {
        const neighbors = grid.get(cellKey(cx + ddx, cz + ddz))
        if (!neighbors) continue
        for (const other of neighbors) {
          if (other.id <= player.id) continue
          const ox = other.state.position[0], oy = other.state.position[1], oz = other.state.position[2]
          const dx = ox - px, dy = oy - py, dz = oz - pz
          if (dx * dx + dy * dy + dz * dz >= minDist2 || !separationPush(dx, dy, dz, minDist, dt, push)) continue
          pushPair(player, other, physicsIntegration)
        }
      }
    }
  }
}
