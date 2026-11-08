import { writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { PhysicsWorld } from '/workspace/spoint/src/physics/World.js'
import { createCollisionTileStreamer } from '/workspace/spoint/src/netcode/CollisionTileStreamer.js'
import { MSG } from '/workspace/spoint/src/protocol/MessageTypes.js'

const OUT = new URL('./fixtures/spoint/', import.meta.url)
const GRAVITY = [0, -9.81, 0]
const TICKS = 24
const RESETS = { 18: [1] }

function box(cx, cy, cz, hx, hy, hz) {
  const vertices = [
    cx - hx, cy - hy, cz - hz, cx + hx, cy - hy, cz - hz, cx + hx, cy + hy, cz - hz, cx - hx, cy + hy, cz - hz,
    cx - hx, cy - hy, cz + hz, cx + hx, cy - hy, cz + hz, cx + hx, cy + hy, cz + hz, cx - hx, cy + hy, cz + hz,
  ]
  const indices = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7]
  return { vertices, indices, position: [0, 0, 0] }
}

const SCENE = [
  { vertices: [-40, 0, -40, 40, 0, -40, 40, 0, 40, -40, 0, 40], indices: [0, 2, 1, 0, 3, 2], position: [0, 0, 0] },
  box(5, 1, 5, 1, 1, 1),
  box(-20, 2, -3, 3, 2, 1.5),
  box(12, 0.5, -14, 6, 0.5, 2),
  box(-7, 3, 21, 2, 3, 2),
  box(30, 1, 30, 1, 1, 1),
]

const RAYS = [
  { origin: [0, 10, 0], direction: [0, -1, 0], maxDistance: 100 },
  { origin: [5, 5, 5], direction: [0, -1, 0], maxDistance: 20 },
  { origin: [-20, 10, -3], direction: [0, -1, 0], maxDistance: 20 },
  { origin: [10, 3, -14], direction: [0, -1, 0], maxDistance: 10 },
  { origin: [30, 3, 30], direction: [0, -1, 0], maxDistance: 10 },
  { origin: [-30, 5, -30], direction: [1, 0, 1], maxDistance: 100 },
  { origin: [-7, 10, 21], direction: [0.2, -1, 0], maxDistance: 30 },
  { origin: [0, 0.5, 0], direction: [1, 0, 0], maxDistance: 60 },
]

const TILE_QUERIES = [[0, 0], [1, 0], [-1, -1], [-2, 1], [3, -2], [2, 2], [6, 6], [-5, -5]]

const CHARACTERS = {
  playerBodies: [[1, { charId: 1 }], [2, { charId: 2 }], [3, { charId: 3 }]],
  charShapes: [
    [1, { radius: 0.4, standHeight: 1.8, crouchHeight: 0.9, slopeAngle: 0.7 }],
    [3, { radius: 0.5, standHeight: 1.9, crouchHeight: 1.0, slopeAngle: 0.6 }],
  ],
  managerConfig: { maxStepHeight: 0.4, stickToFloorDistance: 0.25 },
  integrationConfig: { playerMass: 70, gravity: GRAVITY },
}

const PLAYERS = (t) => {
  const out = [{ id: 1, position: [-30 + 4 * t, 1, -12 + 2 * t] }, { id: 2, position: [22 - 3 * t, 1, 18 - 4 * t] }]
  if (t < 16) out.push({ id: 3, position: [0, 1, -30 + 3 * t] })
  return out
}

const nameOf = (type) => Object.keys(MSG).find((k) => MSG[k] === type)
const summarize = (type, payload) => {
  if (type === MSG.COLLISION_TILE) return { tx: payload.tx, tz: payload.tz, h: payload.h, bytes: payload.v.byteLength, sha256: createHash('sha256').update(payload.v).digest('hex') }
  return JSON.parse(JSON.stringify(payload))
}
const plain = (x) => JSON.parse(JSON.stringify(x))

async function buildWorld() {
  const quiet = console.log
  console.log = () => {}
  try {
    const world = new PhysicsWorld({ gravity: GRAVITY })
    await world.init()
    const ids = SCENE.map((body, i) => world.addStaticTrimeshFromData(i + 1, body.vertices, body.indices, body.position))
    return { world, ids }
  } finally {
    console.log = quiet
  }
}

const hostBuilt = await buildWorld()
const hostWorld = hostBuilt.world
const bounds = hostBuilt.ids.map((id) => {
  const bb = hostWorld.bodies.get(id).GetWorldSpaceBounds()
  return { min: [bb.mMin.GetX(), bb.mMin.GetY(), bb.mMin.GetZ()], max: [bb.mMax.GetX(), bb.mMax.GetY(), bb.mMax.GetZ()] }
})
const pickRay = (r) => ({ hit: r.hit, distance: r.distance, bodyId: r.bodyId, normal: r.normal, position: r.position })
const rays = RAYS.map((r) => ({ ...r, expect: pickRay(hostWorld.raycast(r.origin, r.direction, r.maxDistance)) }))
const hostIndex = hostWorld.enableStaticTiles()
const tiles = TILE_QUERIES.map(([tx, tz]) => {
  const t = hostIndex.get(tx, tz, 0)
  return { tx, tz, expect: { tx: t.tx, tz: t.tz, hash: t.hash, floats: t.verts.length, bodies: [...t.bodies].sort((a, b) => a - b) } }
})
writeFileSync(new URL('collision-host.json', OUT), JSON.stringify({
  gravity: GRAVITY,
  scene: SCENE,
  ids: hostBuilt.ids,
  bodyCount: hostWorld.physicsSystem.GetNumBodies(),
  bounds,
  rays,
  tiles,
}, null, 2) + '\n')

const streamBuilt = await buildWorld()
const streamWorld = streamBuilt.world
const CHAR_SHAPES = new Map(CHARACTERS.charShapes)
const INTEGRATION = { playerBodies: new Map(CHARACTERS.playerBodies), config: CHARACTERS.integrationConfig }
streamWorld._charMgr = { _charShapes: CHAR_SHAPES, config: CHARACTERS.managerConfig }
let currentTick = 0
const sends = []
const clients = new Map()
const connections = {
  send(playerId, type, payload) { sends.push({ tick: currentTick, player: playerId, type: nameOf(type), payload: summarize(type, payload) }) },
  getClient(id) { if (!clients.has(id)) clients.set(id, { id }); return clients.get(id) },
}
const streamer = createCollisionTileStreamer({
  physics: streamWorld, physicsIntegration: INTEGRATION, connections,
  getNetcodeConfig: () => ({ profile: 'authoritative' }),
})
const ticks = []
for (let t = 0; t < TICKS; t++) {
  currentTick = t
  const players = PLAYERS(t)
  ticks.push(players)
  for (const id of RESETS[t] || []) streamer.reset(id)
  streamer.tick(t, players.map((p) => ({ id: p.id, state: { position: p.position } })))
}
writeFileSync(new URL('collision-tile-streamer.json', OUT), JSON.stringify({
  gravity: GRAVITY,
  scene: SCENE,
  characters: CHARACTERS,
  ticks,
  resets: RESETS,
  expect: { sends, stats: plain(streamer.stats) },
}, null, 2) + '\n')
console.log('wrote collision-host.json (' + rays.length + ' rays, ' + tiles.length + ' tile answers) and collision-tile-streamer.json (' + sends.length + ' sends)')
