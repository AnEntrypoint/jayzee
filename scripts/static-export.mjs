import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { EXPORT_TARGETS, buildExport, zipStore } from './lib/staticExport.mjs'

export async function writeExport({ appsDir, outDir, target = 'itch', base = './', zip = target === 'itch' } = {}) {
  if (typeof outDir !== 'string' || outDir.length === 0) throw new TypeError('writeExport needs an output directory')
  const built = await buildExport({ appsDir, target, base })
  rmSync(outDir, { recursive: true, force: true })
  for (const { to, bytes } of built.files) {
    const path = join(outDir, to)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, bytes)
  }
  let zipPath = null
  if (zip) {
    zipPath = outDir.replace(/[\\/]+$/, '') + '.zip'
    writeFileSync(zipPath, zipStore(built.files))
  }
  return { ...built, outDir, zipPath }
}

const parseArgs = (argv) => {
  const options = { appsDir: 'apps', outDir: null, target: 'itch', base: './' }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--apps') options.appsDir = argv[++i]
    else if (arg === '--out') options.outDir = argv[++i]
    else if (arg === '--target') options.target = argv[++i]
    else if (arg === '--base') options.base = argv[++i]
    else if (arg === '--no-zip') options.zip = false
    else throw new Error('unknown argument ' + arg + '; use --apps <dir> --out <dir> --target ' + EXPORT_TARGETS.join('|') + ' --base <path> --no-zip')
  }
  if (options.outDir === null) options.outDir = join('dist', 'export-' + options.target)
  return options
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await writeExport(parseArgs(process.argv.slice(2)))
    console.log('static export: ' + result.files.length + ' files, ' + result.totalBytes + ' bytes, target ' + result.target + ', written to ' + result.outDir + (result.zipPath ? ' and ' + result.zipPath : ''))
  } catch (error) {
    console.error('static export refused: ' + error.message)
    process.exit(1)
  }
}
