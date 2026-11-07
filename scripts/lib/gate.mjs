let failures = []

export const gate = (label, fn) => {
  try {
    fn()
    console.log('PASS ' + label)
  } catch (error) {
    failures.push(label)
    console.log('FAIL ' + label + ' ' + (error && error.message ? error.message : String(error)))
  }
}

export const finish = () => {
  console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL ' + failures.join('; '))
  process.exitCode = failures.length === 0 ? 0 : 1
}
