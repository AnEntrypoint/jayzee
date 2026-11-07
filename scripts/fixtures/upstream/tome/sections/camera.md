## Camera

```ts
ctx.world.camera (+ derived forward/fov/aspect/insetRight live reads; aspect = this screen's width ÷ height, insetRight = the share of that width Spawn's rail covers at the right edge, 0..1; in skill:cameras)
ctx.worldToScreen(position: Vec3): { x: number; y: number; depth: number; onScreen: boolean } | null
<player>.camera = {…}
<player>.camera = null
<player>.isGodMode
<player>.isEditor
```
