import { gate, finish } from './lib/gate.mjs'
import {
  PLACEMENT_WEIGHTS, scoreRoom, scoreWorkerRooms, parseRoomPickQuery,
  RoomPickError, selectRoomForJoin,
  firstOpenRoom, mostFullWithSpace, nextRoomName, parseRoomPickBody,
  RoomHealthError, createRoomHealth,
  CronSyntaxError, parseCron, cronMatches, parseCrons, dueCrons,
  UPLOAD_MAX_BYTES, uploadBoundary, uploadExtension, uploadHeadAccepted, uploadTooLarge, MultipartUploadParser,
  LLM_REASON, createLlmJobs,
  encodeAgentEntity,
  isDevHmrEnabled,
} from '../src/sdk/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const same = (actual, expected, message) => {
  const left = JSON.stringify(actual)
  const right = JSON.stringify(expected)
  assert(left === right, `${message}: expected ${right}, got ${left}`)
}

const near = (actual, expected, message) => {
  assert(Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`)
}

const reasonOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error?.reasonCode ?? error?.name ?? 'untyped'
  }
  return null
}

const firings = (expr, startIso, count, limitMinutes = 60 * 24 * 800) => {
  const cron = parseCron(expr)
  const out = []
  let t = Date.parse(startIso)
  for (let i = 0; i < limitMinutes && out.length < count; i++, t += 60000) {
    if (cronMatches(cron, new Date(t))) out.push(new Date(t).toISOString())
  }
  return out
}

const rooms = [
  { roomId: 'a', worldName: 'w', players: 3, entities: 0, avgTickMs: 0, dilationFactor: 1 },
  { roomId: 'b', worldName: 'w', players: 1, entities: 0, avgTickMs: 0, dilationFactor: 1 },
  { roomId: 'c', worldName: 'other', players: 0, entities: 0, avgTickMs: 0, dilationFactor: 1 },
]
const pickRequest = (overrides = {}) => ({ requestedRoom: null, rejectedRooms: [], worldName: null, ...overrides })

gate('room placement weights and score match the documented formula', () => {
  same(PLACEMENT_WEIGHTS, { PLAYER_WEIGHT: 1.0, ENTITY_WEIGHT: 0.02, TICKMS_WEIGHT: 0.5, DILATION_PENALTY: 50 }, 'weights')
  near(scoreRoom({ players: 2, entities: 100, avgTickMs: 4, dilationFactor: 1 }), 6, 'two players, 100 entities, 4 ms')
  near(scoreRoom({ players: 1, dilationFactor: 0.9 }), 6, 'one player at dilation 0.9 costs 5')
  near(scoreRoom({}), 0, 'empty room with default dilation scores zero')
  near(scoreWorkerRooms([{ players: 2 }, { players: 3 }]), 5, 'worker score is the sum')
})

gate('negative control: a dilation below one raises the score', () => {
  assert(scoreRoom({ dilationFactor: 0.5 }) > scoreRoom({ dilationFactor: 1 }), 'dilation penalty did not raise the score')
})

gate('room pick query parses the documented search parameters', () => {
  same(parseRoomPickQuery(new URLSearchParams('requested=a&rejected=b,c,&world=w')), { requestedRoom: 'a', rejectedRooms: ['b', 'c'], worldName: 'w' }, 'full query')
  same(parseRoomPickQuery(new URLSearchParams('')), { requestedRoom: null, rejectedRooms: [], worldName: null }, 'empty query')
})

gate('negative control: a query with a different world name parses differently', () => {
  assert(parseRoomPickQuery(new URLSearchParams('world=x')).worldName !== 'w', 'world name was not kept')
})

gate('selectRoomForJoin picks the lowest score among same-world open rooms', () => {
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w' }) }).roomId, 'b', 'lowest score')
})

gate('selectRoomForJoin honours a requested room and skips rejected rooms', () => {
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w', requestedRoom: 'a' }) }).roomId, 'a', 'requested room wins over score')
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w', rejectedRooms: ['b'] }) }).roomId, 'a', 'rejected room is skipped')
})

gate('negative control: a world with no open rooms returns null', () => {
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'missing' }) }), null, 'no room for an unknown world')
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w', rejectedRooms: ['a', 'b'] }) }), null, 'every same-world room rejected')
})

gate('pickRoom callback choice is honoured and an outside choice is refused', () => {
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w' }), pickRoom: () => 'a' }).roomId, 'a', 'callback choice')
  same(selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w' }), pickRoom: () => null }), null, 'callback declines')
  same(reasonOf(() => selectRoomForJoin({ candidates: rooms, request: pickRequest({ worldName: 'w' }), pickRoom: () => 'c' })), 'pick-outside-candidates', 'choice outside the world is refused')
  assert(new RoomPickError('x', 'm') instanceof Error, 'RoomPickError is an Error')
})

gate('ties keep the first candidate in order', () => {
  const tied = [{ roomId: 'first', players: 1 }, { roomId: 'second', players: 1 }]
  same(selectRoomForJoin({ candidates: tied, request: pickRequest() }).roomId, 'first', 'tie')
})

const routingRooms = [
  { id: 'r1', players: 4, maxPlayers: 4 },
  { id: 'r2', players: 1, maxPlayers: 4 },
  { id: 'r3', players: 0, maxPlayers: 2 },
]

gate('firstOpenRoom skips full rooms and honours rejections', () => {
  same(firstOpenRoom(routingRooms).id, 'r2', 'first open room')
  same(firstOpenRoom(routingRooms, { rejected: ['r2'] }).id, 'r3', 'rejected room skipped')
  same(firstOpenRoom(routingRooms, { requestedRoomId: 'r3' }).id, 'r3', 'requested room')
})

gate('negative control: a full requested room and an exhausted list return null', () => {
  same(firstOpenRoom(routingRooms, { requestedRoomId: 'r1' }), null, 'full room cannot be requested')
  same(firstOpenRoom([{ id: 'x', players: 2, maxPlayers: 2 }]), null, 'no open room')
})

gate('mostFullWithSpace picks the fullest open room and breaks ties by id', () => {
  same(mostFullWithSpace(routingRooms).id, 'r2', 'fullest open room')
  same(mostFullWithSpace([{ id: 'b', players: 2, maxPlayers: 4 }, { id: 'a', players: 2, maxPlayers: 4 }]).id, 'a', 'tie by id')
  same(mostFullWithSpace([{ id: 'x', players: 2, maxPlayers: 2 }]), null, 'no open room')
})

gate('nextRoomName fills the lowest free number and refuses bad prefixes', () => {
  same(nextRoomName('room', []), 'room-1', 'empty list')
  same(nextRoomName('room', ['room-1', 'room-3']), 'room-2', 'gap is filled')
  same(reasonOf(() => nextRoomName('a b')), 'room-prefix-invalid', 'space in prefix')
  same(reasonOf(() => nextRoomName('')), 'room-prefix-invalid', 'empty prefix')
})

gate('nextRoomName reports exhaustion after 100000 names', () => {
  const taken = []
  for (let n = 1; n <= 100000; n++) taken.push(`room-${n}`)
  same(reasonOf(() => nextRoomName('room', taken)), 'room-name-exhausted', 'all names taken')
})

gate('routing refuses malformed room lists', () => {
  same(reasonOf(() => firstOpenRoom('nope')), 'room-rooms-invalid', 'not an array')
  same(reasonOf(() => firstOpenRoom([{ id: 'x', players: -1, maxPlayers: 2 }])), 'room-entry-invalid', 'negative players')
  same(reasonOf(() => firstOpenRoom([{ id: 'x', players: '1', maxPlayers: 2 }])), 'room-entry-invalid', 'string players')
  same(reasonOf(() => mostFullWithSpace([{ id: '', players: 0, maxPlayers: 2 }])), 'room-entry-invalid', 'empty id')
  same(reasonOf(() => firstOpenRoom([{ id: 'x', players: 0, maxPlayers: 0 }])), 'room-entry-invalid', 'zero capacity')
})

gate('parseRoomPickBody accepts the documented shapes and refuses others', () => {
  same(parseRoomPickBody({}), { requestedRoomId: null, rejected: [], world: null }, 'empty object')
  same(parseRoomPickBody({ requested: 'r1', rejected: ['r2'], worldName: 'w' }), { requestedRoomId: 'r1', rejected: ['r2'], world: 'w' }, 'alias keys')
  same(reasonOf(() => parseRoomPickBody(null)), 'room-request-invalid', 'null body')
  same(reasonOf(() => parseRoomPickBody([])), 'room-request-invalid', 'array body')
  same(reasonOf(() => parseRoomPickBody({ rejected: [1] })), 'room-request-invalid', 'numeric rejection')
  same(reasonOf(() => parseRoomPickBody({ world: 5 })), 'room-request-invalid', 'numeric world')
})

gate('room health windows percentiles and budget overruns', () => {
  const health = createRoomHealth({ tickBudgetMs: 10, windowTicks: 4, startedAt: 1000, now: () => 1500, memory: () => ({ heapUsed: 1, rss: 2, external: 3, arrayBuffers: 4 }) })
  health.recordTick(1, 4)
  health.recordTick(2, 12)
  health.recordTick(3, 8)
  health.recordTick(4, 6)
  health.recordTick(5, 2)
  const snap = health.snapshot()
  same(snap.tick, 5, 'last tick')
  same(snap.ticks, 5, 'tick count')
  same(snap.uptimeMs, 500, 'uptime from injected clock')
  same(snap.tickMs, { p50: 8, p95: 12, max: 12, window: 4 }, 'window of the last four samples')
  same(snap.overBudget, { ticks: 1, ratio: 0.2 }, 'one tick over 10 ms')
  same(snap.memory, { heapUsed: 1, rss: 2, external: 3, arrayBuffers: 4 }, 'injected memory')
})

gate('negative control: a tick exactly at budget is not an overrun', () => {
  const health = createRoomHealth({ tickBudgetMs: 10, now: () => 0, memory: () => ({ heapUsed: 0, rss: 0, external: 0, arrayBuffers: 0 }) })
  health.recordTick(1, 10)
  same(health.snapshot().overBudget, { ticks: 0, ratio: 0 }, 'exactly budget')
})

gate('room health jolt headroom is computed only when both numbers are given', () => {
  const health = createRoomHealth({ tickBudgetMs: 10, now: () => 0, memory: () => ({ heapUsed: 0, rss: 0, external: 0, arrayBuffers: 0 }) })
  const full = health.snapshot({ bodies: 10, bodyLimit: 100, joltHeapBytes: 50, joltHeapLimitBytes: 200 })
  same(full.jolt.bodyHeadroom, 90, 'body headroom')
  same(full.jolt.heapHeadroomBytes, 150, 'heap headroom')
  const partial = health.snapshot({ bodies: 10 })
  same(partial.jolt.bodyHeadroom, null, 'headroom without limit is null')
  same(health.snapshot().tickMs, { p50: null, p95: null, max: null, window: 0 }, 'empty window')
})

gate('room health refuses bad budgets, windows and tick records', () => {
  same(reasonOf(() => createRoomHealth({ tickBudgetMs: 0 })), 'budget-not-positive-finite', 'zero budget')
  same(reasonOf(() => createRoomHealth({ tickBudgetMs: Infinity })), 'budget-not-positive-finite', 'infinite budget')
  same(reasonOf(() => createRoomHealth({ tickBudgetMs: 10, windowTicks: 0 })), 'window-not-positive-integer', 'zero window')
  same(reasonOf(() => createRoomHealth({ tickBudgetMs: 10, windowTicks: 1.5 })), 'window-not-positive-integer', 'fractional window')
  const health = createRoomHealth({ tickBudgetMs: 10, now: () => 0, memory: () => ({ heapUsed: 0, rss: 0, external: 0, arrayBuffers: 0 }) })
  same(reasonOf(() => health.recordTick(1.5, 3)), 'tick-not-integer', 'fractional tick')
  same(reasonOf(() => health.recordTick(1, -1)), 'tick-ms-not-finite', 'negative milliseconds')
  same(reasonOf(() => health.recordTick(1, NaN)), 'tick-ms-not-finite', 'NaN milliseconds')
  assert(new RoomHealthError('x', 'm') instanceof Error, 'RoomHealthError is an Error')
})

gate('cron fields expand steps and ranges to the hand-derived values', () => {
  same([...parseCron('*/15 * * * *').minute].sort((a, b) => a - b), [0, 15, 30, 45], 'every 15 minutes')
  same([...parseCron('5-20/5 * * * *').minute].sort((a, b) => a - b), [5, 10, 15, 20], 'range with step')
  same([...parseCron('0 0 * * 0-6/3').dayOfWeek].sort((a, b) => a - b), [0, 3, 6], 'weekday step')
  assert(parseCron('* * * * 1').domRestricted === false && parseCron('* * * * 1').dowRestricted === true, 'restriction flags')
})

gate('cron refuses malformed expressions with the documented reasons', () => {
  same(reasonOf(() => parseCron(5)), 'not-a-string', 'number')
  same(reasonOf(() => parseCron('* * * *')), 'field-count', 'four fields')
  same(reasonOf(() => parseCron('a * * * *')), 'bad-field', 'letter field')
  same(reasonOf(() => parseCron('*/0 * * * *')), 'bad-step', 'zero step')
  same(reasonOf(() => parseCron('60 * * * *')), 'out-of-range', 'minute 60')
  same(reasonOf(() => parseCron('0 0 0 * *')), 'out-of-range', 'day of month 0')
  same(reasonOf(() => parseCron('5-3 * * * *')), 'out-of-range', 'reversed range')
  same(reasonOf(() => parseCron('0 0 * * 7')), 'out-of-range', 'weekday 7')
  assert(new CronSyntaxError('x', 'y') instanceof Error, 'CronSyntaxError is an Error')
})

gate('cron weekly schedule fires on the hand-derived Mondays only', () => {
  same(firings('30 9 * * 1', '2026-11-07T00:00:00Z', 3), ['2026-11-09T09:30:00.000Z', '2026-11-16T09:30:00.000Z', '2026-11-23T09:30:00.000Z'], 'Mondays at 09:30 UTC')
})

gate('negative control: a Sunday at the same time does not fire the Monday schedule', () => {
  assert(!cronMatches(parseCron('30 9 * * 1'), new Date('2026-11-08T09:30:00Z')), 'Sunday matched a Monday schedule')
})

gate('cron with both day fields restricted fires on either (OR)', () => {
  same(firings('0 12 1,15 * 5', '2026-11-01T00:00:00Z', 6), [
    '2026-11-01T12:00:00.000Z',
    '2026-11-06T12:00:00.000Z',
    '2026-11-13T12:00:00.000Z',
    '2026-11-15T12:00:00.000Z',
    '2026-11-20T12:00:00.000Z',
    '2026-11-27T12:00:00.000Z',
  ], 'day of month or Friday')
})

gate('negative control: an unrestricted weekday does not add Fridays to a day-of-month schedule', () => {
  same(firings('0 12 1,15 * *', '2026-11-01T00:00:00Z', 2), ['2026-11-01T12:00:00.000Z', '2026-11-15T12:00:00.000Z'], 'only the 1st and 15th')
})

gate('cron leap day fires in 2028 and not in 2027', () => {
  same(firings('0 0 29 2 *', '2026-11-07T00:00:00Z', 1), ['2028-02-29T00:00:00.000Z'], 'first leap day')
  assert(!cronMatches(parseCron('0 0 29 2 *'), new Date('2027-02-28T00:00:00Z')), 'matched a non-leap year')
})

gate('parseCrons refuses duplicate names and dueCrons selects by the minute', () => {
  same(reasonOf(() => parseCrons([{ name: 'a', schedule: '* * * * *' }, { name: 'a', schedule: '* * * * *' }])), 'duplicate-name', 'duplicate name')
  const crons = parseCrons([{ name: 'weekly', schedule: '30 9 * * 1' }, { name: 'hourly', schedule: '0 * * * *' }])
  same(dueCrons(crons, Date.UTC(2026, 10, 9, 9, 30, 45)), ['weekly'], 'Monday 09:30:45 falls in the 09:30 minute')
  same(dueCrons(crons, Date.UTC(2026, 10, 9, 10, 0, 0)), ['hourly'], 'top of the hour')
  same(dueCrons(crons, Date.UTC(2026, 10, 9, 9, 31, 0)), [], 'no firing at 09:31')
})

gate('upload boundary is read from quoted and unquoted content types', () => {
  same(uploadBoundary('multipart/form-data; boundary=abc123'), 'abc123', 'unquoted')
  same(uploadBoundary('multipart/form-data; boundary="a-b c"'), 'a-b c', 'quoted')
  same(uploadBoundary('multipart/form-data'), null, 'no boundary')
  same(uploadBoundary(undefined), null, 'missing header')
})

gate('upload extension admits only glb, gltf and vrm, case-insensitively', () => {
  same(uploadExtension('Model.GLB'), '.glb', 'upper case glb')
  same(uploadExtension('scene.gltf'), '.gltf', 'gltf')
  same(uploadExtension('avatar.vrm'), '.vrm', 'vrm')
  same(uploadExtension('tool.exe'), null, 'executable refused')
  same(uploadExtension('model'), null, 'no extension refused')
  same(uploadExtension(''), null, 'empty name refused')
})

gate('upload head check requires the GLB magic or a JSON opening brace', () => {
  assert(uploadHeadAccepted('.glb', Buffer.from('glTF\u0002\u0000\u0000\u0000')), 'glb magic refused')
  assert(!uploadHeadAccepted('.glb', Buffer.from('{"asset":{}}')), 'json accepted as glb')
  assert(!uploadHeadAccepted('.glb', Buffer.from('glT')), 'short glb head accepted')
  assert(uploadHeadAccepted('.gltf', Buffer.from('  \n{"asset":{}}')), 'json with leading whitespace refused')
  assert(!uploadHeadAccepted('.gltf', Buffer.from('glTF')), 'glb magic accepted as gltf')
  assert(!uploadHeadAccepted('.vrm', Buffer.from('MZ\u0090\u0000')), 'binary executable accepted as vrm')
})

gate('upload size limit is 50 MiB inclusive', () => {
  same(UPLOAD_MAX_BYTES, 50 * 1024 * 1024, 'limit')
  assert(!uploadTooLarge(UPLOAD_MAX_BYTES), 'exactly the limit refused')
  assert(uploadTooLarge(UPLOAD_MAX_BYTES + 1), 'one byte over was accepted')
})

const payload = Buffer.from('glTF\u0002\u0000\u0000\u0000--BN\r\nxyz\u0000ÿ')
const firstPart = '--BND\r\nContent-Disposition: form-data; name="model"; filename="a.glb"\r\nContent-Type: model/gltf-binary\r\n\r\n'
const secondPart = '\r\n--BND\r\nContent-Disposition: form-data; name="other"; filename="b.glb"\r\n\r\nSECOND\r\n--BND--\r\n'
const fullBody = Buffer.concat([Buffer.from(firstPart), payload, Buffer.from(secondPart)])

const runParser = (body, chunkSize) => {
  const parser = new MultipartUploadParser('BND')
  const names = []
  const chunks = []
  let ends = 0
  parser.onFileStart = (name) => names.push(name)
  parser.onFileData = (chunk) => chunks.push(Buffer.from(chunk))
  parser.onFileEnd = () => { ends++ }
  for (let offset = 0; offset < body.length; offset += chunkSize) parser.write(body.subarray(offset, offset + chunkSize))
  return { names, data: Buffer.concat(chunks), ends }
}

const oneByte = runParser(fullBody, 1)
const oneShot = runParser(fullBody, fullBody.length)
const sevenBytes = runParser(fullBody, 7)

gate('multipart parser yields only the first file part, byte for byte, at any chunk size', () => {
  same(oneByte.names, ['a.glb'], 'first file name only')
  assert(oneByte.data.equals(payload), 'payload differs at one byte per chunk')
  assert(oneShot.data.equals(payload), 'payload differs in one write')
  assert(sevenBytes.data.equals(payload), 'payload differs at seven bytes per chunk')
  same(oneByte.ends, 1, 'one end for the file')
})

gate('negative control: the second file part is never emitted', () => {
  assert(!oneByte.data.includes(Buffer.from('SECOND')), 'second file data leaked into the first file')
  same(oneByte.names.includes('b.glb'), false, 'second file name started')
})

gate('negative control: a body with no file part emits nothing', () => {
  const noFile = runParser(Buffer.from('--BND\r\nContent-Disposition: form-data; name="x"\r\n\r\nvalue\r\n--BND--\r\n'), 3)
  same(noFile.names, [], 'no file start')
  same(noFile.data.length, 0, 'no file data')
  same(noFile.ends, 0, 'no file end')
})

const echoing = createLlmJobs({ provider: { complete: async () => 'unused' }, maxMessages: 2 })

const badPrompt = await echoing.start({ prompt: '   ' }).done
const longPrompt = await createLlmJobs({ provider: { complete: async () => 'x' }, maxPromptChars: 4 }).start({ prompt: 'hello' }).done
const badPartHandler = await echoing.start({ prompt: 'p', onPart: 'not a function' }).done
const noProvider = await createLlmJobs().start({ prompt: 'hi' }).done
const badConversation = await echoing.start({ prompt: 'hi', conversation: '' }).done

const partsSeen = []
const streamed = await createLlmJobs({
  provider: {
    complete: async ({ onPart }) => {
      onPart('ab')
      onPart('cd')
      return undefined
    },
  },
}).start({ prompt: 'stream', onPart: (chunk) => partsSeen.push(chunk) }).done

const emptyReply = await createLlmJobs({ provider: { complete: async () => '' } }).start({ prompt: 'x' }).done
const threw = await createLlmJobs({ provider: { complete: async () => { throw new Error('boom') } } }).start({ prompt: 'x' }).done
const partThrew = await createLlmJobs({
  provider: { complete: async ({ onPart }) => { onPart('a'); onPart('b'); return 'ab' } },
}).start({ prompt: 'x', onPart: () => { throw new Error('ui broke') } }).done

const memorySeen = []
const memory = createLlmJobs({
  provider: {
    complete: async ({ messages }) => {
      memorySeen.push(messages.length)
      return 'r' + memorySeen.length
    },
  },
  maxMessages: 2,
})
const firstTurn = await memory.start({ conversation: 'c1', prompt: 'one' }).done
const secondTurn = await memory.start({ conversation: 'c1', prompt: 'two' }).done
const thirdTurn = await memory.start({ conversation: 'c1', prompt: 'three' }).done
const boundedHistory = memory.history('c1')

const failedTurn = createLlmJobs({ provider: { complete: async () => { throw new Error('down') } } })
const failedResult = await failedTurn.start({ conversation: 'x', prompt: 'lost' }).done
const failedHistory = failedTurn.history('x')

const hanging = createLlmJobs({
  provider: {
    complete: ({ signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }),
  },
})
const cancelling = hanging.start({ prompt: 'wait' })
cancelling.cancel()
const cancelled = await cancelling.done

const disposable = createLlmJobs({ provider: { complete: async () => 'ok' } })
await disposable.start({ conversation: 'd', prompt: 'hi' }).done
disposable.dispose()
const afterDispose = await disposable.start({ prompt: 'hi' }).done

const swappable = createLlmJobs()
swappable.setProvider({ complete: async () => 'now here' })
const afterSwap = await swappable.start({ prompt: 'hi' }).done

const resettable = createLlmJobs({ provider: { complete: async () => 'ok' } })
await resettable.start({ conversation: 'r', prompt: 'hi' }).done
resettable.reset('r')
const afterReset = resettable.history('r')

gate('llm jobs refuse bad prompts, handlers and conversations', () => {
  same(badPrompt.reasonCode, LLM_REASON.BAD_PROMPT, 'blank prompt')
  same(longPrompt.reasonCode, LLM_REASON.BAD_PROMPT, 'prompt over the character cap')
  same(badPartHandler.reasonCode, LLM_REASON.BAD_PROMPT, 'onPart that is not a function')
  same(badConversation.reasonCode, LLM_REASON.BAD_CONVERSATION, 'empty conversation id')
})

gate('llm jobs report a missing provider and refuse invalid construction', () => {
  same(noProvider, { ok: false, reasonCode: 'no-provider', message: 'no llm provider is configured for this runtime' }, 'no provider')
  same(reasonOf(() => createLlmJobs({ provider: {} })), 'TypeError', 'provider without complete is refused')
  same(reasonOf(() => createLlmJobs({ maxMessages: 1 })), 'RangeError', 'maxMessages 1 is refused')
  same(reasonOf(() => createLlmJobs({ maxPromptChars: 0 })), 'RangeError', 'maxPromptChars 0 is refused')
})

gate('llm jobs return the reply text and stream parts in order', () => {
  same(streamed, { ok: true, text: 'abcd' }, 'streamed text is the joined parts')
  same(partsSeen, ['ab', 'cd'], 'parts forwarded in order')
  same(emptyReply.reasonCode, LLM_REASON.EMPTY_REPLY, 'empty reply refused')
})

gate('llm jobs map provider errors and part-handler errors to reasons', () => {
  same(threw, { ok: false, reasonCode: 'provider-threw', message: 'boom' }, 'provider error')
  same(partThrew, { ok: false, reasonCode: 'part-handler-threw', message: 'ui broke' }, 'part handler error')
  same(failedResult.reasonCode, LLM_REASON.PROVIDER_THREW, 'failed turn reason')
})

gate('llm conversation memory keeps the last maxMessages entries', () => {
  same(firstTurn.text, 'r1', 'first reply')
  same(secondTurn.text, 'r2', 'second reply')
  same(thirdTurn.text, 'r3', 'third reply')
  same(memorySeen, [1, 3, 3], 'message counts sent to the provider')
  same(boundedHistory, [{ role: 'user', content: 'three' }, { role: 'assistant', content: 'r3' }], 'history after the bound')
})

gate('negative control: a failed turn does not enter the conversation', () => {
  same(failedHistory, [], 'failed turn left no history')
})

gate('llm jobs cancel through the abort signal and report it', () => {
  same(cancelled.reasonCode, LLM_REASON.CANCELLED, 'cancelled job reason')
  assert(cancelling.cancelled === true, 'job did not record cancellation')
})

gate('llm dispose and reset clear the provider and the conversation', () => {
  same(afterDispose.reasonCode, LLM_REASON.NO_PROVIDER, 'provider removed by dispose')
  same(afterSwap, { ok: true, text: 'now here' }, 'provider set after creation')
  same(afterReset, [], 'reset conversation is empty')
})

const exampleEntity = {
  _appName: 'door',
  model: 'door.glb',
  position: [1, 2, 3],
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  scale: [1, 1, 1],
  config: { open: true },
}
const identityBase = { point: (p) => p.map(v => v + 100), quat: (q) => q }
const rotatedEntity = { _appName: 'gate', position: [0, 0, 0], rotation: { x: 0, y: 1, z: 0, w: 0 }, scale: [2, 1, 1] }

gate('agent entity encoding omits identity rotation and scale', () => {
  same(encodeAgentEntity('e1', exampleEntity), { id: 'e1', app: 'door', model: 'door.glb', position: [1, 2, 3], config: { open: true } }, 'identity fields omitted')
  same(encodeAgentEntity('e2', rotatedEntity), { id: 'e2', app: 'gate', position: [0, 0, 0], rotation: [0, 1, 0, 0], scale: [2, 1, 1] }, 'non-identity fields kept')
})

gate('agent entity encoding rebases root entities and leaves children alone', () => {
  same(encodeAgentEntity('e1', exampleEntity, identityBase).position, [101, 102, 103], 'root rebased')
  same(encodeAgentEntity('e3', { ...exampleEntity, parent: 'p' }, identityBase).position, [1, 2, 3], 'child not rebased')
})

gate('negative control: an empty config object is not emitted', () => {
  assert(!('config' in encodeAgentEntity('e4', { position: [0, 0, 0], config: {} })), 'empty config emitted')
})

gate('HMR is enabled by default and disabled by production, the opt-out flag or the no-watch flag', () => {
  assert(isDevHmrEnabled({}) === true, 'default is enabled')
  assert(isDevHmrEnabled({ NODE_ENV: 'production' }) === false, 'production disables')
  assert(isDevHmrEnabled({ SPOINT_HMR: '0' }) === false, 'SPOINT_HMR=0 disables')
  assert(isDevHmrEnabled({ SPOINT_NO_WATCH: '1' }) === false, 'no-watch disables')
  assert(isDevHmrEnabled({ SPOINT_HMR: '1', NODE_ENV: 'development' }) === true, 'explicit on stays enabled')
})

finish()
