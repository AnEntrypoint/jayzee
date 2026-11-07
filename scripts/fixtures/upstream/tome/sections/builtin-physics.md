## builtin/physics

Pass ctx first. raycast defaults to 200 meters and ignores the caller. physicsOnly: true selects colliders only. overlapPoint and overlapSegment return intersecting collider volumes. traverseCheck returns traversable, reason, and detail; its default step height is 0.3 meters. getInputRay uses the sampled pointer ray, or the camera's forward ray when no pointer ray is available. createWorld(opts) takes no ctx. It gives a physics world of your own on this machine, apart from the place, that moves only when you call step(dt). save() gives a snapshot of its whole state as bytes, and restore(bytes) rewinds the world to that snapshot. On one engine build, the same adds, writes and steps give the same bytes on every machine, so the world is deterministic: a rollback game restores the save of a late input's frame and steps again to the present frame. On a phone, a step of 50 moving bodies costs about 1.5 ms, so keep a rollback world to the bodies that the match needs.

```ts
raycast(ctx, origin: Vec3, direction: Vec3, opts?: number | { distance?, radius?, ignoreEntities?, ignoreSelf?, tags?, anyTags?, excludeTags?, bodies?: "static" | "dynamic" | "all", through?, physicsOnly?, multiple?, verdict?, shape? }): RaycastHit | RaycastHit[] | RaycastProbeResult | null
overlapPoint(ctx, point: Vec3, opts?: OverlapOptions): OverlapResult
overlapSegment(ctx, a: Vec3, b: Vec3, opts?: OverlapOptions & { radius? }): OverlapResult
traverseCheck(ctx, from: Vec3, to: Vec3, opts?: TraverseCheckOptions): TraverseCheckResult
jumpCheck(ctx, from: Vec3, to: Vec3, { speed, jumpSpeed, place?, body?, includeDynamicBodies?, ignoreEntities? }): JumpCheckResult
getInputRay(ctx, input?: InputState): { origin, direction, source } | null
createWorld(opts?: { gravity?: Vec3 }): Promise<PhysicsWorld>
PhysicsWorld.add({ body?: "dynamic" | "static" | "kinematic", collider: "box" | "sphere" | "capsule", size?: Vec3, radius?, height?, position?: Vec3, rotation?: Quat | { yaw, pitch, roll } | yaw, velocity?: Vec3, angularVelocity?: Vec3, mass?, friction?, restitution?, gravityScale?, linearDamping?, angularDamping?, lockedAxes?: ("x" | "y" | "z" | "rotX" | "rotY" | "rotZ")[] }): PhysicsBody
PhysicsWorld.step(dt?: number): void
PhysicsWorld.save(bodies?: PhysicsBody[]): Uint8Array; PhysicsWorld.save(into: Uint8Array): number; PhysicsWorld.restore(bytes: Uint8Array, bodies?: PhysicsBody[]): void
PhysicsWorld.remove(body: PhysicsBody): void
raycast(world: PhysicsWorld, origin, direction, opts?: number | { distance?, radius?, shape?, bodies?, ignoreEntities?: PhysicsBody[], multiple?, verdict? })
overlapPoint(world: PhysicsWorld, point, { ignoreEntities? })
overlapSegment(world: PhysicsWorld, a, b, { radius?, ignoreEntities? })
traverseCheck(world: PhysicsWorld, from, to, { body?: PhysicsBody, includeDynamicBodies?, ignoreEntities? })
jumpCheck(world: PhysicsWorld, from, to, { speed, jumpSpeed, body?, includeDynamicBodies?, ignoreEntities? })
getInputRay(world: PhysicsWorld, input?)
PhysicsBody.position: Vec3; PhysicsBody.rotation: Quat; PhysicsBody.velocity: Vec3; PhysicsBody.angularVelocity: Vec3
```
