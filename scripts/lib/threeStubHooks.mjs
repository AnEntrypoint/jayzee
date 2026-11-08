const STUB = 'data:text/javascript,export default {};'

export async function resolve(specifier, context, nextResolve) {
  if (/(^|\/)three(\/|\.module\.js$|$)/.test(specifier)) return { url: STUB, shortCircuit: true }
  return nextResolve(specifier, context)
}
