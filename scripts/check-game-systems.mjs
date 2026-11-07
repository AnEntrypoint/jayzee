import { gate, finish } from './lib/gate.mjs'
import { DEFAULT_ABILITIES, createAbilityTree } from '../src/game/AbilityTree.js'
import { CURVE_LINEAR, CURVE_EXPONENTIAL, CURVE_QUADRATIC, createProgressionSystem, getStatScaling } from '../src/game/ProgressionSystem.js'
import { defineStatsSystem } from '../src/game/StatsSystem.js'
import { defineQuestSystem } from '../src/game/QuestSystem.js'
import { EventChainManager } from '../src/game/EventChainManager.js'
import * as game from '../src/game/index.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const same = (actual, expected, label) => {
  const got = JSON.stringify(actual)
  const want = JSON.stringify(expected)
  assert(got === want, `${label}: got ${got}, expected ${want}`)
}

const negative = (label, check) => {
  let failed = false
  try {
    check()
  } catch {
    failed = true
  }
  assert(failed, `${label}: the negative control passed when it must fail`)
}

const throwsKind = (kind, fn) => {
  try {
    fn()
  } catch (error) {
    return error instanceof kind
  }
  return false
}

const throwsAny = (fn) => {
  try {
    fn()
  } catch {
    return true
  }
  return false
}

const abilityTable = (tree) => tree.getAllAbilities().map((a) => [a.id, a.name, a.manaCost, a.cooldown, a.unlockLevel, a.damage])
const expectedAbilityTable = [
  [1, 'Fireball', 20, 2, 1, 25],
  [2, 'Frost Nova', 30, 5, 5, 15],
  [3, 'Lightning Strike', 40, 4, 10, 40],
  [4, 'Teleport', 35, 8, 15, 0],
  [5, 'Meteor Shower', 50, 10, 25, 60]
]
const unlockedIds = (tree, level) => tree.getUnlockedAbilities(level).map((a) => a.id)

gate('AbilityTree default table matches the spoint definitions', () => {
  same(abilityTable(createAbilityTree()), expectedAbilityTable, 'default table')
  const cheaper = [{ ...DEFAULT_ABILITIES[0], cooldown: 3 }, ...DEFAULT_ABILITIES.slice(1)]
  negative('a changed cooldown is caught', () => same(abilityTable(createAbilityTree(cheaper)), expectedAbilityTable, 'table'))
})

gate('AbilityTree unlock rule opens an ability at its unlockLevel', () => {
  const tree = createAbilityTree()
  same(unlockedIds(tree, 0), [], 'level 0')
  same(unlockedIds(tree, 1), [1], 'level 1')
  same(unlockedIds(tree, 4), [1], 'level 4')
  same(unlockedIds(tree, 5), [1, 2], 'level 5')
  same(unlockedIds(tree, 10), [1, 2, 3], 'level 10')
  same(unlockedIds(tree, 25), [1, 2, 3, 4, 5], 'level 25')
  negative('ability 2 at level 4 is caught', () => same(unlockedIds(tree, 4), [1, 2], 'level 4'))
})

gate('cast refusals keep the spoint order: unknown, unparsed level, locked, cooling', () => {
  const tree = createAbilityTree()
  same(tree.castRefusal('a', 99, 50), 'unknown-ability', 'unknown ability')
  same(tree.castRefusal('a', 1, NaN), 'level-unparsed', 'unparsed level')
  same(tree.castRefusal('a', 2, 4), 'locked', 'locked ability')
  same(tree.castRefusal('a', 1, 1), null, 'castable ability')
  same(tree.castAbility('a', 2, 4), { ok: false, reason: 'locked' }, 'cast locked')
  same(tree.canCastAbility('a', 1, NaN), { ok: true, reason: null }, 'can cast with unparsed level and no cooldown')
  negative('a castable ability is not reported locked', () => same(tree.castRefusal('a', 1, 1), 'locked', 'castRefusal'))
})

gate('a cast starts a cooldown that ticks down and clears at zero', () => {
  const tree = createAbilityTree()
  same(tree.castAbility('a', 1, 1), { ok: true, reason: null }, 'first cast')
  same(tree.getAbilityCooldown('a', 1), 2, 'cooldown after cast')
  same(tree.castAbility('a', 1, 1), { ok: false, reason: 'cooling' }, 'recast')
  for (let step = 0; step < 3; step++) tree.tick(0.5)
  same(tree.getAbilityCooldown('a', 1), 0.5, 'cooldown at 1.5 s')
  same(tree.castAbility('a', 1, 1), { ok: false, reason: 'cooling' }, 'recast at 1.5 s')
  tree.tick(0.5)
  same(tree.getAbilityCooldown('a', 1), 0, 'cooldown at 2 s')
  same(tree.castAbility('a', 1, 1), { ok: true, reason: null }, 'cast after clear')
  negative('a freshly cast ability is not ready', () => same(tree.getAbilityCooldown('a', 1), 0, 'cooldown'))
})

gate('tick ignores a negative, NaN, infinite or non-numeric step', () => {
  const tree = createAbilityTree()
  tree.castAbility('a', 1, 1)
  for (const step of [-1, NaN, Infinity, '1']) tree.tick(step)
  same(tree.getAbilityCooldown('a', 1), 2, 'cooldown after rejected steps')
  tree.tick(0.5)
  same(tree.getAbilityCooldown('a', 1), 1.5, 'cooldown after a valid step')
  negative('an applied step is visible', () => same(tree.getAbilityCooldown('a', 1), 2, 'cooldown'))
})

gate('cooldown is at least 0.1 s, defaults to 1 s, and missing fields take their defaults', () => {
  const tree = createAbilityTree([{ id: 1, cooldown: 0 }, { id: 2, cooldown: 'x' }, { id: 3, cooldown: 0.5 }, { id: 4 }])
  same(tree.getAbility(1).cooldown, 0.1, 'zero cooldown clamps up')
  same(tree.getAbility(2).cooldown, 1, 'non-number cooldown')
  same(tree.getAbility(3).cooldown, 0.5, 'valid cooldown')
  const bare = tree.getAbility(4)
  same([bare.name, bare.manaCost, bare.unlockLevel, bare.damage], ['', 0, 1, 0], 'missing fields')
  negative('a zero cooldown kept at zero is caught', () => same(tree.getAbility(1).cooldown, 0, 'cooldown'))
})

