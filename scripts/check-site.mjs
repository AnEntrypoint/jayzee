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
  for (const name of ['src/world/World.js', 'src/kernel/load.js', 'src/physics-pure/settler.js', 'index.html', 'play.js', 'kernel.wasm']) {
    assert(planned.has(name), name + ' is not in the site plan')
  }
})

gate('the service worker re-serves every response with both cross-origin isolation headers', () => {
  const text = planned.get('coi-sw.js').toString('utf8')
  assert(text.includes("'Cross-Origin-Embedder-Policy'") && text.includes("'Cross-Origin-Opener-Policy'"), 'coi-sw.js does not set both isolation headers')
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

gate('negative control: the planner refuses a bare import, so the site carries no vendored package', () => {
  const read = (abs) => (abs.endsWith('World.js') ? "import { instantiate } from 'jz/interop'\n" : '')
  let refused = false
  try {
    planSite({ read })
  } catch (error) {
    refused = error.message.includes('jz/interop')
  }
  assert(refused, 'a bare import was accepted into the site plan')
})

gate('the page has no import map and the plan has no vendor file', () => {
  const html = readFileSync(join(SITE_DIR, 'index.html'), 'utf8')
  assert(!html.includes('importmap'), 'index.html still carries an import map')
  for (const name of planned.keys()) assert(!name.startsWith('vendor/'), name + ' is a vendored file')
})

gate('the kernel in the site is a WebAssembly module that compiles', () => {
  const bytes = planned.get('kernel.wasm')
  assert(bytes.subarray(0, 4).toString('hex') === '0061736d', 'kernel.wasm lacks the wasm magic')
  new WebAssembly.Module(bytes)
})

finish()
