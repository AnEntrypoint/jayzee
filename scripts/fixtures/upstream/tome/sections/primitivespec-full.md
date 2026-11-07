## PrimitiveSpec (full)

A scripted primitive's collider() may return a heightfield: an object's ground from a grid of heights, as one collider (`spawn api ColliderHeightfield`).

```ts
PrimitiveSpec =
  | { kind: "cube"; size?: number; segments?: number } & PrimitiveBase
  | { kind: "box"; width?: number; height?: number; depth?: number; widthSegments?: number; heightSegments?: number; depthSegments?: number } & PrimitiveBase
  | { kind: "sphere"; radius?: number; widthSegments?: number; heightSegments?: number; phiStart?: number; phiLength?: number; thetaStart?: number; thetaLength?: number } & PrimitiveBase
  | { kind: "cylinder"; radiusTop?: number; radiusBottom?: number; height?: number; radialSegments?: number; heightSegments?: number; openEnded?: boolean; thetaStart?: number; thetaLength?: number } & PrimitiveBase
  | { kind: "capsule"; radius?: number; halfHeight?: number; capSegments?: number; radialSegments?: number } & PrimitiveBase
  | { kind: "plane"; width?: number; height?: number; widthSegments?: number; heightSegments?: number } & PrimitiveBase
  | { kind: "torus"; radius?: number; tube?: number; radialSegments?: number; tubularSegments?: number; arc?: number } & PrimitiveBase
  | { kind: "octahedron"; radius?: number; detail?: number } & PrimitiveBase
  | { kind: "tube"; points: Array<[number, number, number]>; radius?: number; radialSegments?: number; tubularSegments?: number; closed?: boolean; straight?: boolean } & PrimitiveBase
  | { kind: "cone"; radius?: number; height?: number; radialSegments?: number; heightSegments?: number; openEnded?: boolean; thetaStart?: number; thetaLength?: number } & PrimitiveBase
  | { kind: "ring"; innerRadius?: number; outerRadius?: number; thetaSegments?: number; phiSegments?: number; thetaStart?: number; thetaLength?: number } & PrimitiveBase
  | { kind: "tetrahedron"; radius?: number; detail?: number } & PrimitiveBase
  | { kind: "icosahedron"; radius?: number; detail?: number } & PrimitiveBase
  | { kind: "dodecahedron"; radius?: number; detail?: number } & PrimitiveBase
  | { kind: "pyramid"; radius?: number; height?: number; segments?: number; width?: number; depth?: number; thetaStart?: number } & PrimitiveBase
  | { kind: "lathe"; points: Array<[number, number]>; segments?: number; phiStart?: number; phiLength?: number } & PrimitiveBase
  | { kind: "extrude"; shape: Array<[number, number]> | string; holes?: Array<Array<[number, number]>>; depth?: number; bevelEnabled?: boolean; bevelThickness?: number; bevelSize?: number; bevelSegments?: number; curveSegments?: number } & PrimitiveBase
  | { kind: "circle"; radius?: number; segments?: number; thetaStart?: number; thetaLength?: number } & PrimitiveBase
  | { kind: "torusKnot"; radius?: number; tube?: number; radialSegments?: number; tubularSegments?: number; p?: number; q?: number } & PrimitiveBase
  | { kind: "frustum"; radiusTop?: number; radiusBottom?: number; height?: number; segments?: number } & PrimitiveBase
  | { kind: "ellipsoid"; radiusX?: number; radiusY?: number; radiusZ?: number; widthSegments?: number; heightSegments?: number } & PrimitiveBase
  | { kind: "superellipsoid"; a?: number; b?: number; c?: number; n1?: number; n2?: number; segments?: number } & PrimitiveBase
  | { kind: "hollowCylinder"; innerRadius?: number; outerRadius?: number; height?: number; radialSegments?: number; openEnded?: boolean } & PrimitiveBase
  | { kind: "hemisphere"; radius?: number; segments?: number; direction?: "up" | "down" } & PrimitiveBase
  | { kind: "arch"; width?: number; height?: number; depth?: number; segments?: number } & PrimitiveBase
  | { kind: "archway"; width?: number; height?: number; depth?: number; thickness?: number; segments?: number } & PrimitiveBase
  | { kind: "squareArch"; width?: number; height?: number; depth?: number; archWidth?: number; archHeight?: number; segments?: number } & PrimitiveBase
  | { kind: "wall"; width: number; height: number; depth: number; holes?: Array<{ x: number; bottomY?: number; y?: number; w: number; h: number }>; facing?: "z" | "x" | "y" } & PrimitiveBase
  | { kind: "line"; points?: [number, number, number][]; segments?: boolean; count?: number; bounds?: { min: [number, number, number]; max: [number, number, number] } }
  | { kind: "custom"; geometry: BespokeGeometrySpec; forward?: ForwardAxis; sockets?: PrimitiveSockets }
  | { kind: "scripted"; script: ScriptRef; params?: Record<string, unknown>; seed?: number; forward?: ForwardAxis; sockets?: PrimitiveSockets }
  | { kind: "points"; count: number; bounds?: { min: [number, number, number]; max: [number, number, number] } }

PrimitiveBase = {
  materialKey?: string
  overrides?: DrawMaterialOverrides
  sockets?: Record<string, { x: number; y: number; z: number } | [number, number, number] | { position: { x: number; y: number; z: number } | [number, number, number]; direction?: { x: number; y: number; z: number } | [number, number, number] }>
}
```
