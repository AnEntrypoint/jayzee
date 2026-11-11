import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { DATASET_REF, KERNEL_REF, TICK_GLUES, buildPlan } from './plan.mjs'
import { SCENARIO_TIERS } from '../lib/scenarioTiers.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const out = join(root, 'build/kaggle')
const stage = join(out, 'stage')
const plan = buildPlan()
const entries = [...new Set(plan.runs.map((run) => run.script))]
const glues = [...new Set([...TICK_GLUES, ...SCENARIO_TIERS.map((tier) => tier.glue)])]

rmSync(stage, { recursive: true, force: true })
mkdirSync(stage, { recursive: true })

const place = (file) => {
  if (!existsSync(join(root, file))) throw new Error('missing ' + file)
  mkdirSync(dirname(join(stage, file)), { recursive: true })
  copyFileSync(join(root, file), join(stage, file))
}

const seen = new Set()
const queue = [...entries]
while (queue.length) {
  const file = queue.shift()
  if (seen.has(file)) continue
  seen.add(file)
  const source = readFileSync(join(root, file), 'utf8')
  for (const match of source.matchAll(/from '([^']+)'/g)) {
    const specifier = match[1]
    if (specifier.startsWith('.')) queue.push(relative(root, resolve(root, dirname(file), specifier)))
    else if (!specifier.startsWith('node:')) throw new Error(file + ' imports bare specifier ' + specifier)
  }
}
const modules = [...seen].sort()
modules.forEach(place)
for (const glue of glues) {
  place(glue)
  place(glue.replace(/\.mjs$/, '.wasm'))
}
writeFileSync(join(stage, 'package.json'), JSON.stringify({ type: 'module' }) + '\n')
writeFileSync(join(stage, 'plan.json'), JSON.stringify(plan) + '\n')

const datasetDir = join(out, 'dataset')
rmSync(datasetDir, { recursive: true, force: true })
mkdirSync(datasetDir, { recursive: true })
const archive = join(datasetDir, 'bench.bin')
const tar = spawnSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-cf', '-', '-C', stage, '.'], { maxBuffer: 256 * 1024 * 1024 })
if (tar.status !== 0) throw new Error('tar failed: ' + tar.stderr)
const zipped = spawnSync('gzip', ['-n', '-9'], { input: tar.stdout, maxBuffer: 256 * 1024 * 1024 })
if (zipped.status !== 0) throw new Error('gzip failed: ' + zipped.stderr)
writeFileSync(archive, zipped.stdout)
const payloadSha256 = createHash('sha256').update(zipped.stdout).digest('hex')
writeFileSync(join(datasetDir, 'dataset-metadata.json'), JSON.stringify({ title: 'jayzee physics bench', id: DATASET_REF, licenses: [{ name: 'CC0-1.0' }] }, null, 2) + '\n')

const template = readFileSync(join(root, 'scripts/kaggle/kernel.py.tmpl'), 'utf8')
if (!template.includes('__PAYLOAD_SHA256__')) throw new Error('template has no __PAYLOAD_SHA256__ marker')
const kernelDir = join(out, 'kernel')
rmSync(kernelDir, { recursive: true, force: true })
mkdirSync(kernelDir, { recursive: true })
writeFileSync(join(kernelDir, 'kernel.py'), template.replace('__PAYLOAD_SHA256__', payloadSha256))
writeFileSync(join(kernelDir, 'kernel-metadata.json'), JSON.stringify({
  id: KERNEL_REF,
  title: 'jayzee physics goalpost',
  code_file: 'kernel.py',
  language: 'python',
  kernel_type: 'script',
  is_private: true,
  enable_gpu: false,
  enable_internet: true,
  dataset_sources: [DATASET_REF],
  competition_sources: [],
  kernel_sources: [],
  model_sources: [],
}, null, 2) + '\n')

console.log(JSON.stringify({ modules: modules.length, glues: glues.length, runs: plan.runs.length, archiveBytes: zipped.stdout.length, payloadSha256, datasetDir: relative(root, datasetDir), kernelDir: relative(root, kernelDir) }))
