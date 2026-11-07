## builtin/vibe

Export pattern(ctx) from the audio script. ctx.params holds the audio parameters; set tempo with ctx.setBpm(n), ctx.setCps(n), or ctx.setSwing(amount). The default bus is Music. gain ranges from 0 to 2; 0 is silent and paused: true stops the transport. Sample names are listed at /cdn/vibe-samples/manifest.json.

```ts
audio: { kind: "vibe", script, params, gain, bus, paused }
<entity>.audio.params.<name> = v
ctx.getVibeAudio(id): { playing, bpm, bar, barPos, beat, beatPos, cycle, cyclePos, voices: [{ sample, channel, gain, kind }], triggers: [{ sample, when, ageSec }] } | null
export function pattern(ctx): Pattern | null
export function on(name, fire, payload)
note(pattern), s(pattern), stack(...patterns), seq(...patterns), silence(), mini`…`
.s(bank) .gain(g) .pan(p) .lpf(hz) .hpf(hz) .fast(n) .slow(n) .every(n, fn) .swing(a) .humanize(a) .rate(r) .prob(p) .room(0..1) .reverbBus("plate" | "hall") .delaytime(s) .delayfeedback(f) .delayxfeed(x) .delaylpf(hz) .drive(d) .crush(bits) .grain(true) .attack .decay .sustain .release .channel(name)
.scale(factor) vs .when(cond)
arrange([cycles, pattern], …)
scale(key, degrees), progression(romans, key), arp(chords, "up" | "down" | "updown" | "random"), chord(name, octave = 3)
clamp01(x), lerp(a, b, t), smoothstep(e0, e1, x), above(threshold, x, fade = 0.05), below(threshold, x, fade = 0.05), between(lo, hi, x, fade = 0.05), mapRange(x, inMin, inMax, outMin, outMax)
banks: .s() takes a name exactly as the manifest spells it (/cdn/vibe-samples/manifest.json): pitched vsco_{piano,piano_alt,harp,glock,xylo,marimba_loud,cellos,cellos_{spicc,sus_vib,trem},violins_{pizz,spicc,sus_vib,trem},violin_{pizz,spicc,trem,vib},violas_{pizz,spicc,sus_vib,trem},contrabass_{pizz,spicc,sus_nv,sus_vib,trem},flute,flute_{stac,sus_nv,sus_vib},piccolo_{stac,sus},oboe,oboe_{sus,vib},clarinet,clarinet_stac,bassoon_{stac,sus,vib},horn_{mute,stac,sus},trumpet_{stac,sus,sus_vib,harmonmute,strmute},trombone_{stac,sus,vib},tuba_{stac,sus}} (each has a pitch range: transpose or switch, never shift past an octave), synths sawtooth square sine triangle, one-shots bd_* sn_* hat_* ride_* drum_* elec_* perc_* tabla_* glitch_* bass_* guit_* ambi_* loop_* vinyl_* vsco_{organ,timpani} (the manifest lists each); the short words bd sn hh cp kick snare hat clap ride tom piano pad bass bell pluck resolve; an instrument word alone (violins, harp) is a silent voice and a vibe.sample.unknown DM
```
