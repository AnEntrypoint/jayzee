import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runGameFsmScenarios } from './lib/gameFsmScenario.mjs'
import { createXstateGameFSM } from '../src/behaviours/fsmXstate.js'

const xstateDir = resolve(process.argv[2] ?? process.env.XSTATE_DIR ?? 'node_modules/xstate')
const manifest = JSON.parse(readFileSync(join(xstateDir, 'package.json'), 'utf8'))
const entry = manifest.exports?.['.']?.import ?? manifest.exports?.['.']?.default ?? manifest.module ?? manifest.main
const entryFile = typeof entry === 'string' ? entry : entry.default
const xstate = await import(pathToFileURL(join(xstateDir, entryFile)).href)
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'xstate', 'game-fsm.json')

const sections = runGameFsmScenarios((spec, appCtx, now) => createXstateGameFSM(spec, appCtx, { xstate, now }))
const selfTargetLog = (reenter) => {
  const log = []
  const machine = xstate.createMachine({
    initial: 'a',
    states: { a: { entry: () => log.push('enter a'), exit: () => log.push('exit a'), on: { AGAIN: reenter === null ? { target: 'a' } : { target: 'a', reenter } } } },
  })
  const actor = xstate.createActor(machine)
  actor.start()
  actor.send({ type: 'AGAIN' })
  return log
}

const fixture = {
  source: {
    package: 'xstate',
    version: manifest.version,
    note: 'Each line is one step of scripts/lib/gameFsmScenario.mjs run on a real xstate actor through src/behaviours/fsmXstate.js: createMachine, createActor and a clock whose timers fire on tick. A transition that targets its own state is built with reenter true.',
  },
  selfTarget: { xstateDefault: selfTargetLog(null), reenterTrue: selfTargetLog(true) },
  sections,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote game-fsm.json from xstate ' + manifest.version + ': ' + Object.entries(sections).map(([name, lines]) => lines.length).join(', ') + ' lines')
