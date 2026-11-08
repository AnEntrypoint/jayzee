export const GAME_SECTIONS = ['ability', 'progression', 'stats', 'quest', 'chain', 'noContext']

const serialise = (value) => JSON.stringify(value, (key, v) => {
  if (v === undefined) return '<undefined>'
  if (typeof v === 'number' && !Number.isFinite(v)) return `<${v}>`
  return v
})

const attempt = (fn) => {
  try {
    return fn()
  } catch (error) {
    return { threw: error.name, message: error.message }
  }
}

const questDefs = () => ({
  hunt: {
    title: 'Hunt',
    description: 'Clear the cellar',
    objectives: [{ type: 'kill', count: 2, description: 'Rats' }, { type: 'collect', count: 1 }],
    rewards: { xp: 20, items: { gold: 3 }, statBonuses: { damage: 2 } },
  },
  daily: {
    title: 'Daily',
    objectives: [{ type: 'kill', count: 1 }],
    rewards: {},
    repeatable: true,
  },
})

const recordingCtx = (put) => ({
  players: {
    send: (pid, message) => put('effect.send', [pid, message]),
  },
  debug: {
    warn: (text) => put('effect.warn', text),
  },
})

const abilityScenario = (lib, put) => {
  const tree = lib.createAbilityTree()
  put('table', tree.getAllAbilities())
  put('unlocked', [0, 1, 4, 5, 10, 25].map((level) => tree.getUnlockedAbilities(level).map((a) => a.id)))
  put('castRefusals', [tree.castRefusal('a', 99, 50), tree.castRefusal('a', 1, NaN), tree.castRefusal('a', 2, 4), tree.castRefusal('a', 1, 1)])
  put('canCastUnparsed', tree.canCastAbility('a', 1, NaN))
  put('castLocked', tree.castAbility('a', 2, 4))
  put('castFirst', tree.castAbility('a', 1, 1))
  put('cooldownAfterCast', tree.getAbilityCooldown('a', 1))
  put('recast', tree.castAbility('a', 1, 1))
  for (let step = 0; step < 3; step++) tree.tick(0.5)
  put('cooldownAt1_5', tree.getAbilityCooldown('a', 1))
  for (const step of [-1, NaN, Infinity, '1']) tree.tick(step)
  put('cooldownAfterRejectedTicks', tree.getAbilityCooldown('a', 1))
  tree.tick(0.5)
  put('cooldownAt2', tree.getAbilityCooldown('a', 1))
  put('castAfterClear', tree.castAbility('a', 1, 1))
  put('bindHotkeys', [tree.bindHotkey(1, 1), tree.bindHotkey(2, 4), tree.bindHotkey(12, 2)])
  put('hotkeyBindings', tree.getAllHotkeyBindings())
  put('hotkeyOne', tree.getHotkeyBinding(1))
  put('playerInfo', tree.getPlayerAbilityInfo('a', 10))
  put('cooldownsForNetwork', tree.getCooldownsForNetwork('a'))
  put('snapshot', tree.buildSnapshot())
  put('removePlayer', tree.removePlayer('a'))
  put('definitionRefusals', [
    lib.createAbilityTree('nope').getDefinitionRefusals(),
    lib.createAbilityTree([null, { id: 0 }, { id: 1, name: 'a' }, { id: 1 }, { id: 2.5 }, { name: 'x' }, { id: 2 }]).getDefinitionRefusals(),
  ])
  put('cooldownDefaults', lib.createAbilityTree([{ id: 1, cooldown: 0 }, { id: 2, cooldown: 'x' }, { id: 3, cooldown: 0.5 }, { id: 4 }]).getAllAbilities())
}

const progressionScenario = (lib, put) => {
  for (const curve of [lib.CURVE_LINEAR, lib.CURVE_EXPONENTIAL, lib.CURVE_QUADRATIC]) {
    const system = lib.createProgressionSystem({ curve, baseXpPerLevel: 100, maxLevel: 12 })
    put(`thresholds ${curve}`, [1, 2, 3, 5, 8, 12].map((level) => system.calculateXpThreshold(level)))
    put(`scaling ${curve}`, [1, 2, 5, 10].map((level) => lib.getStatScaling(level, 20, curve)))
  }
  put('defaultConfig', lib.createProgressionSystem({ maxLevel: 7 }).getConfig())
  put('refusals', [
    attempt(() => lib.createProgressionSystem({ curve: 'cubic' })),
    attempt(() => lib.createProgressionSystem().calculateXpThreshold(2, 'cubic')),
  ])
  const system = lib.createProgressionSystem({ curve: lib.CURVE_LINEAR, baseXpPerLevel: 100, maxLevel: 10 })
  put('addXpResults', [system.addXpResult('p', 150), system.addXpResult('p', 0), system.addXpResult('p', NaN)])
  system.addXp('p', 400)
  put('progress', system.getProgress('p'))
  put('state', system.getState('p'))
  system.tick(0.016)
  system.tick()
  put('levelUpEvents', system.drainLevelUpEvents('p'))
  put('allStates', system.getAllStates())
  const snapshot = system.buildSnapshot()
  put('snapshot', snapshot)
  const copy = lib.createProgressionSystem({ curve: lib.CURVE_LINEAR, baseXpPerLevel: 100, maxLevel: 10 })
  copy.applySnapshot(snapshot)
  put('restoredState', copy.getState('p'))
  put('removePlayer', system.removePlayer('p'))
}

