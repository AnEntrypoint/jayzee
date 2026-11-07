# 2D Mode

`spawn starter 2d-top` (or `2d-side`) is the first call on a young world: mode, gravity, a drawn player (`scripts/tex-hero.js`, its `?facing=` set), the rig, a drawn wang ground. 2D places share a world with 3D ones: a hop between them re-dresses from the template: a template `sprite` stays on in 3D; one with no visual wears the avatar there, and the 2D place's `onArrive` adds the `sprite`.

**Tiles.** `tileAt({ x, y, world })` answers a 1-based atlas id per cell (0 or null = empty), x right, row 0 at the TOP: `2d-top` y grows down-screen (+Z), `2d-side` y grows down (−Y). Per-room ground reads `world.state` and redraws when it changes. Solid tiles are real colliders in BOTH modes: `solidTiles: [ids]` merges them from `tileAt`: ground and platforms in `2d-side`, walls that block characters in `2d-top` (rock, water, cliff ids); `tiles[x][y]` gating is for non-physical movement (grid-snap steps). `ctx.place.tiles[x][y] = id` paints a cell for everyone, `= 0` carves it, `delete` returns it to `tileAt`. The wang atlas is 16 corner-mask tiles, id = mask + 1, bits TL=1 TR=2 BL=4 BR=8 marking material-B corners (1 pure A, 16 pure B); the atlas is a texture script (`spawn api TextureScript`): a plain tile grid is `ctx.canvas` cells at `tilesetColumns`. A side-scroller's ground is a surface band over a borderless fill: boxes are platforms and blockers, never the running surface.

**Collision runs opposite per mode.** `2d-top`: world objects are SOLID (`physics: "static"`) and a tall sprite collides at its FEET: `collider2d` is image space, y DOWN, normalized, v = 1 the feet: the foot band `[[0.32, 0.86], [0.68, 0.86], [0.68, 1], [0.32, 1]]` is the trunk a walker bumps; a band higher in the image sits up-screen of the trunk and the walker passes under it; the auto hull wraps the whole canopy. Only ground decals are `physics: "none"`; `2d-top` has NO ground collider, ever. `2d-side`: depth dressing is NON-solid: z is draw order, not collision: plates, canopies, signs take `physics: "none"`; solid is the playable band (`solidTiles`, platforms, blockers).

**Movement.** `2d-top` is X/Z, bodies pinned to the plane, up-input is −z, `ctx.self.velocity = { x, y: 0, z }` held until rewritten. `2d-side`: the controller adds no gravity: every body's script bends `vy` (`ctx.self.velocity = { x: vx, y: v.y + GRAVITY * dt, z: 0 }`; a wander script without it floats); player z 1.5, level geometry −1..0, plates −15..−3, foreground 3+. The rig, orthoSize, `pixelSnap` →cameras. Stairs and cliffs to walk on need a 3D place: the pixel-art 3D camera →cameras, and `engine.graphics.perfectPixelArt`.

