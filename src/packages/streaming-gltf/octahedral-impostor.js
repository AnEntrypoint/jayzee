import { atlasLayout } from '../../sdk/TextureAtlas.js'

export class ImpostorError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'ImpostorError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new ImpostorError(code, message)
}

const signNotZero = (value) => (value < 0 ? -1 : 1)

export function octEncode(direction, out = [0, 0]) {
  const x = direction[0], y = direction[1], z = direction[2]
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z)
  if (!(sum > 0) || !Number.isFinite(sum)) refuse('impostor-direction', 'a direction must be finite and non-zero')
  let u = x / sum, v = z / sum
  if (y < 0) {
    const fu = (1 - Math.abs(v)) * signNotZero(u)
    const fv = (1 - Math.abs(u)) * signNotZero(v)
    u = fu
    v = fv
  }
  out[0] = u * 0.5 + 0.5
  out[1] = v * 0.5 + 0.5
  return out
}

export function octDecode(uv, out = [0, 0, 0]) {
  const u = uv[0] * 2 - 1, v = uv[1] * 2 - 1
  let x = u, z = v
  const y = 1 - Math.abs(u) - Math.abs(v)
  if (y < 0) {
    x = (1 - Math.abs(v)) * signNotZero(u)
    z = (1 - Math.abs(u)) * signNotZero(v)
  }
  const length = Math.hypot(x, y, z)
  out[0] = x / length; out[1] = y / length; out[2] = z / length
  return out
}

export function hemiOctEncode(direction, out = [0, 0]) {
  const x = direction[0], y = direction[1], z = direction[2]
  if (!(y >= 0)) refuse('impostor-direction', 'a hemisphere direction needs y of at least 0, got ' + String(y))
  const sum = Math.abs(x) + y + Math.abs(z)
  if (!(sum > 0) || !Number.isFinite(sum)) refuse('impostor-direction', 'a direction must be finite and non-zero')
  const px = x / sum, pz = z / sum
  out[0] = (px + pz) * 0.5 + 0.5
  out[1] = (pz - px) * 0.5 + 0.5
  return out
}

export function hemiOctDecode(uv, out = [0, 0, 0]) {
  const a = uv[0] * 2 - 1, b = uv[1] * 2 - 1
  const x = (a - b) * 0.5, z = (a + b) * 0.5
  const y = 1 - Math.abs(x) - Math.abs(z)
  const length = Math.hypot(x, y, z)
  out[0] = x / length; out[1] = y / length; out[2] = z / length
  return out
}

export function createImpostorGrid({ framesPerAxis, frameSize, hemisphere = true }) {
  if (!Number.isInteger(framesPerAxis) || framesPerAxis < 2) refuse('impostor-grid', 'framesPerAxis must be an integer of at least 2, got ' + String(framesPerAxis))
  const n = framesPerAxis
  const frameCount = n * n
  const atlas = atlasLayout({ frameSize: [frameSize, frameSize], animations: { views: frameCount }, columns: n })
  const directions = new Float64Array(frameCount * 3)
  const decode = hemisphere ? hemiOctDecode : octDecode
  const encode = hemisphere ? hemiOctEncode : octEncode
  const uv = [0, 0]
  const dir = [0, 0, 0]
  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      uv[0] = col / (n - 1)
      uv[1] = row / (n - 1)
      decode(uv, dir)
      const f = row * n + col
      directions[f * 3] = dir[0]; directions[f * 3 + 1] = dir[1]; directions[f * 3 + 2] = dir[2]
    }
  }

  function frameDirection(frame, out = [0, 0, 0]) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) refuse('impostor-frame', 'no frame ' + String(frame) + ' of ' + frameCount)
    out[0] = directions[frame * 3]; out[1] = directions[frame * 3 + 1]; out[2] = directions[frame * 3 + 2]
    return out
  }

  function sample(viewDirection, out) {
    const x = viewDirection[0], z = viewDirection[2]
    let y = viewDirection[1]
    if (hemisphere && y < 0) y = 0
    dir[0] = x; dir[1] = y; dir[2] = z
    encode(dir, uv)
    const gx = Math.min(n - 1, Math.max(0, uv[0] * (n - 1)))
    const gy = Math.min(n - 1, Math.max(0, uv[1] * (n - 1)))
    const col = Math.min(n - 2, Math.floor(gx))
    const row = Math.min(n - 2, Math.floor(gy))
    const fx = gx - col, fy = gy - row
    out.frames[0] = row * n + col
    out.frames[1] = row * n + col + 1
    out.frames[2] = (row + 1) * n + col
    out.frames[3] = (row + 1) * n + col + 1
    out.weights[0] = (1 - fx) * (1 - fy)
    out.weights[1] = fx * (1 - fy)
    out.weights[2] = (1 - fx) * fy
    out.weights[3] = fx * fy
    let best = 0
    for (let i = 1; i < 4; i++) if (out.weights[i] > out.weights[best]) best = i
    out.nearest = out.frames[best]
    return out
  }

  function frameRect(frame, out = [0, 0, 0, 0]) {
    if (!Number.isInteger(frame) || frame < 0 || frame >= frameCount) refuse('impostor-frame', 'no frame ' + String(frame) + ' of ' + frameCount)
    const cell = atlas.clips.views.cells[frame]
    out[0] = cell[0] / atlas.width
    out[1] = cell[1] / atlas.height
    out[2] = atlas.cellW / atlas.width
    out[3] = atlas.cellH / atlas.height
    return out
  }

  return { framesPerAxis: n, frameCount, hemisphere, atlasWidth: atlas.width, atlasHeight: atlas.height, directions, frameDirection, frameRect, sample, createSample: () => ({ frames: new Int32Array(4), weights: new Float64Array(4), nearest: 0 }) }
}
