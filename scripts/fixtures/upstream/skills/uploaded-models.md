# Uploaded Models

```js
spawn({ id: "fountain", feetPosition: { x: 12, z: -4 }, physics: "static", layout: { box: { min: { y: 0 }, max: { y: 2.6 } } },
  model: { id: "cdn/fountain.glb", materials: {
    marble: { texture: "cdn/texture-marble-white-veined.png", roughness: 0.3 },
    brass: { texture: "cdn/texture-brass-brushed.png", metalness: 1, roughness: 0.4 } } },
  children: [{ id: "fountain-lamp", attachment: { socket: "lamp_top" }, model: "cdn/lantern.glb" }] });
spawn({ id: "knight", feetPosition: { x: 4, z: 2 }, physics: "character", model: "cdn/knight-silver-armor.glb",
  children: [{ id: "knight-cape", attachment: { skin: true }, model: "cdn/cape.glb" }] });
```

- A creator's own picture they want in 3D asks for its cooked mesh, nothing built first: one cook, not one a turn. Its `/cdn/` name plus `.glb` is that mesh (`model: "cdn/value.<sha>.png.glb"`), again when they say yours looks wrong. `?static` on that address cooks one unrigged statue in the picture's own pose, no clips. Any other likeness is yours to build (→geometry). A chat picture gets its `/cdn/` name by `spawn attachments download`, then `spawn upload`. A humanoid comes rigged with Idle, Walk, Run, Sprint and Jump inside it; any other motion is a clip address; an animal comes as one unrigged mesh.
- Size: the DM's height and bounds, not the thumbnail, are the in-game size. The collider follows, coarse until the hull cooks; a `character` with no `collider` keeps a 1.9 m capsule, radius 0.35, until `physics.capsule` sizes it; `collider: "capsule"` fits it to the model. A box hitbox is a `render: false` box `primitive` with `collider: "box"` that never turns; its model turns on a child.
- Clips play by name, case-insensitive and near (Walk finds Walking; `Armature|` ignored), past the DM's cap; a missing name plays its idle (else first) clip and `getLogs()` lists the real ones. An unrigged model plays baked clips but takes no bone attachments, IK or library clips.
- Name each material slot for its surface in Blender so each takes its own texture; until it lands a slot wears the GLB's paint.
- Read bones, sockets and shape keys as if the model is there: a read holds your hook until it loads; a `{ bone }` or `{ socket }` attachment written first rides its anchor once there. A shape-key read's `[]` or a socket read's `null` = none. A face talks by its jaw bone or mouth key; with neither, weight a jaw to its mouth in Blender.
- `ctx.getObject(id).skeleton` is an array of rows by `name`. Check a pose (astride a saddle) by each knee's and foot's drawn `currentWorldPosition`, as a picture can hide a crossed limb.
- `ctx.attach` is for a piece swap alone, hiding `replaces` as the piece's model lands.
- A humanoid rig with recognizable bone names (Mixamo-style; prefixes and twist bones tolerated) gets foot grounding; a rig the platform knows (Mixamo, Spawn's, Meshy, UE mannequin, Auto-Rig Pro, Unity humanoid) also plays every library clip by address; any other rig plays its own clips and one made on its bones, by the address `spawn clip import` prints.
- The DM comes once the file is live at world scale; compression lands later. A DM calling it too heavy: fix its source, else Blender.
- Facing: the engine, a CDN model and a dropped file face −Z (no `forward`). A workshop file faces as its bytes do: a platform body fetched plain keeps −Z through Blender, its `?raw` copy faces as it came in (often +Z); on `spawn upload` and `spawn fetch` their `facing:` line names the `forward` it takes. `forward` turns the mesh, sockets and parts; `rotation` turns the whole object, children and colliders.

<api>
model.materials: { <slot>: material } // keyed by the GLB's material names (node names as fallback); a miss lists the real names in getLogs()
// a colour painted into a body's texture: a scripted material on its slot shifts its hue in materialColor; every colour of that hue there shifts
model.parts.<name>: { visible, ...material } // each mesh node or material the .glb names, no cook; it draws until { visible: false }; ?parts=a,b cuts a nameless mesh; ?extract=a mints one as a model
model.forward: "+z" | "+x" | "-x" // for a model that stands turned round: the axis it was built to face; the engine turns it onto −Z once (omitted: no turn)
attachment: { bone } // on a parent: "player" root, every player wears a copy; a hand's joint is the wrist: the fist closes on the hand row's `fist.grip`: seat a handle along it, its middle on `fist.position`
attachment: { skin: true | { map: { <childBone>: <parentBone> } } } // a SKINNED child (its own joints named for the parent's bones, case-insensitive) deforms with the parent's rig; one child per garment, never baked in; its own feetPosition/rotation/scale mean nothing
// a { bone } or { skin } child on a shape-keyed body follows its keys (hair grows with a head-size morph); its own morph write wins per key
attachment: { socket } // any snake_case name on any model resolves on its own; the child sits at the parent's origin until it does
attachment: { part } // names normalize to snake_case
layout.box // meters; model meets the nearest side
</api>

<!-- generated-types -->

### Signatures (generated: do not edit)

```ts
ctx.getObjectBoneNames(id: str): BoneNamesResult // Use before setting attachment.bone. A model still loading is waited for; once it lands, [] means no rig
ctx.getObjectMorphTargetNames(id: str): MorphTargetNamesResult // Discover an object's shape keys (morph targets / blend shapes): the names morph takes, e.g. ["Blink", "Smile"]
ctx.getObjectSocket(id: str, name: str): { position: Vec3, direction: Vec3, confidence: num } | null // Same for another object: projectile spawn points without invisible marker children
ctx.self.ragdoll = {…} (= null releases it) // Flip a rigged character to physics: joints[bone].strength pulls each to its animation; its own fixed joint to a kinematic object at the hips keeps it standing
ctx.attach(entity: str | { readonly id: str }, parent: str | { readonly id: str } | null, offset?: { position?: Vec3, rotation?: RotationSpec, scale?: Vec3, pivot?: PivotSpec, attachment?: ObjectAttachmentSpec | null, replaces?: str }) // The piece swap: attach(piece, holder, { attachment: { part: "turret" }, replaces: "turret" }) hides the named thing: a child of the world by id
```

<!-- /generated-types -->