gate('definition refusals name each bad entry and keep the valid ones', () => {
  const rejected = createAbilityTree('nope')
  same(rejected.getDefinitionRefusals(), [{ index: null, field: 'definitions', reason: 'definitions-not-an-array' }], 'not an array')
  same(rejected.getAllAbilities(), [], 'no abilities from a non-array')
  const mixed = createAbilityTree([null, { id: 0 }, { id: 1, name: 'a' }, { id: 1 }, { id: 2.5 }, { name: 'x' }, { id: 2 }])
  same(mixed.getDefinitionRefusals(), [
    { index: 0, field: 'definitions[0]', reason: 'not-an-object' },
    { index: 1, field: 'definitions[1]', reason: 'id-not-a-positive-integer' },
    { index: 3, field: 'definitions[3]', reason: 'duplicate-id' },
    { index: 4, field: 'definitions[4]', reason: 'id-not-a-positive-integer' },
    { index: 5, field: 'definitions[5]', reason: 'id-missing' }
  ], 'mixed refusals')
  same(mixed.getAllAbilities().map((a) => a.id), [1, 2], 'valid ids kept')
  negative('the duplicate refusal is counted', () => same(mixed.getDefinitionRefusals().length, 4, 'count'))
})

gate('default hotkeys bind slots 1 to 5 and leave 6 to 9 unbound', () => {
  const tree = createAbilityTree()
  same(tree.getAllHotkeyBindings(), { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: null, 7: null, 8: null, 9: null }, 'default bindings')
  same(tree.bindHotkey(10, 1), { ok: false, reason: 'slot-out-of-range' }, 'slot 10')
  same(tree.bindHotkey(0, 1), { ok: false, reason: 'slot-out-of-range' }, 'slot 0')
  same(tree.bindHotkey(1.5, 1), { ok: false, reason: 'slot-out-of-range' }, 'fractional slot')
  same(tree.bindHotkey(1, 99), { ok: false, reason: 'unknown-ability' }, 'unknown ability')
  same(tree.bindHotkey(1, null), { ok: true, reason: null }, 'unbind slot 1')
  same(tree.getHotkeyBinding(1), null, 'slot 1 after unbind')
  same(tree.bindHotkey(7, 5), { ok: true, reason: null }, 'bind slot 7')
  same(tree.getHotkeyBinding(7), 5, 'slot 7 binding')
  negative('an unknown ability is not bound', () => same(tree.bindHotkey(2, 99).ok, true, 'bind'))
})

gate('a hotkey map with a bad entry reports it and leaves that slot unbound', () => {
  const tree = createAbilityTree(DEFAULT_ABILITIES, { 1: 99, 2: 2, 10: 1 })
  same(tree.getHotkeyRefusals(), [{ field: 'hotkeys.1', reason: 'unknown-ability' }, { field: 'hotkeys.10', reason: 'slot-out-of-range' }], 'refusals')
  same(tree.getAllHotkeyBindings(), { 1: null, 2: 2 }, 'bindings')
  negative('a clean map reports no refusal', () => same(createAbilityTree(DEFAULT_ABILITIES, { 2: 2 }).getHotkeyRefusals().length, 1, 'count'))
})

gate('ability snapshot restores cooldowns and reports each dropped entry', () => {
  const source = createAbilityTree()
  source.castAbility(7, 1, 1)
  source.castAbility('x', 2, 5)
  const target = createAbilityTree()
  const restored = target.applySnapshot(source.buildSnapshot())
  same([restored.ok, restored.hotkeys, restored.players, restored.dropped], [true, 9, 2, []], 'clean restore')
  same(target.getCooldownsForNetwork(7), [{ abilityId: 1, remaining: 2 }], 'numeric player id restored')
  same(target.getCooldownsForNetwork('x'), [{ abilityId: 2, remaining: 5 }], 'string player id restored')
  const hostileTree = createAbilityTree()
  const hostile = hostileTree.applySnapshot({
    hotkeys: { 0: 1, 3: 42, 4: null },
    playerStates: [
      { playerId: 'z', cooldowns: [[1, 1], [99, 1], ['bad', 1], [2, 'soon'], 'nope'] },
      { cooldowns: [] },
      { playerId: 'z', cooldowns: [] }
    ]
  })
  same([hostile.ok, hostile.hotkeys, hostile.players], [true, 1, 1], 'hostile counts')
  same(hostile.dropped, [
    { field: 'hotkeys.0', reason: 'slot-out-of-range' },
    { field: 'hotkeys.3', reason: 'unknown-ability' },
    { field: 'playerStates[0].cooldowns[1].abilityId', reason: 'unknown-ability' },
    { field: 'playerStates[0].cooldowns[2].abilityId', reason: 'not-a-number' },
    { field: 'playerStates[0].cooldowns[3].cooldown', reason: 'not-a-number' },
    { field: 'playerStates[0].cooldowns[4]', reason: 'not-an-array' },
    { field: 'playerStates[1].playerId', reason: 'missing' },
    { field: 'playerStates[2].playerId', reason: 'duplicate-player' }
  ], 'dropped entries')
  same(hostileTree.getCooldownsForNetwork('z'), [{ abilityId: 1, remaining: 1 }], 'only the valid cooldown kept')
  same(createAbilityTree().applySnapshot(null), { ok: false, reason: 'not-an-object', hotkeys: 0, players: 0, dropped: [] }, 'null snapshot')
  negative('the bad slot 0 is not kept', () => same(hostileTree.getHotkeyBinding(0), 1, 'slot 0'))
})

gate('removePlayer clears a player, and network cooldowns round to milliseconds', () => {
  const tree = createAbilityTree()
  tree.castAbility('r', 2, 5)
  tree.tick(0.1234567)
  same(tree.getCooldownsForNetwork('r'), [{ abilityId: 2, remaining: 4.877 }], 'rounded remaining')
  negative('the remaining time is not sent unrounded', () => same(tree.getCooldownsForNetwork('r'), [{ abilityId: 2, remaining: 4.8765433 }], 'remaining'))
  same(tree.getPlayerAbilityInfo('r', 5).activeAbilities, [2], 'active abilities')
  same(tree.getPlayerAbilityInfo('r', 5).unlockedAbilities.map((a) => a.id), [1, 2], 'unlocked at level 5')
  tree.removePlayer('r')
  same(tree.getCooldownsForNetwork('r'), [], 'network cooldowns after removal')
  same(tree.getAbilityCooldown('r', 2), 0, 'cooldown after removal')
})

const thresholdsOf = (curve, levels, extra = {}) => {
  const system = createProgressionSystem({ curve, baseXpPerLevel: 100, ...extra })
  return levels.map((level) => system.calculateXpThreshold(level))
}

