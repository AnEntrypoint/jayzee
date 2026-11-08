import http from 'node:http'
import { gate, finish } from './lib/gate.mjs'
import { createPlanetFrame } from '../src/terrain-pure/planetFrame.js'
import { createChartReanchorService } from '../src/chart-pure/chartReanchorService.js'
import { attachServerChartMigrators } from '../src/sdk/chartState/index.js'
import { PLANET_RADIUS_M } from '../src/packages/mapspinner/planet-radius.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const sphereDir = (degrees) => {
  const a = (degrees * Math.PI) / 180
  return [Math.sin(a), Math.cos(a), 0]
}

const buildServer = () => {
  const radius = PLANET_RADIUS_M
  const frame = createPlanetFrame({ sampler: { radius, heightAt: () => 0 } })
  const events = []
  const player = { id: 'p1', state: { position: [5, 0, 3], velocity: [1, 0, 0], rotation: [0, 0, 0, 1] }, lastInput: null, teleportHold: false }
  const players = new Map([[player.id, player]])
  const entity = { id: 'e1', position: [10, 2, 20], velocity: [1, 0, 0], rotation: [0, 0, 0, 1] }
  const entities = new Map([[entity.id, entity]])
  let aimDeg = 0
  const service = createChartReanchorService({ frame, radius, playerDirs: () => [sphereDir(aimDeg)] })
  const physics = {
    _planetFrame: frame,
    _dormant: null,
    guard: null,
    setChartFrameGuard(guard) { this.guard = guard },
    applyChartTransfer: () => ({ characters: 0, groundedUpwardClamped: 0 }),
    charIdOf: () => null,
    isGrounded: () => false,
  }
  const eventLog = []
  const ctx = {
    physics,
    physicsIntegration: { physicsWorld: { _charMgr: null }, playerBodies: new Map() },
    tickSystem: { tickDuration: 50, callbacks: [], stopped: 0, onTick(fn) { this.callbacks.push(fn) }, stop() { this.stopped++ } },
    playerManager: { players, getInputs: () => [] },
    networkState: { players: new Map() },
    lagCompensator: { playerHistory: new Map() },
    appRuntime: {
      entities,
      apps: new Map(),
      contexts: new Map(),
      _attachments: new Map(),
      _behaviours: new Map(),
      _physics: null,
      _stageLoader: null,
      _playerIndex: { insert() {} },
      _snapshotEncCache: new Map(),
      _staticXf: new Map(),
      _staticVersion: 0,
      _markDirty() {},
      _safeCall() {},
      _logAppError() {},
      getPlayers: () => [...players.values()],
      chartReanchorBlocks: new Map(),
      _pendingTrimeshBuilds: new Set(),
      _pendingTrimeshEntities: new Set(),
      _pendingSetupIds: new Set(),
      _resimSuppressed: false,
    },
    stageLoader: { allStages: () => [] },
    eventLog: { record(name, data) { eventLog.push({ name, data }) } },
    peerSession: null,
  }
  const handle = attachServerChartMigrators(ctx, service)

  const snapshot = () => ({
    chartEpoch: frame.chartEpoch,
    appliedEpoch: handle.appliedEpoch,
    ledgerEpoch: handle.ledger.currentEpoch,
    playerPosition: player.state.position,
    entityPosition: entity.position,
    chartEventCount: eventLog.filter((e) => e.name === 'chart_reanchor').length,
    refusals: service.refusalsByReason,
    tickStops: ctx.tickSystem.stopped,
  })

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const send = (status, body) => {
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && url.pathname === '/state') return send(200, snapshot())
    if (req.method === 'POST' && url.pathname === '/aim') {
      aimDeg = Number(url.searchParams.get('deg'))
      if (url.searchParams.get('teleport') === '1') player.teleportHold = true
      if (url.searchParams.get('teleport') === '0') player.teleportHold = false
      return send(200, { aimDeg, teleportHold: player.teleportHold })
    }
    if (req.method === 'POST' && url.pathname === '/step') {
      try {
        const event = service.step()
        return send(200, { reanchored: event !== null, epoch: event ? event.epoch : null, report: ctx.lastChartReanchor ?? null, state: snapshot() })
      } catch (error) {
        return send(500, { error: error.message })
      }
    }
    send(404, { error: 'not found' })
  })
  return { server, snapshot, frame, service, ctx, player, entity }
}

