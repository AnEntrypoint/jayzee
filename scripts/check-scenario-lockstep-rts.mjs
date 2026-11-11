import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { writeTickTrace } from './lib/tickTrace.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const SQUADS = 2
const PER_SQUAD = 4
const BASE_ARC_M = 12
const SPEED_M_S = 4
const SIGHT_M = 9
const ATTACK_M = 1.6
const SEPARATION_M = 1.1
const SEPARATION_GAIN = 6
const DAMAGE = 12
const MAX_HP = 100
const ATTACK_COOLDOWN_TICKS = 36
const INPUT_DELAY = 3
const CHECKPOINT_TICKS = 30
const MATCH_TICKS = 360
const DIVERGE_ISSUE_TICK = 90
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const fnvWords = (values) => {
  let h = FNV_OFFSET
  for (const word of new Uint32Array(new Float32Array(values).buffer)) {
    h ^= word
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h
}

const commandsFor = (variant) => {
  const issued = [
    { tick: 0, squad: 0, arc: BASE_ARC_M },
    { tick: 0, squad: 1, arc: -BASE_ARC_M },
    { tick: 60, squad: 0, arc: BASE_ARC_M * 0.5 },
  ]
  if (variant === 'diverged') issued.push({ tick: DIVERGE_ISSUE_TICK, squad: 0, arc: 0 })
  return issued
}

const match = async (tier, variant) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const anchor = world.height(0, PLANET.radius, 0)
  const centreRadius = PLANET.radius + anchor + CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
  const surfaceAt = (arc, lateral) => {
    const angle = arc / centreRadius
    return [centreRadius * Math.sin(angle), centreRadius * Math.cos(angle), lateral]
  }
  const units = []
  for (let squad = 0; squad < SQUADS; squad++) {
    const arc = squad === 0 ? -BASE_ARC_M : BASE_ARC_M
    for (let k = 0; k < PER_SQUAD; k++) {
      const lateral = (k - (PER_SQUAD - 1) / 2) * 1.2
      units.push({ squad, hp: MAX_HP, cooldown: 0, index: world.addCharacter({ position: surfaceAt(arc, lateral), radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }) })
    }
  }
  world.follow([0, centreRadius, 0])
  const planetCentre = [0, -centreRadius, 0]
  const orders = [null, null]
  const pending = commandsFor(variant)
  const applied = []
  const checkpoints = []
  const tickMs = []
  const positions = units.map(() => [0, 0, 0])
  const bodyToward = (from, to) => {
    const toTarget = [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
    const up = [from[0] - planetCentre[0], from[1] - planetCentre[1], from[2] - planetCentre[2]]
    const upLength = Math.hypot(...up)
    const normal = up.map((v) => v / upLength)
    const along = toTarget[0] * normal[0] + toTarget[1] * normal[1] + toTarget[2] * normal[2]
    return toTarget.map((v, a) => v - along * normal[a])
  }
  for (let tick = 0; tick < MATCH_TICKS; tick++) {
    for (const command of pending) {
      if (command.tick + INPUT_DELAY === tick) {
        orders[command.squad] = command.arc
        applied.push({ issued: command.tick, applied: tick, squad: command.squad })
      }
    }
    units.forEach((unit, i) => world.characterBodyPosition(unit.index, positions[i]))
    units.forEach((unit, i) => {
      if (unit.hp <= 0) {
        world.setCharacterVelocity(unit.index, [0, 0, 0])
        return
      }
      const here = positions[i]
      let enemy = -1
      let enemyDistance = Infinity
      units.forEach((other, j) => {
        if (other.squad === unit.squad || other.hp <= 0) return
        const d = Math.hypot(...positions[j].map((v, a) => v - here[a]))
        if (d < enemyDistance) {
          enemy = j
          enemyDistance = d
        }
      })
      let goal
      if (enemy >= 0 && enemyDistance <= SIGHT_M) goal = positions[enemy]
      else goal = surfaceAt(orders[unit.squad] ?? 0, 0).map((v, a) => (a === 1 ? v - centreRadius : v))
      const sep = [0, 0, 0]
      units.forEach((other, j) => {
        if (j === i || other.hp <= 0) return
        const d = Math.hypot(...positions[j].map((v, a) => v - here[a]))
        if (d < SEPARATION_M && d > 0) {
          for (let a = 0; a < 3; a++) sep[a] += ((here[a] - positions[j][a]) / d) * ((SEPARATION_M - d) / SEPARATION_M)
        }
      })
      const tangent = bodyToward(here, goal)
      const tangentLength = Math.hypot(...tangent)
      let velocity = tangentLength > 0 ? tangent.map((v) => (v / tangentLength) * SPEED_M_S) : [0, 0, 0]
      velocity = velocity.map((v, a) => v + SEPARATION_GAIN * sep[a])
      const engaged = enemy >= 0 && enemyDistance <= ATTACK_M
      world.setCharacterVelocity(unit.index, engaged ? [0, 0, 0] : velocity)
      if (unit.cooldown > 0) unit.cooldown -= 1
      if (engaged && unit.cooldown === 0) {
        units[enemy].hp -= DAMAGE
        unit.cooldown = ATTACK_COOLDOWN_TICKS
      }
    })
    const started = performance.now()
    world.step()
    tickMs.push(performance.now() - started)
    if ((tick + 1) % CHECKPOINT_TICKS === 0) {
      const flat = []
      for (const unit of units) flat.push(...world.characterBodyPosition(unit.index, [0, 0, 0]))
      checkpoints.push({ tick: tick + 1, checksum: fnvWords([...flat, ...units.map((u) => u.hp)]), flat, hp: units.map((u) => u.hp) })
    }
  }
  return { applied, checkpoints, tickMs, hp: units.map((u) => u.hp), squadOf: units.map((u) => u.squad), positions: positions.map((p) => p.slice()) }
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, {
    peerA: await match(tier, 'agreed'),
    peerB: await match(tier, 'agreed'),
    peerC: await match(tier, 'diverged'),
  })
}

