# FX

A program is a string in the emit: `ctx.emit("fx", { position: hit.position, script: "fx\npop …", params: { normal: hit.normal } })`. A file (`scripts/effects/x.fx.js`) is for real code or reuse: `import { fx, pop, … } from "builtin/fx"; export function effect(ctx) { …; return fx(a, b); }`, its params in `ctx.params` (default each: a NaN in a number slot is refused); a file that exports the program string draws nothing. An object's `fx: { script, params }` plays at its feet and follows it.

The straw hit, one volley the tick the blade lands (a one-shot ends when its last stalk dies):
`pop straw burst=18..30 life=.8..1.5 v=<%normal|0,1,0>*(2.5..5*%power|1)+sdir()*(.6..1.6) size=.08..0.16 spin=-9..9 tint=oklch(.86 .10 88)..oklch(.70 .11 75) acc=grav()+drag(1.2) col=$tint a=1>.75:1>0 sz=$size rot=$age*$spin floor=stick r=sprite(stalk,alpha,velocity,.02)`

Fire is a surface whose edges move, and glowing sprites are one form of it: the campfire below holds its hearthlight (`n=1`), so the light stands while the fire does. A fire that must read solid (a burning body) is one mesh around the thing: its `material(ctx)` noise, stretched tall and carried up with `time`, drives `opacityNode`, and `alphaTest` cuts the edge, so it is opaque while its tongues move.

```fx
fx
pop coals n=10 on=disc(.2) size=.07..0.15 tint=<2.6,1,.28>..<1.2,.35,.09> sz=$size*flick(.5,.12) col=$tint*flick(.8,.3) a=.9 r=sprite(soft-disc,add)
pop flame rate=flick(.45,.2)*70 on=disc(.22) life=.5..0.95 v=up(1.6)+cone(24)*(.35..0.9) size=.22..0.42 acc=curl(.5)*1.3+buoy(2.4)+drag(1.5)
  sz=$size*(.5>.25:1>.7:.72>.14) col=hdr(4.8,3.6,1.5)>.3:hdr(3.4,1.5,.35)>.65:hdr(1.9,.55,.12)>hdr(.7,.14,.03) a=0>.12:1>.75:.85>0 rot=spin(.2) r=sprite(flame-wisp,add)
pop embers rate=5 on=disc(.22) life=.7..1.5 v=up(2.4)+cone(32)*(.4..1.3) size=.02..0.05 acc=curl(.8)*1.1+grav()*.45+drag(.5)
  sz=$size*(1>.7:.8>.3) col=hdr(5,2.8,.8)>.6:hdr(2.4,.8,.15)>hdr(1,.22,.04) a=(0>.08:1>.65:.9>0)*flick(11,.35) r=sprite(ember,add,velocity,.02)
pop smoke on=@flame?.22 inh=p;v:$v*.4 life=1.8..3.2 size=.16..0.26 acc=buoy(.9)+curl(.35)*.5+drag(.8) sz=$size*(.7>3.4) col=<.3,.28,.26>><.15,.15,.16> a=0>.25:.3>.7:.21>0 rot=spin(.15) r=sprite(smoke-puff,alpha)
pop hearth n=1 at=disc(.22).c(.45) glo=fire()*(#flame/45)~ r=light(<1,.55,.24>,$glo*30,12)
```

