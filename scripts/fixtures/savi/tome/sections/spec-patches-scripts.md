## Spec Patches & Scripts

```ts
ctx.place.atmosphere.*
ctx.world.player.*
ctx.world.camera.* = …
ctx.world.inputs.* = …
ctx.resolveControls(surface?: string): { surface: TouchSurfaceDef; diagnostics: Array<{ code: string; message: string }> }
ctx.world.godMode.* = … (enabled · scope · behavior · brushes.<id> · movement.flySpeed · movement.sprintMultiplier · movement.verticalSpeed · camera.fov · visuals.disableFog: root = replaces, .leaf = merges, a brush is validated as the brush that will stand)
ctx.world.ui.render = 'scripts/hud.js'
ctx.world.creatorTabs
ctx.world.engine.* = …
ctx.world.routing = { script, maxPlayers } | null (.maxPlayers = 8 writes one key; = null turns routing off)
ctx.world.buyables.<id> = { name, priceSpoins, minSpoins?, imageUrl?, description?, onPurchase? }
ctx.world.buyables.<id>.<field> = v
delete ctx.world.buyables.<id> (= null removes too)
ctx.world.buyables.<id>
ctx.world.godMode.brushes.<id> = { paintScript, label, icon, color?, defaultRadius, defaultStrength, feather?, field? }
ctx.world.godMode.brushes.<id>
Object.keys(ctx.world.buyables) / 'x' in ctx.world.buyables
ctx.world.places.<p> = { mode, terrain, atmosphere, objects, … }
ctx.place.<dial> = … / ctx.world.places.<p>.<dial>.<leaf> = …
delete ctx.world.places.<p>
ctx.world.defaultPlace = 'lobby' | ctx.world.places.lobby
```