const live = buildServer()
await new Promise((resolve) => live.server.listen(0, '127.0.0.1', resolve))
const { port } = live.server.address()
const base = `http://127.0.0.1:${port}`
const call = async (method, path) => {
  const response = await fetch(base + path, { method })
  return { status: response.status, body: await response.json() }
}

const initial = await call('GET', '/state')
const stay = await call('POST', '/step')
const aimed = await call('POST', '/aim?deg=30')
const moved = await call('POST', '/step')
const afterMove = await call('GET', '/state')
await call('POST', '/aim?deg=75&teleport=1')
const refused = await call('POST', '/step')
await call('POST', '/aim?deg=0&teleport=0')
await new Promise((resolve) => live.server.close(resolve))

gate('the live server answers the state route over real HTTP with the attached handle at epoch 0', () => {
  assert(initial.status === 200, 'status ' + initial.status)
  assert(initial.body.chartEpoch === 0 && initial.body.appliedEpoch === 0 && initial.body.ledgerEpoch === 0, JSON.stringify(initial.body))
  assert(initial.body.tickStops === 0, 'the tick loop stopped at boot')
})

gate('a step with the player at the anchor is a stay: no epoch, no chart event, no entity change', () => {
  assert(stay.body.reanchored === false && stay.body.epoch === null, JSON.stringify(stay.body))
  assert(stay.body.state.chartEpoch === 0 && stay.body.state.chartEventCount === 0, JSON.stringify(stay.body.state))
})

gate('a player 30 degrees off the anchor triggers a re-anchor to epoch 1 through the live service', () => {
  assert(moved.status === 200, 'status ' + moved.status + ' ' + JSON.stringify(moved.body))
  assert(moved.body.reanchored === true && moved.body.epoch === 1, JSON.stringify(moved.body))
  assert(afterMove.body.chartEpoch === 1 && afterMove.body.appliedEpoch === 1, JSON.stringify(afterMove.body))
  assert(afterMove.body.ledgerEpoch === 1, 'ledger did not record epoch 1: ' + afterMove.body.ledgerEpoch)
})

gate('the re-anchor moves the entity and the player off their old chart-local positions', () => {
  assert(JSON.stringify(afterMove.body.entityPosition) !== JSON.stringify([10, 2, 20]), 'entity still at its base chart position: ' + JSON.stringify(afterMove.body.entityPosition))
  assert(JSON.stringify(afterMove.body.playerPosition) !== JSON.stringify([5, 0, 3]), 'player still at its base chart position: ' + JSON.stringify(afterMove.body.playerPosition))
})

gate('exactly one chart_reanchor event is logged for the epoch, carrying the migrator counts', () => {
  assert(afterMove.body.chartEventCount === 1, 'chart_reanchor events: ' + afterMove.body.chartEventCount)
  const report = moved.body.report
  assert(report && report.epoch === 1, 'report epoch ' + JSON.stringify(report))
  assert(report.players?.players === 1, 'player migrator counts ' + JSON.stringify(report.players))
  assert(report.entities !== undefined && report.worldAnchors !== undefined, 'a stage did not report')
  assert(Number.isFinite(report.tiltDeg) && report.tiltDeg > 0, 'tiltDeg ' + report.tiltDeg)
})

gate('a player under a teleport hold refuses the re-anchor with the spoint reason and changes no epoch', () => {
  assert(refused.body.reanchored === false && refused.body.epoch === null, JSON.stringify(refused.body))
  assert(refused.body.state.chartEpoch === 1, 'epoch moved while refused: ' + refused.body.state.chartEpoch)
  assert(refused.body.state.refusals['teleport-hold-active:p1'] === 1, 'refusal tally ' + JSON.stringify(refused.body.state.refusals))
})

gate('the live run never stopped the tick loop, so no fault was recorded', () => {
  assert(afterMove.body.tickStops === 0 && refused.body.state.tickStops === 0, 'tick loop stopped')
  assert(live.ctx.chartReanchorFault === undefined, 'a fault was recorded')
})

finish()
