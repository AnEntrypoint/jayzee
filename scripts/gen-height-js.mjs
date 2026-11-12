import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transpileGlsl } from '../src/packages/mapspinner/glsl-to-js.js'
import { HEIGHT_GLSL, HEIGHT_GLSL_EXPORTS } from '../src/packages/mapspinner/height-glsl.js'

const USAGE = 'usage: node scripts/gen-height-js.mjs [--out path.js] [--runtime-path ./glsl-rt.js]\n\nTranspiles the height GLSL (src/packages/mapspinner/height-glsl.js) to a JavaScript module over glsl-rt and prints it, or writes it to --out.'

try {
  const argv = process.argv.slice(2)
  const args = {}
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new RangeError('unexpected argument ' + argv[i])
    args[argv[i].slice(2)] = argv[i + 1]
  }
  const result = transpileGlsl(HEIGHT_GLSL, { exports: HEIGHT_GLSL_EXPORTS, runtimePath: args['runtime-path'] })
  if (args.out) {
    writeFileSync(resolve(args.out), result.code)
    process.stdout.write(JSON.stringify({ out: resolve(args.out), functions: result.functions.length, constants: result.constants.length, bytes: result.code.length }) + '\n')
  } else {
    process.stdout.write(result.code)
  }
} catch (error) {
  process.stderr.write((error && error.message ? error.message : String(error)) + '\n\n' + USAGE + '\n')
  process.exitCode = 1
}
