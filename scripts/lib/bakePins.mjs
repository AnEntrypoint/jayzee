import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBakePinTable } from '../../src/bundle/bakePins.js'

export const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const PINS_PATH = 'src/bundle/bake-pins.json'
export const readRepoText = (path) => readFileSync(join(repoRoot, path), 'utf8')
export const sha1Hex = (text) => createHash('sha1').update(text).digest('hex')
export const repoPinTable = () => createBakePinTable({ readText: readRepoText, sha1Hex })
export const readPins = () => JSON.parse(readRepoText(PINS_PATH))
export const writePins = (pins) => writeFileSync(join(repoRoot, PINS_PATH), JSON.stringify(pins, null, 2) + '\n')
