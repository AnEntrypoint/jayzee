import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const GLUE = 'engine/out/engine-core-1024mib-threads-simd.mjs'

export const referenceDir = (commit, cap = 0) => 'build/reference/' + commit.slice(0, 12) + (cap ? '-cap' + cap : '')
export const referenceGlue = (commit, cap = 0) => referenceDir(commit, cap) + '/' + GLUE

export const ensureReference = (commit, cap = 0) => {
  if (!Number.isInteger(cap) || cap < 0) throw new RangeError('cap must be a whole number of bodies, or 0 for the commit\'s own cap')
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new RangeError('the reference commit must be a full 40-hex commit id')
  const dir = join(root, referenceDir(commit, cap))
  const glue = join(root, referenceGlue(commit, cap))
  if (existsSync(glue) && existsSync(glue.replace(/\.mjs$/, '.wasm'))) return { glue: referenceGlue(commit, cap), built: false }
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const archive = execFileSync('git', ['archive', '--format=tar', commit, 'engine'], { cwd: root, maxBuffer: 512 * 1024 * 1024 })
  const unpack = spawnSync('tar', ['-x', '-C', dir], { input: archive, maxBuffer: 16 * 1024 * 1024 })
  if (unpack.status !== 0) throw new Error('could not unpack the reference source: ' + unpack.stderr)
  mkdirSync(join(dir, 'engine/out'), { recursive: true })
  const built = spawnSync('bash', [join(dir, 'engine/build.sh')], { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, EMSDK_DIR: join(root, 'build/emsdk'), ENGINE_VARIANT: 'threads', ENGINE_TIER_MIB: '1024', ENGINE_WASM_SIMD: 'ON', JOLT_SOURCE: '', ...(cap ? { CXXFLAGS: '-DENGINE_TOP_TIER_BODIES=' + cap } : {}) } })
  if (built.status !== 0 || !existsSync(glue)) throw new Error('the reference build of ' + commit + ' failed: ' + (built.stdout + built.stderr).slice(-600))
  return { glue: referenceGlue(commit, cap), built: true }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(ensureReference(process.argv[2], Number(process.argv[3] ?? '0'))))
