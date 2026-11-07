## Object Access

```ts
ctx.world.places.<p>
ctx.getRoomId(): string
ctx.presence(userIds: ReadonlyArray<string | { readonly userId: string }>): Promise<readonly PresenceRow[]>
ctx.world.mode
ctx.getObject(id: string): ObjectView | null
<entity>.state.*
ctx.self.audio.params.<name> = v
ctx.getVibeAudio(id: string): VibeAudioSnapshot | null
<entity>.<prop>
ctx.getObjectBoneNames(id: string): BoneNamesResult
ctx.getObjectMorphTargetNames(id: string): MorphTargetNamesResult
ctx.getObjectSocket(id: string, name: string): { position: Vec3; direction: Vec3; confidence: number } | null
<entity>.children
<entity>.<prop> = v
ctx.place.tiles[x][y] = id
ctx.place.tiles[x][y] = 0
delete ctx.place.tiles[x][y]
ctx.place.tiles[x][y]
```