gate('XP thresholds per curve match the spoint formulas', () => {
  same(thresholdsOf(CURVE_LINEAR, [1, 2, 3, 4]), [0, 100, 200, 300], 'linear')
  same(thresholdsOf(CURVE_EXPONENTIAL, [1, 2, 3, 4, 5], { curveScalar: 1.5 }), [0, 100, 150, 225, 337], 'exponential')
  same(thresholdsOf(CURVE_QUADRATIC, [1, 2, 3, 4, 10]), [0, 100, 400, 900, 8100], 'quadratic')
  negative('the quadratic table is not the linear table', () => same(thresholdsOf(CURVE_QUADRATIC, [1, 2, 3, 4]), [0, 100, 200, 300], 'table'))
})

gate('illegal progression config is refused and a legal one is accepted', () => {
  for (const bad of [{ curve: 'cubic' }, { maxLevel: 0 }, { maxLevel: 2.5 }, { baseXpPerLevel: -1 }, { curveScalar: NaN }, { xpPerKill: -1 }]) {
    assert(throwsKind(TypeError, () => createProgressionSystem(bad)), 'accepted ' + JSON.stringify(bad))
  }
  assert(throwsKind(TypeError, () => createProgressionSystem().calculateXpThreshold(2, 'cubic')), 'accepted an illegal curve argument')
  same(createProgressionSystem({ maxLevel: 7 }).getConfig(), { curve: 'quadratic', baseXpPerLevel: 100, curveScalar: 1.5, maxLevel: 7, xpPerKill: 10 }, 'defaults merged')
  negative('a legal curve is refused', () => assert(throwsKind(TypeError, () => createProgressionSystem({ curve: CURVE_LINEAR })), 'refused'))
})

gate('one award that crosses several thresholds raises one event per level', () => {
  const system = createProgressionSystem({ curve: CURVE_LINEAR, baseXpPerLevel: 100, maxLevel: 10 })
  same(system.addXpResult('a', 300), { ok: true, reason: null, leveledUp: true }, 'award')
  same(system.getState('a').level, 4, 'level')
  const events = system.drainLevelUpEvents('a')
  same(events.map((e) => [e.level, e.xp, e.totalXp]), [[2, 200, 300], [3, 100, 300], [4, 0, 300]], 'events')
  same(system.drainLevelUpEvents('a'), [], 'events are drained once')
  same(system.addXpResult('a', 0), { ok: true, reason: null, leveledUp: false }, 'zero award')
  for (const bad of [-1, NaN, Infinity]) {
    same(system.addXpResult('a', bad), { ok: false, reason: 'invalid-amount', leveledUp: false }, 'invalid ' + bad)
  }
  same(system.getState('a').totalXp, 300, 'total untouched by refusals')
  negative('a two-level award is caught', () => same(events.map((e) => e.level), [2, 3], 'levels'))
})

gate('maxLevel caps the level and the excess XP stays in the total', () => {
  const system = createProgressionSystem({ maxLevel: 3 })
  system.addXp('c', 10000)
  const state = system.getState('c')
  same([state.level, state.xp, state.totalXp], [3, 9600, 10000], 'capped state')
  same(system.drainLevelUpEvents('c').map((e) => e.level), [2, 3], 'events stop at maxLevel')
  same(system.getProgress('c').progressRatio, 1, 'ratio clamps to one')
  negative('a level of 4 is caught', () => same(state.level, 4, 'level'))
})

gate('u32 saturation pins the total, reports no level-up and keeps returning false', () => {
  const system = createProgressionSystem({ maxLevel: 100 })
  same(system.addXpResult('s', 0xffffffff), { ok: true, reason: null, leveledUp: true }, 'award up to the bound')
  same(system.addXpResult('s', 1), { ok: false, reason: 'xp-saturated', leveledUp: false }, 'overflow')
  same(system.addXp('s', 5), false, 'addXp after saturation')
  const state = system.getState('s')
  same([state.totalXp, state.level, state.xp], [4294967295, 100, 4293987195], 'pinned state')
  negative('the total is not one below the bound', () => same(state.totalXp, 4294967294, 'total'))
})

gate('progress ratio is XP into the level over the level span', () => {
  const system = createProgressionSystem({ curve: CURVE_LINEAR, baseXpPerLevel: 100 })
  system.addXp('d', 50)
  same(system.getProgress('d'), { level: 1, xp: 50, totalXp: 50, xpForLevel: 100, xpInLevel: 50, progressRatio: 0.5 }, 'level 1')
  system.addXp('d', 60)
  same(system.getProgress('d'), { level: 2, xp: 10, totalXp: 110, xpForLevel: 100, xpInLevel: 10, progressRatio: 0.1 }, 'level 2')
  negative('a quarter ratio is not the half ratio', () => same(system.getProgress('d').progressRatio, 0.25, 'ratio'))
})

gate('progression snapshot recomputes level from the total and clamps the total and tick', () => {
  const system = createProgressionSystem({ curve: CURVE_QUADRATIC, baseXpPerLevel: 100 })
  system.applySnapshot({ progressions: [{ id: 'x', totalXp: 450, lastLevelUpTick: -3.7 }] })
  same(system.getState('x'), { id: 'x', xp: 50, level: 3, totalXp: 450, lastLevelUpTick: 0, levelUpEvents: [] }, 'restored')
  system.applySnapshot({ progressions: [{ id: 'y', totalXp: -5 }, { id: 'z', totalXp: 1e12 }] })
  same([system.getState('y').totalXp, system.getState('z').totalXp, system.getState('z').level], [0, 4294967295, 100], 'clamped totals')
  system.applySnapshot(null)
  same(system.getState('x').level, 3, 'null snapshot ignored')
  const copy = createProgressionSystem({ curve: CURVE_QUADRATIC, baseXpPerLevel: 100 })
  copy.applySnapshot(system.buildSnapshot())
  same(copy.buildSnapshot(), system.buildSnapshot(), 'round trip')
  negative('a level of 2 is not restored', () => same(system.getState('x').level, 2, 'level'))
})

gate('getStatScaling follows the three curves and falls back to the base value', () => {
  same([getStatScaling(3, 100, CURVE_LINEAR), getStatScaling(3, 100, CURVE_EXPONENTIAL), getStatScaling(3, 100, CURVE_QUADRATIC)], [110, 110, 120], 'three curves at level 3')
  same([getStatScaling(1, 100), getStatScaling(50, 100, CURVE_LINEAR), getStatScaling(3, 100, 'bogus')], [100, 345, 100], 'default and unknown curve')
  negative('the quadratic value is not the linear one', () => same(getStatScaling(3, 100, CURVE_QUADRATIC), 110, 'quadratic'))
})