- `stretch` is SECONDS of travel: a velocity-aligned card's long axis is size + |v|·stretch: 0.02 on a stalk or chip; 0.1 draws a glow blade that reads as hay. On `align=axis` the slot is metres: a unit `axis=<x,y,z>` with stretch 9 is a ten-metre card turned to the camera around the axis; a beam of light is four of them held (`n=4`, `add`, no rate), its dust on `line(10,ax,ay,az)`, a pool and one daylight at the foot. Debris is a hard-edged card (5–12 cm, `alpha`), never a soft dot stretched; sparks and embers are the streaks (`ember`, `add`, ≤ 0.03).
- Textures, white shapes tinted by `col`: `soft-disc smoke-puff ember mote flame-wisp leaf droplet snowflake petal stalk chip grain splinter shard`; ground and walls cut them hard without `soft` metres. `hdr(5,3,1)` through `alpha` clips to white; smoke through `add` never darkens. `distort` (`sprite(soft-disc,distort)`) paints what stands behind, shifted by `col`'s x,y in screen fractions (under .002 nothing paints), masked by the texture's alpha, mixed by `a`: heat haze, refraction, a vortex's warp.
- `rate` reads emitter values (`time()`, `noise()`, `#pop`, `flick()`, `env()`); `cone()` `sdir()` `blast()` roll once at birth; `acc` and bindings run every tick. Coupling reads the previous tick; a child with no shape is born where its parent died, `on=point()` at the anchor.
- `count: N` holds until destroyed (with no lifetime it rides its emitter, `space=world` holds it); `burst` with a life ends. A moving emitter leaves its particles behind: trails `inheritVelocity`, auras `space: "local"` or `attachTo: <id>`, weather `fx follow=player` with `n=` and `wrap=` on a `box()` slab around every viewer, `n` its only density knob.
- A jagged strike is ~15 midpoint-displaced points fed to `path()` with `align: "segment"`; it also takes SVG path data (`{ plane: "xz", size }`, metres) or `entity(id)` of a `vector` object. Timed ribbons (`lifetime`), ground ribbons (`facing: "ground"`), a ribbon beside a sprite with several `textures`, `path(entity(id))`, `parent()` and `light({ perParticle })` pull their whole effect onto the CPU; dense sprite mass is its own effect. Tens of thousands alive is working scale.
- Light that moves: a trail, a helix, an arc is a `ribbon()` rider whose `pos:`/`vel:` traces the path, ONE continuous strip per particle (u along, v across 0 → 1; `width`/`color`). A sheet, a petal, a veil is `mesh({ shape: "card", blend: "add", material })`; a blade or a leaf `mesh({ script: "scripts/blade.js" })`: your `geometry(ctx)` piece. The look (a bright rim over a softer core, veins, a shimmer) is your own fresnel and noise in the `material(ctx)` file the sink names, over `ctx.fx` (uvAlong, uvAcross, viewDir, normal, color, alpha, `params.<name>`, `scene(offset)`, `texture(uv)`).
- Tier branches (`ctx.quality`, `ctx.device`, `ctx.device.hold`: 0..1, the memory this viewer can carry) are per viewer and render-only: counts, sizes, rates, never lifetimes or windows (they set the shared wind-down clock). `ctx.device.quality`: the level drawn now.

<grammar>
`//` starts a comment. Beyond <fx-grammar>:
shapes for on= and at= (on=box(13,.6,13).c(9.5) is a rain slab over the eye): disc(r) sphere(r) box(hx,hy,hz) arc() line(len,ax,ay,az) point() path(js{pts})
.fn on any expr: sin cos abs floor fract sqrt neg norm len min max mix cross dot step smooth mod pow atan2 yaw
builtins with their arguments (long names work too): cone(deg) sdir() blast(s) ci() up(s) grav() buoy(k) drag(k) radial(s) attract(k) vortex(k) force(f) hdr(r,g,b) spin(rps) curl(f) noise(x) flick(hz,amt) fire() env(0>.2:80>1.7:0) time() floorh() wind() entity(id) parent(name) field(js{…}) orbit(radius,rps,phase,around,axis) seek(target,speed) along(js{pts},t): s k f x t take any value; deg rps hz amt r g b are one number, the roll goes outside: cone(15)*(.2..0.5)
sprite's later slots: sprite(tex,blend,align,stretch s,soft[,lit=true,axis=<0,1,0>,repeat=6;1,glow=.1,filter=pixel,depthTest=false,sortingLayer=75,sortingOrder=2]): tex a textures/ name, a /cdn/ picture or SVG path data; glow a halo past a picture's edge in particle colour, ≤ .15 of size; filter=pixel keeps texels hard, one more draw like another tex; sortingLayer and sortingOrder sort particles among 2D sprites (neither: the nearest sprite among the object it plays on or a loose one-shot's emitter and its parents, else 0)
rib's and mesh's later slots: blend=add soft=.2 material=scripts/rim.js (a file you write) params=t:$age/$life;heat:$heat (≤ 4) · rib facing=camera|ground|<0,1,0> in the pop's frame, sortingLayer sortingOrder as sprite's · mesh script=scripts/blade.js
</grammar>