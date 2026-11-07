import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { firstOpenRoom, mostFullWithSpace, nextRoomName, roomFor, ROOM_ROUTING_NAMES } from '../src/savi-builtins/roomRouting.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-room-routing.md')
const skillPath = join(root, 'scripts', 'fixtures', 'savi', 'skills', 'rooms-and-matchmaking.json')
const sourcePath = join(root, 'src', 'savi-builtins', 'roomRouting.js')

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

const room = (roomId, playerCount, maxPlayers, createdAt = 0) => ({ roomId, playerCount, maxPlayers, createdAt })

gate('the names, the section sentences and the savi skill semantics are the ones savi documents for room-routing', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('firstOpenRoom selects the requested open room, an available room, or a new room.'), true, 'firstOpenRoom sentence')
  same(section.includes('mostFullWithSpace returns null when none has space.'), true, 'mostFullWithSpace sentence')
  same(section.includes('roomFor gives a stable room name for a key.'), true, 'roomFor sentence')
  same(section.includes('nextRoomName(rooms, exclude?: string[]): string;'), true, 'nextRoomName signature')
  const skill = JSON.parse(readFileSync(skillPath, 'utf8')).content
  same(skill.includes('fullest with space, ties to the oldest, null when every room is full'), true, 'fullest and tie rule')
  same(skill.includes('the lowest free room-{n}'), true, 'lowest free name rule')
  same(skill.includes('a stable readable key'), true, 'stable key rule')
  same(skill.includes('US East 1'), true, 'example key')
  same(skill.includes('room-us-east-1'), true, 'example name')
  sameJson(ROOM_ROUTING_NAMES, ['firstOpenRoom', 'mostFullWithSpace', 'nextRoomName', 'roomFor'], 'exported names')
})

gate('roomFor makes the stable readable name, the same for the same key, from the example and from odd punctuation', () => {
  same(roomFor('US East 1'), 'room-us-east-1', 'the documented example')
  same(roomFor('Lobby__A!!'), 'room-lobby-a', 'punctuation runs become one dash')
  same(roomFor('  x  '), 'room-x', 'surrounding space is trimmed')
  same(roomFor('US East 1'), roomFor('US East 1'), 'stable across calls')
})

gate('nextRoomName is the lowest free room-n, and skips rooms and excluded names', () => {
  same(nextRoomName([]), 'room-1', 'empty world')
  same(nextRoomName([room('room-1', 0, 4), room('room-3', 0, 4)]), 'room-2', 'the gap is the lowest free')
  same(nextRoomName([room('room-1', 0, 4)], ['room-2']), 'room-3', 'excluded names are taken')
  same(nextRoomName([room('main', 0, 4)]), 'room-1', 'a non-numbered room does not take a number')
})

gate('mostFullWithSpace is the fullest room with space, ties to the oldest, and null when every room is full', () => {
  const rooms = [room('a', 3, 4, 1), room('b', 2, 4, 0), room('c', 4, 4, 0)]
  same(mostFullWithSpace({ rooms }), 'a', 'the fullest with space')
  same(mostFullWithSpace({ rooms: [room('a', 2, 4, 5), room('b', 2, 4, 1)] }), 'b', 'ties to the oldest')
  same(mostFullWithSpace({ rooms: [room('a', 4, 4), room('b', 6, 6)] }), null, 'every room full')
  same(mostFullWithSpace({ rooms: [] }), null, 'no rooms')
  same(mostFullWithSpace({ rooms, rejectedRooms: ['a'] }), 'b', 'a rejected room is not chosen')
})

gate('firstOpenRoom takes the requested room when it has space, else the fullest with space, else a new room', () => {
  const rooms = [room('a', 3, 4, 1), room('b', 2, 4, 0), room('c', 4, 4, 0)]
  same(firstOpenRoom({ rooms, requestedRoomId: 'b' }), 'b', 'requested room with space wins over a fuller one')
  same(firstOpenRoom({ rooms, requestedRoomId: 'c' }), 'a', 'requested full room falls to the fullest with space')
  same(firstOpenRoom({ rooms, requestedRoomId: 'zz' }), 'a', 'requested unlisted room falls to the fullest with space')
  same(firstOpenRoom({ rooms, requestedRoomId: 'a', rejectedRooms: ['a'] }), 'b', 'a rejected requested room is not taken')
  same(firstOpenRoom({ rooms: [room('a', 4, 4), room('b', 4, 4)], rejectedRooms: ['a'] }), 'room-1', 'every room full: a new room')
  same(firstOpenRoom({ rooms: [] }), 'room-1', 'no rooms: a new room')
})

gate('scoped negatives: a non-array room list, a room without an id or with bad counts, a bad rejected list and a key with no characters are refused', () => {
  mustThrow(() => mostFullWithSpace({}))
  mustThrow(() => mostFullWithSpace({ rooms: [{ playerCount: 1, maxPlayers: 4 }] }))
  mustThrow(() => mostFullWithSpace({ rooms: [room('a', -1, 4)] }))
  mustThrow(() => mostFullWithSpace({ rooms: [room('a', 1, 0)] }))
  mustThrow(() => mostFullWithSpace({ rooms: [room('a', 1, 4)], rejectedRooms: 'a' }))
  mustThrow(() => nextRoomName([room('a', 1, 4)], [3]))
  mustThrow(() => roomFor(42))
  mustThrow(() => roomFor('!!!'))
  mustThrow(() => roomFor('x'.repeat(70)))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/roomRouting.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
