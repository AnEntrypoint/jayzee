# Platform Systems

Durable things (coins, a bag, XP) are `player.state`: back on every rejoin over the template, a dot write where the player simulates with no round trip and no save call; one tick's writes (no `await` between) save as one piece. Seed ONCE: `player.state.run ??= {…}` at the first arrival, never `= …` on a spawn, which throws the save away. A fresh start ("reset my progress", NEW GAME) is `player.state = {}` on their row (`ctx.self.state = {}` in their own behavior; a `ctx.world.players` row from sim.js or run_script): the save empties at once and the next join stamps the template. The engine keeps where a player stands; save nothing for it. sim.js referees a claim several hands make at once (the win, the last seat). SQL answers what only a table answers (every player ever, every room: the all-time board, a gift between players): every row keyed on `userId`. History grows without end: boards and totals read a running summary.

```js
// the pickup: the chest's hook, where it simulates; the bag is the player's row
export function onTriggerEnter(ctx, player) {
  if (!player.tags.includes("player")) return;
  player.state.bag ??= {};
  player.state.bag[ctx.self.state.item] = (player.state.bag[ctx.self.state.item] ?? 0) + 1;
  ctx.destroy(ctx.self.id);
}
// scripts/db.js
export async function migrate(sql) {
  await sql`CREATE TABLE IF NOT EXISTS best (user_id TEXT PRIMARY KEY, name TEXT, score INTEGER NOT NULL)`;
  await sql`CREATE INDEX IF NOT EXISTS best_score ON best (score)`;
}
// the match's end: their summary row
await ctx.sql`INSERT INTO best VALUES (@caller, ${name}, ${score}) ON CONFLICT (user_id) DO UPDATE SET name = excluded.name, score = MAX(score, excluded.score)`;
// the board; the HUD renders state, never SQL
ctx.world.state.allTime = (await ctx.sql`SELECT name, score FROM best ORDER BY score DESC LIMIT 10`).rows;
```

A board also goes to Spawn's game page: each player's number in `player.state` (their best, their total), named under world.config.yaml `leaderboards` (`spawn api LeaderboardDef`).

