export const SOLVER_ITERATIONS_DEFAULT = 8
export const SOLVER_ITERATIONS_BY_PLAYERS = Object.freeze({ 1024: 4 })

export const solverIterationsFor = (players) => SOLVER_ITERATIONS_BY_PLAYERS[players] ?? SOLVER_ITERATIONS_DEFAULT
