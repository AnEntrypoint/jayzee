## TerrainDef heightmap (full)

```ts
terrain: {
  kind: "heightmap",
  seed?: num | str,
  materials?: [{ id: str, albedo?: "/cdn/value.<sha>.png", pbr?: bool, tint?: Color, normal?: str, roughness?: str, textureScale?: num, metalness?: num, normalStrength?: num, roughnessIntensity?: num, antiTiling?: "none" | "stochastic", filter?: "pixel" | "linear", macro?: { scale?, hue?, value? } }, ...],
  generator?: "scripts/file.js",
  verticalRange?: { min, max },
  marks?: Record<string, { kind: "sea", level: num, reach?: { shape: "rectangle", width: num, depth: num, center: { x, z } } | { shape: "halfplane", edge: "north" | "south" | "east" | "west", offset: num }, floorMaterial?: str, liquid?: LiquidSpec } | { kind: "lake", at: { x, z }, radius: num, level?: num, depth?: num, bedMaterial?: str, liquid?: LiquidSpec } | { kind: "river", points: [[x, z] | [x, z, level], ...], width: num, depth?: num, closed?: bool, bedMaterial?: str, liquid?: LiquidSpec } | { kind: "path", points: [[x, y], ...], width: num, material?: str, edgeMaterial?: str, noise?: num, falloff?: num, clearScatter?: bool, grade?: bool, maxGrade?: num } | { kind: "road", points?: [[x, y], ...], spline?: [[x, y, z], ...], closed?: bool, width: num, material?: str, edgeMaterial?: str, edgeWidth?: num, falloff?: num, clearScatter?: bool } | { kind: "flatten", center: { x, z }, height: num | { terrain: num }, shape: MarkShape | { kind: "path", points: [[x, y], ...], width: num }, falloff: num, falloffCurve?: "smooth" | "cliff" | "linear", maxGrade?: num, material?: str, edgeMaterial?: str, clearScatter?: bool } | { kind: "clear-scatter", center: { x, z }, shape: MarkShape | { kind: "path", points: [[x, y], ...], width: num } } | { kind: "hole", points: [[x, y], ...] }>,
  water?: LiquidSpec,
  material?: ScriptedMaterialSpec,
}
```
