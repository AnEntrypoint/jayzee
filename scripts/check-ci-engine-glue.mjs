import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

const REQUIRED = [
  'bash engine/build.sh',
  'ENGINE_TIER_MIB=128 bash engine/build.sh',
  'ENGINE_VARIANT=leak bash engine/build.sh',
  'ENGINE_VARIANT=timed bash engine/build.sh',
  'ENGINE_VARIANT=timed ENGINE_TIER_MIB=128 bash engine/build.sh',
]

const judgeCi = (text) => {
  const lines = text.split('\n').map((line) => line.trim())
  const testAt = lines.indexOf('- run: npm test')
  assert.ok(testAt !== -1, 'the workflow runs npm test')
  for (const command of REQUIRED) {
    const at = lines.indexOf(command)
    assert.ok(at !== -1, 'the workflow builds no glue with: ' + command)
    assert.ok(at < testAt, command + ' runs after npm test')
  }
}

const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8')

gate('the ci test job builds every engine glue variant the test chain reads, before npm test', () => {
  judgeCi(ci)
})
gate('the ci gate refuses a workflow without the timed 128 build', () => {
  assert.throws(() => judgeCi(ci.replace('ENGINE_VARIANT=timed ENGINE_TIER_MIB=128 bash engine/build.sh', '')), /timed/)
})
gate('the ci gate refuses a workflow whose glue build comes after npm test', () => {
  const block = ci.slice(ci.indexOf('      - name: Build the engine glue'), ci.indexOf('      - run: npm ci'))
  const moved = ci.replace(block, '') + block
  assert.throws(() => judgeCi(moved), /after npm test/)
})

finish()
