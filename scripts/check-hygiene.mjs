import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const HOST_CLOCK = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require']
const HOST_STD = [...HOST_CLOCK, 'Buffer']

const SCOPES = [
  { label: 'src/terrain-pure/heightfieldPhysics.js', files: ['src/terrain-pure/heightfieldPhysics.js'], hosts: HOST_STD, mathRandom: true },
  { label: 'src/apps/hookOrder.js', files: ['src/apps/hookOrder.js'], hosts: HOST_STD, mathRandom: true },
  { label: 'src/spawn/namedAssetRedirect.js', files: ['src/spawn/namedAssetRedirect.js'], hosts: [...HOST_STD, 'fetch', 'URL'], mathRandom: true },
  { label: 'src/physics-pure', dir: 'src/physics-pure', hosts: HOST_STD, mathRandom: true },
  { label: 'src/sandbox/limits.js', files: ['src/sandbox/limits.js'], hosts: HOST_STD, mathRandom: true },
  { label: 'src/world/query.js', files: ['src/world/query.js'], hosts: HOST_STD, mathRandom: true },
  { label: 'src/rollback-pure correctionObserver.js and peerSimRuntime.js', files: ['src/rollback-pure/correctionObserver.js', 'src/rollback-pure/peerSimRuntime.js'], hosts: ['process', 'performance', 'Date', 'setTimeout', 'setInterval', 'clearInterval', 'console', 'window', 'globalThis', 'require', 'Buffer'] },
  { label: 'src/tick-pure', dir: 'src/tick-pure', hosts: HOST_CLOCK },
  { label: 'src/upstream-builtins', dir: 'src/upstream-builtins', hosts: [...HOST_STD, 'URL', 'eval', 'Function', 'fetch'], stripStrings: true },
  { label: 'src/upstream-doors', dir: 'src/upstream-doors', hosts: [...HOST_STD, 'URL', 'fetch', 'XMLHttpRequest', 'WebSocket'] },
  { label: 'src/upstream-skills', dir: 'src/upstream-skills', hosts: [...HOST_STD, 'eval', 'Function', 'fetch'] },
  { label: 'src/upstream-tome', dir: 'src/upstream-tome', hosts: [...HOST_STD, 'URL'] },
  { label: 'src/upstream-reference', dir: 'src/upstream-reference', hosts: HOST_STD },
  { label: 'src/worker-dispatch-pure', dir: 'src/worker-dispatch-pure', hosts: [...HOST_STD, 'postMessage', 'self', 'document', 'Worker', 'fetch'] },
  { label: 'src/transport/workerTransport.js', files: ['src/transport/workerTransport.js'], hosts: ['self', 'postMessage', 'Worker', 'window', 'globalThis', 'process', 'require'], imports: false },
  { label: "missing-rows sdk-editor", files: ["src/sdk/EditOpLog.js","src/sdk/PlaceInstances.js","src/sdk/PrefabSpawner.js","src/sdk/AppManifest.js","src/sdk/FreddieBridge.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows sdk-misc", files: ["src/sdk/PublicBenchmark.js","src/sdk/RoomLog.js","src/sdk/ServerTimeOfDay.js","src/sdk/SharedEventEnvelope.js","src/sdk/appEventSender.js","src/sdk/scatterSpec.js","src/sdk/TextureAtlas.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows behaviours-a", files: ["src/behaviours/checkpoint.js","src/behaviours/decisionPipe.js","src/behaviours/decisionRuntime.js","src/behaviours/gamemode.js","src/behaviours/buoyancy.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows behaviours-b", files: ["src/behaviours/pickup.js","src/behaviours/shrinkingZone.js","src/behaviours/projectile.js","src/behaviours/projectileGravity.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows behaviours-c", files: ["src/behaviours/steering.js","src/behaviours/teams.js","src/behaviours/trade.js","src/behaviours/weapon.js","src/behaviours/voxelPart.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows apps-a", files: ["src/apps/persistedStore.js","src/apps/AccountState.js","src/apps/AppSeats.js","src/apps/AppRuntimeState.js","src/apps/AppRuntimeStaticMotion.js","src/apps/AppPhysics.js","src/apps/AppGameplay.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows apps-b", files: ["src/apps/CustomVersion.js","src/apps/EcsEntityMap.js","src/apps/EventBus.js","src/apps/SurfaceSelector.js","src/apps/SurfaceSelectorRuntime.js","src/apps/appImports.js"], hosts: HOST_STD, mathRandom: true },
  { label: "src/procgen", dir: "src/procgen", hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows shared-pure", files: ["src/shared/biomeColor.js","src/shared/ballisticsElevation.js","src/shared/bookmarks.js","src/shared/colliderLattice.js","src/shared/equipment.js","src/shared/materialSlots.js","src/shared/worldPresets.js","src/shared/worldResolve.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows client-pure", files: ["src/client-pure/tileExtent.js","src/client-pure/keybindingDefaults.js","src/client-pure/keyBindings.js","src/client-pure/transformLerp.js","src/client-pure/cacheRevalidationSweep.js","src/client-pure/exactPatchFrame.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows client-machines", files: ["src/client-pure/clientMachine.js","src/client-pure/loadingMachine.js","src/client-pure/inputActionCompile.js","src/client-pure/inputStepper.js","src/client-pure/stateValue.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows terrain-static", files: ["src/terrain-pure/terrainAmbientScalars.js","src/terrain-pure/terrainDefaults.js","src/terrain-pure/bakeCodeVersion.js"], hosts: HOST_STD, mathRandom: true },
  { label: "src/static", dir: "src/static", hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows import-scene", files: ["src/sdk/sceneImport.js","src/sdk/tiledImport.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows chart-migrators", files: ["src/sdk/chartState/migratePlayers.js","src/sdk/chartState/migrateWorldAnchors.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows netcode-small", files: ["src/netcode/playerManager.js","src/netcode/networkState.js","src/netcode/vecGuard.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows editor-serialize", files: ["src/sdk/editorHandlersSerialize.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows app-behaviours", files: ["src/apps/appBehaviours.js"], hosts: HOST_STD, mathRandom: true },
  { label: "missing-rows app-runtime-state", files: ["src/apps/appRuntimeTags.js","src/apps/appStaticMotion.js"], hosts: HOST_STD, mathRandom: true },
]

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const findingsIn = (source, scope) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (scope.mathRandom && source.includes('Math.random')) found.push('uses Math.random')
  if (scope.imports !== false) {
    for (const piece of source.split("from '").slice(1)) {
      const specifier = piece.slice(0, piece.indexOf("'"))
      if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
    }
  }
  const text = scope.stripStrings ? source.replace(/'[^'\n]*'|"[^"\n]*"/g, "''") : source
  const words = new Set(text.split(/[^A-Za-z0-9_$]/))
  for (const token of scope.hosts) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

const pathsOf = (scope) => {
  if (scope.files) return scope.files
  return readdirSync(join(root, scope.dir)).filter((name) => name.endsWith('.js')).sort().map((name) => join(scope.dir, name))
}

for (const scope of SCOPES) {
  const rules = scope.imports === false ? 'comment-free and reads no host global' : 'comment-free, imports only relative modules and reads no host global'
  gate(scope.label + ' is ' + rules, () => {
    const paths = pathsOf(scope)
    assert(paths.length > 0, 'no source files matched')
    for (const path of paths) {
      const found = findingsIn(readFileSync(join(root, path), 'utf8'), scope)
      assert(found.length === 0, path + ': ' + found.join(', '))
    }
  })
}

gate('control: the scanner flags a comment, a bare import and a host global, and ignores a host word inside a string only when strings are stripped', () => {
  const planted = "import fs from 'node:fs'\nconst t = performance.now() // x"
  const flagged = findingsIn(planted, { hosts: HOST_STD }).join(',')
  assert(flagged === 'comment marker,bare import node:fs,uses performance', 'planted sample: ' + flagged)
  assert(findingsIn("const key = 'window'", { hosts: ['window'], stripStrings: true }).length === 0, 'a string literal was read as a host global')
  assert(findingsIn("const key = 'window'", { hosts: ['window'] }).join(',') === 'uses window', 'unstripped string was not flagged')
})

finish()
