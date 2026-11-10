import { Session } from 'node:inspector'
import { decodeCrowdDots } from '../src/client/crowdDots.js'

const withTsl = !process.argv.includes('--no-tsl')
const ITERATIONS = 20000
const DOTS = 64

if (withTsl) await import('three/tsl')

const dots = Array.from({ length: DOTS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])
const options = { viewerY: 0 }
const out = []
for (let i = 0; i < 2000; i++) decodeCrowdDots(dots, options, out)

const session = new Session()
session.connect()
const post = (method, params = {}) => new Promise((resolve, reject) => session.post(method, params, (err, res) => (err ? reject(err) : resolve(res))))

await post('HeapProfiler.enable')
await post('HeapProfiler.startSampling', { samplingInterval: 16, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
for (let i = 0; i < ITERATIONS; i++) decodeCrowdDots(dots, options, out)
const { profile } = await post('HeapProfiler.stopSampling')

const sites = new Map()
let total = 0
const walk = (node) => {
  const f = node.callFrame
  const key = (f.functionName || '(anonymous)') + ' ' + (f.url.split('/').pop() || f.url) + ':' + (f.lineNumber + 1)
  const hit = sites.get(key) ?? { bytes: 0 }
  hit.bytes += node.selfSize
  sites.set(key, hit)
  total += node.selfSize
  for (const child of node.children) walk(child)
}
walk(profile.head)

const top = [...sites.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 15)
console.log(JSON.stringify({ withTsl, iterations: ITERATIONS, totalBytes: total, bytesPerCall: total / ITERATIONS }))
for (const [key, { bytes }] of top) console.log(String(bytes).padStart(12), key)
