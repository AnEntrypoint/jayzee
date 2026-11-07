const ID = /^[a-z0-9-]+$/

function refuse(message) {
  throw new Error('skill registry: ' + message)
}

function validate(skill) {
  if (skill === null || typeof skill !== 'object') refuse('skill must be an object')
  for (const field of ['id', 'name', 'description', 'body']) {
    if (typeof skill[field] !== 'string') refuse('skill field ' + field + ' must be a string')
  }
  if (!ID.test(skill.id)) refuse('skill id is not a served id: ' + skill.id)
}

export function createSkillRegistry({ verify }) {
  if (typeof verify !== 'function') refuse('verify(skill) is required')
  const installed = new Map()
  return {
    install(skill) {
      validate(skill)
      if (!verify(skill)) refuse('skill ' + skill.id + ' failed verification')
      if (installed.has(skill.id)) refuse('skill ' + skill.id + ' is already installed')
      const record = Object.freeze({ id: skill.id, name: skill.name, description: skill.description, body: skill.body })
      installed.set(skill.id, record)
      return record
    },
    lookup(id) {
      return installed.get(id) ?? null
    },
    uninstall(id) {
      return installed.delete(id)
    },
    ids() {
      return [...installed.keys()]
    },
  }
}
