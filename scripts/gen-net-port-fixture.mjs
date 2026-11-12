import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runBridgeProxy, runCoalesced, runLaggedCollisions } from './lib/netPortScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const files = ['src/netcode/CollisionSystem.js', 'src/netcode/WorkerBridgeProxy.js', 'src/connection/ConnectionManager.js', 'src/client/BaseClient.js']
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'net-port.json')
const read = (file) => readFileSync(join(spointRoot, file), 'utf8')

const collisions = await import(pathToFileURL(join(spointRoot, files[0])).href)
const bridge = await import(pathToFileURL(join(spointRoot, files[1])).href)

const functionText = (source, name) => {
  const start = source.indexOf('function ' + name + '(')
  if (start === -1) throw new Error('spoint has no function ' + name)
  let depth = 0
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1)
  }
  throw new Error('function ' + name + ' does not close')
}
const constants = 'const COALESCE_SENTINEL = 0xff\nconst LEN_PREFIX_BYTES = 4\n'
for (const file of [files[2], files[3]]) {
  const source = read(file)
  if (!source.includes('const COALESCE_SENTINEL = 0xff') || !source.includes('const LEN_PREFIX_BYTES = 4')) throw new Error(file + ' no longer declares the coalesce constants this generator copies')
}
const frameCoalesced = new Function(constants + functionText(read(files[2]), 'frameCoalesced') + '\nreturn frameCoalesced')()
const splitCoalesced = new Function(constants + functionText(read(files[3]), 'splitCoalesced') + '\nreturn splitCoalesced')()

const sections = {
  laggedCollisions: runLaggedCollisions({ plan: collisions.planPlayerCollisions, advance: collisions.advancePushQueue, window: collisions.pushWindowOf, reset: collisions.resetPushQueue }),
  lagInputs: collisions.COLLISION_LAG_INPUTS,
  bridgeProxy: runBridgeProxy(bridge.createWorkerBridgeProxy),
  coalesced: runCoalesced({ frame: frameCoalesced, split: splitCoalesced }),
}

const fixture = {
  source: {
    files: files.map((file) => ({ file, sha256: createHash('sha256').update(readFileSync(join(spointRoot, file))).digest('hex') })),
    note: 'spoint planPlayerCollisions, advancePushQueue, pushWindowOf, resetPushQueue and createWorkerBridgeProxy are imported and run on scripts/lib/netPortScenario.mjs. frameCoalesced (ConnectionManager.js) and splitCoalesced (BaseClient.js) are module-private in spoint, so their function text is cut from the source and evaluated with the two constants both files declare.',
  },
  sections,
}
fixture.sha256 = createHash('sha256').update(JSON.stringify(fixture.sections)).digest('hex')
writeFileSync(outFile, JSON.stringify(fixture) + '\n')
console.log('wrote ' + outFile + ' sha256 ' + fixture.sha256)
