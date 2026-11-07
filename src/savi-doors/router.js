const ROUTABLE_VERBS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const PARAM = /\{[^}]*\}|<[^>]*>/g
const STRAY = /[{}<>]/
const NOTE_OR_QUERY = /\s*\(|\?/
const HOST = /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(?=\/)/i

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function routePathOf(path) {
  return path.split(NOTE_OR_QUERY)[0].trim().replace(HOST, '')
}

export function requestPathOf(url) {
  return url.split('?')[0].replace(HOST, '')
}

export function compileDoor(door) {
  if (!ROUTABLE_VERBS.has(door.method)) return null
  const path = routePathOf(door.path)
  const params = path.match(PARAM) ?? []
  if (STRAY.test(path.replace(PARAM, ''))) throw new Error('malformed route template: ' + door.path)
  const pieces = path.split(PARAM)
  let source = ''
  pieces.forEach((piece, index) => {
    source += escapeRegExp(piece)
    if (index < params.length) source += '[^/]+'
  })
  return { door, method: door.method, regex: new RegExp('^' + source + '$') }
}

export function compileDoors(doors) {
  return doors.map(compileDoor).filter((route) => route !== null)
}

export function routeRequest(routes, method, url) {
  const path = requestPathOf(url)
  return routes.filter((route) => route.method === method && route.regex.test(path)).map((route) => route.door)
}
