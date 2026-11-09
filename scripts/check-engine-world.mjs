import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { finish } from './lib/gate.mjs'
import { worldGates } from './lib/worldSuite.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href

const FLOAT32_TOLERANCE = 1e-5

worldGates((options) => createEngineWorld(options, glue), FLOAT32_TOLERANCE)
finish()
