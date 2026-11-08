import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runServerScenarios, nearEqual } from './lib/chartStateServerScenarios.mjs'
import { attachServerChartMigrators } from '../src/sdk/chartState/index.js'
import { createChartTransfer } from '../src/client/chartTransfer.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/chart-state-server.json', import.meta.url), 'utf8'))
const got = JSON.parse(JSON.stringify(runServerScenarios({ attachServerChartMigrators, createChartTransfer })))

const check = (label, key) => gate(label, () => nearEqual(got[key], fixture.result[key], key))

check('attach wires one migrator per stage, one terrain gate and one tick callback, and shares the handle ledger', 'attach')
check('the guard re-expresses a base-epoch point through the identity transfer to spoint values', 'guardAtBase')
check('applying epoch 1 runs every stage and returns spoint report keys and counts, without timing', 'apply')
check('after epoch 1 the entity is re-expressed, the epoch is recorded and one chart_reanchor event is logged', 'afterApply')
check('the guard reports epoch 1 and re-expresses a base-epoch point to the current chart', 'guardAfter')
check('applying the same epoch again returns null and changes nothing', 'reapply')
check('a skipped epoch is refused with the spoint message before any stage runs', 'skipped')
check('a stage that throws records the fault, stops the tick loop once and rethrows', 'fault')
check('each re-anchor blocker reason matches spoint, in spoint order', 'blockers')
check('the dormant-statics drain runs with the quarter-tick budget on every tick', 'dormant')
check('detach removes the migrator, the terrain gate, the tick callback and the guard', 'detach')
check('a host without a planet frame is refused with the spoint message', 'missingFrame')
finish();
