## Identity

Use player.userId for saved player records. The player entity id changes on each join. getObject returns null when the object does not exist. player.arrival.request is what the link the player opened asked for: { room, query }. query holds the game's own words, which the link carries in its one linkQuery word: https://spawn.co/@you/game?linkQuery=tab%3Dshop reads { tab: "shop" }. No other word of the link's query string reaches the game. Read it in onArrive(ctx, player).

```ts
ctx.self.id
<player>.userId
<entity>.objectId
<entity>.arrival: { kind: "join" | "rejoin" | "link" | "respawn", link?, from?, through?, request? }
<entity>.pocket
<player>.isLocal
```
