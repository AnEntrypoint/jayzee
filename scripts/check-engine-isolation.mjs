import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { ISOLATION_HEADERS, ISOLATION_SHIM_URL, VARIANT, isolationPlan, registerIsolationShim } from '../src/engine/isolation.js'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

gate('a page that is already cross-origin isolated gets the threaded build and no registration', () => {
  const plan = isolationPlan({ crossOriginIsolated: true, serviceWorkerSupported: true })
  assert.equal(plan.variant, VARIANT.THREADED)
  assert.equal(plan.register, false)
  assert.ok(Object.isFrozen(plan))
})

gate('a page without isolation but with a service worker gets the single build and registers the shim', () => {
  const plan = isolationPlan({ crossOriginIsolated: false, serviceWorkerSupported: true })
  assert.equal(plan.variant, VARIANT.SINGLE)
  assert.equal(plan.register, true)
})

gate('a page with no service worker and no isolation gets the single build and no registration', () => {
  const plan = isolationPlan({ crossOriginIsolated: false, serviceWorkerSupported: false })
  assert.equal(plan.variant, VARIANT.SINGLE)
  assert.equal(plan.register, false)
})

gate('threads not requested always gets the single build, even when isolated', () => {
  const plan = isolationPlan({ crossOriginIsolated: true, serviceWorkerSupported: true, threadsRequested: false })
  assert.equal(plan.variant, VARIANT.SINGLE)
  assert.equal(plan.register, false)
})

gate('registerIsolationShim registers the shim URL and reports registered', async () => {
  const calls = []
  const navigatorLike = { serviceWorker: { register: async (url) => calls.push(url) } }
  assert.equal(await registerIsolationShim(navigatorLike), 'registered')
  assert.deepEqual(calls, [ISOLATION_SHIM_URL])
})

gate('registerIsolationShim reports unsupported without a service worker', async () => {
  assert.equal(await registerIsolationShim({}), 'unsupported')
  assert.equal(await registerIsolationShim(undefined), 'unsupported')
  assert.equal(await registerIsolationShim({ serviceWorker: {} }), 'unsupported')
})

gate('the shim sets the COEP and COOP headers with the values the isolation module names', () => {
  const shim = read('site/coi-sw.js')
  assert.ok(shim.includes("const COEP = '" + ISOLATION_HEADERS.COEP_VALUE + "'"))
  assert.ok(shim.includes("const COOP = '" + ISOLATION_HEADERS.COOP_VALUE + "'"))
  assert.ok(shim.includes("headers.set('" + ISOLATION_HEADERS.COEP + "', COEP)"))
  assert.ok(shim.includes("headers.set('" + ISOLATION_HEADERS.COOP + "', COOP)"))
})

gate('the published shim in docs/play is the same file as the site shim', () => {
  assert.equal(read('docs/play/coi-sw.js'), read('site/coi-sw.js'))
})

gate('both pages register the shim only when the page is not already isolated', () => {
  for (const page of ['site/index.html', 'docs/play/index.html']) {
    const html = read(page)
    assert.ok(html.includes("if (!self.crossOriginIsolated && 'serviceWorker' in navigator)"), page)
    assert.ok(html.includes("navigator.serviceWorker.register('./coi-sw.js')"), page)
  }
})

finish()
