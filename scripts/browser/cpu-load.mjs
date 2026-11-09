import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const exited = (child) => new Promise((resolve) => child.once('exit', resolve))

export async function burn({ workers, durationMs, now = () => Date.now() }) {
  const requestedEnd = now() + durationMs
  const start = now()
  const children = Array.from({ length: workers }, () =>
    spawn(process.execPath, ['-e', `const e=${requestedEnd}; while (Date.now() < e);`], { stdio: 'ignore' }),
  )
  await Promise.all(children.map(exited))
  return { workers, requestedDurationMs: durationMs, startMs: start, endMs: now() }
}

if (process.argv[1] && process.argv[1].endsWith('cpu-load.mjs')) {
  const [workersArg, durationArg, outPath] = process.argv.slice(2)
  const record = await burn({ workers: Number(workersArg), durationMs: Number(durationArg) })
  writeFileSync(outPath, JSON.stringify(record) + '\n')
  console.log(JSON.stringify(record))
}
