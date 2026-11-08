import { parseDefineSpec } from './specBoundary.js'
import { defineGameFSM } from './game-fsm.js'

const SCORING_MODES = ['teams', 'players', 'none']
const PHASE_KEYS = ['lobby', 'warmup', 'rounds', 'roundEnd', 'end']
const MESSAGE_KEYS = ['lobby', 'warmup', 'countdown', 'roundStart', 'roundEnd', 'end']

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const isWholeMs = (v) => Number.isInteger(v) && v >= 0
const hook = { type: 'function', nullable: true, default: null }

const GAMEMODE_SCHEMA = Object.freeze({
  id: { type: 'string', nonEmpty: true, default: 'game-mode' },
  channel: { type: 'string', nonEmpty: true, default: 'match' },
  minPlayers: { type: 'number', min: 0, default: 2 },
  countdownMs: { type: 'custom', default: 5000, check: isWholeMs },
  roundMs: { type: 'custom', default: 60000, check: isWholeMs },
  intermissionMs: { type: 'custom', default: 4000, check: isWholeMs },
  roundsPerMatch: { type: 'custom', default: 3, check: (v) => Number.isInteger(v) && v >= 1 },
  winCondition: { type: 'function', nullable: true, default: null },
  scoring: { type: 'custom', nullable: true, default: null, check: (v) => SCORING_MODES.includes(v) },
  teams: { type: 'custom', nullable: true, default: null, check: isPlainObject },
  phaseNames: { type: 'custom', nullable: true, default: null, check: isPlainObject },
  messages: { type: 'custom', nullable: true, default: null, check: isPlainObject },
  onLobbyEnter: hook,
  onLobbyTick: hook,
  onWarmupEnter: hook,
  onWarmupTick: hook,
  onRoundStart: hook,
  onRoundTick: hook,
  onRoundEnd: hook,
  onEnd: hook,
})

function resolvePhaseNames(phaseNames) {
  for (const key of Object.keys(phaseNames)) {
    if (!PHASE_KEYS.includes(key)) throw new TypeError(`[gamemode] phaseNames has unknown key "${key}"`)
    if (typeof phaseNames[key] !== 'string' || phaseNames[key].length === 0) throw new TypeError(`[gamemode] phaseNames.${key} must be a non-empty string`)
  }
  const N = {
    lobby: phaseNames.lobby ?? 'lobby',
    warmup: phaseNames.warmup ?? 'warmup',
    rounds: phaseNames.rounds ?? 'rounds',
    roundEnd: phaseNames.roundEnd ?? 'roundEnd',
    end: phaseNames.end ?? 'end',
  }
  if (new Set(Object.values(N)).size !== PHASE_KEYS.length) throw new TypeError('[gamemode] phaseNames must resolve to 5 distinct state names')
  return N
}

function resolveMessages(messages) {
  for (const key of Object.keys(messages)) {
    if (!MESSAGE_KEYS.includes(key)) throw new TypeError(`[gamemode] messages has unknown key "${key}"`)
    if (typeof messages[key] !== 'function') throw new TypeError(`[gamemode] messages.${key} must be a function`)
  }
  return messages
}