const statsScenario = (lib, put, ctx, advance) => {
  const equipment = {
    weapon: [
      { id: 'iron', name: 'Iron Sword', bonuses: { damage: 5 } },
      { id: 'steel', name: 'Steel Sword', bonuses: { damage: 9 } },
    ],
    armor: [{ id: 'leather', name: 'Leather', bonuses: { defense: 2 } }],
  }
  const stats = lib.defineStatsSystem({ equipment, xpPerLevel: 100, maxLevel: 10, onLevelUp: (_c, data) => put('hook.onLevelUp', data) }, ctx)
  put('startStats', stats.getStats('p'))
  put('addXPResults', [stats.addXPResult('p', 0), stats.addXPResult('p', 150), stats.addXPResult('p', -5), stats.addXPResult('p', NaN), stats.addXPResult('p', Infinity)])
  put('afterAdd', stats.getStats('p'))
  advance(50)
  put('addXP', stats.addXP('p', 400))
  put('level', stats.getLevel('p'))
  put('applyBonusResults', [
    stats.applyBonusResult('p', 'damage', 2),
    stats.applyBonusResult('p', 'mana', 0),
    stats.applyBonusResult('p', 'gold', 5),
    stats.applyBonusResult('p', 'health', NaN),
  ])
  put('equipRefusal', stats.equipItemResult('p', 'ghost'))
  put('equipIron', stats.equipItemResult('p', 'iron'))
  put('equipSteel', stats.equipItem('p', 'steel'))
  put('equipment', stats.getEquipment('p'))
  put('unequipArmor', stats.unequipSlot('p', 'armor'))
  put('saveBuild', stats.saveLoadoutResult('p', 'build1'))
  put('badLoadoutNames', [stats.saveLoadoutResult('p', '  '), stats.saveLoadoutResult('p', 5)])
  stats.equipItem('p', 'iron')
  put('loadBuild', stats.loadLoadoutResult('p', 'build1'))
  put('loadMissing', [stats.loadLoadout('p', 'nope'), stats.loadLoadoutResult('p', 'nope')])
  put('loadouts', stats.getLoadouts('p'))
  put('loadout', stats.getLoadout('p'))
  put('bonuses', stats.getBonuses('p'))
  stats.push('p')
  const snapshot = stats.snapshot()
  put('snapshot', snapshot)
  const other = lib.defineStatsSystem({ equipment, xpPerLevel: 100, maxLevel: 10 }, ctx)
  other.restore(snapshot)
  put('restored', other.getStats('p'))
  put('restoredLoadouts', other.getLoadouts('p'))
  const noisy = lib.defineStatsSystem({ xpPerLevel: 100, maxLevel: 10, onLevelUp: () => { throw new Error('level hook') } }, ctx)
  put('noisyAddXP', noisy.addXP('w', 150))
}

