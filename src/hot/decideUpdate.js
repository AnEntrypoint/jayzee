const ignored = (detail) => ({ route: 'record', result: 'ignored', detail })
const recorded = (result, detail = '') => ({ route: 'record', result, detail })
const reloadWith = (reason) => ({ route: 'reload', reason })

const decideHello = (ev, state) => {
  const restarted = Boolean(state.lastBootId && state.lastBootId !== ev.bootId)
  if (!restarted) return { route: 'none', bootId: ev.bootId }
  if (!state.singleplayer) {
    return { ...reloadWith('multiplayer server restarted; rejoining at the same pose'), bootId: ev.bootId }
  }
  return { route: 'resync', bootId: ev.bootId }
}

const decideServer = (ev) => {
  if (ev.hot) return recorded('server-hot-swapped')
  if (ev.restarting) return recorded('server-restarting')
  return recorded('server-restart-needed')
}

const decideWorld = (ev, state) => {
  if (state.singleplayer || !ev.restarting) return reloadWith(ev.reason)
  return recorded('server-restarting', 'world rebuild; this page rejoins at the same pose when the server is back')
}

const ROUTE_BY_KIND = { css: 'css', module: 'module', app: 'app', asset: 'asset' }

const decideBody = (ev, state) => {
  if (ROUTE_BY_KIND[ev.kind]) return { route: ROUTE_BY_KIND[ev.kind] }
  if (ev.kind === 'server') return decideServer(ev)
  if (ev.kind === 'world') return decideWorld(ev, state)
  if (ev.kind === 'reload') return reloadWith(ev.reason)
  return recorded('noop', ev.reason || '')
}

export const decideUpdate = (ev, state) => {
  if (ev.kind === 'hello') return decideHello(ev, state)
  if (state.filter && !state.filter.test(ev.path)) return ignored('outside __spointHmr.only filter')
  if (state.reloadOrdered && state.coalesced) {
    return ignored('a page reload is already ordered; this update lands with it')
  }
  return decideBody(ev, state)
}
