import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'

const judge = (result) => {
  assert.equal(result.tier, 1024, 'not a 1024-tier result, tier is ' + result.tier)
  assert.ok(Array.isArray(result.visible) && result.visible.length > 0, '1024-tier result has no visible counts')
  assert.ok(result.visible.some((count) => count > 0), '1024-tier visible counts are all zero: ' + JSON.stringify(result.visible))
  return result.visible
}

gate('1024-tier visible counts that are all zero fail', () => {
  assert.throws(() => judge({ tier: 1024, visible: [0, 0, 0, 0] }), /all zero/)
})
gate('1024-tier visible counts with a non-zero entry pass', () => {
  assert.deepEqual(judge({ tier: 1024, visible: [729, 746, 747, 750] }), [729, 746, 747, 750])
  assert.deepEqual(judge({ tier: 1024, visible: [0, 0, 5, 0] }), [0, 0, 5, 0])
})
gate('a 1024-tier result with no visible counts fails', () => {
  assert.throws(() => judge({ tier: 1024 }), /no visible counts/)
  assert.throws(() => judge({ tier: 1024, visible: [] }), /no visible counts/)
})
gate('a 64-tier result is refused by this gate', () => {
  assert.throws(() => judge({ tier: 64, visible: [18, 20, 21, 20] }), /not a 1024-tier result/)
})
process.argv.slice(2).forEach((path) => {
  gate('witness ' + path + ' has non-zero 1024-tier visible counts', () => {
    judge(JSON.parse(readFileSync(path, 'utf8')))
  })
})
finish()
