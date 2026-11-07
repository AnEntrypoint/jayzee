import { World } from '../src/index.js'

const bodies = Number(process.argv[2] ?? 2000)
const ticks = Number(process.argv[3] ?? 300)
const WARMUP = 30
const SPREAD = 60

const world = new World({
  capacity: bodies,
  boxes: [[-10, 0, -10, 10, 1, 10]],
})
let seed = 1
const random = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0
  return seed / 4294967296
}
for (let i = 0; i < bodies; i++) world.spawn([random() * SPREAD - SPREAD / 2, 5 + random() * 40, random() * SPREAD - SPREAD / 2])

for (let i = 0; i < WARMUP; i++) world.step()
const samples = []
for (let i = 0; i < ticks; i++) {
  const started = performance.now()
  world.step()
  samples.push(performance.now() - started)
}
samples.sort((a, b) => a - b)
const mean = samples.reduce((sum, ms) => sum + ms, 0) / samples.length
const pick = (q) => samples[Math.min(samples.length - 1, Math.floor(q * samples.length))]
console.log(JSON.stringify({
  bodies,
  ticks,
  meanMs: Number(mean.toFixed(3)),
  p50Ms: Number(pick(0.5).toFixed(3)),
  p95Ms: Number(pick(0.95).toFixed(3)),
  ticksPerSecondAtMean: Math.round(1000 / mean),
  node: process.version,
}))