- SQL runs at an event, never per tick: `onArrive`/`onLeave` (the player's machine), a player's behavior, a cron, `run_script`, `db.js`. A hook's or behavior's call publishes with the save and runs as its player; one the save lacks answers `statement_not_published`.
- A save in `onLeave` lands however the player left: their machine runs it at the door; when their tab dies, Spawn's machine there runs it from the last state everyone saw, `@caller` bound to them; alone with no Spawn machine there, nobody does: a game that must survive that also writes at its moment. Keep `onLeave` one fast call.
- `platformState: ["gold", "inventory"]` on the player template makes these keys cheat-proof where players meet: no player's machine writes them, sim.js's `onArrive` included; start them in its `state`.
- `simulatedBy: "platform"` on a row (a bank, a bot director; at `spawn` or live) runs on Spawn's machine, never a player's, even with nobody near. `= null` undials; undialed, it stops in an empty place. It can move machines: a finished onSpawn's writes are not repeated, `ctx.self.session` starts with what onSpawn left. Keep no module state.
- A thing one player alone sees: `visibility: "owner"` on a row under them (a hand: `spawn({ parent: player.id, visibility: "owner", … })`) reaches their screen, live, at a join and in the saved world; `visibility: "platform"` (a deck), or `"owner"` with no player above, reaches no player. Both reach the platform, you and the creator; a platform row's `ctx.random()` draws the platform's entropy, never the world's seed. The platform deals: it writes the deck and the hands. Any other row or emit, `audience: { player: id }` included, can reach others: a secret rides a row with the word. The owner's HUD reads it by `ctx.getObject(id)`, `null` elsewhere.
- Crons: `engine.crons: [{ schedule: "*/5 * * * *", script: "crons/respawn.js" }]` in world.config.yaml; the file exports `async function cron(ctx)`; a minute the finest step. A one-shot is `ctx.after`. Crons, timers and sim.js run while someone is in; with nobody in: `routing.alwaysOn` →rooms-and-matchmaking.
- A talking, seeing, hearing character: `ctx.job("llm:chat", { conversationId, system, message, media, maxHistory (20), model: "fast" | "smart" | an OpenRouter id (20 asks a player an hour) }, (r) => …)` → `r.data.text`; a fourth `{ onPart: (p) => … }` streams it: `p.text` the next words, `p.first` a restart; `"llm:generate"` with `schema` → `r.data.object`; `"llm:clear"` forgets. `media: […]`, that turn alone: a `/cdn/…` address, an upload's `url` or a `data:` URL. `conversationId` IS the memory: `"npc:" + npcId + ":" + playerId` per player. `r: { ok, data, error: { message, code, retryAfterMs } }`, never thrown; seconds pass: `state.loading = true` at the submit, cleared in the callback.
- Words a player writes that others read (a pet's name, a board post): `ctx.job("text:check", { text }, (r) => …)` runs them, any length, through chat's filter and posts nothing; `r.data.ok` false: the game shows its own words. `chat:send` posts in Spawn's chat, never a way to check text.
- The outside web (a Discord webhook): `fetch(url, { method: "POST", body })` inside a job's `run` (`jobs/<id>.js`) reaches the public internet (http/https, no private hosts), answering the `ctx.job` callback. A picture POSTed to `"/cdn/"` with its content-type on a builder's or Spawn's machine stores once; clients load its `location` like an upload. A feed holds `new WebSocket(url)` in an `async function* run` yielding each message to the asker's `onPart`; ask it once from `sim.js`, again when its callback fires. A behavior or `sim.js` on Spawn's machine reaches no outside address. To prove the player to the creator's service, `ctx.job("player:token", {}, (r) => …)` from their body answers `r.data.token`, a signed JWT (`sub` = `player.userId`) verified at `https://www.spawn.co/api/.well-known/jwks.json`.
- Names of players who left, by id: `"player:names"` from the owner's body (`spawn api job`).
- `ctx.notifyDm(message, { to: player, link: "+garden" })` rings their Spawn bell and phone, playing or away, not Upstream's chat: `to` a player row or its `userId`, `link` where it opens this world: a place, or a room as `"world:" + ctx.world.id + "/room:" + name + "+garden"`. Only this world's players get it (a waitlist is Spawn's: `spawn publish propose_covers --opensAt`). A line holds 1,000 characters; a world sends a player at most 5 a UTC day, grouped and held through their night; players can mute it; a line not sent says why in getLogs. Send the moments worth coming back for, one each; `notifyDmOnce` takes `{ to }` too.

<api>
ctx.sql`…`: { rows, changes, lastInsertRowid } // ${v} binds string · number · boolean · null (JSON.stringify a structure; json_each reads it), never concatenate; a call from a player's machine is a round trip: a list is one call; semicolons = ordered statements in one transaction; rows [] = none, changes 0 = a guarded write refused; errors throw into getLogs; calls queue one at a time and every call answers, however slow: never time one out, resend it or read it back
budgets: ≤ 100 parameters a statement, ≤ 5 SELECTs joined by UNION / UNION ALL / INTERSECT / EXCEPT (one multi-row VALUES (…), (…) seeds rows, uncapped) // LIMIT big scans
@caller // the player this call acts for: a player's hook or behavior, singleplayer, where a sim.js, cron or place-hook write binds it alone, else `statement_not_player_invocable`; run_script, db.js and a multiplayer cron or place hook have none: bind ${playerId}
scripts/db.js: export async function migrate(sql) // before the first statement: idempotent DDL and set-based backfills; a throw never blocks play: the prior schema serves and it re-runs at the next spec version
dev and live are two databases // the schema carries to live on its first call, rows do not: seed live with INSERT … ON CONFLICT DO NOTHING in migrate()
money says its domain in SQL: WHERE coins >= ${amount} AND ${amount} > 0, the credit gated on the debit's changes // a negative amount pays the sender otherwise
</api>