gate('tick counts elapsed ticks and stamps level-up events with them', () => {
  const system = createProgressionSystem()
  system.tick(0.016)
  system.tick()
  system.addXp('t', 100)
  same(system.drainLevelUpEvents('t').map((e) => e.tick), [2], 'event tick')
  const once = createProgressionSystem()
  once.tick()
  once.addXp('t', 100)
  negative('one tick is not stamped as two', () => same(once.drainLevelUpEvents('t').map((e) => e.tick), [2], 'tick'))
})

const expectedStatsOf = { level: 1, xp: 0, health: 100, mana: 50, damage: 10, defense: 5, speed: 1 }

gate('default stats scale per level as spoint does', () => {
  const stats = defineStatsSystem({}, null)
  same(stats.getStats('p'), expectedStatsOf, 'level 1')
  stats.addXP('p', 100)
  same(stats.getStats('p'), { level: 2, xp: 100, health: 110, mana: 55, damage: 10.5, defense: 5.25, speed: 1 }, 'level 2')
  negative('level 2 health is not the level 1 health', () => same(stats.getStats('p').health, 100, 'health'))
})

gate('addXPResult refuses zero, negative, NaN and infinite amounts', () => {
  const stats = defineStatsSystem({}, null)
  for (const bad of [0, -5, NaN, Infinity]) {
    same(stats.addXPResult('p', bad), { ok: false, reason: 'xp-invalid-amount' }, 'amount ' + bad)
  }
  same(stats.getStats('p').xp, 0, 'no xp added')
  same(stats.addXPResult('p', 1), { ok: true, reason: null }, 'a positive amount')
  negative('a zero award is not accepted', () => same(stats.addXP('p', 0), true, 'addXP'))
})

gate('level cap clamps xp at the maxLevel threshold', () => {
  const stats = defineStatsSystem({ maxLevel: 50 }, null)
  stats.addXP('c', 10000)
  same([stats.getLevel('c'), stats.getStats('c').xp, stats.getStats('c').health], [50, 5000, 590], 'capped')
  stats.addXP('c', 1)
  same([stats.getLevel('c'), stats.getStats('c').xp], [50, 5000], 'further xp')
  negative('a level past maxLevel is caught', () => same(stats.getLevel('c'), 51, 'level'))
})

gate('startLevel and startXP set where a new player begins', () => {
  const leveled = defineStatsSystem({ startLevel: 3 }, null)
  same(leveled.getStats('z'), { level: 3, xp: 200, health: 120, mana: 60, damage: 11, defense: 5.5, speed: 1 }, 'startLevel 3')
  const banked = defineStatsSystem({ startXP: 50 }, null)
  same([banked.getLevel('y'), banked.getStats('y').xp], [1, 50], 'startXP 50')
  negative('startXP 50 does not reach level 2', () => same(banked.getLevel('y'), 2, 'level'))
})

gate('onLevelUp fires once per level gained and every change pushes the stats channel', () => {
  const levelUps = []
  const sent = []
  const stats = defineStatsSystem({ onLevelUp: (ctx, data) => levelUps.push(data) }, { players: { send: (pid, message) => sent.push([pid, message]) } })
  stats.addXP('p', 50)
  same([levelUps.length, sent.length, sent[0][1].type, sent[0][1].nextLevelXP], [0, 1, 'stats', 100], 'no level yet')
  negative('a level-up is reported before it happens', () => same(levelUps.length, 1, 'level-ups'))
  stats.addXP('p', 50)
  same([levelUps.length, levelUps[0].playerId, levelUps[0].level, levelUps[0].stats.level, sent.length, sent[1][1].nextLevelXP], [1, 'p', 2, 2, 2, 200], 'level 2')
})

gate('bonuses and equipment add to level-scaled stats and refuse bad input', () => {
  const stats = defineStatsSystem({ equipment: { weapon: [{ id: 'sword', name: 'Iron Sword', bonuses: { damage: 5 } }] } }, null)
  same(stats.equipItemResult('p', 'ghost'), { ok: false, reason: 'equip-item-not-found' }, 'unknown item')
  same(stats.equipItem('p', 'sword'), true, 'equip')
  same(stats.getStats('p').damage, 15, 'damage with sword')
  same(stats.applyBonusResult('p', 'damage', 2), { ok: true, reason: null }, 'bonus')
  same(stats.getStats('p').damage, 17, 'damage with bonus')
  same(stats.applyBonusResult('p', 'mana', 0), { ok: false, reason: 'bonus-zero-amount' }, 'zero bonus')
  same(stats.applyBonusResult('p', 'gold', 5), { ok: false, reason: 'bonus-unknown-stat' }, 'unknown stat')
  same(stats.applyBonusResult('p', 'health', NaN), { ok: false, reason: 'bonus-invalid-amount' }, 'invalid bonus')
  same(stats.getEquipment('p'), { weapon: { id: 'sword', name: 'Iron Sword', bonuses: { damage: 5 } } }, 'equipment view')
  same([stats.unequipSlot('p', 'weapon'), stats.unequipSlot('p', 'weapon')], [true, false], 'unequip')
  same(stats.getStats('p').damage, 12, 'damage after unequip')
  negative('damage without the sword is not 15', () => same(stats.getStats('p').damage, 15, 'damage'))
})

gate('loadouts save, swap back and refuse unknown or unnamed ones', () => {
  const stats = defineStatsSystem({ equipment: { weapon: [{ id: 'iron', name: 'Iron', bonuses: { damage: 5 } }, { id: 'steel', name: 'Steel', bonuses: { damage: 9 } }] } }, null)
  stats.equipItem('p', 'iron')
  same(stats.saveLoadoutResult('p', 'build1'), { ok: true, reason: null }, 'save')
  stats.equipItem('p', 'steel')
  same(stats.getLoadout('p'), { weapon: 'steel' }, 'before swap')
  same(stats.loadLoadoutResult('p', 'build1'), { ok: true, reason: null }, 'swap back')
  same(stats.getLoadout('p'), { weapon: 'iron' }, 'after swap')
  same([stats.loadLoadout('p', 'nope'), stats.loadLoadoutResult('p', 'nope')], [false, { ok: false, reason: 'loadout-not-found' }], 'missing loadout')
  same([stats.saveLoadoutResult('p', '  '), stats.saveLoadoutResult('p', 5)], [{ ok: false, reason: 'loadout-invalid-name' }, { ok: false, reason: 'loadout-invalid-name' }], 'bad names')
  same(stats.getLoadouts('p'), { build1: { weapon: 'iron' } }, 'loadout list')
  negative('the swap leaves steel equipped', () => same(stats.getLoadout('p'), { weapon: 'steel' }, 'loadout'))
})