export function defineGameMode(spec = {}, host = null, { now, defineTeams = null } = {}) {
  if (!host || typeof host.countPlayers !== 'function') throw new TypeError('[gamemode] a host accessor object with countPlayers is required')
  const context = host.context
  if (typeof now !== 'function') throw new TypeError('[gamemode] now must be a function: the phase timers read the clock through it')
  const config = parseDefineSpec('defineGameMode', spec, GAMEMODE_SCHEMA)
  if (config.scoring === 'teams' && !config.teams) throw new TypeError('[gamemode] scoring "teams" requires spec.teams')
  if (config.teams && typeof defineTeams !== 'function') throw new TypeError('[gamemode] spec.teams needs a defineTeams function')

  const N = resolvePhaseNames(config.phaseNames || {})
  const M = resolveMessages(config.messages || {})
  const channel = config.channel
  const winCondition = config.winCondition ?? ((ctx, runtime) => runtime.context.round >= config.roundsPerMatch)
  const teams = config.teams ? defineTeams(config.teams, context) : null
  const scoringMode = config.scoring ?? (teams ? 'teams' : 'players')
  const playerScores = new Map()

  const getScores = () => {
    if (scoringMode === 'teams') return teams.getScores()
    if (scoringMode === 'none') return []
    return [...playerScores.entries()].map(([id, score]) => ({ id, score }))
  }

  const broadcast = (ctx, runtime, builder, fallback, ...extra) => {
    const msg = (builder ?? fallback)(ctx, runtime, ...extra)
    if (msg) ctx.network?.broadcast?.(msg)
  }
  const callHook = (fn, ctx, runtime) => { if (fn) fn(ctx, runtime) }
  const callTick = (fn, ctx, dt, runtime) => { if (fn) fn(ctx, dt, runtime) }

  const lobbyMessage = () => ({ type: `${channel}_phase`, phase: N.lobby })
  const warmupMessage = () => ({ type: `${channel}_phase`, phase: N.warmup, ms: config.countdownMs })
  const countdownMessage = (ctx, runtime, seconds) => ({ type: 'countdown', seconds })
  const roundStartMessage = (ctx, runtime) => ({ type: `${channel}_round_start`, round: runtime.context.round })
  const roundEndMessage = (ctx, runtime) => ({ type: `${channel}_round_end`, round: runtime.context.round })
  const endMessage = (ctx, runtime, scores) => ({ type: `${channel}_over`, rounds: runtime.context.round, scores })

  const gamemode = defineGameFSM({
    id: config.id,
    initial: N.lobby,
    context: { round: 0 },
    states: {
      [N.lobby]: {
        enter: (ctx, runtime) => {
          broadcast(ctx, runtime, M.lobby, lobbyMessage)
          callHook(config.onLobbyEnter, ctx, runtime)
        },
        tick: (ctx, dt, runtime) => callTick(config.onLobbyTick, ctx, dt, runtime),
        on: {
          START: { target: N.warmup, guard: () => host.countPlayers() >= config.minPlayers },
        },
      },
      [N.warmup]: {
        enter: (ctx, runtime) => {
          runtime.context.lastSecond = -1
          broadcast(ctx, runtime, M.warmup, warmupMessage)
          callHook(config.onWarmupEnter, ctx, runtime)
        },
        tick: (ctx, dt, runtime) => {
          const remain = Math.ceil((config.countdownMs - runtime.timeInState) / 1000)
          if (remain !== runtime.context.lastSecond) {
            runtime.context.lastSecond = remain
            broadcast(ctx, runtime, M.countdown, countdownMessage, Math.max(0, remain))
          }
          callTick(config.onWarmupTick, ctx, dt, runtime)
        },
        after: { [config.countdownMs]: N.rounds },
      },
      [N.rounds]: {
        enter: (ctx, runtime) => {
          runtime.context.round++
          broadcast(ctx, runtime, M.roundStart, roundStartMessage)
          callHook(config.onRoundStart, ctx, runtime)
        },
        tick: (ctx, dt, runtime) => callTick(config.onRoundTick, ctx, dt, runtime),
        on: { ROUND_OVER: N.roundEnd },
        after: { [config.roundMs]: N.roundEnd },
      },
      [N.roundEnd]: {
        enter: (ctx, runtime) => {
          broadcast(ctx, runtime, M.roundEnd, roundEndMessage)
          callHook(config.onRoundEnd, ctx, runtime)
        },
        after: {
          [config.intermissionMs]: [
            { target: N.end, guard: (ctx, runtime) => winCondition(ctx, runtime) },
            { target: N.rounds },
          ],
        },
      },
      [N.end]: {
        final: true,
        enter: (ctx, runtime) => {
          broadcast(ctx, runtime, M.end, endMessage, getScores())
          callHook(config.onEnd, ctx, runtime)
        },
      },
    },
  }, context, { now })

  const addScore = (id, delta = 1) => {
    if (scoringMode === 'none') return 0
    if (scoringMode === 'teams') return teams.addScore(id, delta)
    if (!Number.isFinite(delta)) throw new TypeError('[gamemode] addScore delta must be a finite number')
    const key = String(id)
    const next = (playerScores.get(key) || 0) + delta
    playerScores.set(key, next)
    return next
  }
  const getScore = (id) => {
    if (scoringMode === 'teams') return teams.getScore(id)
    if (scoringMode === 'none') return 0
    return playerScores.get(String(id)) ?? 0
  }

  gamemode.teams = teams
  gamemode.addScore = addScore
  gamemode.getScore = getScore
  gamemode.getScores = getScores
  Object.defineProperty(gamemode, 'round', { get: () => gamemode.context.round })
  return gamemode
}

export default defineGameMode
