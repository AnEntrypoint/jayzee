## Movement

Velocity uses meters per second. forces holds named forces until a key is cleared with null. Force uses newtons and torque uses newton-meters on world axes. Dynamic bodies accept forces. A character body standing on a moving kinematic platform rides it: the engine carries it, and its velocity is relative to the platform.

```ts
ctx.self.grounded
ctx.self.touching.wallLeft/.wallRight
ctx.self.touching.ceiling
ctx.self.velocity
ctx.self.velocity = v
ctx.self.forces.<key> = { force?, position?, torque? }
<entity>.velocity
<entity>.velocity = v
ctx.self.angularVelocity
ctx.self.angularVelocity = v
<entity>.angularVelocity = v
ctx.self.liquid.in
ctx.self.liquid.level
ctx.self.overlapping
```
