let failures = []
const pending = []

const fail = (label, error) => {
  failures.push(label)
  console.log('FAIL ' + label + ' ' + (error && error.message ? error.message : String(error)))
}

export const gate = (label, fn) => {
  let outcome
  try {
    outcome = fn()
  } catch (error) {
    fail(label, error)
    return
  }
  if (outcome && typeof outcome.then === 'function') {
    pending.push(outcome.then(() => { console.log('PASS ' + label) }, (error) => fail(label, error)))
    return
  }
  console.log('PASS ' + label)
}

export const finish = () => {
  Promise.allSettled(pending).then(() => {
    console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL ' + failures.join('; '))
    process.exitCode = failures.length === 0 ? 0 : 1
  })
}
