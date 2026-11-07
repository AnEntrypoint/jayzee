import { PLAYERS_PER_SNAP_GROUP, SNAP_ENTITY_VISITS_PER_TICK } from './constants.js'

export function planSnapshotGroups(playerCount, population, snapshotSeq) {
  const maxRecipients = Math.min(PLAYERS_PER_SNAP_GROUP, Math.max(1, Math.floor(SNAP_ENTITY_VISITS_PER_TICK / Math.max(1, population))))
  const snapGroups = Math.max(1, Math.ceil(playerCount / maxRecipients))
  return {
    maxRecipients,
    snapGroups,
    curGroup: snapshotSeq % snapGroups,
    clientSeq: Math.floor(snapshotSeq / snapGroups),
  }
}

export function selectServedPlayers(players, snapGroups, curGroup, serveAll) {
  const served = []
  for (let i = 0; i < players.length; i++) if (serveAll || i % snapGroups === curGroup) served.push(players[i])
  return served
}

export function restoreTrimmedBaselines(sent, kept, staticCount, entityMap, prevMap) {
  const keptIds = new Set()
  for (let i = staticCount; i < kept.length; i++) keptIds.add(kept[i][0])
  for (let i = staticCount; i < sent.length; i++) {
    const id = sent[i][0]
    if (keptIds.has(id)) continue
    const prev = prevMap.get(id)
    if (prev) entityMap.set(id, prev)
    else entityMap.delete(id)
  }
}
