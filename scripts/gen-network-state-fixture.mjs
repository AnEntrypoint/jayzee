import { writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { makeClock, runNetworkStateTrace } from './lib/network-state-trace.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const { NetworkState } = await import(pathToFileURL(join(spointRoot, 'src', 'netcode', 'NetworkState.js')).href)
const guard = await import(pathToFileURL(join(spointRoot, 'src', 'shared', 'vecGuard.js')).href)

const clock = makeClock()
const realNow = Date.now
Date.now = clock.now
let steps
try {
  steps = runNetworkStateTrace(() => new NetworkState(), clock, guard)
} finally {
  Date.now = realNow
}
const fixture = {
  source: 'spoint src/netcode/NetworkState.js and src/shared/vecGuard.js, driven by scripts/lib/network-state-trace.mjs with Date.now set to the trace clock',
  steps,
}
writeFileSync(join(here, 'fixtures', 'spoint', 'network-state.json'), JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote', steps.length, 'steps')
