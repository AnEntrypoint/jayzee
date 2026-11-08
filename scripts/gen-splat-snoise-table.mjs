import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = dirname(here)
const spointRoot = process.argv[2] || '/workspace/spoint'
const NativeFunction = globalThis.Function
const captured = []
globalThis.Function = function CapturingFunction(...args) {
  captured.push(args)
  return NativeFunction(...args)
}
const jsgen = await import(pathToFileURL(join(spointRoot, 'packages', 'mapspinner', 'src', 'tsl', 'ops-jsgen.js')).href)
const sourceOf = (hashVersion) => {
  captured.length = 0
  jsgen.compileSnoise3({ hashVersion, precision: 'f64' })
  if (captured.length !== 1) throw new Error('expected one compiled function for hash ' + hashVersion + ', got ' + captured.length)
  const source = String(captured[0][captured[0].length - 1])
  if (/ROT_|CARVE|HPF/.test(source)) throw new Error('snoise3 source reads a runtime binding for hash ' + hashVersion)
  return source
}
const block = (name, source) => 'const ' + name + ' = (() => {\n' + source + '\n})()\n'
const text = block('SNOISE3_FLOAT_V1', sourceOf(1)) + block('SNOISE3_INTEGER_V2', sourceOf(2)) + 'export { SNOISE3_FLOAT_V1, SNOISE3_INTEGER_V2 }\n'
globalThis.Function = NativeFunction
writeFileSync(join(root, 'src', 'packages', 'mapspinner', 'splat-snoise-table.js'), text)
console.log('wrote splat-snoise-table.js bytes=' + text.length)