gate('stats snapshot restores players and drops unknown data with a reason', () => {
  const spec = { equipment: { weapon: [{ id: 'sword', name: 'Sword', bonuses: { damage: 5 } }] } }
  const source = defineStatsSystem(spec, null)
  source.addXP('p', 250)
  source.applyBonus('p', 'speed', 0.5)
  source.equipItem('p', 'sword')
  source.saveLoadout('p', 'b')
  const target = defineStatsSystem(spec, null)
  same([target.restore(source.snapshot()).ok, target.restore(source.snapshot()).players], [true, 1], 'clean restore')
  same(target.getStats('p'), source.getStats('p'), 'stats after restore')
  same(target.getLoadouts('p'), { b: { weapon: 'sword' } }, 'loadouts after restore')
  same(target.restore('x'), { ok: false, reason: 'not-an-object', players: 0, dropped: [] }, 'non-object')
  const mixed = target.restore({
    '': { xp: 1 },
    p3: { xp: 100, equipment: { weapon: 'sword', shield: 'x' }, bonuses: { mana: 3, gold: 9 }, loadouts: { ok: { weapon: 'sword', shield: 'x' }, empty: { weapon: 'nope' } } },
    p4: 'bad'
  })
  same([mixed.ok, mixed.players], [true, 1], 'mixed counts')
  same(mixed.dropped, [
    { playerId: '', reason: 'invalid-player-id' },
    { playerId: 'p3', slot: 'shield', reason: 'unknown-slot' },
    { playerId: 'p3', slot: 'shield', reason: 'unknown-slot' },
    { playerId: 'p4', reason: 'not-an-object' }
  ], 'dropped entries')
  same([target.getEquipment('p3').weapon.id, target.getLoadouts('p3'), target.getBonuses('p3')], ['sword', { ok: { weapon: 'sword' } }, { mana: 3 }], 'restored p3')
  same(target.getLevel('p'), 1, 'restore replaces every player')
  negative('the unknown bonus gold is kept', () => same(target.getBonuses('p3'), { mana: 3, gold: 9 }, 'bonuses'))
})

const questSpec = (extra = {}) => ({
  quests: {
    hunt: { title: 'Hunt', description: 'Hunt the rats', objectives: [{ type: 'killN', count: 2 }, { type: 'collectX', count: 1 }], rewards: { xp: 20, items: { gold: 3 }, statBonuses: { damage: 2 } } },
    daily: { title: 'Daily', repeatable: true, objectives: [{ type: 'talk', count: 1 }], rewards: {} }
  },
  now: () => 1000,
  ...extra
})

gate('a quest definition needs an object, a title, an objectives array and rewards', () => {
  const incomplete = [
    { quests: { a: null } },
    { quests: { a: { objectives: [], rewards: {} } } },
    { quests: { a: { title: 'A', rewards: {} } } },
    { quests: { a: { title: 'A', objectives: [] } } }
  ]
  for (const spec of incomplete) assert(throwsAny(() => defineQuestSystem(spec, null)), 'accepted ' + JSON.stringify(spec))
  const complete = { quests: { a: { title: 'A', objectives: [], rewards: {} } } }
  assert(!throwsAny(() => defineQuestSystem(complete, null)), 'refused a complete definition')
  negative('a complete definition is refused', () => assert(throwsAny(() => defineQuestSystem(complete, null)), 'refused'))
})

gate('startQuest refuses unknown and already started quests', () => {
  const quests = defineQuestSystem(questSpec(), null)
  same(quests.startQuest('p', 'nope'), { ok: false, reason: 'unknown-quest' }, 'unknown quest')
  same(quests.startQuest('p', 'hunt'), { ok: true }, 'start')
  same(quests.startQuest('p', 'hunt'), { ok: false, reason: 'already-started' }, 'second start')
  same(quests.getQuestState('p', 'hunt'), { questId: 'hunt', state: 'active', progress: [0, 0], startedAt: 1000, completedAt: null, claimedAt: null }, 'state')
  same(quests.getQuestState('p', 'daily'), null, 'unstarted quest has no state')
  negative('a started quest is not complete', () => same(quests.getQuestState('p', 'hunt').state, 'complete', 'state'))
})

gate('completeObjective walks a quest to complete and refuses bad steps', () => {
  const progressEvents = []
  const completions = []
  const quests = defineQuestSystem(questSpec({
    onObjectiveProgress: (ctx, data) => progressEvents.push([data.objectiveIndex, data.progress, data.target]),
    onQuestComplete: (ctx, data) => completions.push(data)
  }), null)
  quests.startQuest('p', 'hunt')
  same(quests.completeObjective('p', 'nope', 0), { ok: false, reason: 'unknown-quest' }, 'unknown quest')
  same(quests.completeObjective('p', 'hunt', 5), { ok: false, reason: 'bad-objective' }, 'bad objective')
  for (const amount of [0, -1, '1', NaN]) {
    same(quests.completeObjective('p', 'hunt', 0, amount), { ok: false, reason: 'bad-amount' }, 'amount ' + amount)
  }
  same(quests.completeObjective('p', 'hunt', 0, 1), { ok: true }, 'first step')
  same(quests.completeObjective('p', 'hunt', 0, 5), { ok: true }, 'overshoot clamps')
  same(quests.getQuestState('p', 'hunt').progress, [2, 0], 'clamped progress')
  same(quests.completeObjective('p', 'hunt', 0, 1), { ok: false, reason: 'already-at-target' }, 'objective full')
  same(quests.completeObjective('p', 'hunt', 1, 1), { ok: true }, 'last objective')
  same(completions, [{ playerId: 'p', questId: 'hunt', rewards: { xp: 20, items: { gold: 3 }, statBonuses: { damage: 2 } } }], 'completion callback')
  same(quests.completeObjective('p', 'hunt', 0, 1), { ok: false, reason: 'not-active' }, 'after complete')
  same(quests.getQuestState('p', 'hunt'), { questId: 'hunt', state: 'complete', progress: [2, 1], startedAt: 1000, completedAt: 1000, claimedAt: null }, 'complete state')
  same(progressEvents, [[0, 1, 2], [0, 2, 2], [1, 1, 1]], 'progress callbacks')
  negative('a repeated progress callback is not counted', () => same(progressEvents.length, 2, 'events'))
})

