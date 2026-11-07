import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseDoorCatalog } from '../src/upstream-doors/catalog.js'
import { compileDoors } from '../src/upstream-doors/router.js'
import { dispatch } from '../src/upstream-doors/dispatch.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'scripts', 'fixtures', 'upstream', 'CATALOG.md')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

const routes = compileDoors(parseDoorCatalog(readFileSync(catalogPath, 'utf8')))
const calls = []
const recorder = (name) => (door, ...args) => {
  calls.push({ name, door: door.door, args })
  return name + ':' + door.door
}
const registry = new Map([
  ['me', recorder('me')],
  ['docs', recorder('docs')],
  ['delete', recorder('delete')],
])
const host = 'https://www.spawn.co'

gate('a matched door invokes exactly its registered handler, once, with the request arguments', () => {
  calls.length = 0
  const outcome = dispatch(routes, registry, 'GET', host + '/api/agent/v1/me?unread=1', 'arg1')
  sameJson(outcome, { status: 'dispatched', door: 'me', result: 'me:me' }, 'outcome')
  sameJson(calls, [{ name: 'me', door: 'me', args: ['arg1'] }], 'calls')
})

gate('a wrong method invokes nothing', () => {
  calls.length = 0
  sameJson(dispatch(routes, registry, 'DELETE', '/api/agent/v1/me'), { status: 'unmatched' }, 'wrong method outcome')
  sameJson(calls, [], 'wrong method calls')
})

gate('a non-matching path invokes nothing', () => {
  calls.length = 0
  sameJson(dispatch(routes, registry, 'GET', '/api/no/such/door'), { status: 'unmatched' }, 'unknown path outcome')
  sameJson(dispatch(routes, registry, 'GET', '/api/agent/v1/me/extra'), { status: 'unmatched' }, 'extra segment outcome')
  sameJson(calls, [], 'unmatched calls')
})

gate('a malformed template is refused before any route exists, so no handler can be reached through it', () => {
  calls.length = 0
  let refused = false
  try {
    compileDoors([{ door: 'bad', method: 'GET', path: '/api/{x' }])
  } catch (_) {
    refused = true
  }
  assert(refused, 'malformed template was compiled')
  const badRegistry = new Map([['bad', recorder('bad')]])
  sameJson(dispatch(routes, badRegistry, 'GET', '/api/{x'), { status: 'unmatched' }, 'malformed request outcome')
  sameJson(calls, [], 'malformed calls')
})

gate('a matched door with no registered handler is reported and invokes nothing', () => {
  calls.length = 0
  sameJson(dispatch(routes, registry, 'GET', '/api/agent/v1/access?world=w'), { status: 'unregistered', door: 'access' }, 'unregistered outcome')
  sameJson(calls, [], 'unregistered calls')
})

gate('a door with no stated method is never routed, so its registered handler is not invoked', () => {
  calls.length = 0
  sameJson(dispatch(routes, registry, 'DELETE', '/api/games/x1'), { status: 'unmatched' }, 'unstated method outcome')
  sameJson(calls, [], 'unstated method calls')
})

gate('two routes that match the same request invoke nothing and name both doors', () => {
  calls.length = 0
  const twin = [...routes, ...compileDoors([{ door: 'twin', method: 'GET', path: '/api/agent/v1/me' }])]
  sameJson(dispatch(twin, registry, 'GET', '/api/agent/v1/me'), { status: 'ambiguous', doors: ['me', 'twin'] }, 'ambiguous outcome')
  sameJson(calls, [], 'ambiguous calls')
})

gate('a handler that throws is not retried, and the error reaches the caller', () => {
  let count = 0
  const failing = new Map([['me', () => {
    count += 1
    throw new Error('handler failed')
  }]])
  mustThrow(() => dispatch(routes, failing, 'GET', '/api/agent/v1/me'))
  same(count, 1, 'handler invocations')
})

gate('a registered entry that is not a function is refused, and nothing else runs', () => {
  const broken = new Map([['me', 'not a function']])
  mustThrow(() => dispatch(routes, broken, 'GET', '/api/agent/v1/me'))
})

finish()
