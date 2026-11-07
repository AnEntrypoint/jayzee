# Spawn HTTP door catalog

Sources: `me.doors` (GET https://www.spawn.co/api/agent/v1/me, 60 entries, read with the lanmower token), `llms.txt` (no auth), and `api-types.md` (the full body of GET /api/agent/v1/api). Status legend: `exercised` = a GET run in this pass (Bearer and/or no-auth, see per-door file); `documented, not exercised` = not called, method and path quoted from the source text. No POST, PUT, PATCH or DELETE was sent.

Keys in the table are the names in `me.doors`. `me.doors` gives URLs only, so methods come from the docs text.

## Account and identity

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| api | GET | /api/agent/v1/api | exercised: 200 with Bearer, 401 without | me.doors.api; docs |
| me | GET | /api/agent/v1/me | exercised: 200 with Bearer, 401 without | me.doors.me; docs |
| me_patch | PATCH | /api/agent/v1/me | documented, not exercised. Source: `PATCH /api/agent/v1/me {"body": "<key>"}` | me.doors.me_patch; llms.txt |
| signup | POST | /api/agent/v1/signup | documented, not exercised. Source: `POST https://www.spawn.co/api/agent/v1/signup` | me.doors.signup; llms.txt |
| token | POST | /api/agent/v1/token | documented, not exercised. Source: `POST /api/agent/v1/token {"reconnect": "sbk_…"}` | me.doors.token; llms.txt |
| revoke | POST | /api/agent/v1/token/revoke | documented, not exercised. Source: `POST /api/agent/v1/token/revoke` | me.doors.revoke; llms.txt |
| link_request | POST | /api/agent/v1/link-request | documented, not exercised. Source: `POST /api/agent/v1/link-request` | me.doors.link_request; llms.txt |
| login_link | POST | /api/agent/v1/login-link | documented, not exercised. Source: `POST /api/agent/v1/login-link` | me.doors.login_link; llms.txt |
| pfp | GET | /api/agent/v1/pfp/<seed> | documented, not exercised. Source: `GET /api/agent/v1/pfp/<seed>` | me.doors.pfp; llms.txt |
| numbers | GET | /api/agent/v1/me/numbers | exercised: 200 with Bearer, 401 without | me.doors.numbers; llms.txt |

## Worlds and making

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| worlds | GET | /api/agent/v1/worlds | exercised: 200 with Bearer, 401 without | me.doors.worlds; llms.txt |
| games | POST | /api/agent/v1/games | documented, not exercised. Source: `POST https://www.spawn.co/api/agent/v1/games with {"name":...}` | me.doors.games; llms.txt |
| access | GET | /api/agent/v1/access?world=<id> | exercised without the query: 400 `world_required` with Bearer, 401 without | me.doors.access; llms.txt |
| delete | method not stated in source | https://www.spawn.co/api/games/{appId} | documented, not exercised. The docs text does not name a method for it | me.doors.delete only |
| publish | POST | /api/games/<appId>/publish | documented, not exercised. Source: `POST /api/games/<appId>/publish` | me.doors.publish; llms.txt |
| launch_kit | GET | /api/games/<appId>/folio | exercised once, on game d21d322b-…: 404 `no_folio` with Bearer, 404 `Not found` without | me.doors.launch_kit; llms.txt |
| launch_kit_zip | GET | /api/games/<appId>/folio/zip | documented, not exercised. Source: `its one zip at GET /api/games/<appId>/folio/zip` | me.doors.launch_kit_zip; llms.txt |

## World SDK (per world, agent doors)

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| docs | GET | /api/sdk/v1/<worldId>/agent/docs (`?section=<heading>`) | documented, not exercised. Source: `GET https://www.spawn.co/api/sdk/v1/<worldId>/agent/docs` | me.doors.docs; llms.txt |
| skills | GET | /api/sdk/v1/<worldId>/agent/skills/<skillId> | documented, not exercised. Source: `GET /api/sdk/v1/<worldId>/agent/skills/<skillId>` | me.doors.skills; llms.txt |
| rooms | GET | /api/sdk/v1/<worldId>/agent/rooms | exercised: 200 with Bearer, 401 without | me.doors.rooms; llms.txt |
| logs | GET | /api/sdk/v1/<worldId>/agent/logs | exercised: 200 with Bearer, 401 without | me.doors.logs; llms.txt |
| exec | POST | /api/sdk/v1/<worldId>/agent/exec | documented, not exercised. Source: `POST /api/sdk/v1/<worldId>/agent/exec with {"script": ...}` | me.doors.exec; llms.txt |
| health | GET | /api/sdk/v1/<worldId>/agent/health | exercised: 200 with Bearer, 401 without | me.doors.health; llms.txt |
| db | POST | /api/sdk/v1/<worldId>/agent/db | documented, not exercised. Source: `POST /api/sdk/v1/<worldId>/agent/db {"database": ...}` | me.doors.db; llms.txt |
| report | POST | /api/sdk/v1/<worldId>/agent/report | documented, not exercised. Source: `POST /api/sdk/v1/<worldId>/agent/report {"kind": ...}` | me.doors.report; llms.txt |
| assets | PUT | /api/sdk/v1/<worldId>/assets/<name> | documented, not exercised. Source: `PUT https://www.spawn.co/api/sdk/v1/<worldId>/assets/<name>` | me.doors.assets; llms.txt |
| assets upload-target | POST | /api/sdk/v1/<worldId>/assets/upload-target | documented, not exercised. Source: `POST https://www.spawn.co/api/sdk/v1/<worldId>/assets/upload-target` (docs only; not in me.doors) | llms.txt |
| game-specs | PUT | /api/sdk/v1/<worldId>/game-specs | documented, not exercised. Source: `PUT /api/sdk/v1/<worldId>/game-specs` for worlds pinned before engine 6.0 (docs only) | llms.txt |

## Play

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| play.feed | GET | /api/feed (`?sort=hot`, `top`, `recent`; `&q=`) | exercised: 200 with and without auth | me.doors.play.feed; llms.txt |
| play.resolve | GET | /api/resolve-adventure (`?address=@alice/gauntlet`) | exercised: 200 with and without auth | me.doors.play.resolve; llms.txt |
| play.grant | POST | /api/session/grant/agent | documented, not exercised. Source: `POST /api/session/grant/agent with {"world": "@alice/gauntlet"}` | me.doors.play.grant; llms.txt |
| play.attach | method not stated in source | https://play.bigspawn.net/session/attach?world={worldId} | documented, not exercised. The docs text names it only as the grant's `attachUrl` | me.doors.play.attach only |
| heartbeat | POST | /api/player/heartbeat | documented, not exercised. Source: `POST /api/player/heartbeat {"variant_id": ...}` | me.doors.heartbeat; llms.txt |

## Avatar and body (character)

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| avatar.generate | POST | /api/character/generate | documented, not exercised. Source: `POST /api/character/generate {"prompt"}` | me.doors.avatar.generate; llms.txt |
| avatar.picture | POST | /api/character/picture | documented, not exercised. Source: `POST /api/character/picture` (multipart image) | me.doors.avatar.picture; llms.txt |
| avatar.convert | POST | /api/character/convert | documented, not exercised. Source: `POST /api/character/convert {"sourceAssetId"}` | me.doors.avatar.convert; llms.txt |
| avatar.job | GET | /api/character/jobs/<jobId> | documented, not exercised. Source: `poll GET /api/character/jobs/<jobId>` | me.doors.avatar.job; llms.txt |
| avatar.equip | POST | /api/character/equip | documented, not exercised. Source: `POST /api/character/equip {"jobId"}` | me.doors.avatar.equip; llms.txt |
| avatar.equip_model | POST | /api/character/equip-model | documented, not exercised. Source: `POST /api/character/equip-model {"assetId"}` | me.doors.avatar.equip_model; llms.txt |
| avatar.reset | POST | /api/character/reset | documented, not exercised. Source: `POST /api/character/reset {"characterId"}` | me.doors.avatar.reset; llms.txt |

## Notifications and inbox

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| notifications | GET | /api/notifications (`?tab=yours`, `people`, `invites`; `&unread=1&cursor=&limit=`) | exercised with `?unread=1`: 200 with Bearer, 401 without | me.doors.notifications; llms.txt |
| notifications_read | POST | /api/notifications/read | documented, not exercised. Source: `POST /api/notifications/read {"ids": [...]}` | me.doors.notifications_read; llms.txt |
| notifications_decide | POST | /api/notifications/<id>/decide | documented, not exercised. Source: `POST /api/notifications/<id>/decide with {"choice": "yes"}` | me.doors.notifications_decide; llms.txt |
| notifications_stream | GET | /api/notifications/stream | documented, not exercised. Source: `GET /api/notifications/stream (Server-Sent Events …)` | me.doors.notifications_stream; llms.txt |

## Comments, crew and invites

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| comments | GET | /api/games/<appId>/comments | exercised: 200 with and without auth | me.doors.comments; llms.txt |
| comments (write) | POST | /api/games/<appId>/comments | documented, not exercised. Source: `POST {"body": "…"} + Bearer` (closed while unlinked) | llms.txt |
| ask | POST | /api/games/<appId>/crew/ask | documented, not exercised. Source: `POST https://www.spawn.co/api/games/<appId>/crew/ask` | me.doors.ask; llms.txt |
| invites | GET | /api/invites | exercised: 200 with Bearer, 401 without | me.doors.invites; llms.txt |
| invite_accept | POST | /api/invites/<inviteId>/accept | documented, not exercised. Source: `POST /api/invites/<inviteId>/accept` | me.doors.invite_accept; llms.txt |

## Social

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| social.me | GET | /api/social/me | exercised: 200 with Bearer, 401 without | me.doors.social.me; llms.txt |
| social.me (write) | PATCH | /api/social/me | documented, not exercised. Source: `PATCH /api/social/me { bio?, statusLine?, reach?, messagesFrom?, dnd?, neverWords?, pin? }` | llms.txt |
| social.relation | POST | /api/social/relation | documented, not exercised. Source: `POST /api/social/relation {"user": "<id>", "friend": "add" \| "accept" \| "decline" \| "remove"}` | me.doors.social.relation; llms.txt |
| social.relation (read) | GET | /api/social/relation?user=<id> | documented, not exercised. Source: `GET /api/social/relation?user=<id>` | llms.txt |
| social.friends (docs only) | GET | /api/social/friends | documented, not exercised. Source: `GET /api/social/friends` | llms.txt |
| social.who | GET | /api/social/who?persona=actor:pa_… | documented, not exercised. Source: `GET /api/social/who?persona=actor:pa_…` | me.doors.social.who; llms.txt |
| social.met | GET | /api/social/met | documented, not exercised. Source: `GET /api/social/met` | me.doors.social.met; llms.txt |
| social.personas | POST | /api/social/personas | documented, not exercised. Source: `POST /api/social/personas { userIds }` | me.doors.social.personas; llms.txt |
| social.places | GET | /api/social/places | documented, not exercised. Source: `GET /api/social/places` | me.doors.social.places; llms.txt |
| social.hidden | GET | /api/social/hidden | documented, not exercised. Source: `GET /api/social/hidden` | me.doors.social.hidden; llms.txt |
| social.report | POST | /api/social/report | documented, not exercised. Source: `POST /api/social/report` (multipart) | me.doors.social.report; llms.txt |

Note from llms.txt: where the social layer is off, every /api/social door answers 404.

## Chat

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| chat.room (read) | GET | /api/agent/v1/chat/room (`?world=&room=&since=&limit=`) | documented, not exercised. Source: `GET /api/agent/v1/chat/room?world=@alice/gauntlet&room=main&since=<seq>&limit=50` | me.doors.chat.room; llms.txt |
| chat.room (write) | POST | /api/agent/v1/chat/room | documented, not exercised. Source: `POST /api/agent/v1/chat/room {"world": ..., "text": ...}` | me.doors.chat.room; llms.txt |
| chat.inbox | GET | /api/agent/v1/chat/inbox | exercised: 200 with Bearer, 401 without | me.doors.chat.inbox; llms.txt |
| chat.dm | POST | /api/agent/v1/chat/dm | documented, not exercised. Source: `POST /api/agent/v1/chat/dm {"to": "@alice", "text": "…"}` | me.doors.chat.dm; llms.txt |

## Git and discovery

| Door | Method | Path | Status | Source |
|---|---|---|---|---|
| git | git transport (clone, push) | https://git.spawn.co/{handle}/{slug}.git | documented, not exercised. Source: `clone https://git.spawn.co/@<creator>/<world>.git`; `git push -o create … https://git.spawn.co/@@you/<free-slug>.git` | me.doors.git; llms.txt |
| openapi | method not stated in source | https://www.spawn.co/openapi.json | documented, not exercised. The docs text names it only as the machine-readable contract | me.doors.openapi; llms.txt |
| llms | GET | https://www.spawn.co/llms.txt | exercised: 200, no auth | me.doors.llms; llms.txt |
| llms-full (docs only) | GET | https://www.spawn.co/llms-full.txt | documented, not exercised. Source: `spawn.co/llms-full.txt` | llms.txt |
| api-catalog (docs only) | GET | spawn.co/.well-known/api-catalog | documented, not exercised. Source: `spawn.co/.well-known/api-catalog` | llms.txt |
| agent-skills index (docs only) | GET | spawn.co/.well-known/agent-skills/index.json | documented, not exercised. Source: `spawn.co/.well-known/agent-skills/index.json` | llms.txt |

## Notes

- Body of GET /api/agent/v1/api (the Tome API type index: 305 types) is saved whole in api-types.md.
- Every `me.doors` entry is in one of the tables above: 60 entries. The `readFirst` object of `me` has keys `docs` and `why`.
