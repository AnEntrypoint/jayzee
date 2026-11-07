import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseDoorCatalog, statusOf, summarizeDoors } from '../src/upstream-doors/catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, 'scripts', 'fixtures', 'upstream', 'CATALOG.md')
const NO_VERB_DOORS = ['delete', 'play.attach', 'git', 'openapi']

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}

const text = readFileSync(fixturePath, 'utf8')
const doors = parseDoorCatalog(text)
const summary = summarizeDoors(doors)

gate('the catalog holds 70 doors, 17 exercised and 53 documented, with unique names', () => {
  same(summary.total, 70, 'doors')
  same(summary.exercised, 17, 'exercised')
  same(summary.documented, 53, 'documented')
  same(summary.other, 0, 'other status')
  same(new Set(doors.map((door) => door.door)).size, 70, 'unique names')
  mustReject(() => same(summary.total, 69, 'doors'))
})

gate('rows with an HTTP verb are counted, and the four named rows state no verb', () => {
  sameJson(summary.withoutVerb, NO_VERB_DOORS, 'rows without an HTTP verb')
  same(summary.withVerb, 66, 'rows with an HTTP verb')
  mustReject(() => same(summary.withVerb, 56, 'rows with an HTTP verb'))
})

gate('known rows keep their method, path and status class', () => {
  const me = doors.find((door) => door.door === 'me')
  same(me.method, 'GET', 'me method')
  same(me.path, '/api/agent/v1/me', 'me path')
  same(me.state, 'exercised', 'me state')
  const patch = doors.find((door) => door.door === 'me_patch')
  same(patch.method, 'PATCH', 'me_patch method')
  same(patch.state, 'documented', 'me_patch state')
  const git = doors.find((door) => door.door === 'git')
  same(git.method, 'git transport (clone, push)', 'git method')
})

gate('an escaped pipe inside a cell stays part of that cell', () => {
  const relation = doors.find((door) => door.door === 'social.relation')
  same(relation.method, 'POST', 'method')
  assert(relation.detail.includes('\\|'), 'escaped pipe lost from the status cell')
  assert(relation.detail.includes('accept'), 'source text after the escaped pipe lost')
  same(relation.source, 'me.doors.social.relation; llms.txt', 'source column')
})

gate('a row with a missing cell is refused rather than dropped', () => {
  mustReject(() => parseDoorCatalog('| Door | Method | Path | Status | Source |\n|---|---|---|---|---|\n| a | GET |\n'))
})

gate('status classes are exercised, documented and other only', () => {
  same(statusOf('exercised: 200 with Bearer'), 'exercised', 'exercised')
  same(statusOf('exercised once, on game d21d322b'), 'exercised', 'exercised once')
  same(statusOf('exercised with ?unread=1: 200'), 'exercised', 'exercised with query')
  same(statusOf('documented, not exercised. Source'), 'documented', 'documented')
  same(statusOf('unknown text'), 'other', 'other')
})

finish()
