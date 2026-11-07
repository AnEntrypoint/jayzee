# Game UI

Control words are labels (`turn` below), never keys as text. Arrival, identity and voice are Spawn's: the play press and first click or key start sound and take the mouse, a player is their Spawn name and face overhead and on every board, and players hear each other on Spawn's mic (join, mute, open or hold V), so a game builds no click-to-start or tap-for-sound gate, mic button, nickname or login; asked, say so and build only a sign-in button on `player.isGuest`. The game owns its fiction (named character, hero or team on `player.state`). A Spawn game opens in the world: a start screen (title, lobby) loses players: the room reads empty. Never add or remove one unasked (`ui.startScreen`). A level pick is a pad, doorway or marked area you stand on, a portal only when it is another place (→portals); a character or loadout pick is a station you walk to. The screen is in the game's material: the engine's pixel face: Jersey 10, Geist Pixel Square (Grid/Circle/Triangle/Line stripe small text) named by `engine.ui.theme.font` in world.config.yaml, or its own (`spawn upload` an open-licence .woff2 named in `@font-face`): the world's palette, flat fills, hard edges, a hard-offset shadow (the plate below); a game's HUD, never a web page's glass card; `system-ui` throws the face away.

```js
// ui.js is one module on the page: the engine calls the default export whenever what it reads moves, ≤30/s (a glide is CSS; read ctx.now() only to draw time); every named export is a page global for onclick
const THEME = `<style>#hud{--ink:oklch(.22 .04 60);--paper:oklch(.96 .03 90);--gold:oklch(.86 .15 85);color:var(--paper);text-shadow:2px 2px var(--ink)}.plate{background:var(--paper);color:var(--ink);box-shadow:0 0 0 3px var(--ink);text-shadow:none;padding:10px 16px}.lbl{font-size:13px;letter-spacing:.08em;opacity:.7}.num{font-size:48px;line-height:1}@keyframes kick{50%{scale:1.4}}@keyframes fade{to{opacity:0;visibility:hidden}}</style>`;
export default function (ctx, player) {
const s = player.controlling?.state ?? player.state, turn = ctx.world.inputs.axes?.moveX?.label;
return `${THEME}<div id="hud" class="fixed inset-0 pointer-events-none">
<div class="absolute left-6 bottom-6 plate" style="min-width:180px"><div class="lbl">SPEED</div><div class="num">${Math.round(s.speed ?? 0)}</div></div>
<div class="absolute top-6 plate text-right" style="min-width:140px;right:clamp(24px,(110px - var(--spawn-chrome-reservation-right-top,0px))*999,var(--spawn-chrome-reservation-right-inset,50px) + 24px)"><div class="lbl">SCORE</div><div id="s${s.score ?? 0}" class="num" style="color:var(--gold);animation:kick .15s">${s.score ?? 0}</div></div>
${turn ? `<div id="hint" class="absolute inset-x-0 bottom-24 text-center" style="padding:0 calc(var(--spawn-chrome-reservation-right-inset,50px) + 24px);font-size:18px;animation:fade 1s 4s forwards">${turn} to steer</div>` : ""}
</div>`;
}
```

- A table only some players need is `import()`ed where first needed: the render draws it on landing; arrival skips it. Nodes match by `id`: a kept id keeps its running animation; a new id or changed inline `animation` replays it. A loop moves only opacity or a transform; stroke-dashoffset and others repaint every frame: a glow pulses the opacity of a shadowed `::after` at `inset:0`, never scaled or larger (a shadow leaves its box dark); marching dashes slide a `repeating-linear-gradient` strip. A render throw blanks the HUD until one succeeds. Secret cards are owner rows under their player →platform-systems. Theme classes paint, utilities place: `.plate` never sets `position` or `display` (authored rules beat utilities).
- The rail is Spawn's: one block centered on the right edge, every platform and width. Never hide, move or cover it. A band, not a column: `var(--spawn-chrome-reservation-right-inset, 50px)` wide, its rows `var(--spawn-chrome-reservation-right-top)` / `var(--spawn-chrome-reservation-right-height)`. Above and below it the right edge is the game's (`right: 24px`); a plate or scrollbar across its rows keeps clear (`right: calc(var(--spawn-chrome-reservation-right-inset, 50px) + 24px)`), a centered line there pads both sides alike, or ends above it (`bottom: calc(100vh - var(--spawn-chrome-reservation-right-top) + 24px)`).
- Escape frees a locked cursor and closes Spawn's chat, so a game opens nothing on Escape or the release (`pointerLockLost`) even when asked; its bound action fires. A game's menu, pause and HUD buttons take its own keys, each printed on its button; pause sets `ctx.place.timeScale`: 0 holds every body, timer and effect.
- `html { cursor: none }` hides the arrow over the whole game; `url(…), auto` draws its own.
- A hotbar scroll is two actions `mouse: "wheelUp"`/`"wheelDown"` (a pulse per notch), never the `wheelY` axis. `pointer-events-auto` stays on real buttons. Plates fit a 390 px phone: side by side they `flex-wrap`, none narrower than its one-line label; an opened panel across the band's rows keeps `max-width: calc(100vw - 2 * (var(--spawn-chrome-reservation-right-inset, 50px) + 24px))`, the HUD under it hides; on touch its words name the tap (✕); past ~640 px tall it scrolls.
- World panels: WORDS on a thing are big letters on the bare material (`<div face="front" width="1.6m" style="font-size:140px">HIGH TOWN</div>`, in one colour the material is not). A PANEL (readouts, buttons) is a FLOATING PLATE: a root with no background and a margin holds a soft-edged plate in its place's material. A SCREEN the ui draws (an arcade game) is `material.canvas`.
- A plate that FOLLOWS a thing (nameplate, marker) is HUD HTML with `data-world-anchor="<id>"`: atop its body, or at `data-anchor-offset="x y z"` metres from its feet; `--anchor-depth` is metres away for a CSS fade.
- `data-modal` = "this surface owns the screen" (dialog, story card, opened bag or shop), one at a time: the cursor frees while it stands and relocks after; its siblings dim, unclickable; one title bar, the card's. A bar always shown carries none. Invisible still catches clicks and costs an iPhone a screen-sized layer: panel-less backdrop, idle hit marker or spent intro is `visibility:hidden`.
- An icon is a painted picture: one `spawn paint "<what>" --size 1024x1024` per icon, each `<img>` slot-sized; an inline `<svg>` is the glyph a creator wants flat or hand-drawn (one `<symbol>` set, `<use>` per slot); a texture script is an image (`<img src="scripts/tex-icons.js?slot=heart">`). Sound never lives in HTML, nor its settings but one mute.
- `ctx.view.site` (`"x.com"` on X, `""` unnamed): fit the frame, no mouse lock.
- Microphone and camera (`getUserMedia`), `SpeechRecognition` and `navigator.geolocation` share the platform's ask (surface its reject or error); never gate on `track.muted`.

<api> // ui.js's page side; in the render ctx.self is the body's handle (player.controlling's while set), ctx.session a plain copy
sendAction(name, payload, { down, relockPointer }) // down true on pointerdown, false on pointerup = a held button; relockPointer = back to mouse-look
ctx.emit("haptic", { kind: "light" }) // a press's buzz, from that action's handler in the player's script: the presser's alone; the Spawn app and a controller buzz, a phone browser never
sendAxis(name, value) // into input.axes.<name>
openLink(url) // opens discord.gg or spawn.co, confirmed, ≤3/min; any other URL is copyable text; a download never starts
onMount(container, player) / onDestroy(container) // container = #tome-game-mount, empty viewport-wide pointer-events-none layer beside the render's #tome-ui-container: getElementById finds render nodes
audio.context, audio.bus("UI" | "SFX" | "Music"), audio.buffer(ref) // in onMount: the HUD's own WebAudio graph (a press tick is an oscillator) into the bus, under the rail dials
window.spawn.assets.upload({ blob, name }): { url } // a player's <input type="file"> or image/audio/video bytes (GLB if .isEditor) become a /cdn/ url to store, never base64; the game's link with `?card=<url>` unfurls as that picture; e.code guest_not_allowed, rate_limited (wait e.retryAfterSeconds when set)
window.spawn.user.upgradeGuest() // Spawn's sign-in
window.spawn.view.captureFrame({ type, quality, maxSize, camera?: ViewCamera }): Blob // screenshot/photo, no HUD; code capture_unavailable = no frame yet
navigator.mediaDevices.getDisplayMedia({ audio: true }) // that view and sound; no picker, screen or system audio; preferCurrentTab adds UI
window.spawn.chat.sharePicture({ blob, scope }): { url, width, height } // the player's picture, checked by Spawn, said as them in chat or a chat.js scope; paint url with <img>, never a copy; refused: code rejected, message for the player
window.spawn.on("event", (name, payload) => …) // in onMount: each ctx.emit("uiEvent", { name, payload }) once: an effect, never a persisted value; onDestroy calls the returned unsubscribe
data-interactive // marks a custom element clickable (buttons, links, inline handlers are)
spawn-canvas // one element, the game's viewport: its box alone gets the picture's resolution; no transform, clip or pointer events; backdrop: box-shadow 0 0 0 200vmax #000
ctx.worldToScreen(position): { x, y, depth, onScreen } | null // one-shot placement at a static point; null off-client
ctx.world.engine.ui.referenceHeight: number // the window height the HUD was designed on (1080); fixes a HUD huge or tiny
ctx.self.inputHeld: boolean // true while Spawn's chat, menu or held Tab has the keyboard; a clock or gamepad read standing still then reads it in the render or body script
navigator.getGamepads(), navigator.languages // ui.js only: each controller apart
var(--spawn-safe-area-top|right|bottom|left, 0px) // notch insets on html
var(--spawn-touch-corner-band-height, 0px) // bottom-right touch buttons' height over the safe-area bottom; the stick owns bottom-left
</api>