# Jev Decides

`jev:decide` is a probability pipe: facts in (small and typed: distances, counts, last moves) plus pictures (`media` as in `llm:chat`, no sound or clip), typed questions in, calibrated probabilities out in about half a second. One ask per decision on the mind's own clock, never per tick, none while `ctx.place.players` is empty.

```js
export function update(ctx) {
  const s = ctx.self.state;
  if (!ctx.place.players.length || ctx.now() < (s.nextAt ?? 0)) return;
  s.nextAt = ctx.now() + 4000 + ctx.random() * 2000;
  ctx.job("jev:decide", {
    state: { gold: s.gold, stall: { item: "pie", queue: ctx.place.players.length }, recent: s.recent ?? [] },
    questions: { act: { type: "choice", instructions: "What does this shopper do next?", criteria: { buy: "pays and takes it", browse: "looks at another item", leave: "walks off" } } },
  }, "decided");
}
export function decided(ctx, r) {
  if (!r.ok) return;
  const s = ctx.self.state, act = r.data.answers.act;
  let roll = ctx.random(), pick = act.choice;
  for (const [option, p] of Object.entries(act.probabilities)) if ((roll -= p) <= 0) { pick = option; break; }
  s.recent = [...(s.recent ?? []).slice(-4), { at: ctx.now(), act: pick }];
  s.plan = pick;
}
```

- DECIDE: `boolean` → `{ type, probability }`; `choice` → `{ type, choice, probabilities: { option: p } }`, its `criteria` keys are the options; `score` → `{ type, score, probabilities }`, its `criteria` the ordered steps (`["sour", "flat", "glad"]`), the score a number over their indices.
- ACT: SAMPLE with `ctx.random()`, never the top answer: forty bodies sampling one set of odds spread like a crowd; argmax makes clones.
- REMEMBER: the mind's memory is your state: its last few `{ at, …what it did }` in `state.recent`, handed back in the next `state`.
- `"decided"` names an export: `decided(ctx, r, payload)` fires where the entity simulates, through a restart; a `(r) => …` callback lives only as long as its hook.
- One shape, every mind. A boss: state = each player's damage, healing, distance, its own last moves; questions = `target`, `move` (choices), `retreat` (boolean). A crowd: one ask per body on its own `nextAt`; question = where it goes. A puzzle that learns: state = the last attempts; question = which door opens now.
- A failed ask is `r.ok: false` with `r.error.code`: keep the last plan, ask next cycle. Metered to the world like `llm:chat`; a 768 px picture as four plain asks, the largest fifteen.