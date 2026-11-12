import { checksumBodies, createChecksumFold } from '../anticheat/LockstepChecksum.js'
import { createCorrectionObserver } from '../rollback-pure/correctionObserver.js'
import { STATS_POST_INTERVAL_MS, startStatsPost } from '../rollback-pure/peerSimRuntime.js'
import { playerDefault } from '../player-defaults-pure/playerDefaults.js'
import { resolveNetcodeProfile } from './netcodeProfile.js'
import { PEER_LOOP_FACTORIES, PEER_SIMULATED_PROFILES } from './peerLoops.js'

const DEFAULT_SPAWN_POINT = Object.freeze([0, 5, 0])

function spawnFor(ctx, index) {
  const pts = ctx.worldSpawnPoints || [ctx.worldSpawnPoint || [...DEFAULT_SPAWN_POINT]]
  return [...pts[index % pts.length]]
}

export function createPeerSimSession(ctx, { roster, localPubkey, bridge, tickSystem, now }) {
  const profile = resolveNetcodeProfile(ctx.currentWorldDef)
  if (!PEER_SIMULATED_PROFILES.has(profile.name)) throw new Error(`[PeerSimSession] world netcode profile '${profile.name}' is not peer-simulated`)
  if (!Array.isArray(roster) || !roster.includes(localPubkey)) throw new Error('[PeerSimSession] roster must be an array of peer pubkeys including localPubkey')
  const { playerManager, networkState, physicsIntegration, physics, lagCompensator, connections } = ctx
  const sorted = [...roster].sort()
  const playerIdByPeer = new Map()
  const playerConfig = ctx.currentWorldDef?.player || {}
  sorted.forEach((pk, i) => {
    const sp = spawnFor(ctx, i)
    const id = playerManager.addPlayer(null, { position: sp, health: playerConfig.health })
    networkState.addPlayer(id, { position: sp })
    physicsIntegration.addPlayerCollider(id, playerDefault(playerConfig, 'capsuleRadius'))
    physicsIntegration.setPlayerPosition(id, sp)
    const st = playerManager.getPlayer(id).state
    lagCompensator.recordPlayerPosition(id, st.position, st.rotation, st.velocity, 0)
    playerIdByPeer.set(pk, id)
  })
  const localPlayerId = playerIdByPeer.get(localPubkey)
  let lastLocalInput = null

  function getLocalInput() {
    const q = playerManager.getInputs(localPlayerId)
    if (q.length) { lastLocalInput = q[q.length - 1].data; q.length = 0 }
    return lastLocalInput ? { ...lastLocalInput } : null
  }

  function toPlayerInputs(inputsByPeer) {
    const m = new Map()
    for (const [pk, inp] of inputsByPeer) m.set(playerIdByPeer.get(pk), inp)
    return m
  }

  function simulate(tick, dt, inputsByPeer, resim) {
    ctx.handlerState.fn(tick, dt, toPlayerInputs(inputsByPeer))
    if (!resim) connections.flushAll()
  }

  function capture() {
    return { bodies: physics.snapshotBodies(), players: playerManager.snapshotState() }
  }

  function apply(snap) {
    physics.restoreBodies(snap.bodies)
    playerManager.restoreState(snap.players)
  }

  function connectedPlayers() {
    const out = []
    for (const id of playerIdByPeer.values()) {
      const p = playerManager.getPlayer(id)
      if (p) out.push({ id, position: p.state.position })
    }
    return out
  }

  const observeRollback = createCorrectionObserver({ connected: connectedPlayers, localPlayerId })

  function checksumOf(tick, snap) {
    const fold = createChecksumFold().pushInt(tick)
    fold.pushInt(parseInt(checksumBodies(tick, snap.bodies).slice(0, 8), 16))
    const ids = [...snap.players.keys()].sort((a, b) => a - b)
    for (const id of ids) {
      const s = snap.players.get(id).state
      fold.pushInt(id)
      for (const v of s.position) fold.push(v)
      for (const v of s.velocity) fold.push(v)
    }
    return fold.digest()
  }

  function liveChecksum(tick) {
    const core = checksumOf(tick, { bodies: physics.snapshotBodies(), players: playerManager.snapshotState() })
    const fold = createChecksumFold().pushInt(parseInt(core.slice(0, 8), 16)).pushInt(parseInt(core.slice(8), 16))
    const ids = [...ctx.appRuntime.entities.keys()].sort()
    for (const id of ids) {
      const e = ctx.appRuntime.entities.get(id)
      for (const v of e.position) fold.push(v)
    }
    return fold.digest()
  }

  const { loop, transport, voter } = PEER_LOOP_FACTORIES[profile.name]({ bridge, tickSystem, roster: sorted, localPeerId: localPubkey, simulate, getLocalInput, liveChecksum, checksumOf, observeRollback, capture, apply, options: profile.options, now })

  let stopStats = null

  function getStats() {
    return { profile: profile.name, options: profile.options, localPlayerId, loop: loop.getStats(), transport: transport.getStats(), ...(voter ? {} : { corrections: observeRollback.snapshot() }) }
  }

  function haltStats() {
    if (!stopStats) return false
    stopStats()
    stopStats = null
    return true
  }

  return {
    profile,
    loop,
    localPlayerId,
    playerIdByPeer,
    bridge,
    claimLocalPlayer(socket) {
      const p = playerManager.getPlayer(localPlayerId)
      if (p) p.socket = socket
      return localPlayerId
    },
    start() {
      loop.start()
    },
    startStats({ post, schedule, cancel, every = STATS_POST_INTERVAL_MS } = {}) {
      if (typeof post !== 'function' || typeof schedule !== 'function' || typeof cancel !== 'function') throw new Error('[PeerSimSession] startStats needs post, schedule and cancel')
      if (!Number.isFinite(every) || every <= 0) throw new Error('[PeerSimSession] startStats interval must be a positive number of milliseconds')
      if (stopStats) throw new Error('[PeerSimSession] stats interval is already running')
      stopStats = startStatsPost({ getStats, post, schedule, cancel, every })
      return haltStats
    },
    get statsRunning() { return stopStats !== null },
    stop() {
      haltStats()
      loop.stop()
      transport.destroy()
      if (voter) voter.destroy()
    },
    getStats,
  }
}