const questScenario = (lib, put, ctx, now, advance) => {
  const stats = lib.defineStatsSystem({ xpPerLevel: 100, maxLevel: 10 }, ctx)
  const questCtx = {
    players: ctx.players,
    debug: ctx.debug,
    progression: {
      addXP: (pid, amount) => {
        put('effect.progression.addXP', [pid, amount])
        return stats.addXP(pid, amount)
      },
      applyBonus: (pid, stat, amount) => {
        put('effect.progression.applyBonus', [pid, stat, amount])
        return stats.applyBonus(pid, stat, amount)
      },
    },
    inventory: {
      add: (pid, itemId, count) => put('effect.inventory.add', [pid, itemId, count]),
    },
  }
  const quests = lib.defineQuestSystem({
    quests: questDefs(),
    now,
    channel: 'quests',
    onQuestStart: (_c, data) => put('hook.onQuestStart', data),
    onObjectiveProgress: (_c, data) => put('hook.onObjectiveProgress', data),
    onQuestComplete: (_c, data) => put('hook.onQuestComplete', data),
  }, questCtx)
  put('startUnknown', quests.startQuest('p', 'nope'))
  put('startHunt', quests.startQuest('p', 'hunt'))
  put('startAgain', quests.startQuest('p', 'hunt'))
  put('stateAfterStart', quests.getQuestState('p', 'hunt'))
  put('objectiveRefusals', [
    quests.completeObjective('p', 'nope', 0),
    quests.completeObjective('p', 'hunt', 5),
    ...[0, -1, NaN, '1'].map((amount) => quests.completeObjective('p', 'hunt', 0, amount)),
  ])
  advance(100)
  put('objective0', quests.completeObjective('p', 'hunt', 0, 1))
  put('overshoot', quests.completeObjective('p', 'hunt', 0, 5))
  put('atTarget', quests.completeObjective('p', 'hunt', 0, 1))
  advance(100)
  put('lastObjective', quests.completeObjective('p', 'hunt', 1, 1))
  put('afterComplete', quests.completeObjective('p', 'hunt', 0, 1))
  put('stateComplete', quests.getQuestState('p', 'hunt'))
  put('claimUnknown', quests.claimReward('p', 'nope'))
  put('claimEarly', quests.claimReward('p', 'daily'))
  put('claimHunt', quests.claimReward('p', 'hunt'))
  put('claimAgain', quests.claimReward('p', 'hunt'))
  put('allProgress', quests.getAllQuestProgress('p'))
  put('playerQuests', quests.getPlayerQuests('p'))
  quests.push('p')
  quests.startQuest('d', 'daily')
  quests.completeObjective('d', 'daily', 0, 1)
  put('dailyClaim', quests.claimReward('d', 'daily'))
  put('dailyRestart', quests.startQuest('d', 'daily'))
  const snapshot = quests.snapshot()
  put('snapshot', snapshot)
  const restored = lib.defineQuestSystem({ quests: questDefs(), now }, questCtx)
  restored.restore(snapshot)
  put('restoredQuests', restored.getPlayerQuests('p'))
  put('badDefinition', attempt(() => lib.defineQuestSystem({ quests: { bad: { title: 'x' } } }, questCtx)))
  const noisy = lib.defineQuestSystem({ quests: questDefs(), onQuestStart: () => { throw new Error('hook failed') } }, questCtx)
  put('noisyStart', noisy.startQuest('w', 'hunt'))
}

