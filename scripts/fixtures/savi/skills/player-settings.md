# Player Settings

Players own their settings: sound levels (kept per game), accessibility protections, perf preference, control overrides, and every game's keys and pad, rebound in Settings › look › keys; no cap reaches them. On the player's press (ctx.self), `ctx.emit("openSettings", { page: "keys" })` opens that page and `"openAvatarEditor"` their avatar editor (a wardrobe). A game shapes the STARTING experience and bounds what its design can survive; it never overrides a choice a player made. `defaults` speak only for players who never chose; `caps` bound only the families where the creator holds design authority, never graphics quality. A creator wanting high sets their own: the rail's Settings → screen → quality re-tiers their renderer to it, terrain reach included; phones and tablets stop at what they measured, and late frames still lower resolution beneath it. Accessibility is safe-direction only, by law: nothing you write can force flashing on a photosensitive player.

```js
// run_script: a dot write saves it (world.config.yaml engine.playerSettings); patch only the keys you change, null clears one
ctx.world.engine.playerSettings.defaults.accessibility.reduceFlashing = true; // a strobe-heavy game ships photosensitive-safe; players may still turn it off for themselves
ctx.world.engine.playerSettings.caps.controls.lookSensitivity = false; // this game's cutscene camera ignores the player's sensitivity override
ctx.world.engine.playerSettings.caps.controls.lookSensitivity = null; // remove the lock; the rest of the policy survives
```

<api>
engine.playerSettings.defaults.accessibility: { reduceFlashing, reduceMotion } // true only. false answers "playerSettings.defaults.accessibility.reduceFlashing may only be true: a creator can pre-enable a protection, never disable one (players own accessibility)". Tell the creator why; there is no other path
engine.playerSettings.caps.accessibility // never legal: no creator may bound a player's accessibility protections
engine.playerSettings.caps.controls: { lookSensitivity, invertY } // booleans, both honored by default: whether the player's override applies in this game; disable one only when it breaks the design. Values live where they always did: camera and inputs
defaults.sound, defaults.controls, defaults.perf, caps.perf // not creator surfaces: the mix is authored in audio and composes under the player's sliders; sensitivity and bindings are camera and inputs; quality is the player's: a game slow on phones is made cheaper in its content, never pinned to a level
a refused field is dropped with a warning in the run result and getLogs; the legal keys beside it apply // a default that "isn't applying" means the player already chose: nothing to fix. Policy is per game, never a player's own preference written for everyone
</api>