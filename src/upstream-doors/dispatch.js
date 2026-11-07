import { routeRequest } from './router.js'

export function dispatch(routes, registry, method, url, ...args) {
  const matches = routeRequest(routes, method, url)
  if (matches.length === 0) return { status: 'unmatched' }
  if (matches.length > 1) return { status: 'ambiguous', doors: matches.map((door) => door.door) }
  const [door] = matches
  if (!registry.has(door.door)) return { status: 'unregistered', door: door.door }
  const handler = registry.get(door.door)
  if (typeof handler !== 'function') throw new Error('registered handler for ' + door.door + ' is not a function')
  return { status: 'dispatched', door: door.door, result: handler(door, ...args) }
}
