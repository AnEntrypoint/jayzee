## Self

```ts
ctx.self
ctx.self.id: string
ctx.self.state: TomeCameraState
ctx.self.session: Record<string, unknown>
ctx.self.feetPosition: Vec3
ctx.self.rotation: RotationSpec
ctx.self.up: Vec3 | null
ctx.self.frame: RotationSpec | string | { readonly id: string } | null
ctx.self.target: CameraTargetView | null
ctx.self.view: { yaw: number; pitch: number } | undefined
ctx.self.pointerLock?: boolean | "drag" | { drag: "left" | "right" | "middle" } | { unadjustedMovement: boolean } | null
ctx.self.fov?: number | null
ctx.self.clip?: { near?: number | null; far?: number | null } | null
ctx.self.orientation?: CameraOrientationDef | null
ctx.self.sensitivity?: number | null
ctx.self.minPitch?: number | null
ctx.self.maxPitch?: number | null
ctx.self.pixelSnap?: boolean | null
ctx.self.hideLocalPlayer?: boolean | null
ctx.self.projection?: "perspective" | "orthographic" | null
ctx.self.layers?: string[] | null
```
