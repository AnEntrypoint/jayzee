import { defineGameFSM } from '../behaviours/game-fsm.js'

export const CONTROLLER_DEFAULTS = Object.freeze({
  idleClip: 'Idle',
  walkClip: 'WalkLoop',
  runClip: 'RunLoop',
  sprintClip: 'SprintLoop',
  jumpClip: 'JumpStart',
  fallClip: 'Fall',
  landClip: 'Land',
  attackClip: 'Attack',
  dieClip: 'Die',
  walkSpeed: 1.5,
  runSpeed: 5,
  sprintSpeed: 10,
  jumpForce: 10,
  fallThreshold: -2,
})

const BLENDER_METHODS = ['playClip', 'updateBlend', 'getClipDuration', 'stop']

const SET_STATE_EVENTS = Object.freeze({
  idle: 'IDLE',
  walk: 'WALK',
  run: 'RUN',
  sprint: 'SPRINT',
  jump: 'JUMP',
  attack: 'ATTACK',
  die: 'DIE',
})

const requireBlender = (blender) => {
  if (!blender || typeof blender !== 'object') throw new Error('[AnimationController] a blender object is required')
  for (const method of BLENDER_METHODS) {
    if (typeof blender[method] !== 'function') throw new Error('[AnimationController] blender.' + method + ' must be a function')
  }
  return blender
}

const requireClock = (now) => {
  if (typeof now !== 'function') throw new Error('[AnimationController] a now() clock in milliseconds is required')
  return now
}

const settleCandidates = (config) => [
  { target: 'idle', guard: (appCtx, fsm) => fsm.context.speed < 0.5 },
  { target: 'walk', guard: (appCtx, fsm) => fsm.context.speed >= 0.5 && fsm.context.speed <= config.runSpeed },
  { target: 'run', guard: (appCtx, fsm) => fsm.context.speed > config.runSpeed },
]

const buildSpec = (blender, config) => ({
  id: 'animation-controller',
  initial: 'idle',
  context: {
    speed: 0,
    direction: new Float32Array([0, 0, 1]),
    isGrounded: true,
    verticalVelocity: 0,
    blendParameter: 0,
    moveBlendX: 0,
    moveBlendY: 0,
  },
  states: {
    idle: {
      enter() { blender.playClip(config.idleClip, 0.3) },
      tick(appCtx, dt, fsm) {
        const speed = fsm.context.speed
        if (speed > config.runSpeed) fsm.send('RUN')
        else if (speed > config.walkSpeed) fsm.send('WALK')
        if (!fsm.context.isGrounded) fsm.send('JUMP')
      },
      on: { WALK: 'walk', RUN: 'run', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' },
    },
    walk: {
      enter() { blender.playClip(config.walkClip, 0.3) },
      tick(appCtx, dt, fsm) {
        const speed = fsm.context.speed
        if (speed < 0.1) fsm.send('IDLE')
        else if (speed > config.runSpeed) fsm.send('RUN')
        if (!fsm.context.isGrounded) fsm.send('JUMP')
      },
      on: { IDLE: 'idle', RUN: 'run', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' },
    },
    run: {
      enter() { blender.playClip(config.runClip, 0.3) },
      tick(appCtx, dt, fsm) {
        const speed = fsm.context.speed
        if (speed < config.walkSpeed) fsm.send('IDLE')
        else if (speed < config.runSpeed) fsm.send('WALK')
        else if (speed > config.sprintSpeed) fsm.send('SPRINT')
        if (!fsm.context.isGrounded) fsm.send('JUMP')
      },
      on: { IDLE: 'idle', WALK: 'walk', SPRINT: 'sprint', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' },
    },
    sprint: {
      enter() { blender.playClip(config.sprintClip, 0.2) },
      tick(appCtx, dt, fsm) {
        if (fsm.context.speed < config.runSpeed) fsm.send('RUN')
        if (!fsm.context.isGrounded) fsm.send('JUMP')
      },
      on: { RUN: 'run', IDLE: 'idle', JUMP: 'jump', ATTACK: 'attack', DIE: 'die' },
    },
    jump: {
      enter() { blender.playClip(config.jumpClip, 0.1) },
      tick(appCtx, dt, fsm) {
        if (fsm.context.isGrounded && fsm.context.verticalVelocity <= 0) fsm.send('LAND')
      },
      on: { LAND: 'land', DIE: 'die' },
    },
    land: {
      enter() { blender.playClip(config.landClip, 0.15) },
      after: { 500: settleCandidates(config) },
      on: { IDLE: 'idle', WALK: 'walk', RUN: 'run', DIE: 'die' },
    },
    attack: {
      enter() { blender.playClip(config.attackClip, 0.1) },
      tick(appCtx, dt, fsm) {
        const clipDurationMs = blender.getClipDuration(config.attackClip) * 1000
        if (fsm.timeInState > clipDurationMs) fsm.send('ATTACK_END')
      },
      on: { ATTACK_END: settleCandidates(config), DIE: 'die' },
    },
    die: {
      enter() { blender.playClip(config.dieClip, 0.3) },
      type: 'final',
    },
  },
})

export function createAnimationController(blender, options = {}, clock = {}) {
  requireBlender(blender)
  const now = requireClock(clock.now)
  const config = { ...CONTROLLER_DEFAULTS, ...options }
  const fsm = defineGameFSM(buildSpec(blender, config), {}, { now })

  const controller = {
    fsm,
    blender,
    config,

    update(dt, motionState = {}) {
      const { speed = 0, direction = [0, 0, 1], isGrounded = true, verticalVelocity = 0 } = motionState
      fsm.context.speed = speed
      if (Array.isArray(direction)) {
        fsm.context.direction[0] = direction[0]
        fsm.context.direction[1] = direction[1]
        fsm.context.direction[2] = direction[2]
      }
      fsm.context.isGrounded = isGrounded
      fsm.context.verticalVelocity = verticalVelocity
      fsm.tick(dt)
      blender.updateBlend(dt)
    },

    setState(state) {
      if (Object.hasOwn(SET_STATE_EVENTS, state)) fsm.send(SET_STATE_EVENTS[state])
      return controller
    },

    getState() {
      return fsm.state
    },

    onStateChange(callback) {
      return fsm.onTransition((state) => {
        callback(state)
      })
    },

    dispose() {
      fsm.stop()
      blender.stop()
    },
  }
  return controller
}

export default createAnimationController
