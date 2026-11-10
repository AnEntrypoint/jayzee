import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [label = 'project-browser', portArg = '8851'] = process.argv.slice(2)
const PROBE_DONE = '(() => { const probe = window.probe; const tries = probe ? probe.tries ?? probe.results : null; return Array.isArray(tries) && tries.length >= 5 ? JSON.stringify({ userAgent: navigator.userAgent, probe }) : null })()'
const startedMs = Date.now()
const run = await runPageWitness({ root, port: Number(portArg), pagePath: 'scripts/browser/adapter-probe.html', expression: PROBE_DONE })
const localState = JSON.parse(readFileSync(join(root, '.playwriter', 'browser-profile', 'Local State'), 'utf8'))
const labs = localState.browser && localState.browser.enabled_labs_experiments
console.log(JSON.stringify({ label, wallMs: Date.now() - startedMs, labs, userAgent: run.result ? run.result.userAgent : null, probe: run.result ? run.result.probe : null, errors: run.errors ?? [], error: run.error ?? null }, null, 1))
if (run.error) process.exitCode = 1
