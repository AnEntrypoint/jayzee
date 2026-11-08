export const runComponentPoolTrace = (createComponentPool) => {
  const lifecycle = []
  const pool = createComponentPool({ fields: { x: 'f32', y: 'f64', z: null } })
  lifecycle.push(['fieldNames', pool.fieldNames], ['capacity', pool.capacity], ['epoch', pool.epoch])
  const a = pool.alloc()
  const b = pool.alloc()
  lifecycle.push(['alloc', a, b])
  pool.set('x', a, 1.5)
  pool.set('y', a, 2.25)
  pool.set('z', b, -3)
  lifecycle.push(['get', pool.get('x', a), pool.get('y', a), pool.get('z', b), pool.get('x', b)])
  pool.free(a)
  const c = pool.alloc()
  lifecycle.push(['reuse', c, 'zeroed', pool.get('x', c), pool.get('y', c)])
  lifecycle.push(['liveCount', pool.liveCount])
  pool.set('x', c, 7)
  const growth = []
  for (let i = 0; i < 40; i++) growth.push(pool.alloc())
  growth.push(['capacity', pool.capacity], ['epoch', pool.epoch], ['liveCount', pool.liveCount])
  growth.push(['kept', pool.get('x', c), pool.get('z', b), pool.get('y', a)])
  growth.push(['columns', pool.column('x').constructor.name, pool.column('x').length, pool.column('y').constructor.name, pool.column('y').length, pool.column('z').constructor.name])
  growth.push(['slots', growth.slice(0, 40).join(',')])
  for (const slot of growth.slice(0, 40)) pool.free(slot)
  growth.push(['liveCount after frees', pool.liveCount], ['epoch final', pool.epoch])
  const errors = []
  for (const spec of [{ fields: { w: 'i32' } }, { fields: { w: 'bogus' } }, {}]) {
    try {
      createComponentPool(spec)
      errors.push(['no error'])
    } catch (error) {
      errors.push([error.constructor.name, error.message])
    }
  }
  return { lifecycle, growth, errors }
}
