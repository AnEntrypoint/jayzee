## builtin/room-routing

Use only in a routing script that exports pickRoom(ctx). firstOpenRoom selects the requested open room, an available room, or a new room. mostFullWithSpace returns null when none has space. roomFor gives a stable room name for a key.

```ts
export async function pickRoom(ctx: { player, rooms, requestedRoomId, game, rejectedRooms }): Promise<string | { room, persistence } | null>
firstOpenRoom(ctx): string;
mostFullWithSpace(ctx): string | null;
nextRoomName(rooms, exclude?: string[]): string;
roomFor(key: string): string;
```
