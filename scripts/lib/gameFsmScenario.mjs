const roundSpec = (log) => ({
  id: 'round',
  initial: 'lobby',
  context: { players: 0, round: 0, score: 0, warned: 0 },
  states: {
    lobby: {
      enter: (app, fsm) => log.push('enter lobby'),
      exit: (app, fsm) => log.push('exit lobby'),
      on: {
        JOIN: { action: (app, fsm, payload) => { fsm.context.players += payload?.count ?? 1; log.push('join ' + fsm.context.players) } },
        LEAVE: { guard: (app, fsm) => fsm.context.players > 0, action: (app, fsm) => { fsm.context.players -= 1; log.push('leave ' + fsm.context.players) } },
        START: [
          { target: 'countdown', guard: (app, fsm) => fsm.context.players >= 2, action: (app, fsm) => log.push('start accepted') },
          { action: (app, fsm) => { fsm.context.warned += 1; log.push('start refused') } },
        ],
      },
    },
    countdown: {
      enter: (app, fsm) => { fsm.context.round += 1; log.push('enter countdown ' + fsm.context.round) },
      exit: (app, fsm) => log.push('exit countdown'),
      on: { CANCEL: 'lobby', RESTART: 'countdown' },
      after: { 3000: 'playing' },
    },
    playing: {
      enter: (app, fsm) => log.push('enter playing'),
      exit: (app, fsm) => log.push('exit playing'),
      tick: (app, dt, fsm) => { fsm.context.score += 1 },
      on: {
        SCORE: { action: (app, fsm, payload) => { fsm.context.score += payload.points; log.push('score ' + fsm.context.score) } },
        END: [
          { target: 'results', guard: (app, fsm, payload) => payload?.force === true, action: (app, fsm) => log.push('forced end') },
          { target: 'results', guard: (app, fsm) => fsm.context.score >= 100, action: (app, fsm) => log.push('earned end') },
        ],
      },
      after: {
        2000: { guard: (app, fsm) => fsm.context.score < 0, target: 'results' },
        5000: [{ guard: (app, fsm) => fsm.context.players < 2, target: 'lobby' }, { target: 'results', action: (app, fsm) => log.push('time up') }],
      },
    },
    results: {
      enter: (app, fsm) => log.push('enter results'),
      exit: (app, fsm) => log.push('exit results'),
      on: { AGAIN: 'lobby', QUIT: 'closed' },
      after: { 0: { action: (app, fsm) => log.push('results shown') } },
    },
    closed: { type: 'final', enter: (app, fsm) => log.push('enter closed') },
  },
})

const SCENARIOS = [
  {
    name: 'guarded start, cancel and restart',
    steps: [
      ['send', 'START'], ['send', 'JOIN'], ['send', 'START'], ['send', 'JOIN', { count: 2 }], ['send', 'LEAVE'], ['can', 'START'], ['send', 'START'],
      ['send', 'JOIN'], ['advance', 1000], ['send', 'RESTART'], ['advance', 2500], ['send', 'CANCEL'], ['can', 'CANCEL'], ['send', 'LEAVE'], ['send', 'LEAVE'], ['send', 'LEAVE'], ['can', 'LEAVE'],
    ],
  },
  {
    name: 'countdown timer, play, earned end and replay',
    steps: [
      ['send', 'JOIN', { count: 3 }], ['send', 'START'], ['advance', 2999], ['advance', 1], ['send', 'SCORE', { points: 40 }], ['send', 'END'], ['can', 'END'],
      ['send', 'SCORE', { points: 70 }], ['can', 'END'], ['send', 'END'], ['advance', 0], ['advance', 10], ['send', 'AGAIN'], ['send', 'START'], ['advance', 3000],
    ],
  },
  {
    name: 'forced end by payload, then quit into the final state',
    steps: [
      ['send', 'JOIN', { count: 2 }], ['send', 'START'], ['advance', 3000], ['send', 'END', { force: false }], ['send', 'END', { force: true }],
      ['send', 'QUIT'], ['send', 'AGAIN'], ['can', 'AGAIN'], ['advance', 1000], ['send', 'JOIN'],
    ],
  },
  {
    name: 'play times out: a guard that fails once is not retried, the later delay ends the round',
    steps: [
      ['send', 'JOIN', { count: 2 }], ['send', 'START'], ['advance', 3000], ['advance', 2000], ['send', 'SCORE', { points: -50 }], ['advance', 1000], ['advance', 1999], ['advance', 1], ['advance', 500],
    ],
  },
  {
    name: 'one long step past two delays takes one transition per tick',
    steps: [
      ['send', 'JOIN', { count: 2 }], ['send', 'START'], ['advance', 9000], ['advance', 9000], ['advance', 0], ['advance', 0],
    ],
  },
  {
    name: 'stop: events after it report stopped and listeners are dropped',
    steps: [
      ['send', 'JOIN', { count: 2 }], ['send', 'START'], ['stop'], ['send', 'CANCEL'], ['advance', 5000], ['send', 'START'],
    ],
  },
]

export function runGameFsmScenarios(makeMachine) {
  const sections = {}
  for (const scenario of SCENARIOS) {
    const lines = []
    const log = []
    let nowMs = 1000
    const transitions = []
    const fsm = makeMachine(roundSpec(log), { name: 'app' }, () => nowMs)
    fsm.onTransition((state) => transitions.push(state))
    const record = (step, result) => {
      lines.push(JSON.stringify({ step, result: result === undefined ? null : result, state: fsm.state, context: fsm.context, timeInState: fsm.timeInState, log: log.splice(0), transitions: transitions.splice(0) }))
    }
    record(['start'])
    for (const step of scenario.steps) {
      if (step[0] === 'send') record(step, fsm.send(step[1], step[2]))
      else if (step[0] === 'can') record(step, fsm.can(step[1]))
      else if (step[0] === 'advance') { nowMs += step[1]; record(step, fsm.tick(step[1] / 1000)) }
      else if (step[0] === 'stop') record(step, fsm.stop())
    }
    sections[scenario.name] = lines
  }
  return sections
}

export const GAME_FSM_SCENARIO_NAMES = SCENARIOS.map((scenario) => scenario.name)
