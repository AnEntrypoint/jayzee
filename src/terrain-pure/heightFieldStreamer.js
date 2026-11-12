import { snapshotChart, createChartTransfer } from '../chart-pure/chartAnchor.js'

const HEIGHTFIELD_BODY_ID = 1

function refuse(what) {
  throw new TypeError('[height-field-streamer] ' + what)
}

function makeBank(fieldCount, nodes) {
  const bank = []
  for (let i = 0; i < fieldCount; i++) bank.push({ live: false, center: [0, 0], cornerX: 0, cornerZ: 0, heights: new Float32Array(nodes * nodes) })
  return bank
}

export function createHeightFieldStreamer({ frame, fieldCount, nodes, spacing, defer }) {
  if (!frame || typeof frame.groundHeightLocal !== 'function') refuse('frame is missing: the streamer samples the ground of one planet frame')
  if (!Number.isInteger(fieldCount) || fieldCount < 1) refuse('fieldCount ' + String(fieldCount) + ' is not a positive integer: one field follows one player, and both banks are sized once from this budget')
  if (!Number.isInteger(nodes) || nodes < 3 || nodes % 2 === 0) refuse('nodes ' + String(nodes) + ' is not an odd integer of at least 3: a field is centred on a node')
  if (!Number.isFinite(spacing) || !(spacing > 0)) refuse('spacing ' + String(spacing) + ' is not a positive length in metres')
  if (typeof defer !== 'function') refuse('defer is missing: a prepare yields between fields through an injected function that returns a promise')

  const half = (nodes - 1) / 2
  const extent = half * spacing
  const coverRadius = extent - spacing
  const recentreAt = coverRadius * 0.5
  let liveBank = makeBank(fieldCount, nodes)
  let spareBank = makeBank(fieldCount, nodes)
  let lattice = null
  let toChart = null
  let toChartEpoch = -1
  const stats = { sampled: 0, recentred: 0, prepared: 0, aborted: 0, installed: 0, placed: 0 }
  const scratch = [0, 0, 0]
  const placed = [0, 0, 0]

  function fill(field, cx, cz, heightFn) {
    const sx = Math.round(cx / spacing) * spacing
    const sz = Math.round(cz / spacing) * spacing
    field.center[0] = sx
    field.center[1] = sz
    field.cornerX = sx - extent
    field.cornerZ = sz - extent
    const h = field.heights
    let guess
    for (let iz = 0; iz < nodes; iz++) {
      for (let ix = 0; ix < nodes; ix++) {
        const y = heightFn(field.cornerX + ix * spacing, field.cornerZ + iz * spacing, guess)
        h[iz * nodes + ix] = y
        guess = y
      }
    }
    field.live = true
    stats.sampled += nodes * nodes
  }

  function bilinear(field, x, z) {
    const gx = (x - field.cornerX) / spacing
    const gz = (z - field.cornerZ) / spacing
    if (!(gx >= 0) || !(gz >= 0) || gx > nodes - 1 || gz > nodes - 1) return NaN
    const ix = gx >= nodes - 1 ? nodes - 2 : Math.floor(gx)
    const iz = gz >= nodes - 1 ? nodes - 2 : Math.floor(gz)
    const fx = gx - ix, fz = gz - iz
    const h = field.heights
    const i = iz * nodes + ix
    const top = h[i] + (h[i + 1] - h[i]) * fx
    const bottom = h[i + nodes] + (h[i + nodes + 1] - h[i + nodes]) * fx
    return top + (bottom - top) * fz
  }

  function bankSurface(bank, count, x, z) {
    for (let i = 0; i < count; i++) {
      const field = bank[i]
      if (!field.live) continue
      const y = bilinear(field, x, z)
      if (y === y) return y
    }
    return NaN
  }

  const liveHeightFn = (x, z, yGuess) => frame.groundHeightLocal(x, z, yGuess)

  function fieldHeightFn() {
    return lattice ? lattice.heightFn : liveHeightFn
  }

  function chartTransfer() {
    if (toChart === null || toChartEpoch !== frame.chartEpoch) {
      toChart = createChartTransfer(lattice.anchor, snapshotChart(frame))
      toChartEpoch = frame.chartEpoch
    }
    return toChart
  }

  function update(players) {
    if (!Array.isArray(players) || players.length > fieldCount) refuse('update got ' + (Array.isArray(players) ? players.length + ' players for a budget of ' + fieldCount + ' fields' : String(players)))
    const heightFn = fieldHeightFn()
    for (let i = 0; i < fieldCount; i++) {
      const field = liveBank[i]
      if (i >= players.length) { field.live = false; continue }
      const p = lattice ? lattice.toLattice(players[i][0], players[i][1]) : players[i]
      if (field.live && Math.max(Math.abs(p[0] - field.center[0]), Math.abs(p[1] - field.center[1])) <= recentreAt) continue
      fill(field, p[0], p[1], heightFn)
      stats.recentred++
    }
  }

  function surfaceY(x, z) {
    if (!lattice) {
      const y = bankSurface(liveBank, fieldCount, x, z)
      return y === y ? y : null
    }
    const p = lattice.toLattice(x, z)
    const h = bankSurface(liveBank, fieldCount, p[0], p[1])
    if (h !== h) return null
    scratch[0] = p[0]
    scratch[1] = h
    scratch[2] = p[1]
    return chartTransfer().point(scratch, placed)[1]
  }

  async function prepareFields({ players, heightFn, isAborted }) {
    if (players.length > fieldCount) refuse('prepareFields got ' + players.length + ' players for a budget of ' + fieldCount + ' fields')
    const bank = spareBank
    for (let i = 0; i < fieldCount; i++) bank[i].live = false
    for (let i = 0; i < players.length; i++) {
      await defer()
      if (isAborted()) { stats.aborted++; return null }
      fill(bank[i], players[i][0], players[i][1], heightFn)
    }
    await defer()
    if (isAborted()) { stats.aborted++; return null }
    stats.prepared++
    return { fields: bank.slice(0, players.length), bank }
  }

  function preparedSurfaceY(prepared, x, z) {
    const y = bankSurface(prepared.fields, prepared.fields.length, x, z)
    return y === y ? y : null
  }

  function installPrepared(prepared) {
    if (prepared.bank !== spareBank) refuse('installPrepared got a set this streamer did not prepare, or one already installed')
    let removed = 0
    for (let i = 0; i < fieldCount; i++) if (liveBank[i].live) removed++
    const old = liveBank
    liveBank = spareBank
    spareBank = old
    for (let i = 0; i < fieldCount; i++) spareBank[i].live = false
    lattice = null
    toChart = null
    stats.installed++
    return { installed: prepared.fields.length, removed, retransformed: 0, tiltDeg: 0 }
  }

  function setLattice(next) {
    if (!next || typeof next.toLattice !== 'function' || typeof next.heightFn !== 'function') refuse('setLattice got no field lattice')
    lattice = next
    toChart = null
    placeAllFields()
  }

  function placeAllFields() {
    toChart = null
    stats.placed++
  }

  return {
    coverRadius,
    spacing,
    nodes,
    stats,
    liveHeightFn,
    update,
    surfaceY,
    prepareFields,
    preparedSurfaceY,
    installPrepared,
    setLattice,
    placeAllFields,
    get lattice() { return lattice },
    get fields() { return liveBank.filter((f) => f.live) },
    placementOf(field) {
      if (!lattice) return { position: [field.cornerX, 0, field.cornerZ], rotation: [0, 0, 0, 1] }
      return lattice.placement(field.cornerX, field.cornerZ)
    },
  }
}

export function createHeightFieldPhysics(streamer) {
  const bodyMeta = new Map([[HEIGHTFIELD_BODY_ID, { shape: 'heightfield' }]])
  function raycast(origin, direction, range) {
    if (!(direction[1] < 0) || direction[0] !== 0 || direction[2] !== 0) throw new TypeError('[height-field-physics] raycast got direction ' + JSON.stringify(direction) + ': this probe answers straight-down rays only')
    const y = streamer.surfaceY(origin[0], origin[2])
    if (y === null || y > origin[1] || origin[1] - y > range) return { hit: false }
    return { hit: true, bodyId: HEIGHTFIELD_BODY_ID, position: [origin[0], y, origin[2]], distance: origin[1] - y }
  }
  return { raycast, bodyMeta }
}
