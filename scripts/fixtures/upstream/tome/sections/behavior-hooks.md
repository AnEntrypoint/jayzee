## Behavior Hooks

Export these functions from a behavior module. onInput reads named axes and actions declared in the world's inputs. pressed and released apply on the transition; held stays true while the action is held.

```ts
onSpawn(ctx)
onDestroy(ctx)
update(ctx, dt: number)
lateUpdate(ctx, dt: number)
onInput(ctx, input: InputState)
onCollide(ctx, other: ObjectQueryResult, contact: Contact)
onTriggerEnter(ctx, other: ObjectQueryResult)
onTriggerExit(ctx, other: ObjectQueryResult)
onCross(ctx, other: ObjectQueryResult, outcome: Extract<CrossOutcome, { crossed: true | "departing" }>)
onRefuse(ctx, other: ObjectQueryResult, verdict: CrossVerdict)
onLiquidEnter(ctx, other: ObjectQueryResult & { liquidKind?: string; markKind?: string })
onLiquidExit(ctx, other: ObjectQueryResult & { liquidKind?: string; markKind?: string })
onSay(ctx, line: SaidLine)
onSoundEnd(ctx, sound: SoundEndEvent)
onOutOfBounds(ctx, event: OutOfBoundsEvent)
onControlBegin(ctx, player: ObjectQueryResult)
onControlEnd(ctx, player: ObjectQueryResult)
editor(ctx, obj: ObjectView)
visual(ctx, obj: ObjectView)
updateSchedule, data export, not a hook: export const updateSchedule = { every: N | { seconds: s }, near: { radius } }. update() runs only while a player is near the object (the engine's locality default, ~500 m; an object with no position always runs; a rule that must advance for everyone wherever they stand is sim.js, not an update()). The engine skips update() on ticks the schedule declines: every runs update() every N ticks (deterministic per-entity phase: a cohort auto-spreads). dt = the declared cadence step (every × tick dt), so integrate-by-dt code just works. Declaring every REPLACES a hand-rolled tick % N gate, delete the gate line, never keep both: the engine's per-entity phase and the body's own phase rarely coincide, so a script that keeps its gate mostly stops running. A path that must run every tick (aggro, sprint, a raising burst) is a reason to declare the gate wide enough in the export; the schedule is the file's, not a runtime dial.
async and import() in a hook or ear: the part before the first await runs in the tick, the rest later on the same ctx. import() answers an ES module's exports. A file only import() names stays out of arrival, so code only some moments need is its own module, import()ed where first needed: let seeder; export const ears = { "match:start": async (ctx) => { seeder ??= await import("./lib/seeder.js"); seeder.seedAll(ctx); } };
```
