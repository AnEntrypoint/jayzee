import { runStateScenario, stateHash } from './stateHash1024.mjs'

const [glue, workers] = process.argv.slice(2)
const positions = await runStateScenario(glue, Number(workers))
process.stdout.write(JSON.stringify({ hash: stateHash(positions), count: positions.length, first: positions.slice(0, 3) }) + '\n')