for (const tier of TIERS) {
  const { peerA, peerB, peerC } = runs.get(tier.label)
  gate(tier.label + ': every order applies exactly the input delay after it is issued', () => {
    assert.ok(peerA.applied.length > 0, 'no orders were applied')
    for (const entry of peerA.applied) assert.equal(entry.applied - entry.issued, INPUT_DELAY, 'order issued at ' + entry.issued + ' applied at ' + entry.applied)
  })
  gate(tier.label + ': the squads engage: units take damage within the match', () => {
    const damage = peerA.hp.reduce((sum, hp) => sum + (MAX_HP - hp), 0)
    assert.ok(damage > 0, 'no damage was dealt')
  })
  gate(tier.label + ': two peers fed the same orders agree on the checksum at every checkpoint', () => {
    assert.equal(peerA.checkpoints.length, MATCH_TICKS / CHECKPOINT_TICKS)
    for (let i = 0; i < peerA.checkpoints.length; i++) assert.equal(peerB.checkpoints[i].checksum, peerA.checkpoints[i].checksum, 'checkpoint ' + peerA.checkpoints[i].tick)
  })
  gate(tier.label + ': a peer given one divergent order is caught at the first checkpoint after the order takes effect', () => {
    const expected = Math.ceil((DIVERGE_ISSUE_TICK + INPUT_DELAY) / CHECKPOINT_TICKS) * CHECKPOINT_TICKS
    const mismatch = peerC.checkpoints.find((cp, i) => cp.checksum !== peerA.checkpoints[i].checksum)
    assert.ok(mismatch, 'no checkpoint caught the divergence')
    assert.equal(mismatch.tick, expected, 'first mismatch at tick ' + mismatch.tick + ', expected ' + expected)
  })
  gate(tier.label + ': two runs agree bit for bit on every unit position and health at the end', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(peerB.positions.flat()).buffer), new Uint32Array(new Float32Array(peerA.positions.flat()).buffer))
    assert.deepEqual(peerB.hp, peerA.hp)
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, all peers)', () => {
    const trace = writeTickTrace('lockstep-rts', tier.label, [peerA.tickMs, peerB.tickMs, peerC.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
