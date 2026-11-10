const KIND_OF_CATEGORY = Object.freeze({ trees: 'tree', rocks: 'rock', buildings: 'prop', props: 'prop' })

export const registerPopulation = (set, category, count, prefix = category) => {
  const kind = KIND_OF_CATEGORY[category]
  if (kind === undefined) throw new RangeError('no collider kind for population category: ' + category)
  const ids = new Array(count)
  for (let i = 0; i < count; i++) {
    const id = prefix + '-' + i
    set.add(id, kind)
    ids[i] = id
  }
  return ids
}

export const registerTerrain = (set, id = 'planet') => {
  set.add(id, 'terrain')
  return id
}
