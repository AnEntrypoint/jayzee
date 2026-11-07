import { marchBox } from './marchingCubes.js'

const ROCK_BOUND = 1.5
const ROCK_SURFACE_LEVEL_CAP = 0.3

export const ROCK_MESH_RES = 16

function rng(seed) {
  let s = seed | 0
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return s / 0x7fffffff
  }
}

export function makeRockSDF(seed) {
  const r = rng(seed)
  const numCuts = 14 + Math.floor(r() * 8)
  const cuts = []
  for (let i = 0; i < numCuts; i++) {
    const theta = r() * Math.PI * 2
    const phi = Math.acos(2 * r() - 1)
    cuts.push({
      dx: Math.sin(phi) * Math.cos(theta),
      dy: Math.sin(phi) * Math.sin(theta),
      dz: Math.cos(phi),
      radius: 1.4 + r() * 1.1,
      ratio: 0.6 + r() * 0.25,
      k: 0.02 + r() * 0.06,
    })
  }
  const sx = 0.75 + r() * 0.5
  const sy = 0.6 + r() * 0.4
  const sz = 0.75 + r() * 0.5
  return (x, y, z) => {
    const px = x / sx
    const py = y / sy
    const pz = z / sz
    let d = Math.sqrt(px * px + py * py + pz * pz) - 1.05
    for (const c of cuts) {
      const ax = px + c.dx * c.radius
      const ay = py + c.dy * c.radius
      const az = pz + c.dz * c.radius
      const sd = Math.sqrt(ax * ax + ay * ay + az * az) - c.radius * c.ratio
      const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (-sd - d)) / c.k))
      d = d * (1 - h) + (-sd) * h + c.k * h * (1 - h)
    }
    if (d > ROCK_SURFACE_LEVEL_CAP) d = ROCK_SURFACE_LEVEL_CAP
    return d
  }
}

export function marchRockSurface(res, sdf) {
  return marchBox(res, sdf, -ROCK_BOUND, ROCK_BOUND, -ROCK_BOUND, ROCK_BOUND, -ROCK_BOUND, ROCK_BOUND)
}

export function generateRockHullData(numShapes = 6, baseSeed = 1337, hullRes = ROCK_MESH_RES) {
  const out = []
  for (let s = 0; s < numShapes; s++) {
    const sdf = makeRockSDF(baseSeed + s * 7919)
    const { positions: hullPos, indices: hullIdx } = marchRockSurface(hullRes, sdf)
    let cx = 0
    let cy = 0
    let cz = 0
    const vCount = hullPos.length / 3
    for (let v = 0; v < vCount; v++) {
      cx += hullPos[v * 3]
      cy += hullPos[v * 3 + 1]
      cz += hullPos[v * 3 + 2]
    }
    cx /= vCount
    cy /= vCount
    cz /= vCount
    let total = 0
    let minY = Infinity
    let maxY = -Infinity
    for (let v = 0; v < vCount; v++) {
      const dxv = hullPos[v * 3] - cx
      const dyv = hullPos[v * 3 + 1] - cy
      const dzv = hullPos[v * 3 + 2] - cz
      total += Math.sqrt(dxv * dxv + dyv * dyv + dzv * dzv)
      if (hullPos[v * 3 + 1] < minY) minY = hullPos[v * 3 + 1]
      if (hullPos[v * 3 + 1] > maxY) maxY = hullPos[v * 3 + 1]
    }
    out.push({
      positions: hullPos.slice(),
      indices: hullIdx.slice(),
      vCount,
      avgRadius: total / vCount,
      squashRatio: ((maxY - minY) / 2) / (total / vCount),
      bottomY: minY,
      height: maxY - minY,
    })
  }
  return out
}
