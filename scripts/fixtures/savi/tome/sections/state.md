## State

Assigning an entire state object replaces it. Assign a field to change only that field; delete a field to clear it. Changes made through game handles are shared. A player's save, `player.state`, has no size cap and nests to any depth, and it loads whole at every join. A list or a string is one value that every change sends and saves whole, so keep a large collection as a record keyed by id.

```ts
ctx.self.state.*
ctx.state = ctx.self.state
ctx.self.session.*
ctx.world
ctx.world.state: Record<string, unknown>
ctx.world.camera: Record<string, unknown>
ctx.world.inputs: Record<string, unknown>
ctx.world.assets: Record<string, AssetMetadata | undefined>
ctx.world.mode: "dev" | "live"
ctx.world.version: number | null
ctx.world.id: string | null
ctx.world.address: string | null
ctx.world.players: PlayerQueryResult[]
ctx.world.playerCount: number
ctx.world.onlineCount: number
ctx.world.date: string
ctx.world.places: PlacesCollection
ctx.world.engine: EngineConfig
ctx.world.passThrough: Record<string, string[]>
ctx.world.routing: RoutingDef
ctx.world.ui: Record<string, unknown>
ctx.world.player: Record<string, unknown>
ctx.world.godMode: Record<string, unknown>
ctx.world.creatorTabs: CreatorTabDef[]
ctx.world.defaultPlace: string
ctx.world.settling: boolean
ctx.world.files: readonly string[]
ctx.session.*
ctx.files.read(path) / .write(path, text) / .delete(path)
ctx.view.camera = { eye, aim, fov } | { parent: id, eye, aim, fov } | null
ctx.quality
ctx.self
ctx.place
```
