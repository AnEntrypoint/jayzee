export const updateKey = (ev) => (ev.kind === 'module' ? 'module:' + ev.url : ev.kind + ':' + (ev.url || '') + ':' + (ev.path || ''))
