import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runPoolParamsScenario } from './lib/poolParamsScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const relative = 'packages/mapspinner/src/pool-params.js'
const sourcePath = join(spointRoot, relative)
const spoint = await import(pathToFileURL(sourcePath).href)

const withWindow = (host, run) => {
  const hadWindow = Object.prototype.hasOwnProperty.call(globalThis, 'window')
  const previous = globalThis.window
  if (host === undefined) delete globalThis.window
  else globalThis.window = host
  try {
    return run()
  } finally {
    if (hadWindow) globalThis.window = previous
    else delete globalThis.window
  }
}

const sections = runPoolParamsScenario({
  resolvePoolParams: (host) => withWindow(host, () => spoint.resolvePoolParams()),
  resolveWetness: (host) => withWindow(host, () => spoint.resolveWetness()),
})

const fixture = {
  source: {
    file: relative,
    sha256: createHash('sha256').update(readFileSync(sourcePath)).digest('hex'),
  },
  sections,
}

const out = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'pool-params.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n')
console.log('wrote ' + out + ' from ' + relative)
for (const [name, rows] of Object.entries(sections)) console.log(name + ': ' + rows.length)
