## builtin/voxels

```ts
part(): VoxelPart
VoxelPart.set({ x, y, z, material }): VoxelPart
VoxelPart.fill({ from, to, material }): VoxelPart
VoxelPart.hollowBox({ from, to, material }): VoxelPart
VoxelPart.sphere({ center, radius, material, filled? }): VoxelPart
VoxelPart.cylinder({ base, radius, height, axis?: "x" | "y" | "z", material, filled? }): VoxelPart
VoxelPart.cone({ base, radius, height, axis?, material, filled? }): VoxelPart
VoxelPart.pyramid({ base, size, height, material, filled? }): VoxelPart
VoxelPart.torus({ center, majorRadius, minorRadius, axis?, material, filled? }): VoxelPart
VoxelPart.line({ from, to, material, thickness? }): VoxelPart
VoxelPart.add(source: VoxelPart | serialized, { at? }): VoxelPart
VoxelPart.bounds(): [[x, y, z], [x, y, z]] | null
VoxelPart.serialize(): { version: 1, bounds, palette: string[], voxels: [x, y, z, paletteIndex][] }
material(id: string): Brush
checker(a: string, b: string): Brush
random(ids: string[], weights?: number[]): Brush
noise(ids: string[], opts?: { scale?: number, seed?: number | string, weights?: number[] }): Brush
```