gate('claimReward grants xp, items and stat bonuses through the injected systems', () => {
  const xpLog = []
  const bonusLog = []
  const itemLog = []
  const stats = { addXP: (pid, xp) => xpLog.push([pid, xp]), applyBonus: (pid, stat, bonus) => bonusLog.push([pid, stat, bonus]) }
  const inventory = { add: (pid, item, count) => itemLog.push([pid, item, count]) }
  const quests = defineQuestSystem(questSpec({ stats, inventory }), null)
  quests.startQuest('r', 'hunt')
  same(quests.claimReward('r', 'nope'), { ok: false, reason: 'unknown-quest' }, 'unknown quest')
  same(quests.claimReward('r', 'hunt'), { ok: false, reason: 'not-complete' }, 'not complete')
  quests.completeObjective('r', 'hunt', 0, 2)
  quests.completeObjective('r', 'hunt', 1, 1)
  same(quests.claimReward('r', 'hunt'), { ok: true, xp: 20, items: { gold: 3 }, statBonuses: { damage: 2 } }, 'claim')
  same([xpLog, itemLog, bonusLog], [[['r', 20]], [['r', 'gold', 3]], [['r', 'damage', 2]]], 'grants')
  same([quests.getQuestState('r', 'hunt').state, quests.getQuestState('r', 'hunt').claimedAt], ['claimed', 1000], 'claimed state')
  same(quests.claimReward('r', 'hunt'), { ok: false, reason: 'not-complete' }, 'second claim')
  negative('the xp grant is not 99', () => same(xpLog, [['r', 99]], 'xp'))
})

gate('claimed quests restart only when repeatable, and a claim with no stats grants nothing', () => {
  const quests = defineQuestSystem(questSpec(), null)
  quests.startQuest('d', 'daily')
  quests.completeObjective('d', 'daily', 0, 1)
  same(quests.claimReward('d', 'daily'), { ok: true, xp: 0, items: {}, statBonuses: {} }, 'daily claim without stats')
  same(quests.startQuest('d', 'daily'), { ok: true }, 'repeatable restart')
  same(quests.getQuestState('d', 'daily'), { questId: 'daily', state: 'active', progress: [0], startedAt: 1000, completedAt: null, claimedAt: null }, 'restarted state')
  quests.startQuest('d', 'hunt')
  quests.completeObjective('d', 'hunt', 0, 2)
  quests.completeObjective('d', 'hunt', 1, 1)
  quests.claimReward('d', 'hunt')
  same(quests.startQuest('d', 'hunt'), { ok: false, reason: 'already-started' }, 'non-repeatable restart')
  negative('the repeatable quest is not left claimed', () => same(quests.getQuestState('d', 'daily').state, 'claimed', 'state'))
})

gate('the channel receives a push on every state change and push resends every quest', () => {
  const sent = []
  const quests = defineQuestSystem(questSpec({ channel: 'quest-feed' }), { players: { send: (pid, message) => sent.push([pid, message]) } })
  quests.startQuest('s', 'hunt')
  same(sent, [['s', { type: 'quest-feed', questId: 'hunt', state: 'active', progress: [0, 0], completedAt: null }]], 'start push')
  quests.completeObjective('s', 'hunt', 0, 1)
  same(sent[1][1].progress, [1, 0], 'progress push')
  quests.push('s')
  same(sent.length, 3, 'push resend')
  negative('a start sends no message', () => same(sent.length, 2, 'messages'))
})

gate('a throwing callback is caught and reported through appCtx.debug', () => {
  const warnings = []
  const quests = defineQuestSystem(questSpec({ onQuestStart: () => { throw new Error('boom') } }), { debug: { warn: (message) => warnings.push(message) } })
  same(quests.startQuest('t', 'hunt'), { ok: true }, 'start still succeeds')
  same(warnings, ['[quest] onQuestStart threw: boom'], 'warning')
  negative('no warning is reported', () => same(warnings, [], 'warnings'))
})

gate('getAllQuestProgress lists every quest with default objective text and state', () => {
  const quests = defineQuestSystem(questSpec(), null)
  quests.startQuest('u', 'hunt')
  quests.completeObjective('u', 'hunt', 0, 1)
  same(quests.getAllQuestProgress('u'), {
    hunt: {
      title: 'Hunt',
      description: 'Hunt the rats',
      objectives: [
        { type: 'killN', description: 'killN objective', progress: 1, target: 2 },
        { type: 'collectX', description: 'collectX objective', progress: 0, target: 1 }
      ],
      state: 'active',
      rewards: { xp: 20, items: { gold: 3 }, statBonuses: { damage: 2 } }
    },
    daily: {
      title: 'Daily',
      objectives: [{ type: 'talk', description: 'talk objective', progress: 0, target: 1 }],
      state: 'available',
      rewards: {}
    }
  }, 'progress view')
  negative('an active quest is not shown as available', () => same(quests.getAllQuestProgress('u').hunt.state, 'available', 'state'))
})

gate('quest snapshot round-trips and restore clears the old players', () => {
  const source = defineQuestSystem(questSpec(), null)
  source.startQuest('p', 'hunt')
  source.completeObjective('p', 'hunt', 0, 2)
  const snapshot = source.snapshot()
  const target = defineQuestSystem(questSpec(), null)
  target.restore(snapshot)
  same(target.getPlayerQuests('p'), source.getPlayerQuests('p'), 'round trip')
  target.restore(null)
  same(target.getQuestState('p', 'hunt').progress, [2, 0], 'null restore keeps state')
  target.restore({ v: { hunt: { state: 'active', progress: 'bad', startedAt: 5 } } })
  same(target.getQuestState('p', 'hunt'), null, 'restore clears the old player')
  same(target.getQuestState('v', 'hunt'), { questId: 'hunt', state: 'active', progress: [], startedAt: 5, completedAt: null, claimedAt: null }, 'non-array progress')
  negative('a non-array progress is not kept', () => same(target.getQuestState('v', 'hunt').progress, [0, 0], 'progress'))
})

gate('a chain runs only on a matching, enabled trigger', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'hit', trigger: { type: 'onInteract', entityId: 'rat' }, actions: [{ type: 'setVariable', variableName: 'hits', operator: '+=', value: 1 }] })
  manager.addChain({ id: 'any', actions: [{ type: 'setVariable', variableName: 'any', value: true }] })
  manager.addChain({ id: 'off', enabled: false, actions: [{ type: 'setVariable', variableName: 'off', value: 1 }] })
  same(manager.triggerEvent('onInteract', { entityId: 'rat' }).map((r) => r.chainId), ['hit', 'any'], 'rat')
  same([manager.getVariable('hits'), manager.getVariable('any'), manager.getVariable('off')], [1, true, undefined], 'effects')
  same(manager.triggerEvent('onInteract', { entityId: 'bat' }).map((r) => r.chainId), ['any'], 'bat')
  same(manager.triggerEvent('onCollision', {}), [], 'wrong event type')
  negative('a second rat hit is not counted', () => same(manager.getVariable('hits'), 2, 'hits'))
})

