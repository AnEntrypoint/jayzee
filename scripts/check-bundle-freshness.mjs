import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createStamp, checkFreshness } from '../src/bundle/index.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const kernelDir = join(root, 'src', 'kernel')
const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const expectRefusal = (action, pattern) => {
  try {
    action()
  } catch (error) {
    return pattern.test(error.message)
  }
  return false
}
const flipFirstByte = (content) => {
  const copy = Buffer.from(content)
  copy[0] ^= 0x01
  return copy
}
const readSources = (dir, names) => names.map((name) => ({
  path: name,
  content: existsSync(join(dir, name)) ? readFileSync(join(dir, name)) : null,
}))
const kernelSources = () => readdirSync(kernelDir)
  .filter((name) => name.endsWith('.js'))
  .sort()
  .map((name) => ({ path: 'src/kernel/' + name, content: readFileSync(join(kernelDir, name)) }))

const workDir = mkdtempSync(join(tmpdir(), 'jayzee-freshness-'))
const persistStamp = (dir, stamp) => {
  const file = join(dir, 'stamp.json')
  writeFileSync(file, JSON.stringify(stamp))
  return JSON.parse(readFileSync(file, 'utf8'))
}
const caseDir = (name) => {
  const dir = join(workDir, name)
  mkdirSync(dir)
  return dir
}

try {
  const kernel = kernelSources()
  const kernelStamp = persistStamp(workDir, createStamp(kernel))

  gate('an unchanged set of kernel sources is fresh', () => {
    const verdict = checkFreshness(kernelSources(), kernelStamp)
    assert(verdict.fresh === true, 'unchanged kernel sources read as stale: ' + JSON.stringify(verdict))
  })

  gate('control: one edited byte in a kernel source is stale and names that source', () => {
    const edited = kernel.map((source, index) => (index === 0 ? { path: source.path, content: flipFirstByte(source.content) } : source))
    const verdict = checkFreshness(edited, kernelStamp)
    assert(verdict.fresh === false && verdict.file === kernel[0].path && verdict.reason === 'changed', 'edited byte not named: ' + JSON.stringify(verdict))
  })

  const changedDir = caseDir('changed')
  const changedNames = ['a.js', 'b.js', 'c.js']
  const originalText = 'export const value = 1\n'
  for (const name of changedNames) writeFileSync(join(changedDir, name), originalText)
  const changedStamp = persistStamp(changedDir, createStamp(readSources(changedDir, changedNames)))

  gate('a changed source is stale and names the file', () => {
    writeFileSync(join(changedDir, 'b.js'), 'export const value = 99\n')
    const verdict = checkFreshness(readSources(changedDir, changedNames), changedStamp)
    assert(verdict.fresh === false && verdict.file === 'b.js' && verdict.reason === 'changed', 'changed b.js not named: ' + JSON.stringify(verdict))
  })

  gate('control: a source restored to its stamped bytes is fresh again', () => {
    writeFileSync(join(changedDir, 'b.js'), originalText)
    const verdict = checkFreshness(readSources(changedDir, changedNames), changedStamp)
    assert(verdict.fresh === true, 'restored source still stale: ' + JSON.stringify(verdict))
  })

  const missingDir = caseDir('missing')
  const missingNames = ['a.js', 'b.js']
  for (const name of missingNames) writeFileSync(join(missingDir, name), originalText)
  const missingStamp = persistStamp(missingDir, createStamp(readSources(missingDir, missingNames)))

  gate('a missing source is refused', () => {
    rmSync(join(missingDir, 'b.js'))
    const refused = expectRefusal(() => checkFreshness(readSources(missingDir, missingNames), missingStamp), /missing source b\.js/)
    assert(refused, 'a missing source was not refused')
  })

  gate('control: a present source is not refused', () => {
    writeFileSync(join(missingDir, 'b.js'), originalText)
    const verdict = checkFreshness(readSources(missingDir, missingNames), missingStamp)
    assert(verdict.fresh === true, 'present sources were refused or stale: ' + JSON.stringify(verdict))
  })

  gate('a malformed stamp is refused', () => {
    const sources = readSources(missingDir, missingNames)
    const refusedVersion = expectRefusal(() => checkFreshness(sources, { v: 2, sources: [] }), /version 1 freshness stamp/)
    const refusedNull = expectRefusal(() => checkFreshness(sources, null), /version 1 freshness stamp/)
    assert(refusedVersion && refusedNull, 'a malformed stamp was accepted')
  })

  gate('control: a stamp made from the same sources is accepted', () => {
    const sources = readSources(missingDir, missingNames)
    const verdict = checkFreshness(sources, createStamp(sources))
    assert(verdict.fresh === true, 'a fresh stamp was refused: ' + JSON.stringify(verdict))
  })
} finally {
  rmSync(workDir, { recursive: true, force: true })
}

finish()
