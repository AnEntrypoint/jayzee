import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const SPECIFIER = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\1/g
const ASSET = /new URL\((['"])([^'"]+)\1,\s*import\.meta\.url\)/g
const PACKED_LIMIT_BYTES = 131072

const packageOf = (specifier) => (specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0])

const closureOf = (entries, read = (abs) => readFileSync(abs, 'utf8')) => {
  const files = new Set()
  const packages = new Map()
  const queue = entries.map((entry) => resolve(root, entry))
  while (queue.length > 0) {
    const abs = queue.pop()
    if (files.has(abs)) continue
    files.add(abs)
    if (!abs.endsWith('.js')) continue
    const text = read(abs)
    for (const [, , specifier] of text.matchAll(SPECIFIER)) {
      if (specifier.startsWith('.')) queue.push(resolve(dirname(abs), specifier))
      else if (!specifier.startsWith('node:')) packages.set(packageOf(specifier), relative(root, abs))
    }
    for (const [, , asset] of text.matchAll(ASSET)) queue.push(resolve(dirname(abs), asset))
  }
  return { files: [...files].map((abs) => relative(root, abs)).sort(), packages }
}

const entries = [manifest.exports['.'].default, ...Object.values(manifest.bin)]
const surface = closureOf(entries)
const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
const packLines = packOutput.split('\n')
const packReport = JSON.parse(packLines.slice(packLines.findIndex((line) => line === '[' || line === '{')).join('\n'))
const packed = Array.isArray(packReport) ? packReport[0] : Object.values(packReport)[0]
const packedPaths = new Set(packed.files.map((file) => file.path))

gate('the package exports one entry point and nothing else, so its surface is that entry and the bins', () => {
  assert.deepEqual(Object.keys(manifest.exports).sort(), ['.', './package.json'])
  assert.equal(manifest.main, './' + manifest.exports['.'].default.replace(/^\.\//, ''))
})

gate('every file the entry point and the bins reach is in the tarball, the kernel and the types among them', () => {
  for (const file of surface.files) assert.ok(packedPaths.has(file), file + ' is reached and is not packed')
  assert.ok(packedPaths.has('dist/kernel.wasm'))
  assert.ok(packedPaths.has(manifest.types.replace(/^\.\//, '')))
})

gate('the dependencies are exactly the packages the surface imports: none is missing and none is carried for a module no consumer can reach', () => {
  assert.deepEqual(Object.keys(manifest.dependencies).sort(), [...surface.packages.keys()].sort())
})

gate('the tarball holds exactly the source files the surface reaches and is under ' + PACKED_LIMIT_BYTES + ' bytes packed', () => {
  const reached = surface.files.filter((file) => file.startsWith('src/'))
  const shipped = [...packedPaths].filter((path) => path.startsWith('src/')).sort()
  assert.deepEqual(shipped, reached)
  assert.ok(packed.size < PACKED_LIMIT_BYTES, 'the tarball is ' + packed.size + ' bytes')
})

gate('control: the closure walk reports a bare import and a file it reaches through a relative import', () => {
  const texts = new Map([[resolve(root, 'a.js'), "import { b } from './b.js'\nimport three from 'three/tsl'\n"], [resolve(root, 'b.js'), "export const b = await import('@scope/name/deep')\n"]])
  const walked = closureOf(['a.js'], (abs) => texts.get(abs))
  assert.deepEqual(walked.files, ['a.js', 'b.js'])
  assert.deepEqual([...walked.packages.keys()].sort(), ['@scope/name', 'three'])
})

finish()
