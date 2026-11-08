import { World } from '../src/world/World.js'
import { finish } from './lib/gate.mjs'
import { worldGates } from './lib/worldSuite.mjs'

worldGates((options) => new World(options))
finish()
