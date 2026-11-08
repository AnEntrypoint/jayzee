import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { planSite, SITE_DIR } from './lib/site.mjs'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const plan = planSite().files
const planned = new Map(plan.map(({ to, bytes }) => [to, bytes]))

gate('the browser closure of the physics page is planned and carries no Node import', () => {
  for (const name of ['src/world/World.js', 'src/kernel/load.js', 'src/physics-pure/settler.js', 'vendor/jz/interop.js', 'index.html', 'play.js', 'kernel.wasm']) {
    assert(planned.has(name), name + ' is not in the site plan')
  }
})

gate('negative control: the planner refuses a module that imports a Node built-in', () => {
  const read = (abs) => (abs.endsWith('World.js') ? "import { readFileSync } from 'node:fs'\n" : '')
  let refused = false
  try {
    planSite({ read })
  } catch (error) {
    refused = error.message.includes('node:fs')
  }
  assert(refused, 'a Node built-in import was accepted into the site plan')
})

gate('the committed site under docs/play matches the plan byte for byte, so npm run build:site has been run after the last change', () => {
  for (const [name, bytes] of planned) {
    const path = join(SITE_DIR, name)
    assert(existsSync(path), 'docs/play/' + name + ' is missing: run npm run build:site')
    assert(readFileSync(path).equals(bytes), 'docs/play/' + name + ' is stale: run npm run build:site')
  }
})

gate('the import map in the page points only at files in the site', () => {
  const html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8')
  const map = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1])
  for (const target of Object.values(map.imports)) {
    const name = target.replace(/^\.\//, '')
    assert(planned.has(name), 'import map target ' + target + ' is not in the site')
  }
})

gate('the kernel in the site is a WebAssembly module that compiles', () => {
  const bytes = planned.get('kernel.wasm')
  assert(bytes.subarray(0, 4).toString('hex') === '0061736d', 'kernel.wasm lacks the wasm magic')
  new WebAssembly.Module(bytes)
})

finish()
