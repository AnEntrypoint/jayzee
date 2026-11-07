## builtin/vec3

Vectors accept { x, y, z } or [x, y, z]. Rotations use degrees; a number means yaw. Euler order is yaw, pitch, roll about +Y, +X, +Z. Yaw 0 faces -Z. rotationFromDirection defaults to the -z axis.

```ts
add(a: Vec3Like, b: Vec3Like): Vec3
sub(a: Vec3Like, b: Vec3Like): Vec3
scale(v: Vec3Like, s: number): Vec3
dot(a: Vec3Like, b: Vec3Like): number
length(v: Vec3Like): number
normalize(v: Vec3Like): Vec3
distance(a: Vec3Like, b: Vec3Like): number
cross(a: Vec3Like, b: Vec3Like): Vec3
directionFromYawPitch(yaw: Degrees, pitch?: Degrees): Vec3;
rotate(rotation: Degrees | { yaw?, pitch?, roll? } | Quat, v: Vec3Like): Vec3;
rotationFromDirection(direction: Vec3Like, axis?: "x" | "y" | "z" | "-x" | "-y" | "-z"): Quat;
rotationFromEuler(euler: Degrees | { yaw?: Degrees, pitch?: Degrees, roll?: Degrees }): Quat;
eulerFromRotation(q: Quat): { yaw: Degrees, pitch: Degrees, roll: Degrees };
```
