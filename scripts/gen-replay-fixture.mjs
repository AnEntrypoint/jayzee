import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')

const replayModule = await import(pathToFileURL(join(spointRoot, 'src/netcode/ReplayFile.js')).href)
const msgpackModule = await import(pathToFileURL(join(spointRoot, 'src/protocol/msgpack.js')).href)
await msgpackModule.ensurePacked

const sample = {
  header: { world: 'replay-sample', tickRate: 64, seed: 7 },
  inputs: [
    { tick: 1, player: 'p1', buttons: 3, pitch: 0.5 },
    { tick: 2, player: 'p1', buttons: 0, pitch: -0.25 }
  ],
  ticks: [],
  events: []
}

const richSample = {
  header: {
    worldName: 'arena',
    tickRate: 60,
    startTick: 1,
    endTick: 3,
    recordedAt: 1700000000000,
    collisionSteps: 2,
    players: [{ id: 'p1', name: 'Player 1', spawn: { position: [0, 1.5, -2], rotation: [0, 0, 0, 1], health: 100 } }],
    flags: { ranked: false, host: null, ratio: 0.125 }
  },
  inputs: [
    { tick: 1, playerId: 'p1', sequence: 1, data: { buttons: 3, x: 0.5 } },
    { tick: 2, playerId: 'p1', sequence: 2, data: { buttons: 0, x: 0.25 } },
    { tick: 3, playerId: 'p1', sequence: null, data: { buttons: 255, x: 1099511627776 } }
  ],
  ticks: [{ tick: 1, dt: 0.015625 }, { tick: 2, dt: 0.015625 }, { tick: 3, dt: 0.015625 }],
  events: [{ tick: 2, kind: 'spawn', text: 'héllo ✓' }]
}

const bytes = Buffer.from(replayModule.encodeReplay(sample))
const sha256 = createHash('sha256').update(bytes).digest('hex')

const version1 = Buffer.from(msgpackModule.pack({ magic: 'spointreplay', version: 1, header: richSample.header, inputs: richSample.inputs, ticks: richSample.ticks, events: richSample.events }))

const variants = [
  { name: 'rich-v2', sample: richSample, version: 2, hex: Buffer.from(replayModule.encodeReplay(richSample)).toString('hex') },
  { name: 'empty-header-v2', sample: { header: {}, inputs: [], ticks: [], events: [] }, version: 2, hex: Buffer.from(replayModule.encodeReplay({ header: {}, inputs: [] })).toString('hex') },
  { name: 'rich-v1', sample: richSample, version: 1, hex: version1.toString('hex') }
]

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'replay-sample.bin'), bytes)
writeFileSync(join(outDir, 'replay-sample.json'), JSON.stringify({
  generatedFrom: 'spoint src/netcode/ReplayFile.js encodeReplay',
  sha256,
  byteLength: bytes.length,
  sample
}, null, 2) + '\n')
writeFileSync(join(outDir, 'replay-variants.json'), JSON.stringify({
  generatedFrom: 'spoint src/netcode/ReplayFile.js encodeReplay, and spoint src/protocol/msgpack.js pack for the version 1 file',
  variants
}, null, 2) + '\n')
console.log('wrote replay-sample.bin ' + bytes.length + ' bytes sha256 ' + sha256 + ' and ' + variants.length + ' variants')
