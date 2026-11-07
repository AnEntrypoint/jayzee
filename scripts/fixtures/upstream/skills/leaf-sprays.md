# Leaf Sprays

The picture is a texture script you write (`spawn api TextureScript`), so every leaf is sharp at any size. One script draws each kind by a param, `scripts/tex-leaves.js?kind=needle`. It exports `meta = { filter: "linear", wrap: "clamp" }`. Its canvas is 512 px square. The object that wears it carries `material: { alphaTest: 0.5 }` to cut the clear ground away.

The picture:

- Each leaf has its own shade, dark in shadow and light in sun, so the spray has depth. `ctx.color` on the card multiplies, so keep it near white.
- Leaves pack toward the card's upper corners, since a sparse spray vanishes far off, and every tip stops short of its edge, since a cut leaf draws a straight line. Count a leaf spray: read the finished canvas with `getImageData`; while under 0.4 of its pixels have alpha over 128, draw more shoots.
- A needle card is its own picture, never counted: a bough up the card with five sprigs a side, shorter toward the tip, each a dense lobe of 3 by 30 px needles from 15% lightness at its base to 40% at its tip, with clear ground as wide as the lobe between. Draw under sprigs first and darker.
- The leaf names the species: a pointed oval, a small round leaf, a needle, a frond.

The cards:

- A card is about 2 m across on a tree and 1 m on a bush: a pixel is 4 or 2 mm, so a species' leaf of 6 to 15 cm is 15 to 40 or 30 to 75 px.
- A crown is many cards crossing its volume at mixed sizes and tilts, faces to the open air, dark cards in its heart so no sky shows through. Every card takes the crown's normal, so the crown shades as one volume (→trees).
- Where paths go under a tree, its lowest boughs stay above a walker's head.
- A bush is a cluster of the same cards round a low oval, a hedge the same along a long box, and ivy lies them flat on the wall.