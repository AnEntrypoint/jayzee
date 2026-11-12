import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { compile } from 'jz'

const here = dirname(fileURLToPath(import.meta.url))
const ENTRY = 'kernel.js'
const MODULES = ['state.js', 'integrate.js', 'respond.js', 'collide.js', 'pairs.js', 'step.js']
const OPTIMIZE = { level: 'speed', compact: false }

const read = (name) => readFileSync(join(here, name), 'utf8')

export const compileKernel = () => {
  const modules = Object.fromEntries(MODULES.map((name) => ['./' + name, read(name)]))
  return compile(read(ENTRY), { modules, optimize: OPTIMIZE })
}
