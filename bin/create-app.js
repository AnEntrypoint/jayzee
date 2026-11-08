#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTemplateContent } from './templates.js'

const BIN_DIR = dirname(fileURLToPath(import.meta.url))
const PACKAGE_ROOT = join(BIN_DIR, '..')
const PROJECT_TEMPLATE_DIR = join(BIN_DIR, 'project-template')
const TEMPLATES = ['simple', 'physics', 'interactive', 'spawner', 'fsm-game']
const DEFAULT_TEMPLATE = 'simple'
const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/

function fail(message) {
  console.error('Error: ' + message)
  process.exit(1)
}

function showHelp() {
  const lines = [
    'Usage: jayzee-create-app [options] <app-name>',
    '',
    'Options:',
    '  --template <type>   One of: ' + TEMPLATES.join(', ') + ' (default: ' + DEFAULT_TEMPLATE + ')',
    '  --help              Show this help message',
    '',
    'Creates <app-name>/ in the current directory: package.json, README.md, .gitignore,',
    'and apps/<app-name>/index.js holding the starter for the chosen template.',
  ]
  console.log(lines.join('\n'))
}

function parseArgs(argv) {
  const args = { name: null, template: DEFAULT_TEMPLATE, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--help') {
      args.help = true
    } else if (arg === '--template') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) fail('--template needs a value: one of ' + TEMPLATES.join(', '))
      args.template = argv[++i]
    } else if (arg.startsWith('--')) {
      fail("unknown option '" + arg + "' (see --help)")
    } else if (args.name === null) {
      args.name = arg
    } else {
      fail("unexpected extra argument '" + arg + "': give exactly one app name")
    }
  }
  return args
}

function readProjectTemplate(file) {
  return readFileSync(join(PROJECT_TEMPLATE_DIR, file), 'utf8')
}

function fillTemplate(text, replacements) {
  let filled = text
  for (const [key, value] of Object.entries(replacements)) filled = filled.replaceAll(key, value)
  return filled
}

function jayzeeVersion() {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  if (typeof pkg.version !== 'string' || pkg.version === '') fail('the jayzee package.json has no version field')
  return pkg.version
}

function createProject(name, template) {
  if (!NAME_PATTERN.test(name)) fail('invalid app name (use letters, digits, - and _ only)')
  if (!TEMPLATES.includes(template)) fail("unknown template '" + template + "'; available: " + TEMPLATES.join(', '))
  const dest = resolve(process.cwd(), name)
  if (existsSync(dest)) fail("'" + dest + "' already exists")
  const starter = getTemplateContent(template)
  const packageJson = fillTemplate(readProjectTemplate('package.json.template'), { __PROJECT_NAME__: name, __JAYZEE_VERSION__: jayzeeVersion() })
  const readme = fillTemplate(readProjectTemplate('README.md.template'), { __PROJECT_NAME__: name })
  const gitignore = readProjectTemplate('gitignore.template')
  try {
    mkdirSync(join(dest, 'apps', name), { recursive: true })
    writeFileSync(join(dest, 'apps', name, 'index.js'), starter)
    writeFileSync(join(dest, 'package.json'), packageJson)
    writeFileSync(join(dest, 'README.md'), readme)
    writeFileSync(join(dest, '.gitignore'), gitignore)
  } catch (error) {
    rmSync(dest, { recursive: true, force: true })
    fail("cannot scaffold '" + name + "' (" + error.message + "); removed the partial directory")
  }
  console.log('[ok] Created ' + name + '/')
  console.log('  Template: ' + template)
  console.log('  App: apps/' + name + '/index.js')
  console.log('\nNext steps:')
  console.log('  cd ' + name)
  console.log('  npm install')
}

function main(argv) {
  const args = parseArgs(argv)
  if (args.help) {
    showHelp()
    return
  }
  if (!args.name) {
    console.error('Error: app name required')
    showHelp()
    process.exit(1)
  }
  createProject(args.name, args.template)
}

main(process.argv.slice(2))
