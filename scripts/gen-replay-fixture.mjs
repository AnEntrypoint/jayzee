import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')

const replayModule = await import(join(spointRoot, 'src/netcode/ReplayFile.js'))
const msgpackModule = await import(join(spointRoot, 'src/protocol/msgpack.js'))
if (typeof msgpackModule.ensurePacked === 'function') await msgpackModule.ensurePacked()

const sample = {
  header: { world: 'replay-sample', tickRate: 64, seed: 7 },
  inputs: [
    { tick: 1, player: 'p1', buttons: 3, pitch: 0.5 },
    { tick: 2, player: 'p1', buttons: 0, pitch: -0.25 }
  ],
  ticks: [],
  events: []
}

const bytes = Buffer.from(replayModule.encodeReplay(sample))
const sha256 = createHash('sha256').update(bytes).digest('hex')

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'replay-sample.bin'), bytes)
writeFileSync(join(outDir, 'replay-sample.json'), JSON.stringify({
  generatedFrom: 'spoint src/netcode/ReplayFile.js encodeReplay',
  sha256,
  byteLength: bytes.length,
  sample
}, null, 2) + '\n')
console.log(`wrote replay-sample.bin ${bytes.length} bytes sha256 ${sha256}`)