const chainScenario = (lib, put, now, advance) => {
  const context = {
    audio: { play: (name, options) => put('effect.audio.play', [name, options]) },
    world: { spawn: (id, spec) => { put('effect.world.spawn', [id, spec]); return { id } } },
    players: {
      broadcast: (message) => put('effect.broadcast', message),
      playAnimation: (target, clip, options) => put('effect.playAnimation', [target, clip, options]),
    },
    loadLevel: (levelId) => put('effect.loadLevel', levelId),
    state: {},
  }
  const manager = new lib.EventChainManager({ ctx: context, clock: now })
  manager.onLog((entry) => put('log.heard', entry.type))
  manager.addChain({ id: 'hit', trigger: { type: 'onInteract', entityId: 'rat' }, actions: [{ type: 'setVariable', variableName: 'hits', operator: '+=', value: 1 }] })
  manager.addChain({ id: 'any', actions: [{ type: 'setVariable', variableName: 'any', value: true }] })
  manager.addChain({ id: 'off', enabled: false, actions: [{ type: 'setVariable', variableName: 'off', value: 1 }] })
  advance(250)
  put('triggerRat', manager.triggerEvent('onInteract', { entityId: 'rat' }))
  put('triggerBat', manager.triggerEvent('onInteract', { entityId: 'bat' }))
  put('triggerWrongType', manager.triggerEvent('onCollision', {}))
  put('variablesAfterTriggers', manager.getAllVariables())
  manager.addChain({ id: 'zone', trigger: { type: 'onEnterZone', zoneId: 'ruins' } })
  manager.addChain({ id: 'coll', trigger: { type: 'onCollision', targetEntityId: 'orc' } })
  manager.addChain({ id: 'tmr', trigger: { type: 'onTimer', timerId: 't1' } })
  put('matchZone', manager.triggerEvent('onEnterZone', { zoneId: 'ruins' }).map((r) => r.chainId))
  put('matchCollision', manager.triggerEvent('onCollision', { targetEntityId: 'orc' }).map((r) => r.chainId))
  put('matchTimer', manager.triggerEvent('onTimer', { timerId: 't2' }).map((r) => r.chainId))
  manager.addChain({ id: 'gate', conditions: [{ type: 'ifVariable', variableName: 'keys', operator: '>=', value: 1 }], actions: [{ type: 'setVariable', variableName: 'opened', value: true }] })
  put('gateRefused', manager.runChain('gate'))
  manager.setVariable('keys', 2)
  put('gatePassed', manager.runChain('gate'))
  put('runMissing', manager.runChain('nope'))
  manager.setVariable('n', '10')
  manager.setVariable('s', 'abcdef')
  manager.setVariable('flag', 0)
  const check = (variableName, operator, value) => manager.evaluateCondition({ type: 'ifVariable', variableName, operator, value })
  put('conditions', [
    check('n', '==', 10), check('n', '!=', 10), check('n', '>', 9), check('n', '<', 9),
    check('n', '>=', 10), check('n', '<=', 9), check('s', 'contains', 'cd'), check('flag', 'boolean', false),
    check('missing', '==', undefined),
  ])
  manager.setInventoryItem('p1', 'herb', 3)
  manager.setInventoryItem('p1', 'bad', -4)
  manager.setInventoryItem('global', 'herb', 5)
  const holds = (count, extra = {}) => manager.evaluateCondition({ type: 'ifItemInInventory', itemId: 'herb', count, ...extra }, { playerId: 'p1' })
  put('inventoryConditions', [holds(3), holds(4), manager.evaluateCondition({ type: 'ifItemInInventory', itemId: 'herb', count: 5 }, {})])
  put('inventoryItems', [manager.getInventoryItem('p1', 'bad'), manager.getInventoryItem('nobody', 'herb')])
  manager.addChain({ id: 'seq', actions: [
    { type: 'setVariable', variableName: 'a', value: 1 },
    { type: 'delay', duration: 0.5 },
    { type: 'setVariable', variableName: 'b', value: 2 },
    { type: 'delay', duration: 0.5 },
    { type: 'setVariable', variableName: 'c', value: 3 },
  ] })
  manager.triggerEvent('onInteract', {})
  put('beforeDelay', [manager.getVariable('a'), manager.getVariable('b'), manager.getVariable('c')])
  manager.tick(0.5)
  put('halfDelay', [manager.getVariable('a'), manager.getVariable('b'), manager.getVariable('c')])
  manager.tick(0.5)
  put('afterDelay', [manager.getVariable('a'), manager.getVariable('b'), manager.getVariable('c')])
  put('actions', [
    manager.executeAction({ type: 'playSound', sound: 'boom', volume: 0.5, loop: true, targetEntityId: 'door' }, {}, 'c'),
    manager.executeAction({ type: 'spawnPrefab', prefabId: 'box', position: [1, 2, 3], spawnEntityId: 's1' }),
    manager.executeAction({ type: 'loadLevel', levelId: 'cave' }),
    manager.executeAction({ type: 'emitParticle', particleType: 'smoke', count: 3 }),
    manager.executeAction({ type: 'triggerAnimation', targetEntityId: 'npc', clip: 'wave' }),
    manager.executeAction({ type: 'setVariable', variableName: 'hp', operator: '+=', value: 5 }),
  ])
  put('bareAction', new lib.EventChainManager().executeAction({ type: 'playSound', sound: 'boom' }))
  put('logs', manager.getLogs())
  manager.clearLogs()
  put('logsAfterClear', manager.getLogs())
  const exported = manager.toJSON()
  put('exported', exported)
  const restored = new lib.EventChainManager({ ctx: context, clock: now })
  restored.fromJSON(exported)
  put('restoredVariables', restored.getAllVariables())
  manager.reset()
  put('variablesAfterReset', manager.getAllVariables())
}

export const runQuestWithoutContext = (lib, appCtx, now) => {
  const quests = lib.defineQuestSystem({ quests: { hunt: questDefs().hunt }, now }, appCtx)
  quests.startQuest('p', 'hunt')
  quests.completeObjective('p', 'hunt', 0, 2)
  quests.completeObjective('p', 'hunt', 1, 1)
  return { state: quests.getQuestState('p', 'hunt'), claim: quests.claimReward('p', 'hunt') }
}

export const runGameSystems = (lib, { start = 1000 } = {}) => {
  let time = start
  const now = () => time
  const advance = (ms) => {
    time += ms
  }
  const sections = Object.fromEntries(GAME_SECTIONS.map((name) => [name, []]))
  let current = 'ability'
  const put = (label, value) => sections[current].push(serialise([label, value]))
  const enter = (name) => {
    current = name
  }
  const realNow = Date.now
  Date.now = now
  try {
    enter('ability')
    abilityScenario(lib, put)
    enter('progression')
    progressionScenario(lib, put)
    enter('stats')
    statsScenario(lib, put, recordingCtx(put), advance)
    enter('quest')
    questScenario(lib, put, recordingCtx(put), now, advance)
    enter('chain')
    chainScenario(lib, put, now, advance)
    enter('noContext')
    const silent = { players: { send: () => {} }, debug: { warn: () => {} } }
    put('withContext', runQuestWithoutContext(lib, silent, now))
    const nullContext = attempt(() => runQuestWithoutContext(lib, null, now))
    return { sections, nullContext, finalTime: time }
  } finally {
    Date.now = realNow
  }
}

export const serialiseValue = serialise