gate('zone, collision and timer triggers match only their own field', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'zone', trigger: { type: 'onEnterZone', zoneId: 'ruins' } })
  manager.addChain({ id: 'coll', trigger: { type: 'onCollision', targetEntityId: 'orc' } })
  manager.addChain({ id: 'tmr', trigger: { type: 'onTimer', timerId: 't1' } })
  const matched = (eventType, context) => manager.triggerEvent(eventType, context).map((r) => r.chainId)
  same([
    matched('onEnterZone', { zoneId: 'ruins' }),
    matched('onEnterZone', { zoneId: 'docks' }),
    matched('onCollision', { targetEntityId: 'orc' }),
    matched('onCollision', { targetEntityId: 'elf' }),
    matched('onTimer', { timerId: 't1' }),
    matched('onTimer', { timerId: 't2' })
  ], [['zone'], [], ['coll'], [], ['tmr'], []], 'matches')
  negative('an orc collision does not match the zone chain', () => same(matched('onCollision', { targetEntityId: 'orc' }), ['zone'], 'zone'))
})

gate('a failing condition stops the chain and reports the condition', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'gate', conditions: [{ type: 'ifVariable', variableName: 'keys', operator: '>=', value: 1 }], actions: [{ type: 'setVariable', variableName: 'opened', value: true }] })
  const refused = manager.runChain('gate')
  same([refused.success, refused.reason, refused.conditionResults.map((r) => r.passed)], [false, 'Condition failed', [false]], 'refused run')
  negative('the refused run did not open the gate', () => same(manager.getVariable('opened'), true, 'opened'))
  manager.setVariable('keys', 2)
  same(manager.runChain('gate').success, true, 'passing run')
  same(manager.getVariable('opened'), true, 'opened after keys')
})

gate('ifVariable reads the chain context, then ctx.state, then nothing', () => {
  const condition = { type: 'ifVariable', variableName: 'door', operator: '==', value: 'open' }
  same(new EventChainManager().evaluateCondition(condition, { variables: { door: 'open' } }), true, 'from context')
  same(new EventChainManager({ ctx: { state: { door: 'open' } } }).evaluateCondition(condition, {}), true, 'from ctx.state')
  same(new EventChainManager().evaluateCondition(condition, {}), false, 'unset')
  negative('an unset variable is not open', () => same(new EventChainManager().evaluateCondition(condition, {}), true, 'unset'))
})

gate('comparisons are numeric when both sides parse, otherwise by string or operator', () => {
  const manager = new EventChainManager()
  manager.setVariable('n', '10')
  manager.setVariable('s', 'abcdef')
  manager.setVariable('flag', 0)
  const check = (variableName, operator, value) => manager.evaluateCondition({ type: 'ifVariable', variableName, operator, value })
  same([check('n', '>', '9'), check('s', 'contains', 'cd'), check('flag', 'boolean', false), check('n', '!=', '10.0')], [true, true, true, false], 'comparisons')
  negative('10 is not below 9', () => same(check('n', '<', '9'), true, 'less than'))
})

gate('ifItemInInventory counts per owner, takes ownerId first and defaults to global', () => {
  const manager = new EventChainManager()
  manager.setInventoryItem('p1', 'herb', 3)
  manager.setInventoryItem('p1', 'bad', -4)
  manager.setInventoryItem('global', 'herb', 5)
  const holds = (count, context, extra = {}) => manager.evaluateCondition({ type: 'ifItemInInventory', itemId: 'herb', count, ...extra }, context)
  same([
    holds(2, { playerId: 'p1' }),
    holds(4, { playerId: 'p1' }),
    holds(2, { playerId: 'p2' }),
    holds(2, { playerId: 'p2' }, { ownerId: 'p1' }),
    holds(2, {})
  ], [true, false, false, true, true], 'owners')
  same([manager.getInventoryItem('p1', 'bad'), manager.getInventoryItem('nobody', 'herb')], [0, 0], 'clamped and absent')
  negative('a negative count is kept', () => same(manager.getInventoryItem('p1', 'bad'), -4, 'bad'))
})

gate('a delay pauses a sequence and the rest runs once the delay has elapsed', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'seq', actions: [
    { type: 'setVariable', variableName: 'a', value: 1 },
    { type: 'setVariable', variableName: 'b', value: 2, delay: 1 },
    { type: 'setVariable', variableName: 'c', value: 3 }
  ] })
  manager.triggerEvent('onInteract', {})
  same([manager.getVariable('a'), manager.getVariable('b'), manager.getVariable('c')], [1, undefined, undefined], 'before the delay')
  manager.tick(0.5)
  same(manager.getVariable('b'), undefined, 'half way')
  negative('the tail ran before the delay ended', () => same(manager.getVariable('c'), 3, 'c'))
  manager.tick(0.5)
  same([manager.getVariable('b'), manager.getVariable('c')], [2, 3], 'after the delay')
})

gate('a delay action waits for its duration and runs nothing itself', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'pause', actions: [
    { type: 'setVariable', variableName: 'x', value: 1 },
    { type: 'delay', duration: 0.5 },
    { type: 'setVariable', variableName: 'y', value: 1 }
  ] })
  manager.triggerEvent('onInteract', {})
  same([manager.getVariable('x'), manager.getVariable('y')], [1, undefined], 'before the pause ends')
  manager.tick(0.25)
  same(manager.getVariable('y'), undefined, 'a quarter second in')
  negative('y is not set early', () => same(manager.getVariable('y'), 1, 'y'))
  manager.tick(0.25)
  same(manager.getVariable('y'), 1, 'after the pause')
})

