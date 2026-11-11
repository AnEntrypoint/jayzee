import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const commonDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' }).trim()
const hook = join(commonDir, 'hooks', 'pre-push')
mkdirSync(join(commonDir, 'hooks'), { recursive: true })
writeFileSync(hook, '#!/usr/bin/env bash\nexec "$(git rev-parse --show-toplevel)/.githooks/pre-push" "$@"\n')
chmodSync(hook, 0o755)
console.log('installed ' + hook + ', which runs .githooks/pre-push')
