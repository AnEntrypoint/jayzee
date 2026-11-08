import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { locateSiteWorld } from '../src/site/worldName.js'
import { planSite, SITE_DIR } from './lib/site.mjs'

try {
  locateSiteWorld(process.env.WORLD ?? null)
} catch (error) {
  console.error('build:site refused WORLD: ' + error.message)
  process.exit(1)
}

const { files } = planSite()
for (const { to, bytes } of files) {
  const out = join(SITE_DIR, to)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, bytes)
}
console.log('site: ' + files.length + ' files written to ' + SITE_DIR)
