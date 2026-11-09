import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { WEBGPU_LABS, profileIsOwned, seedWebgpuLabs } from './browser/webgpu-profile.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const wrapper = join(root, 'scripts', 'browser', 'chromium-webgpu.sh')
const tmp = mkdtempSync(join(tmpdir(), 'webgpu-profile-'))
const labsOf = (file) => JSON.parse(readFileSync(file, 'utf8')).browser.enabled_labs_experiments

const fake = join(tmp, 'fake-chromium.sh')
writeFileSync(fake, '#!/bin/sh\nprintf "%s\\n" "$@" > "$ARGS_OUT"\n', { mode: 0o755 })
const chromiumArgs = (projectRoot, profile, argsFile, extra = {}) => spawnSync('sh', [wrapper, '--user-data-dir=' + profile, '--no-first-run', 'about:blank'], {
  env: { ...process.env, NODE: process.execPath, WEBGPU_PROJECT_ROOT: projectRoot, WEBGPU_CHROMIUM: fake, ARGS_OUT: argsFile, ...extra },
  encoding: 'utf8',
})

gate('a fresh profile gets the three WebGPU labs flags in Local State', () => {
  const dir = join(tmp, 'fresh', 'profile')
  const result = seedWebgpuLabs(dir)
  assert.equal(result.changed, true)
  assert.deepEqual(labsOf(join(dir, 'Local State')), WEBGPU_LABS)
})

gate('a second seed changes nothing and leaves the file bytes as they were', () => {
  const dir = join(tmp, 'again')
  seedWebgpuLabs(dir)
  const before = readFileSync(join(dir, 'Local State'), 'utf8')
  const result = seedWebgpuLabs(dir)
  assert.equal(result.changed, false)
  assert.equal(readFileSync(join(dir, 'Local State'), 'utf8'), before)
})

gate('existing preferences and other labs are kept, and only the missing labs are added', () => {
  const dir = join(tmp, 'existing')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'Local State'), JSON.stringify({ browser: { enabled_labs_experiments: ['x-flag'], keep: 1 }, profile: { name: 'p' } }))
  seedWebgpuLabs(dir)
  const state = JSON.parse(readFileSync(join(dir, 'Local State'), 'utf8'))
  assert.deepEqual(state.browser.enabled_labs_experiments, ['x-flag', ...WEBGPU_LABS])
  assert.equal(state.browser.keep, 1)
  assert.equal(state.profile.name, 'p')
})

gate('only the project profile counts as owned, a sibling or other root does not', () => {
  assert.equal(profileIsOwned(join(root, '.playwriter', 'browser-profile'), root), true)
  assert.equal(profileIsOwned(join(root, '.playwriter', 'browser-profile-old'), root), false)
  assert.equal(profileIsOwned(join(tmp, 'other'), root), false)
})

gate('the wrapper seeds the project profile and forwards every argument unchanged', () => {
  const projectRoot = join(tmp, 'project')
  const profile = join(projectRoot, '.playwriter', 'browser-profile')
  const argsFile = join(tmp, 'args-project.txt')
  const result = chromiumArgs(projectRoot, profile, argsFile)
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(readFileSync(argsFile, 'utf8').split('\n').filter(Boolean), ['--user-data-dir=' + profile, '--no-first-run', 'about:blank'])
  assert.deepEqual(labsOf(join(profile, 'Local State')), WEBGPU_LABS)
})

gate('the wrapper leaves a profile that is not the project profile unseeded', () => {
  const projectRoot = join(tmp, 'project-two')
  const other = join(tmp, 'elsewhere')
  const argsFile = join(tmp, 'args-other.txt')
  const result = chromiumArgs(projectRoot, other, argsFile)
  assert.equal(result.status, 0, result.stderr)
  assert.equal(existsSync(join(other, 'Local State')), false)
  assert.ok(readFileSync(argsFile, 'utf8').includes('--user-data-dir=' + other))
})

gate('a corrupt Local State is reported, the file is left alone, and Chromium still starts', () => {
  const projectRoot = join(tmp, 'project-three')
  const profile = join(projectRoot, '.playwriter', 'browser-profile')
  mkdirSync(profile, { recursive: true })
  writeFileSync(join(profile, 'Local State'), '{not json')
  const argsFile = join(tmp, 'args-corrupt.txt')
  const result = chromiumArgs(projectRoot, profile, argsFile)
  assert.equal(result.status, 0)
  assert.ok(result.stderr.includes('seeding failed'))
  assert.equal(readFileSync(join(profile, 'Local State'), 'utf8'), '{not json')
  assert.ok(readFileSync(argsFile, 'utf8').includes('about:blank'))
})

gate('the wrapper is executable', () => {
  assert.ok((statSync(wrapper).mode & 0o111) !== 0)
})

finish()
