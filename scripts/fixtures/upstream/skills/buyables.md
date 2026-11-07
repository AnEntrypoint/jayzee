# Buyables

A buyable is repeatable unless `once: true`: one per account; the platform refuses a second.

`world.config.yaml` → `buyables.<id>`: `name`, `description`, `priceSpoins` (an integer up to 10000; 1 Spoin = $0.01, creators keep 50%), `imageUrl` (the checkout's picture: a /cdn/ address from `spawn paint` or `spawn upload`; else a Spoin icon), `once`, `onPurchase` (a script). `ctx.proposePurchase(buyer, id)` (the buyer's script or a stall's press listener for the presser) opens the platform's checkout and answers a requestId, never proof of payment; `onPurchase(ctx, buyer)` runs once on verified completion.

Owners and editors buy free, so the creator tests a stall by pressing it: the checkout says free, `onPurchase` runs and `purchases` records it.

What an account bought is the platform's record, on every client as `player.state.purchases[buyableId]` → `{ transactionId, at }`: written by the platform alone (a script's or a client's write never saves), there on every reload and reconnect, gone when the buyer undoes it. Gate an equip, a door or an "owned" badge on it. The hook is for the moment at the buyer's feet and the look; it lands the instant the payment stands. No sql or job inside it: the purchase can still be released. A tip jar is a buyable with `minSpoins` (pay what you want) and no `onPurchase`; a thank-you in the world is an `onPurchase` with the moment alone.

```js
// scripts/stall.js: the stall names its offer where the player reads it
export function onSpawn(ctx) {
  ctx.self.state.buyable = "golden-cape";
} // the offer reads on the stall's own ui plate (→game-ui); the engine draws no prompt
// scripts/buyables/grant-cape.js: once, when the money stands: the moment and the look; the record lands by itself
export function onPurchase(ctx, buyer) {
  ctx.spawn("cape-" + buyer.id, { ...CAPE, parent: buyer.id });
  ctx.emit("fx", { position: buyer.feetPosition, script: "scripts/effects/gold-glint.fx.js" });
  ctx.emit("playSound", { clip: "cdn/sfx-chime-golden.mp3", position: buyer.feetPosition });
}
// scripts/player.js: a rejoin dresses the body from the platform's record
export function onSpawn(ctx) {
  if (ctx.self.state.purchases?.["golden-cape"]) ctx.spawn("cape-" + ctx.self.id, { ...CAPE, parent: ctx.self.id });
}
```

<!-- generated-types -->

### Signatures (generated: do not edit)

```ts
ctx.proposePurchase(buyer: str | { readonly id: str }, itemId: str): str // Propose a purchase for a buyer, subject-first: pass the buyer (an entity handle or id), then the buyable id. Returns requestId
ctx.world.buyables.<id> = { name, priceSpoins, minSpoins?, imageUrl?, description?, onPurchase? } // defines or replaces, validated (the dot throws naming every bad field)
ctx.world.buyables.<id>.<field> = v // one field; the record that will stand is validated whole
delete ctx.world.buyables.<id> (= null removes too)
ctx.world.buyables.<id> // the record (undefined when absent)
Object.keys(ctx.world.buyables) / 'x' in ctx.world.buyables // the census
```

<!-- /generated-types -->

<api>
ctx.purchase: { buyableId, transactionId, priceSpoins, … } // inside onPurchase only
player.state.purchases[buyableId] // read-only; undefined until bought
no failure hook // a cancelled payment never reaches world code; one the platform cannot start toasts the buyer and leaves purchase.refused.<why> in getLogs
</api>