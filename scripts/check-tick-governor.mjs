import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  TickGovernor,
  DILATION_WINDOW,
  DILATION_THRESHOLD,
  DILATION_RECOVERY_THRESHOLD,
  DILATION_MIN,
  DILATION_MIN_STEP,
  DILATION_MAX_STEP,
  DILATION_GAIN,
  shedDilation,
  recoverDilation,
} from '../src/tick-pure/tickSystem.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, what) => assert(actual === expected, `${what}: expected ${expected}, got ${actual}`)
const near = (actual, expected, what) => assert(Math.abs(actual - expected) < 1e-12, `${what}: expected ${expected}, got ${actual}`)
const differs = (a, b, what) => assert(a !== b, `${what}: both are ${a}`)

const feed = (governor, budgetMs, count) => {
  for (let i = 0; i < count; i++) governor.onTickMeasured(budgetMs)
  return governor
}

const mulberry32 = (seed) => () => {
  seed += 0x6d2b79f5
  let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const budgetSequence = (rng, length) => {
  const budgets = []
  while (budgets.length < length) {
    const regimeMs = rng() * 40
    const blockLength = 60 + Math.floor(rng() * 90)
    for (let i = 0; i < blockLength && budgets.length < length; i++) {
      budgets.push(regimeMs * (0.8 + 0.4 * rng()))
    }
  }
  return budgets
}

const spointTrajectory = (budgets, tickRate, gain) => {
  const tickDuration = 1000 / tickRate
  const recent = []
  let sum = 0
  let factor = 1.0
  return budgets.map((budget) => {
    recent.push(budget)
    sum += budget
    if (recent.length > 60) sum -= recent.shift()
    if (recent.length >= 60) {
      const load = sum / 60 / (tickDuration * factor)
      if (load > 0.85 && factor > 0.1) {
        const step = Math.min(0.25, Math.max(0.01, ((load - 0.85) / 0.85) * gain))
        factor = Math.max(0.1, +(factor - step).toFixed(3))
      } else if (load < 0.85 * 0.7 && factor < 1.0) {
        const step = Math.min(0.25, Math.max(0.01, ((0.85 * 0.7 - load) / (0.85 * 0.7)) * gain))
        factor = Math.min(1.0, +(factor + step).toFixed(3))
      }
    }
    return factor
  })
}

const portTrajectory = (budgets, tickRate) => {
  const governor = new TickGovernor(tickRate)
  return budgets.map((budget) => {
    governor.onTickMeasured(budget)
    return governor.dilationFactor
  })
}

const transitions = (trajectory) => {
  let sheds = 0
  let recoveries = 0
  let previous = 1.0
  for (const factor of trajectory) {
    if (factor < previous) sheds++
    if (factor > previous) recoveries++
    previous = factor
  }
  return { sheds, recoveries }
}

const legalFactor = (factor) => factor >= DILATION_MIN && factor <= 1 && Number(factor.toFixed(3)) === factor

const SEEDS = 100
const SEQUENCE_LENGTH = 400

const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'tick-pure', 'tickSystem.js')
const source = readFileSync(sourcePath, 'utf8')
const FORBIDDEN_TOKENS = ['//', '/*', 'performance', 'Date', 'setTimeout', 'setImmediate', 'globalThis', 'process', 'import ', 'require(']
const forbiddenIn = (text) => FORBIDDEN_TOKENS.filter((token) => text.includes(token))

gate('tick governor constants equal spoint TickSystem.js values', () => {
  same(DILATION_WINDOW, 60, 'window')
  same(DILATION_THRESHOLD, 0.85, 'threshold')
  near(DILATION_RECOVERY_THRESHOLD, 0.595, 'recovery threshold')
  same(DILATION_MIN, 0.1, 'minimum dilation')
  same(DILATION_MIN_STEP, 0.01, 'minimum step')
  same(DILATION_MAX_STEP, 0.25, 'maximum step')
  same(DILATION_GAIN, 0.5, 'gain')
  differs(DILATION_RECOVERY_THRESHOLD, 0.7, 'negative control: recovery threshold is 0.7 times the threshold, not 0.7')
})

