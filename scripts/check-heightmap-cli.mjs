import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { crc32, decodePNGGray, encodePNGGray } from './lib/png-gray.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'heightmap-cli.json'), 'utf8'))
const cli = join(here, 'heightmap.mjs')
const work = mkdtempSync(join(tmpdir(), 'jayzee-heightmap-'))

const run = (argv) => spawnSync(process.execPath, [cli, ...argv], { cwd: root, encoding: 'utf8' })

const synthGray = () => {
  const gray = new Uint8Array(fixture.synthetic.w * fixture.synthetic.h)
  for (let y = 0; y < fixture.synthetic.h; y++) for (let x = 0; x < fixture.synthetic.w; x++) gray[y * fixture.synthetic.w + x] = (x * 7 + y * 13) & 255
  return gray
}

gate('crc32 gives the standard check value and the spoint value for the same input', () => {
  assert.equal(crc32(Buffer.from(fixture.crc32.input, 'ascii')), 0xCBF43926)
  assert.equal(crc32(Buffer.from(fixture.crc32.input, 'ascii')), fixture.crc32.value)
})

gate('the PNG writer reproduces spoint bytes for a synthetic gradient', () => {
  const bytes = encodePNGGray(fixture.synthetic.w, fixture.synthetic.h, synthGray())
  assert.equal(bytes.toString('base64'), fixture.synthetic.png)
})

gate('the PNG decoder recovers the synthetic gradient and its size', () => {
  const decoded = decodePNGGray(Buffer.from(fixture.synthetic.png, 'base64'))
  assert.equal(decoded.width, fixture.synthetic.w)
  assert.equal(decoded.height, fixture.synthetic.h)
  assert.deepEqual(Array.from(decoded.gray), Array.from(synthGray()))
})

gate('the PNG decoder refuses a flipped data byte through the chunk CRC', () => {
  const bytes = Buffer.from(fixture.synthetic.png, 'base64')
  const flipAt = bytes.length - 20
  bytes[flipAt] ^= 0x40
  assert.throws(() => decodePNGGray(bytes), /bad CRC/)
})

gate('the PNG decoder refuses bytes that are not a PNG', () => {
  assert.throws(() => decodePNGGray(Buffer.from('not a png at all')), /bad signature/)
})

for (const item of fixture.cases) {
  gate('CLI case ' + item.name + ' prints spoint stats and writes spoint PNG bytes', () => {
    const out = join(work, item.name + '.png')
    const result = run([...item.argv, '--out', out])
    assert.equal(result.status, 0, 'exit status, stderr: ' + result.stderr)
    const stats = JSON.parse(result.stdout)
    const { out: printedOut, ...rest } = stats
    assert.equal(printedOut, out)
    assert.deepEqual(rest, item.stats)
    assert.equal(readFileSync(out).toString('base64'), item.png)
  })
  gate('CLI case ' + item.name + ' PNG decodes and re-encodes to the same bytes', () => {
    const bytes = Buffer.from(item.png, 'base64')
    const decoded = decodePNGGray(bytes)
    assert.equal(decoded.width, item.stats.w)
    assert.equal(decoded.height, item.stats.h)
    assert.equal(encodePNGGray(decoded.width, decoded.height, decoded.gray).toString('base64'), item.png)
  })
}

gate('the CLI refuses a non-numeric --res with exit 2 and names the flag', () => {
  const result = run(['--res', 'abc', '--out', join(work, 'x.png')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--res must be a finite number/)
})

gate('the CLI refuses --hash-version 3 with exit 2', () => {
  const result = run(['--res', '8', '--hash-version', '3', '--out', join(work, 'y.png')])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /--hash-version must be 1 or 2/)
})

gate('the CLI refuses a --center without two numbers and an unknown positional argument', () => {
  assert.equal(run(['--center', '46.5', '--out', join(work, 'z.png')]).status, 2)
  assert.equal(run(['stray', '--out', join(work, 'z.png')]).status, 2)
})

gate('the CLI prints usage and exits 0 for --help', () => {
  const result = run(['--help'])
  assert.equal(result.status, 0)
  assert.match(result.stdout, /usage: node scripts\/heightmap\.mjs/)
})

rmSync(work, { recursive: true, force: true })
finish()
