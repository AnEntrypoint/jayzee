import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { probeAtmosphere } from './lib/atmosphere-probe.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const source = join(spointRoot, 'packages/mapspinner/src')

const record = probeAtmosphere({
  trans: await import(join(source, 'atmosphere-transmittance-lut.js')),
  scat: await import(join(source, 'atmosphere-scattering-lut.js')),
  rt: await import(join(source, 'glsl-rt.js')),
})

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'atmosphere-reference.json'), JSON.stringify({
  generatedFrom: 'spoint packages/mapspinner/src atmosphere-transmittance-lut.js, atmosphere-scattering-lut.js and glsl-rt.js',
  ...record,
}, null, 1) + '\n')
