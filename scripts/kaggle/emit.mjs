export const emitResult = (result) => {
  process.stdout.write('RESULT ' + JSON.stringify(result) + '\n', () => process.exit(0))
}
