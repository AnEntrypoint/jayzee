import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { runGameSystems } from './lib/gameSystemsScenario.mjs'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outFile = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'game-systems.json')
const load = (rel) => import(pathToFileURL(join(spointRoot, 'src/game', rel)).href)
const sourceFiles = ['AbilityTree.js', 'ProgressionSystem.js', 'StatsSystem.js', 'QuestSystem.js', 'EventChainManager.js', 'playerId.js']

const ability = await load('AbilityTree.js')
const progression = await load('ProgressionSystem.js')
const stats = await load('StatsSystem.js')
const quest = await load('QuestSystem.js')
const chain = await load('EventChainManager.js')

const lib = {
  createAbilityTree: ability.createAbilityTree,
  createProgressionSystem: progression.createProgressionSystem,
  getStatScaling: progression.getStatScaling,
  CURVE_LINEAR: progression.CURVE_LINEAR,
  CURVE_EXPONENTIAL: progression.CURVE_EXPONENTIAL,
  CURVE_QUADRATIC: progression.CURVE_QUADRATIC,
  defineStatsSystem: stats.defineStatsSystem,
  defineQuestSystem: quest.defineQuestSystem,
  EventChainManager: chain.EventChainManager,
}

const { sections, nullContext } = runGameSystems(lib)
const fixture = {
  source: {
    description: 'spoint src/game modules run on scripts/lib/gameSystemsScenario.mjs with Date.now stubbed to the scenario clock',
    files: Object.fromEntries(sourceFiles.map((name) => [
      name,
      createHash('sha256').update(readFileSync(join(spointRoot, 'src/game', name))).digest('hex'),
    ])),
  },
  sections,
  nullContext,
}
writeFileSync(outFile, JSON.stringify(fixture, null, 1) + '\n')
console.log('wrote game-systems.json', Object.entries(sections).map(([name, lines]) => `${name} ${lines.length}`).join(', '), 'nullContext', JSON.stringify(nullContext).slice(0, 80))
