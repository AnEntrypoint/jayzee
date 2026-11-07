import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseDoorCatalog } from '../src/upstream-doors/catalog.js'
import { compileDoor, compileDoors, routeRequest, routePathOf } from '../src/upstream-doors/router.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const catalogPath = join(root, 'scripts', 'fixtures', 'upstream', 'CATALOG.md')
const CATALOG_SHA256 = '1af9ca969421e05aa26a0daf58e87ec9757e0d571df7d6edbb0ddd763a3a982c'
const ROUTABLE = 66
const UNROUTABLE = ['delete', 'play.attach', 'git', 'openapi']

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

const doors = parseDoorCatalog(readFileSync(catalogPath, 'utf8'))
const routes = compileDoors(doors)
const routed = new Set(routes.map((route) => route.door))
const fill = (path) => path.replace(/\{[^}]*\}|<[^>]*>/g, 'x1')
const hostOf = 'https://www.spawn.co'

gate('the catalog fixture is the upstream file the door gate pins', () => {
  same(createHash('sha256').update(readFileSync(catalogPath)).digest('hex'), CATALOG_SHA256, 'sha256')
})

gate('66 doors with an HTTP verb compile to routes, and the four without one do not', () => {
  same(routes.length, ROUTABLE, 'routable doors')
  sameJson(doors.filter((door) => !routed.has(door)).map((door) => door.door), UNROUTABLE, 'unroutable doors')
})

gate('every routable door routes to itself from a filled example, and to no other door', () => {
  for (const door of doors.filter((item) => routed.has(item))) {
    const hits = routeRequest(routes, door.method, hostOf + fill(routePathOf(door.path)) + '?x=1')
    sameJson(hits.map((hit) => hit.door), [door.door], door.door + ' hits')
  }
})

gate('a request with a host, a query string or no host routes the same way', () => {
  const me = doors.find((door) => door.door === 'me')
  sameJson(routeRequest(routes, 'GET', hostOf + '/api/agent/v1/me').map((door) => door.door), ['me'], 'with host')
  sameJson(routeRequest(routes, 'GET', '/api/agent/v1/me?unread=1').map((door) => door.door), ['me'], 'with query')
  sameJson(routeRequest(routes, 'GET', '/api/agent/v1/me').map((door) => door.door), ['me'], 'bare path')
  same(me.method, 'GET', 'me method')
})

gate('a wrong method, an extra segment, a trailing slash and an unknown path match no door', () => {
  sameJson(routeRequest(routes, 'DELETE', '/api/agent/v1/me'), [], 'wrong method')
  sameJson(routeRequest(routes, 'GET', '/api/agent/v1/me/extra'), [], 'extra segment')
  sameJson(routeRequest(routes, 'GET', '/api/agent/v1/me/'), [], 'trailing slash')
  sameJson(routeRequest(routes, 'GET', '/api/no/such/door'), [], 'unknown path')
})

gate('a template parameter stays inside one path segment, and a parameter-free door does not match a longer path', () => {
  sameJson(routeRequest(routes, 'GET', '/api/sdk/v1/a/b/agent/docs').map((door) => door.door), [], 'two segments in worldId')
  sameJson(routeRequest(routes, 'GET', '/api/sdk/v1/w1/agent/docs').map((door) => door.door), ['docs'], 'one segment in worldId')
})

gate('the regular expression escapes dots, so a dot in a path is only a dot', () => {
  sameJson(routeRequest(routes, 'GET', '/api/agent/v1/meX').map((door) => door.door), [], 'no regular-expression dot')
})

gate('a malformed template with an unclosed or stray brace or bracket is refused when compiled', () => {
  for (const path of ['/api/{id', '/api/x}', '/api/<a', '/api/b>']) {
    mustReject(() => compileDoor({ door: 'bad', method: 'GET', path }))
  }
  same(compileDoor({ door: 'ok', method: 'GET', path: '/api/{a}/b' }).regex.test('/api/z/b'), true, 'well-formed template still matches')
})

gate('a door whose method is not stated is refused rather than guessed', () => {
  const stated = doors.find((door) => door.door === 'delete')
  sameJson(routeRequest(routes, 'DELETE', '/api/games/x1').map((door) => door.door), [], 'delete without a stated method')
  same(stated.method, 'method not stated in source', 'delete method cell')
})

const findingsIn = (source) => {
  const found = []
  if (source.includes("//") || source.includes("/*")) found.push("comment marker")
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith(".")) found.push("bare import " + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of ["process", "performance", "Date", "setTimeout", "clearTimeout", "setImmediate", "setInterval", "console", "window", "globalThis", "require", "Buffer", "URL"]) {
    if (words.has(token)) found.push("uses " + token)
  }
  return found
}

gate("src/upstream-doors/router.js is comment-free, imports nothing bare and reads no host global", () => {
  const source = readFileSync(join(root, "src", "upstream-doors", "router.js"), "utf8")
  sameJson(findingsIn(source), [], "findings")
})

finish()
