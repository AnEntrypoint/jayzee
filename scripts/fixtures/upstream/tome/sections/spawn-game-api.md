# Spawn game API

Use this reference with the world's guide. The guide gives complete placement and template examples, the world's editing format, and the tools for testing it.

Coordinates use meters, Y up, and negative Z forward. Rotations use degrees unless a field says otherwise. Hook dt is seconds; ctx.now() is milliseconds on the world clock.

Object behavior hooks receive ctx first: onSpawn(ctx), update(ctx, dt), onCollide(ctx, other, contact). ctx.self is the object. Read another object with ctx.getObject(id); select objects with ctx.query(selector). Assign a property on a handle to change it.

On a 6.0 world, ctx.spawn(spec) creates an object. ctx.destroy(id) removes it. A behavior path names a module in the world's scripts directory. Export the named hooks from that module.

physics omitted gives no collider. physics: "static" makes a fixed solid. physics: "dynamic" makes a moving body. feetPosition is the bottom center; flat primitives use their center. Parent-relative positions and rotations are local to the parent.

Runtime behavior edits change the running game. Authored file edits and ctx.commit(message, fn) save changes to the world's tree. player.state is the player's saved data; ctx.world.state is shared within the room; ctx.session is local scratch data.

Use ctx.now() for game deadlines and ctx.random() for game randomness. ctx.after(seconds, exportName, payload) calls a named export after the given seconds.

Asset fields contain CDN names or uploaded asset references. The world's guide gives the upload endpoint. A reference to a file in the world's tree must name a file that exists.

Import supported functions from builtin/<module>. The declarations are the sections after this one, listing the fields, parameters, return shapes, and modules of this version: the docs door answers one section with ?section=<heading>, lists every heading in sections, and answers them all with ?section=all. A question mark marks an optional field. A value after = in a field is the value the engine uses when you omit that field.

This behavior records a timer in object state:

```js
export function onSpawn(ctx) {
  ctx.self.state.startedAt = ctx.now();
}
export function update(ctx, dt) {
  ctx.self.state.elapsedSeconds = (ctx.now() - ctx.self.state.startedAt) / 1000;
}
```