gate('a new governor runs at dilation 1 and dt is 1/tickRate seconds', () => {
  const governor = new TickGovernor(60)
  same(governor.dilationFactor, 1, 'initial dilation')
  near(governor.tickDuration, 1000 / 60, 'tick duration in ms')
  near(governor.computeDt(), 1 / 60, 'dt in seconds')
  differs(new TickGovernor(30).computeDt(), governor.computeDt(), 'negative control: tick rate 30 changes dt')
})

gate('getTickDuration tracks the dilated tick', () => {
  const governor = new TickGovernor(60)
  governor.dilationFactor = 0.5
  same(governor.getTickDuration(), governor.computeDt(), 'getTickDuration equals computeDt')
  differs(governor.getTickDuration(), new TickGovernor(60).getTickDuration(), 'negative control: dilation 0.5 halves the rate')
})

gate('no move before the window fills, and a sustained overload moves at the 60th sample', () => {
  const early = feed(new TickGovernor(60), 1000, 59)
  same(early.dilationFactor, 1, 'factor after 59 samples')
  const full = feed(new TickGovernor(60), 1000, 60)
  same(full.dilationFactor, 0.75, 'factor after 60 samples of 1000 ms')
  const underThreshold = feed(new TickGovernor(60), 10, 60)
  same(underThreshold.dilationFactor, 1, 'load 0.6 stays under the threshold')
  differs(full.dilationFactor, underThreshold.dilationFactor, 'negative control: budget 10 ms must not shed like budget 1000 ms')
})

gate('shedDilation applies the overload ratio times the gain', () => {
  same(shedDilation(1.0, 1.2), 0.794, 'shed at load 1.2')
  differs(shedDilation(1.0, 1.2), shedDilation(1.0, 0.851), 'negative control: load 0.851 gives a different shed')
})

gate('shed step is clamped to the minimum and maximum step', () => {
  same(shedDilation(1.0, 0.851), 0.99, 'tiny overload takes the minimum step')
  same(shedDilation(1.0, 60), 0.75, 'huge overload takes the maximum step')
  differs(shedDilation(1.0, 60), shedDilation(1.0, 1.2), 'negative control: the maximum step is not the normal step')
})

gate('shedding stops at DILATION_MIN', () => {
  const atFloor = feed(Object.assign(new TickGovernor(60), { dilationFactor: 0.1 }), 1000, 60)
  same(atFloor.dilationFactor, 0.1, 'factor at the floor after a sustained overload')
  const aboveFloor = feed(Object.assign(new TickGovernor(60), { dilationFactor: 0.5 }), 1000, 60)
  same(aboveFloor.dilationFactor, 0.25, 'factor 0.5 sheds one maximum step')
  differs(atFloor.dilationFactor, aboveFloor.dilationFactor, 'negative control: a factor above the floor still sheds')
})

gate('recoverDilation applies the recovery ratio and caps at 1.0', () => {
  same(recoverDilation(0.5, 0), 0.75, 'recovery from load 0')
  same(recoverDilation(0.95, 0), 1, 'recovery is capped at 1.0')
  differs(recoverDilation(0.95, 0), recoverDilation(0.5, 0), 'negative control: a higher factor caps differently')
})

gate('recovery step is clamped to the minimum step', () => {
  same(recoverDilation(0.5, 0.594), 0.51, 'load just under the recovery threshold takes the minimum step')
  differs(recoverDilation(0.5, 0.594), recoverDilation(0.5, 0), 'negative control: load 0 takes the maximum step')
})

gate('recovery needs the load under the recovery threshold', () => {
  const recovering = feed(Object.assign(new TickGovernor(60), { dilationFactor: 0.5 }), 0, 60)
  same(recovering.dilationFactor, 0.75, 'load 0 recovers one step')
  const midBudget = 0.7 * (1000 / 60) * 0.5
  const betweenThresholds = feed(Object.assign(new TickGovernor(60), { dilationFactor: 0.5 }), midBudget, 60)
  same(betweenThresholds.dilationFactor, 0.5, 'load 0.7 sits between the thresholds and does not move')
  differs(recovering.dilationFactor, betweenThresholds.dilationFactor, 'negative control: load 0 and load 0.7 must differ')
})

