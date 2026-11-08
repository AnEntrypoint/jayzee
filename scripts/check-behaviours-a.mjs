import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { validateQuestions, normalizeAnswers, sampleAnswer, createDecisionPipe } from '../src/behaviours/decisionPipe.js'
import { createDecisionRuntime } from '../src/behaviours/decisionRuntime.js'
import { defineBuoyancy } from '../src/behaviours/buoyancy.js'
import { defineCheckpoint } from '../src/behaviours/checkpoint.js'
import { defineGameMode } from '../src/behaviours/gamemode.js'

const thrown = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}

const refusedWith = (fn, code) => {
  const error = thrown(fn)
  assert.ok(error, 'expected a refusal')
  assert.equal(error.reasonCode ?? error.code, code)
}

const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: got ${actual}, expected ${expected}`)
}

const cases = {}
const probed = []

const probe = async (label, fn) => {
  probed.push(label)
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}

const check = (label) => gate(label, () => {
  if (!(label in cases)) throw new Error('no probe recorded ' + label)
  if (cases[label]) throw cases[label]
})

gate('validateQuestions refuses an empty set, an unknown type, and a choice or score without criteria', () => {
  refusedWith(() => validateQuestions({}), 'no-questions')
  refusedWith(() => validateQuestions(null), 'no-questions')
  refusedWith(() => validateQuestions([]), 'no-questions')
  refusedWith(() => validateQuestions({ a: { type: 'dice' } }), 'bad-type')
  refusedWith(() => validateQuestions({ a: { type: 'choice' } }), 'no-criteria')
  refusedWith(() => validateQuestions({ a: { type: 'choice', criteria: {} } }), 'no-criteria')
  refusedWith(() => validateQuestions({ a: { type: 'score', criteria: [] } }), 'no-criteria')
  refusedWith(() => validateQuestions({ a: { type: 'score', criteria: 'low' } }), 'no-criteria')
  const valid = { a: { type: 'boolean' }, b: { type: 'choice', criteria: { x: 'x' } }, c: { type: 'score', criteria: ['lo', 'hi'] } }
  assert.equal(validateQuestions(valid), valid)
})

gate('normalizeAnswers refuses a boolean outside [0,1], a non-object answer set, and a non-object answer', () => {
  const questions = { alive: { type: 'boolean' } }
  refusedWith(() => normalizeAnswers({ alive: { probability: 1.5 } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ alive: { probability: -0.1 } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ alive: { probability: NaN } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ alive: 0.5 }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers([], questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers(null, questions), 'malformed-answer')
  assert.deepEqual(normalizeAnswers({ alive: { probability: 0 } }, questions), { alive: { probability: 0 } })
  assert.deepEqual(normalizeAnswers({ alive: { probability: 1 } }, questions), { alive: { probability: 1 } })
})

gate('normalizeAnswers keeps the question option order and refuses NaN, infinite, negative, missing or zero weights', () => {
  const questions = { mood: { type: 'choice', criteria: { calm: 'c', angry: 'a' } } }
  assert.deepEqual(
    normalizeAnswers({ mood: { probabilities: { calm: 1, angry: 3 } } }, questions),
    { mood: { options: ['calm', 'angry'], probabilities: { calm: 1, angry: 3 } } },
  )
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: -1, angry: 1 } } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: NaN, angry: 1 } } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: Infinity, angry: 1 } } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: 1 } } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: 0, angry: 0 } } }, questions), 'malformed-answer')
  refusedWith(() => normalizeAnswers({ mood: { probabilities: { calm: 0, angry: 0, extra: 5 } } }, questions), 'malformed-answer')
})

gate('normalizeAnswers reads a score question in the order of its criteria steps', () => {
  const questions = { danger: { type: 'score', criteria: ['low', 'mid', 'high'] } }
  assert.deepEqual(
    normalizeAnswers({ danger: { probabilities: { low: 0, mid: 1, high: 1 } } }, questions),
    { danger: { options: ['low', 'mid', 'high'], probabilities: { low: 0, mid: 1, high: 1 } } },
  )
  refusedWith(() => normalizeAnswers({ danger: { probabilities: { low: 1, mid: 1 } } }, questions), 'malformed-answer')
})

gate('sampleAnswer maps a roll onto a boolean probability and onto weighted options, the last option taking the top roll', () => {
  assert.equal(sampleAnswer({ probability: 0.3 }, 0.29), true)
  assert.equal(sampleAnswer({ probability: 0.3 }, 0.3), false)
  const mood = { options: ['a', 'b'], probabilities: { a: 1, b: 3 } }
  assert.equal(sampleAnswer(mood, 0.2), 'a')
  assert.equal(sampleAnswer(mood, 0.25), 'b')
  assert.equal(sampleAnswer(mood, 0.9), 'b')
  assert.equal(sampleAnswer(mood, 0.999), 'b')
  assert.equal(sampleAnswer(mood, 1), 'b')
})

gate('createDecisionPipe refuses a missing ask or random before any question is asked', () => {
  refusedWith(() => createDecisionPipe({ random: () => 0 }), 'no-backend')
  refusedWith(() => createDecisionPipe({ ask: async () => ({}) }), 'no-random')
})

await probe('decide samples the answers and draws one roll per question in question order', async () => {
  const draws = []
  let seen = null
  const random = () => {
    const roll = [0.4, 0.9][draws.length]
    draws.push(roll)
    return roll
  }
  const decide = createDecisionPipe({
    ask: async (input) => {
      seen = input
      return { alive: { probability: 0.5 }, mood: { probabilities: { calm: 1, angry: 1 } } }
    },
    random,
  })
  const questions = { alive: { type: 'boolean' }, mood: { type: 'choice', criteria: { calm: 'c', angry: 'a' } } }
  const result = await decide({ state: { hp: 3 }, questions })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.answers, { alive: true, mood: 'angry' })
  assert.deepEqual(draws, [0.4, 0.9])
  assert.deepEqual(seen.state, { hp: 3 })
  assert.equal(seen.questions, questions)
})

await probe('decide reports an ask failure and a malformed answer as results and draws no roll', async () => {
  let draws = 0
  const random = () => { draws++; return 0 }
  const questions = { alive: { type: 'boolean' } }
  const failing = createDecisionPipe({ ask: async () => { throw new Error('backend down') }, random })
  assert.deepEqual(await failing({ state: null, questions }), { ok: false, error: { code: 'ask-failed', message: 'backend down' } })
  const malformed = createDecisionPipe({ ask: async () => ({ alive: { probability: 2 } }), random })
  const result = await malformed({ state: null, questions })
  assert.equal(result.ok, false)
  assert.equal(result.error.code, 'malformed-answer')
  assert.equal(draws, 0)
})

await probe('decide rejects a roll outside [0,1) with bad-roll', async () => {
  const questions = { alive: { type: 'boolean' } }
  const ask = async () => ({ alive: { probability: 0.5 } })
  for (const roll of [1, 1.5, -0.1, NaN]) {
    const decide = createDecisionPipe({ ask, random: () => roll })
    const error = await decide({ state: null, questions }).then(() => null, (e) => e)
    assert.ok(error, `roll ${roll} was accepted`)
    assert.equal(error.code, 'bad-roll')
  }
})

gate('createDecisionRuntime refuses bad hooks, period and entity cap', () => {
  const ask = async () => ({})
  const random = () => 0
  const now = () => 0
  refusedWith(() => createDecisionRuntime({ ask, random, now: 'later' }), 'runtime-hooks-invalid')
  refusedWith(() => createDecisionRuntime({ ask, random, now, periodMs: 0 }), 'runtime-period-invalid')
  refusedWith(() => createDecisionRuntime({ ask, random, now, periodMs: NaN }), 'runtime-period-invalid')
  refusedWith(() => createDecisionRuntime({ ask, random, now, maxEntities: 0 }), 'runtime-cap-invalid')
  refusedWith(() => createDecisionRuntime({ ask, random, now, maxEntities: 1.5 }), 'runtime-cap-invalid')
})

gate('createDecisionRuntime refuses a bad entity, questions, callback, duplicate, cap, unknown unregister and a bad clock', () => {
  const ask = async () => ({})
  const random = () => 0
  const questions = { q: { type: 'boolean' } }
  const rt = createDecisionRuntime({ ask, random, now: () => 0, maxEntities: 1 })
  refusedWith(() => rt.register('', { questions }), 'runtime-entity-invalid')
  refusedWith(() => rt.register(7, { questions }), 'runtime-entity-invalid')
  refusedWith(() => rt.register('a'), 'runtime-questions-invalid')
  assert.equal(thrown(() => rt.register('a', { questions: {} })).code, 'no-questions')
  assert.equal(thrown(() => rt.register('a', { questions: { q: { type: 'dice' } } })).code, 'bad-type')
  refusedWith(() => rt.register('a', { questions, onDecision: 'log' }), 'runtime-callback-invalid')
  rt.register('a', { questions })
  refusedWith(() => rt.register('a', { questions }), 'runtime-duplicate')
  refusedWith(() => rt.register('b', { questions }), 'runtime-cap-reached')
  refusedWith(() => rt.unregister('zz'), 'runtime-unknown-entity')
  assert.equal(rt.size(), 1)
  assert.deepEqual(rt.unregister('a'), { ok: true, entityId: 'a' })
  assert.equal(rt.size(), 0)
  const badClock = createDecisionRuntime({ ask, random, now: () => NaN })
  refusedWith(() => badClock.register('a', { questions }), 'runtime-clock-invalid')
})

await probe('decision runtime decides each entity once per period and skips a tick with no players', async () => {
  let t = 0
  let players = true
  const asked = []
  const ask = async ({ questions }) => {
    asked.push(Object.keys(questions))
    return { q: { probability: 1 } }
  }
  const heard = []
  const rt = createDecisionRuntime({ ask, random: () => 0, now: () => t, hasPlayers: () => players, periodMs: 1000 })
  rt.register('npc', { questions: { q: { type: 'boolean' } }, onDecision: (d) => heard.push(d) })
  let r = await rt.tick()
  assert.equal(r.ran, 1)
  assert.equal(r.skipped, null)
  assert.deepEqual(r.decisions, [{ entityId: 'npc', at: 0, ok: true, data: { answers: { q: true }, probabilities: { q: { probability: 1 } } } }])
  t = 999
  r = await rt.tick()
  assert.equal(r.ran, 0)
  t = 1000
  r = await rt.tick()
  assert.equal(r.ran, 1)
  players = false
  t = 2000
  r = await rt.tick()
  assert.deepEqual(r, { ran: 0, skipped: 'no-players', decisions: [] })
  players = true
  r = await rt.tick()
  assert.equal(r.ran, 1)
  assert.equal(asked.length, 3)
  assert.deepEqual(asked[0], ['q'])
  assert.equal(heard.length, 3)
  assert.equal(heard[2].at, 2000)
})

await probe('decision runtime records an ask failure and a refused roll as decision errors', async () => {
  const questions = { q: { type: 'boolean' } }
  const down = createDecisionRuntime({
    ask: async () => { throw new Error('offline') },
    random: () => 0,
    now: () => 0,
  })
  down.register('a', { questions })
  const first = await down.tick()
  assert.deepEqual(first.decisions[0], { entityId: 'a', at: 0, ok: false, error: { code: 'ask-failed', message: 'offline' } })
  const rolling = createDecisionRuntime({
    ask: async () => ({ q: { probability: 0.5 } }),
    random: () => 3,
    now: () => 0,
  })
  rolling.register('b', { questions })
  const second = await rolling.tick()
  assert.equal(second.decisions[0].ok, false)
  assert.equal(second.decisions[0].error.code, 'bad-roll')
})

const floater = ({ y = 0, mass = 2, gravity = [0, -10, 0], noWorldGravity = false, seaLevel = 0, velocity = [1, 2, 3] } = {}) => {
  const forces = []
  const sets = []
  let vel = velocity
  const appCtx = {
    seaLevel,
    entity: { position: [0, y, 0], custom: { mass } },
    world: noWorldGravity ? {} : { gravity },
    physics: {
      addForce: (f) => forces.push(f),
      getVelocity: () => vel,
      setVelocity: (v) => {
        sets.push(v)
        vel = v
      },
    },
  }
  return { appCtx, forces, sets }
}

const buoyancyBody = (appCtx) => ({
  seaLevel: () => appCtx.seaLevel,
  bodyY: () => appCtx.entity.position[1],
  gravityY: () => (appCtx.world.gravity ? appCtx.world.gravity[1] : null),
  mass: () => appCtx.entity.custom?.mass,
  addForce: (f) => appCtx.physics.addForce(f),
  getVelocity: () => appCtx.physics.getVelocity(),
  setVelocity: (v) => appCtx.physics.setVelocity(v),
})

gate('defineBuoyancy floats a half-submerged body with the spoint force and drag, computed from the spoint formula', () => {
  const { appCtx, forces, sets } = floater({ y: 0 })
  const buoy = defineBuoyancy({}, buoyancyBody(appCtx))
  buoy.tick(0.1)
  assert.equal(buoy.submersionFrac, 0.5)
  assert.equal(buoy.submerged, true)
  assert.equal(forces.length, 1)
  near(forces[0][0], 0, 'force x')
  near(forces[0][1], 1.2, 'upward force')
  near(forces[0][2], 0, 'force z')
  assert.equal(sets.length, 1)
  near(sets[0][0], 0.9, 'drag x')
  near(sets[0][1], 1.8, 'drag y')
  near(sets[0][2], 2.7, 'drag z')
})

gate('defineBuoyancy clamps a fully submerged body to fraction 1 and leaves a body above the waterline unforced', () => {
  const deep = floater({ y: -1 })
  const buoyDeep = defineBuoyancy({}, buoyancyBody(deep.appCtx))
  buoyDeep.tick(0.1)
  assert.equal(buoyDeep.submersionFrac, 1)
  near(deep.forces[0][1], 2.4, 'deep upward force')
  near(deep.sets[0][1], 1.6, 'deep drag y')
  const dry = floater({ y: 1 })
  const buoyDry = defineBuoyancy({}, buoyancyBody(dry.appCtx))
  buoyDry.tick(0.1)
  assert.equal(buoyDry.submersionFrac, 0)
  assert.equal(buoyDry.submerged, false)
  assert.equal(dry.forces.length, 0)
  assert.equal(dry.sets.length, 0)
})

gate('defineBuoyancy does nothing with dt of zero, with no sea level, and it uses buoyantForce and skips drag when given', () => {
  const zero = floater({ y: -1 })
  const buoyZero = defineBuoyancy({}, buoyancyBody(zero.appCtx))
  buoyZero.tick(0)
  assert.equal(buoyZero.submersionFrac, 0)
  assert.equal(zero.forces.length + zero.sets.length, 0)
  const noSea = floater({ y: 0, seaLevel: null })
  const buoyNoSea = defineBuoyancy({}, buoyancyBody(noSea.appCtx))
  buoyNoSea.tick(0.1)
  assert.equal(buoyNoSea.submersionFrac, 0)
  assert.equal(noSea.forces.length + noSea.sets.length, 0)
  const explicit = floater({ y: 0 })
  defineBuoyancy({ buoyantForce: 50 }, buoyancyBody(explicit.appCtx)).tick(0.1)
  near(explicit.forces[0][1], 2.5, 'explicit force')
  const noDrag = floater({ y: 0 })
  defineBuoyancy({ linearDrag: 0 }, buoyancyBody(noDrag.appCtx)).tick(0.1)
  assert.equal(noDrag.forces.length, 1)
  assert.equal(noDrag.sets.length, 0)
})

gate('defineBuoyancy applies no force in zero gravity and uses 9.81 only when the world has no gravity', () => {
  const zeroG = floater({ y: 0, gravity: [0, 0, 0] })
  defineBuoyancy({}, buoyancyBody(zeroG.appCtx)).tick(0.1)
  assert.equal(zeroG.forces.length, 0)
  assert.equal(zeroG.sets.length, 1)
  near(zeroG.sets[0][1], 1.8, 'zero gravity drag still applies')
  const noWorld = floater({ y: 0, noWorldGravity: true })
  defineBuoyancy({}, buoyancyBody(noWorld.appCtx)).tick(0.1)
  near(noWorld.forces[0][1], 1.1772, 'default gravity force')
})

gate('defineBuoyancy refuses a bad halfHeight, drag, force, unknown key and a missing appCtx', () => {
  const { appCtx } = floater()
  refusedWith(() => defineBuoyancy({ halfHeight: 0 }, buoyancyBody(appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineBuoyancy({ linearDrag: -1 }, buoyancyBody(appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineBuoyancy({ buoyantForce: 'big' }, buoyancyBody(appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineBuoyancy({ gravity: 9 }, buoyancyBody(appCtx)), 'define-spec-unknown-key')
  assert.match(thrown(() => defineBuoyancy({}, null)).message, /body accessor object is required/)
})

const arena = () => {
  const players = new Map()
  const calls = { checkpoint: [], respawn: [], set: [] }
  const appCtx = {
    players: {
      getAll: () => [...players.values()],
      setPosition: (id, pos) => {
        calls.set.push([id, [...pos]])
        players.get(id).state.position = [...pos]
      },
    },
  }
  const put = (id, pos) => {
    if (!players.has(id)) players.set(id, { id, state: { position: [...pos] } })
    else players.get(id).state.position = [...pos]
  }
  return { appCtx, players, calls, put }
}

const checkpointHost = (appCtx) => ({
  listPlayers: () => appCtx.players.getAll(),
  setPlayerPosition: (id, pos) => appCtx.players.setPosition(id, pos),
  context: appCtx,
})

gate('defineCheckpoint records the first checkpoint a player enters, once, and respawns a player below minY at the last one', () => {
  const world = arena()
  const cp = defineCheckpoint({
    spawn: [0, 0, 0],
    minY: -5,
    radius: 2,
    checkpoints: [{ position: [10, 0, 0] }, { position: [20, 0, 0], radius: 3 }],
    onCheckpoint: (ctx, id, index) => world.calls.checkpoint.push([id, index]),
    onRespawn: (ctx, id) => world.calls.respawn.push(id),
  }, checkpointHost(world.appCtx))
  world.put('p', [10, 0, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.checkpoint, [['p', 0]])
  assert.deepEqual(cp.checkpointOf('p'), [10, 0, 0])
  assert.deepEqual(cp.checkpointOf('nobody'), [0, 0, 0])
  world.put('p', [12, 0, 0])
  cp.tick(0.1)
  assert.equal(world.calls.checkpoint.length, 1, 'a re-entry of an index already reached must not advance')
  world.put('p', [21, 0, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.checkpoint, [['p', 0], ['p', 1]])
  assert.deepEqual(cp.checkpointOf('p'), [20, 0, 0])
  world.put('p', [-1, -6, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.set, [['p', [20, 0, 0]]])
  assert.deepEqual(world.calls.respawn, ['p'])
  world.put('q', [0, -5, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.respawn, ['p'], 'a player exactly at minY is not below it')
  world.put('r', [0, -10, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.set[1], ['r', [0, 0, 0]], 'a player with no checkpoint returns to spawn')
  world.players.set('s', { id: 's' })
  cp.tick(0.1)
  assert.equal(world.calls.checkpoint.length, 2)
})

gate('defineCheckpoint counts the volume boundary inclusively and refuses a point just outside it', () => {
  const world = arena()
  const cp = defineCheckpoint({ spawn: [0, 0, 0], radius: 2, checkpoints: [{ position: [10, 0, 0] }], onCheckpoint: (ctx, id, index) => world.calls.checkpoint.push([id, index]) }, checkpointHost(world.appCtx))
  world.put('edge', [12, 0, 0])
  cp.tick(0.1)
  world.put('outside', [12.01, 0, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.checkpoint, [['edge', 0]])
  assert.deepEqual(cp.checkpointOf('outside'), [0, 0, 0])
})

gate('defineCheckpoint reset clears progress so a player can record the same checkpoint again', () => {
  const world = arena()
  const cp = defineCheckpoint({ spawn: [0, 0, 0], checkpoints: [{ position: [10, 0, 0] }], onCheckpoint: (ctx, id, index) => world.calls.checkpoint.push([id, index]) }, checkpointHost(world.appCtx))
  world.put('p', [10, 0, 0])
  cp.tick(0.1)
  cp.reset()
  assert.deepEqual(cp.checkpointOf('p'), [0, 0, 0])
  world.put('p', [10, 0, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.checkpoint, [['p', 0], ['p', 0]])
})

gate('defineCheckpoint moves its spawn, volumes and recorded positions through a chart transfer in place', () => {
  const world = arena()
  const cp = defineCheckpoint({ spawn: [0, 0, 0], checkpoints: [{ position: [10, 0, 0] }], onCheckpoint: (ctx, id, index) => world.calls.checkpoint.push([id, index]) }, checkpointHost(world.appCtx))
  world.put('p', [10, 0, 0])
  cp.tick(0.1)
  const transfer = {
    point(p, out = [0, 0, 0]) {
      out[0] = p[0] + 100
      out[1] = p[1]
      out[2] = p[2]
      return out
    },
  }
  cp.onChartReanchor({ transfer })
  assert.deepEqual(cp.checkpointOf('p'), [110, 0, 0])
  assert.deepEqual(cp.checkpointOf('nobody'), [100, 0, 0])
  world.put('p', [110, 0, 0])
  cp.tick(0.1)
  world.put('old', [10, 0, 0])
  cp.tick(0.1)
  assert.deepEqual(world.calls.checkpoint, [['p', 0]], 'the volume moved with the transfer, so the old point is outside it')
})

gate('defineCheckpoint refuses a bad spawn, checkpoint, callback, unknown key and a missing host', () => {
  const world = arena()
  refusedWith(() => defineCheckpoint({ spawn: [0, 0] }, checkpointHost(world.appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineCheckpoint({}, checkpointHost(world.appCtx)), 'define-spec-missing-field')
  refusedWith(() => defineCheckpoint({ spawn: [0, 0, 0], checkpoints: [{ position: [1, 2] }] }, checkpointHost(world.appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineCheckpoint({ spawn: [0, 0, 0], checkpoints: [{ position: [1, 2, 3], radius: 0 }] }, checkpointHost(world.appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineCheckpoint({ spawn: [0, 0, 0], onCheckpoint: null }, checkpointHost(world.appCtx)), 'define-spec-invalid-field')
  refusedWith(() => defineCheckpoint({ spawn: [0, 0, 0], extra: 1 }, checkpointHost(world.appCtx)), 'define-spec-unknown-key')
  assert.match(thrown(() => defineCheckpoint({ spawn: [0, 0, 0] })).message, /host accessor object with listPlayers and setPlayerPosition is required/)
  assert.match(thrown(() => defineCheckpoint({ spawn: [0, 0, 0] }, { listPlayers: () => [] })).message, /host accessor object/)
  const cp = defineCheckpoint({ spawn: [0, 0, 0] }, checkpointHost(world.appCtx))
  assert.ok(thrown(() => cp.setCheckpoint('p', [1, 2])) instanceof TypeError)
  assert.ok(thrown(() => cp.setCheckpoint('p', 'abc')) instanceof TypeError)
  cp.setCheckpoint('p', [1, 2, 3])
  assert.deepEqual(cp.checkpointOf('p'), [1, 2, 3])
})

const matchContext = () => {
  const sent = []
  const players = []
  const ctx = {
    players: { getAll: () => players },
    network: { broadcast: (m) => sent.push(m) },
  }
  const join = (id) => players.push({ id })
  return { ctx, sent, join }
}

const gamemodeHost = (ctx) => ({
  countPlayers: () => ctx.players?.getAll?.().length || 0,
  context: ctx,
})

const clockAt = () => {
  const clock = { t: 0 }
  return { now: () => clock.t, clock }
}

const advance = (clock, gm, ms) => {
  clock.t += ms
  gm.tick(ms)
}

gate('defineGameMode runs a full match on an injected clock with the spoint message sequence', () => {
  const { ctx, sent, join } = matchContext()
  const { now, clock } = clockAt()
  const gm = defineGameMode({ minPlayers: 2, countdownMs: 3000, roundMs: 5000, intermissionMs: 2000, roundsPerMatch: 2, channel: 'm' }, gamemodeHost(ctx), { now })
  assert.equal(gm.state, 'lobby')
  join('a')
  assert.deepEqual(gm.send('START'), { ok: false, reason: 'unhandled', event: 'START', state: 'lobby' })
  join('b')
  assert.deepEqual(gm.send('START'), { ok: true, event: 'START', state: 'warmup' })
  advance(clock, gm, 1000)
  advance(clock, gm, 1000)
  advance(clock, gm, 1000)
  assert.equal(gm.state, 'rounds')
  advance(clock, gm, 4000)
  advance(clock, gm, 1000)
  assert.equal(gm.state, 'roundEnd')
  advance(clock, gm, 1000)
  advance(clock, gm, 1000)
  assert.equal(gm.state, 'rounds')
  assert.equal(gm.round, 2)
  advance(clock, gm, 5000)
  advance(clock, gm, 2000)
  assert.equal(gm.state, 'end')
  assert.equal(gm.round, 2)
  assert.deepEqual(sent.map((m) => m.type + (m.phase ? ':' + m.phase : '') + (m.round ? ':' + m.round : '') + (m.seconds !== undefined ? ':' + m.seconds : '')), [
    'm_phase:lobby',
    'm_phase:warmup',
    'countdown:2',
    'countdown:1',
    'm_round_start:1',
    'm_round_end:1',
    'm_round_start:2',
    'm_round_end:2',
    'm_over',
  ])
  assert.deepEqual(sent[1], { type: 'm_phase', phase: 'warmup', ms: 3000 })
  assert.deepEqual(sent[8], { type: 'm_over', rounds: 2, scores: [] })
})

gate('defineGameMode takes phase names, messages and a win condition from the spec and runs them', () => {
  const { ctx, sent, join } = matchContext()
  const { now, clock } = clockAt()
  const gm = defineGameMode({
    countdownMs: 0,
    roundMs: 0,
    intermissionMs: 0,
    phaseNames: { lobby: 'wait', warmup: 'pre', rounds: 'play', roundEnd: 'after', end: 'done' },
    winCondition: () => true,
    channel: 'x',
    messages: { lobby: () => ({ type: 'hello' }) },
  }, gamemodeHost(ctx), { now })
  join('a')
  join('b')
  assert.deepEqual(sent[0], { type: 'hello' })
  assert.equal(gm.state, 'wait')
  gm.send('START')
  assert.equal(gm.state, 'pre')
  advance(clock, gm, 0)
  assert.equal(gm.state, 'play')
  advance(clock, gm, 0)
  assert.equal(gm.state, 'after')
  advance(clock, gm, 0)
  assert.equal(gm.state, 'done')
  assert.equal(gm.round, 1)
  assert.equal(sent.at(-1).type, 'x_over')
})

gate('defineGameMode scores players by id and refuses a non-finite delta', () => {
  const { ctx } = matchContext()
  const { now } = clockAt()
  const gm = defineGameMode({}, gamemodeHost(ctx), { now })
  assert.equal(gm.addScore('a'), 1)
  assert.equal(gm.addScore('a', 2), 3)
  assert.equal(gm.addScore('b', 5), 5)
  assert.equal(gm.getScore('a'), 3)
  assert.equal(gm.getScore('zz'), 0)
  assert.deepEqual(gm.getScores(), [{ id: 'a', score: 3 }, { id: 'b', score: 5 }])
  assert.equal(gm.teams, null)
  assert.ok(thrown(() => gm.addScore('a', NaN)) instanceof TypeError)
  assert.equal(gm.getScore('a'), 3)
})

gate('defineGameMode with scoring none keeps no scores and refuses teams scoring with no teams', () => {
  const { ctx } = matchContext()
  const { now } = clockAt()
  const gm = defineGameMode({ scoring: 'none' }, gamemodeHost(ctx), { now })
  assert.equal(gm.addScore('a', 4), 0)
  assert.equal(gm.getScore('a'), 0)
  assert.deepEqual(gm.getScores(), [])
  assert.match(thrown(() => defineGameMode({ scoring: 'teams' }, gamemodeHost(ctx), { now })).message, /requires spec\.teams/)
})

gate('defineGameMode hands spec.teams to the injected defineTeams and scores through it', () => {
  const { ctx } = matchContext()
  const { now } = clockAt()
  const teamCalls = []
  const log = []
  const defineTeams = (teamSpec, appCtx) => {
    teamCalls.push([teamSpec, appCtx])
    return {
      addScore: (id, delta) => {
        log.push(['add', id, delta])
        return 10
      },
      getScore: (id) => (id === 'red' ? 7 : 0),
      getScores: () => [{ team: 'red', score: 7 }],
    }
  }
  const gm = defineGameMode({ teams: { teams: ['red', 'blue'] } }, gamemodeHost(ctx), { now, defineTeams })
  assert.deepEqual(teamCalls[0][0], { teams: ['red', 'blue'] })
  assert.equal(teamCalls[0][1], ctx)
  assert.equal(gm.addScore('red', 3), 10)
  assert.deepEqual(log, [['add', 'red', 3]])
  assert.equal(gm.getScore('red'), 7)
  assert.deepEqual(gm.getScores(), [{ team: 'red', score: 7 }])
  assert.equal(typeof gm.teams.addScore, 'function')
  assert.match(thrown(() => defineGameMode({ teams: {} }, gamemodeHost(ctx), { now })).message, /defineTeams/)
})

gate('defineGameMode refuses a missing host or clock, a bad spec value, an unknown key and bad phase or message names', () => {
  const { ctx } = matchContext()
  const { now } = clockAt()
  assert.match(thrown(() => defineGameMode({}, null, { now })).message, /host accessor object with countPlayers is required/)
  assert.match(thrown(() => defineGameMode({}, { context: ctx }, { now })).message, /countPlayers/)
  assert.match(thrown(() => defineGameMode({}, gamemodeHost(ctx), {})).message, /now must be a function/)
  refusedWith(() => defineGameMode({ winCondition: 'x' }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ countdownMs: 1.5 }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ roundMs: -1 }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ roundsPerMatch: 0 }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ scoring: 'bogus' }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ onRoundStart: 'x' }, gamemodeHost(ctx), { now }), 'define-spec-invalid-field')
  refusedWith(() => defineGameMode({ extra: 1 }, gamemodeHost(ctx), { now }), 'define-spec-unknown-key')
  assert.match(thrown(() => defineGameMode({ phaseNames: { lobby: 'x', warmup: 'x' } }, gamemodeHost(ctx), { now })).message, /5 distinct/)
  assert.match(thrown(() => defineGameMode({ phaseNames: { nope: 'x' } }, gamemodeHost(ctx), { now })).message, /unknown key/)
  assert.match(thrown(() => defineGameMode({ phaseNames: { lobby: '' } }, gamemodeHost(ctx), { now })).message, /non-empty string/)
  assert.match(thrown(() => defineGameMode({ messages: { lobby: 'hi' } }, gamemodeHost(ctx), { now })).message, /must be a function/)
  assert.match(thrown(() => defineGameMode({ messages: { nope: () => null } }, gamemodeHost(ctx), { now })).message, /unknown key/)
})

for (const label of probed) check(label)

finish()
