export const DEFAULT_LAYER = 'Default'

export function createLayerRegistry({ setLocked, setHidden, isLocked, isHidden, sendLayerUpdate } = {}) {
  const layers = new Map([[DEFAULT_LAYER, { visible: true, locked: false }]])
  const memberLayer = new Map()

  function ensureLayer(name) {
    if (!name || typeof name !== 'string') throw new Error('createLayer: name required')
    if (!layers.has(name)) layers.set(name, { visible: true, locked: false })
    return layers.get(name)
  }

  function membersOf(layerName) {
    const out = []
    for (const [id, layer] of memberLayer) if (layer === layerName) out.push(id)
    return out
  }

  function deleteLayer(name) {
    if (name === DEFAULT_LAYER) return false
    if (!layers.has(name)) return false
    const moved = membersOf(name)
    for (const id of moved) memberLayer.set(id, DEFAULT_LAYER)
    layers.delete(name)
    const fallback = layers.get(DEFAULT_LAYER)
    for (const id of moved) {
      sendLayerUpdate?.(id, DEFAULT_LAYER)
      setHidden?.(id, !fallback.visible)
      setLocked?.(id, fallback.locked)
    }
    return true
  }

  function renameLayer(oldName, newName) {
    if (oldName === DEFAULT_LAYER || !layers.has(oldName) || !newName || typeof newName !== 'string' || layers.has(newName)) return false
    const state = layers.get(oldName)
    layers.delete(oldName)
    layers.set(newName, state)
    for (const [id, layer] of memberLayer) if (layer === oldName) memberLayer.set(id, newName)
    return true
  }

  function assign(entityId, layerName) {
    ensureLayer(layerName)
    memberLayer.set(entityId, layerName)
    sendLayerUpdate?.(entityId, layerName)
    const state = layers.get(layerName)
    setHidden?.(entityId, !state.visible)
    setLocked?.(entityId, state.locked)
  }

  function layerOf(entityId) {
    return memberLayer.get(entityId) || DEFAULT_LAYER
  }

  function setLayerVisible(layerName, visible) {
    const state = ensureLayer(layerName)
    state.visible = !!visible
    for (const id of membersOf(layerName)) setHidden?.(id, !state.visible)
  }

  function setLayerLocked(layerName, locked) {
    const state = ensureLayer(layerName)
    state.locked = !!locked
    for (const id of membersOf(layerName)) setLocked?.(id, state.locked)
  }

  function hydrateFromEntities(entities) {
    for (const e of entities || []) {
      const layer = e?.custom?._layer
      if (layer && typeof layer === 'string') {
        ensureLayer(layer)
        memberLayer.set(e.id, layer)
      }
    }
  }

  return {
    DEFAULT_LAYER,
    ensureLayer,
    deleteLayer,
    renameLayer,
    assign,
    layerOf,
    membersOf,
    setLayerVisible,
    setLayerLocked,
    selectByLayer: membersOf,
    hydrateFromEntities,
    get layerNames() { return [...layers.keys()] },
    getLayerState(name) {
      const state = layers.get(name)
      return state ? { ...state } : null
    },
  }
}