gate('dilation listeners hear each move and no quiet tick', () => {
  const heard = []
  const governor = new TickGovernor(60)
  governor.onDilation((factor) => heard.push(factor))
  feed(governor, 1000, 60)
  same(heard.length, 1, 'one move at the 60th sample')
  same(heard[0], 0.75, 'listener gets the new factor')
  governor.onTickMeasured(1000)
  same(heard[1], 0.5, 'listener hears the next shed')
  const quiet = new TickGovernor(60)
  const quietHeard = []
  quiet.onDilation((factor) => quietHeard.push(factor))
  feed(quiet, 10, 120)
  same(quietHeard.length, 0, 'no move, no call')
  differs(heard.length, quietHeard.length, 'negative control: an overloaded governor is heard, a quiet one is not')
})

gate('a throwing dilation listener neither propagates nor blocks the others', () => {
  const governor = new TickGovernor(60)
  const heard = []
  governor.onDilation(() => { throw new Error('listener failure') })
  governor.onDilation((factor) => heard.push(factor))
  feed(governor, 1000, 60)
  same(heard[0], 0.75, 'the second listener still runs after the first throws')
  differs(heard.length, 0, 'negative control: the second listener recorded a move')
})

gate('source has no comments, clock, hot-swap hook or import', () => {
  same(forbiddenIn(source).length, 0, `forbidden tokens in tickSystem.js: ${forbiddenIn(source).join(', ')}`)
  assert(forbiddenIn('const now = performance.now() // note').length > 0, 'negative control: the scanner flags a clock and a comment')
})

gate('every factor on 100 seeded budget sequences stays in [0.1, 1] at three decimals', () => {
  for (let seed = 1; seed <= SEEDS; seed++) {
    const trajectory = portTrajectory(budgetSequence(mulberry32(seed), SEQUENCE_LENGTH), 60)
    for (const [step, factor] of trajectory.entries()) {
      assert(legalFactor(factor), `seed ${seed} step ${step}: illegal factor ${factor}`)
    }
  }
  assert(!legalFactor(0.0999) && !legalFactor(1.0001) && !legalFactor(0.12345), 'negative control: out-of-range and four-decimal factors are refused')
})

gate('port matches the spoint TickSystem.js arithmetic step for step on 100 seeded sequences', () => {
  let sheds = 0
  let recoveries = 0
  for (let seed = 1; seed <= SEEDS; seed++) {
    const budgets = budgetSequence(mulberry32(seed), SEQUENCE_LENGTH)
    const expected = spointTrajectory(budgets, 60, DILATION_GAIN)
    const actual = portTrajectory(budgets, 60)
    for (const [step, value] of expected.entries()) {
      assert(Object.is(actual[step], value), `seed ${seed} step ${step}: port ${actual[step]} vs spoint ${value}`)
    }
    const counts = transitions(actual)
    sheds += counts.sheds
    recoveries += counts.recoveries
  }
  assert(sheds > 0 && recoveries > 0, `sequences exercised ${sheds} sheds and ${recoveries} recoveries; both are required`)
})

gate('negative control: a gain of 0.6 diverges from the port on at least one sequence', () => {
  let diverged = false
  for (let seed = 1; seed <= SEEDS && !diverged; seed++) {
    const budgets = budgetSequence(mulberry32(seed), SEQUENCE_LENGTH)
    const perturbed = spointTrajectory(budgets, 60, 0.6)
    const actual = portTrajectory(budgets, 60)
    diverged = perturbed.some((value, step) => !Object.is(actual[step], value))
  }
  assert(diverged, 'a perturbed gain did not change any trajectory, so the differential check is blind to the gain')
})

finish()