gate('actions reach the injected context and report without one', () => {
  const plays = []
  const spawns = []
  const broadcasts = []
  const animations = []
  const levels = []
  const state = {}
  const context = {
    audio: { play: (name, options) => plays.push([name, options]) },
    world: { spawn: (id, spec) => { spawns.push([id, spec]); return { id } } },
    players: {
      broadcast: (message) => broadcasts.push(message),
      playAnimation: (target, clip, options) => animations.push([target, clip, options])
    },
    loadLevel: (levelId) => levels.push(levelId),
    state
  }
  const manager = new EventChainManager({ ctx: context })
  const sound = manager.executeAction({ type: 'playSound', sound: 'boom', volume: 0.5, loop: true, targetEntityId: 'door' }, {}, 'c')
  const spawn = manager.executeAction({ type: 'spawnPrefab', prefabId: 'box', position: [1, 2, 3], spawnEntityId: 's1' })
  manager.executeAction({ type: 'loadLevel', levelId: 'cave' })
  manager.executeAction({ type: 'emitParticle', particleType: 'smoke', count: 3 })
  manager.executeAction({ type: 'triggerAnimation', targetEntityId: 'npc', clip: 'wave' })
  const variable = manager.executeAction({ type: 'setVariable', variableName: 'hp', operator: '+=', value: 5 })
  same(plays, [['boom', { volume: 0.5, loop: true, targetEntity: 'door' }]], 'sound')
  same(spawns, [['s1', { app: 'box', position: [1, 2, 3], config: {} }]], 'spawn request')
  same(spawn.spawnedEntity, { id: 's1' }, 'spawned entity')
  same(levels, ['cave'], 'level load')
  same(broadcasts, [{ type: 'emit_particle', particleType: 'smoke', count: 3, position: [0, 0, 0], color: 16776960, scale: 1 }], 'particle')
  same(animations, [['npc', 'wave', { loop: true, fade: 0.15 }]], 'animation')
  same([variable.details, state.hp], [{ name: 'hp', op: '+=', previous: 0, newValue: 5 }, 5], 'variable and ctx.state')
  same(sound.details, { soundName: 'boom', volume: 0.5, targetEntity: 'door' }, 'sound details')
  const bare = new EventChainManager().executeAction({ type: 'playSound', sound: 'boom' })
  same([bare.success, bare.details.soundName], [true, 'boom'], 'no context still reports')
  negative('a context-less call is not recorded as a play', () => same(plays.length, 0, 'plays'))
})

gate('chain ids run in sequence and a stamped explicit id moves the sequence on', () => {
  const manager = new EventChainManager()
  const first = manager.addChain({})
  same([first.id, first.name, first.enabled, first.trigger], ['chain_1', 'Event Chain chain_1', true, { type: 'onInteract', entityId: '*' }], 'first chain defaults')
  same(manager.addChain({ id: 'chain_7' }).id, 'chain_7', 'explicit stamped id')
  same(manager.addChain({}).id, 'chain_8', 'sequence follows the stamped id')
  same(manager.addChain({ id: 'boss' }).id, 'boss', 'unstamped explicit id')
  same(manager.addChain({}).id, 'chain_9', 'unstamped id leaves the sequence alone')
  assert(throwsKind(TypeError, () => manager.addChain(null)), 'null spec accepted')
  assert(throwsKind(TypeError, () => manager.addChain('x')), 'string spec accepted')
  negative('an unstamped id does not reset the sequence', () => same(manager.addChain({ id: 'boss' }).id, 'chain_10', 'id'))
})

gate('the log keeps the newest maxLogs entries, stamps them with the clock, and onLog can unsubscribe', () => {
  const capped = new EventChainManager({ maxLogs: 3, clock: () => 42 })
  for (let index = 1; index <= 5; index++) capped.addChain({ id: 'c' + index })
  const logs = capped.getLogs()
  same([logs.length, logs.map((l) => l.details.chainId), logs.map((l) => l.timestamp), logs.map((l) => l.type)], [3, ['c3', 'c4', 'c5'], [42, 42, 42], ['chain_added', 'chain_added', 'chain_added']], 'capped log')
  const seen = []
  const quiet = new EventChainManager({ clock: () => 7 })
  const unsubscribe = quiet.onLog((entry) => seen.push([entry.type, entry.timestamp]))
  quiet.setVariable('v', 1)
  unsubscribe()
  quiet.setVariable('v', 2)
  same(seen, [['variable_set', 7]], 'listener after unsubscribe')
  quiet.clearLogs()
  same(quiet.getLogs(), [], 'cleared')
  negative('the log is not capped at three', () => same(logs.length, 5, 'length'))
})

gate('toJSON and fromJSON carry chains and variables, and fromJSON reseeds the id sequence', () => {
  const source = new EventChainManager()
  source.addChain({})
  source.addChain({ id: 'chain_4', actions: [{ type: 'setVariable', variableName: 'z', value: 1 }] })
  source.setVariable('k', 'v')
  const data = JSON.parse(JSON.stringify(source))
  const copy = new EventChainManager()
  copy.fromJSON(data)
  same([copy.getChains().map((c) => c.id), copy.getVariable('k')], [['chain_1', 'chain_4'], 'v'], 'restored')
  same(copy.addChain({}).id, 'chain_5', 'next id after restore')
  negative('the restored variable is not the source value', () => same(copy.getVariable('k'), 'x', 'variable'))
})

gate('reset clears variables, inventory, delayed actions and logs but keeps chains', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'keep', actions: [{ type: 'setVariable', variableName: 'late', value: 1, delay: 1 }] })
  manager.setVariable('k', 1)
  manager.setInventoryItem('p', 'herb', 2)
  manager.triggerEvent('onInteract', {})
  manager.reset()
  same([manager.getVariable('k'), manager.getInventoryItem('p', 'herb'), manager.getLogs(), manager.getChains().length], [undefined, 0, [], 1], 'after reset')
  manager.tick(1)
  same(manager.getVariable('late'), undefined, 'delayed action dropped')
  negative('the chain survives reset', () => same(manager.getChains().length, 0, 'chains'))
})

gate('removeChain reports whether a chain existed and runChain names a missing one', () => {
  const manager = new EventChainManager()
  manager.addChain({ id: 'x1' })
  same([manager.removeChain('x1'), manager.removeChain('x1'), manager.getChain('x1')], [true, false, undefined], 'remove')
  same(manager.runChain('nope'), { success: false, reason: 'Chain not found' }, 'missing chain')
  negative('a removed chain is still found', () => same(manager.getChain('x1') ? true : false, true, 'found'))
})

gate('the game barrel re-exports every public name by name', () => {
  const names = [
    'DEFAULT_ABILITIES', 'HOTKEY_MAP', 'DEFINITION_REFUSAL', 'definitionRefusal', 'createAbilityTree',
    'EventChainManager',
    'CURVE_LINEAR', 'CURVE_EXPONENTIAL', 'CURVE_QUADRATIC', 'DEFAULT_CONFIG', 'createProgressionSystem', 'getStatScaling',
    'defineQuestSystem', 'defineStatsSystem', 'parsePlayerId', 'tryParsePlayerId'
  ]
  same(names.filter((name) => game[name] === undefined), [], 'barrel exports')
  same(game.createAbilityTree === createAbilityTree && game.defineStatsSystem === defineStatsSystem, true, 'barrel identity')
})

finish()
