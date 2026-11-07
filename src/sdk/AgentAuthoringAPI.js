export function encodeAgentEntity(id, entity, toBase = null) {
  const out = { id, app: entity._appName || undefined }
  if (entity.model) out.model = entity.model
  const rebase = toBase && !entity.parent
  out.position = rebase ? toBase.point(entity.position) : [...entity.position]
  const live = Array.isArray(entity.rotation)
    ? [...entity.rotation]
    : [entity.rotation?.x || 0, entity.rotation?.y || 0, entity.rotation?.z || 0, entity.rotation?.w ?? 1]
  const rotation = rebase ? toBase.quat(live) : live
  if (rotation.some((value, index) => (index === 3 ? value !== 1 : value !== 0))) out.rotation = rotation
  if (Array.isArray(entity.scale) && entity.scale.some(value => value !== 1)) out.scale = [...entity.scale]
  if (entity.config && typeof entity.config === 'object' && Object.keys(entity.config).length) out.config = entity.config
  return out
}
