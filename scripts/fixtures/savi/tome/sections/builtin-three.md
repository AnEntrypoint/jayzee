## builtin/three

Export material(ctx) from the material script. It returns a material. ctx.param(name, default) is a shader node for a declared parameter; scale it with .mul(), never JS *. Material opacity is 0 to 1. Set transparent when the material uses alpha. A PointsNodeMaterial draws round, unlit points: one a copy on a `points` row, one a vertex on any other shape. Its positionNode places each point (from instanceIndex on a points row), sizeNode is its width in CSS pixels (size when unset), which a perspective eye scales by nearness as three does (sizeAttenuation), and AdditiveBlending sums their light. A crowd of dots a pixel or two wide is a points row, never copies of a tiny mesh. A `line` row wears a LineBasicNodeMaterial or Line2NodeMaterial: linewidth is its width in CSS pixels at every distance.

```ts
material: { kind: "scripted", script, params }
new MeshStandardNodeMaterial() | MeshPhysicalNodeMaterial | MeshSSSNodeMaterial | MeshBasicNodeMaterial | MeshPhongNodeMaterial | MeshLambertNodeMaterial | MeshToonNodeMaterial | MeshMatcapNodeMaterial
new LineBasicNodeMaterial({ color, linewidth: 3 }) | Line2NodeMaterial
m.vertexNode = vec4
new SpriteNodeMaterial()
new PointsNodeMaterial({ size })
m.positionNode = vec3
m.sizeNode = float
m.sizeAttenuation = true
m.colorNode, m.opacityNode
m.blending
FrontSide, BackSide, DoubleSide; NoBlending, NormalBlending, AdditiveBlending, SubtractiveBlending, MultiplyBlending, CustomBlending; AddEquation, SubtractEquation, ReverseSubtractEquation, MinEquation, MaxEquation; ZeroFactor, OneFactor, SrcColorFactor, OneMinusSrcColorFactor, SrcAlphaFactor, OneMinusSrcAlphaFactor, DstColorFactor, OneMinusDstColorFactor, DstAlphaFactor, OneMinusDstAlphaFactor, SrcAlphaSaturateFactor; Plane; RepeatWrapping, ClampToEdgeWrapping, MirroredRepeatWrapping; NearestFilter, LinearFilter, NearestMipmapNearestFilter, NearestMipmapLinearFilter, LinearMipmapNearestFilter, LinearMipmapLinearFilter; NoColorSpace, SRGBColorSpace; RGBAFormat, RGFormat, RedFormat, RGBAIntegerFormat, RGIntegerFormat, RedIntegerFormat; UnsignedByteType, HalfFloatType, FloatType, UnsignedIntType; Color, Vector2, Vector3, Vector4
new StorageTexture(width, height) | new Storage3DTexture(width, height, depth) | new DataTexture(data, width, height, format = RGBAFormat, type = UnsignedByteType) | new Data3DTexture(data, width, height, depth)
m.depthNode = float
m.attributeNode = float
m.dataNode = vec4
ctx.params, ctx.param(name, default), ctx.constants
ctx.param(name, list), ctx.params.name: { element(i), length }
ctx.param(name, ctx.texture(cdn)): texture
ctx.texture(cdn): texture; t.colorSpace = SRGBColorSpace | NoColorSpace
ctx.texture([cdn, …]): texture; t.sample(vec3(uv(), layer))
ctx.field(name).sampleWorld(): float
ctx.terrain.heightAt(xz, orElse?): float
ctx.terrain.pressAt(xz): vec2
ctx.terrain.ground: { color, normal, roughness, metalness, emissive }
ctx.tile: { id, uv, uvRect }
ctx.sprite: { texture, uv }
ctx.view(offset): vec4; ctx.view.depth(offset): float; ctx.portal: { state: 0 waking | 1 open | 2 closed, open, uv, eye, frame, ripples, impulses, edge, edgeDir }
ctx.fx: { uvAlong, uvAcross, viewDir, normal, color, alpha, size, seed, params: { <name> }, scene(offset): vec4, texture(uv?): vec4 }
ctx.device: { class: "desktop" | "mobile" | "tablet" | "unknown", coarse, maxTextures, quality: "low" | "medium" | "high" | "ultra" }, ctx.quality: "low" | "medium" | "high" | "ultra"
```
