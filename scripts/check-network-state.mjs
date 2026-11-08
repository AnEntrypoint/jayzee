import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { makeClock, runNetworkStateTrace } from './lib/network-state-trace.mjs'
import { NetworkState } from '../src/netcode/networkState.js'
import * as guard from '../src/netcode/vecGuard.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'network-state.json'), 'utf8'))
const steps = runNetworkStateTrace((clock) => new NetworkState({ now: clock.now }), makeClock(), guard)

gate('the trace has the same number of steps as spoint produced', () => {
  assert.equal(steps.length, fixture.steps.length)
})

fixture.steps.forEach(([label, value], index) => {
  gate('step ' + index + ': ' + label, () => {
    assert.equal(steps[index][0], label)
    assert.deepEqual(steps[index][1], value)
  })
})

finish()