**Drawn art.** A 2D world's art is yours, every pixel in code (tiles, sprites, backdrop, HUD icons), each picture a script re-baked on edit. When the creator hands you a picture or asks for finished painted pieces, paint instead of drawing: `spawn paint "<the piece>, <one style sentence for the whole set>" [--ref <their picture>] --transparent --size 1024x1024`, and put the address on `sprite.texture` (with `sprite.size`) or an `<img>`; `spawn cutout <their picture>` frees their picture from its background. Each paint or edit redraws the whole picture, keeping no source pixel; no two calls agree on size or build. A painted cycle is one sheet from one call; a one-frame fix keeps its pixels and pastes only the fixed part, fitted by code. A sprite is a texture script on `sprite.texture`: `export function texture(ctx)` paints `ctx.canvas(w, h)` (the first canvas IS the texture, nearest-sampled). Draw at the scene's one texel density (the starters' ground is 32 texels a metre; the 2d-top hero a 32×40 frame, the 2d-side hero 56×64) and always author `sprite.size` on a scripted ref. Facing is a `?facing=` param on the same script: the closed set up · down · left · right · up-left · up-right · down-left · down-right, the bare ref the down pose (2d-side: right); the script draws each pose (a side profile redrawn for its left twin, the body turned, the light kept in place: the art itself, never `flipX` or a negative scale); `sprite.upright: true` keeps the art axis-aligned however the body turns. Animation is `ctx.atlas({ frameSize, animations: { idle: 2, walk: 4 }, fps, draw(g, f) })`: the engine lays out cells and clips, the mixer plays them by name (`ctx.self.anim.locomotion = { clip: "walk", weight }`); a draw reading its wearer (`ctx.self.state.hp`) re-runs only when that changes. A backdrop is a strip script (starter `scripts/tex-sky.js`) on a camera-attached sprite (`repeatX`, `parallax: [0.25, 1]`; torus-tileable: every period divides the width). HUD icons, signs and words are crisp vectors: an inline `<svg>` in ui.js, an object's `vector:`.

```js
// scripts/tex-slime.js: spawn: { sprite: { texture: "scripts/tex-slime.js", size: [1, 0.5], ySort: true }, physics: "character", behavior: "scripts/slime.js" }
var P = { b: '#3fa34d', d: '#2a7a37', e: '#0f1f12', h: '#9fe08a' };
var ROWS = [ // the body, 16 × 8 cells of 2 px: 'e' the eyes, 'h' the highlight
  '.....bbbbbb.....', '...bbbbbbbbbb...', '..bhbbbbbbbbbb..', '.bbbbbbbbbbbbbb.',
  'bbbbebbbbbbebbbb', 'bbbbbbbbbbbbbbbb', 'dbbbbbbbbbbbbbbd', 'dddddddddddddddd',
];
export function texture(ctx) {
  ctx.atlas({ frameSize: [32, 16], animations: { idle: 2, hop: 4 }, fps: 8, draw: function (g, f) {
    var lift = f.animation === 'hop' ? [0, 4, 6, 2][f.frame] : 0;
    var blink = f.animation === 'idle' && f.frame === 1;
    for (var y = 0; y < 8; y++) for (var x = 0; x < 16; x++) { var c = ROWS[y][x]; if (c === '.' || (blink && c === 'e')) continue; g.fillStyle = P[c]; g.fillRect(x * 2, y * 2 - lift, 2, 2); }
  } });
}
```

**Light.** Lift lights off the play plane (`y` ≈ 1.5–3 in `2d-top`, `z` ≈ 1.5–3 in `2d-side`); `distance` omitted = a finite radius from intensity; `decay` defaults to 2 (inverse-square), `decay: 1` is a soft linear fade; plates are unlit. A point light shines through sprites: bound it with `light.fan`, points in metres from the lamp (`[x, z]` in `2d-top`, `[x, y]` in `2d-side`), each a ray's direction × its `raycast` hit distance.

<api>
mode: "2d-top" | "2d-side" // gravity defaults { x: 0, y: -9.81, z: 0 } in 3d and 2d-side, zero in 2d-top
terrain: { kind: "tilemap", tileSize: 1, tileset: "scripts/<name>.js?a=<A>&b=<B>", tilesetColumns: 4, generator, solidTiles: [ids], width, height } // infinite unless BOTH, then centered on the origin
sprite.texture: "scripts/tex-<subject>.js?<params>"
sprite.sortingLayer, .sortingOrder, .ySort // higher draws in front; ySort sorts a layer by world Z; a mesh's layer is its material.renderOrder; fx sprites (sprite(ember,add,sortingLayer=11)), ribbon sinks and svg roots take layer and order too (none: an fx takes a sprite's →fx, else 0)
sprite.parallax: [fx, fy], .repeatX: true // per viewer, never a pan script; fx < 1 behind the play plane, > 1 in front; a camera-attached strip spans the viewport
collider2d: { outline: [[x, y], …] } // ≥ 3 points = a convex hull
camera.state: { orthoSize, heightOffset, distance } // a side-scroller rig's numbers live on its def: a door paints the place from them, so its glass shows the frame you land in
</api>