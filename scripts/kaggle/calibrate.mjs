import { availableParallelism } from 'node:os'
import { Worker, isMainThread, parentPort } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'

const LOOP = 60_000_000
const MEMORY_WORDS = 1 << 25
const MEMORY_READS = 12_000_000
const LANES = 4
const REPEATS = 3

const compute = () => {
  let x = 0.5
  for (let i = 0; i < LOOP; i++) x = x * 1.0000001 + Math.sqrt(x) * 1e-9
  return x
}
const timed = (fn) => {
  const at = performance.now()
  fn()
  return performance.now() - at
}
const best = (values) => Number(Math.min(...values).toFixed(1))

if (!isMainThread) {
  parentPort.on('message', () => {
    parentPort.postMessage(timed(compute))
  })
} else {
  compute()
  const single = Array.from({ length: REPEATS }, () => timed(compute))
  const words = new Int32Array(MEMORY_WORDS)
  for (let i = 0; i < MEMORY_WORDS; i++) words[i] = i
  const chase = () => {
    let at = 12345
    let sum = 0
    for (let i = 0; i < MEMORY_READS; i++) {
      at = (Math.imul(at, 1103515245) + 12345) & (MEMORY_WORDS - 1)
      sum += words[at]
    }
    return sum
  }
  const memory = Array.from({ length: REPEATS }, () => timed(chase))
  const workers = Array.from({ length: LANES }, () => new Worker(fileURLToPath(import.meta.url)))
  const round = () => Promise.all(workers.map((worker) => new Promise((done) => {
    worker.once('message', done)
    worker.postMessage(0)
  })))
  await round()
  const parallel = []
  for (let r = 0; r < REPEATS; r++) {
    const at = performance.now()
    const each = await round()
    parallel.push({ wallMs: performance.now() - at, slowestMs: Math.max(...each) })
  }
  await Promise.all(workers.map((worker) => worker.terminate()))
  const singleMs = best(single)
  const parallelWallMs = best(parallel.map((p) => p.wallMs))
  console.log('RESULT ' + JSON.stringify({ kind: 'calibrate', cpus: availableParallelism(), lanes: LANES, singleMs, memoryMs: best(memory), parallelWallMs, laneSlowdown: Number((parallelWallMs / singleMs).toFixed(3)) }))
}
