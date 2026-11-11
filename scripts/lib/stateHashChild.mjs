import { WorkersDoNotFitError } from '../../src/engine/EngineWorld.js'
import { runStateScenario, stateHash } from './stateHash1024.mjs'

const [glue, workers] = process.argv.slice(2)
try {
  const positions = await runStateScenario(glue, Number(workers))
  process.stdout.write(JSON.stringify({ hash: stateHash(positions), count: positions.length, first: positions.slice(0, 3) }) + '\n')
} catch (error) {
  if (!(error instanceof WorkersDoNotFitError)) throw error
  process.stdout.write(JSON.stringify({ refused: error.code, status: error.status, workers: error.workers, players: error.players, budgetBytes: error.budgetBytes }) + '\n')
}
