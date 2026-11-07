# Spawn reference: master index

This tree is a local, read-only copy of what Spawn exposes for the game `@lanmower/game-6`: the Tome game API as served for world `26f64424-cc19-43af-a9c3-666e4559bb05`, the per-world skills, the engine 6.0.0 source docs, the `spawn` CLI help and output, the HTTP door catalog, and the local AGENTS.md digest. It was assembled by GET-only jobs. Nothing here was written back to Spawn, and no game file was changed.

Before relying on any file, read the identity caveat in [COVERAGE.md](COVERAGE.md#world-identity-unresolved). World `26f64424-...` is @lanmower/the-savi-gallery ("The Savi Gallery"), confirmed by lanmower. Its served Tome and skills are this world's.

## How to use this reference

1. Start with the start-here list below. It names the 15 files to read first.
2. Go to an area section, then its INDEX. Each INDEX lists every file with its size and headings.
3. Check [COVERAGE.md](COVERAGE.md) before assuming something is documented. It gives expected against found for each area and lists every gap the jobs reported.
4. Treat `http/raw/` as sensitive. The job that captured it reports that the `social-me`, `notifications`, `invites` and `me` bodies contain personal fields. Read the door files in `http/` instead, and do not copy raw bodies into shared output.
5. Do not add tokens or personal data to this tree. The token is read from `/config/.spawn/token` only when a job needs it.

## Start here (15 files)

1. [guide/AGENTS-digest.md](guide/AGENTS-digest.md): the world's own rules for the tree, pushes, publishing and the page.
2. [engine/README.md](engine/README.md): engine 6.0.0 vocabulary.
3. [engine/skills.md](engine/skills.md): the engine's skill index.
4. [engine/spawn-engine.md](engine/spawn-engine.md): how to use the Spawn engine.
5. [engine/api-reference.md](engine/api-reference.md): the full engine API reference (about 117 KB).
6. [tome/INDEX.md](tome/INDEX.md): the Tome API index, with 68 distinct headings.
7. [tome/sections/spawn-game-api.md](tome/sections/spawn-game-api.md): the Spawn game API overview.
8. [tome/sections/behavior-hooks.md](tome/sections/behavior-hooks.md): behavior hook signatures.
9. [tome/sections/state.md](tome/sections/state.md): state scopes.
10. [tome/sections/self.md](tome/sections/self.md): `ctx.self`.
11. [skills/INDEX.md](skills/INDEX.md): the 23 served per-world skills.
12. [skills/spawn-engine.md](skills/spawn-engine.md): the served engine skill.
13. [cli/INDEX.md](cli/INDEX.md): the `spawn` CLI reference.
14. [cli/client.txt](cli/client.txt): the `spawn client` verbs.
15. [http/CATALOG.md](http/CATALOG.md): the HTTP door catalog, with 17 doors called and 53 documented but not exercised.

## Areas

### Tome API (game API as served)

- Index: [tome/INDEX.md](tome/INDEX.md). 69 section files in `tome/sections/`, covering 68 distinct headings. `World Queries` appears twice and both copies are kept.
- Full text: [tome/all.md](tome/all.md), with the raw JSON in [tome/raw-all.json](tome/raw-all.json).
- Guide: [tome/guide.md](tome/guide.md), with the raw JSON in [tome/raw-guide.json](tome/raw-guide.json). See the identity caveat above.

### Skills (per-world, served)

- Index: [skills/INDEX.md](skills/INDEX.md). 23 skills, each with a `.md` body and a `.json` record.

### Engine 6.0.0 (source docs)

- Index: [engine/INDEX.md](engine/INDEX.md). 27 files: the engine README, `skills.md`, `api-reference.md`, 23 skill guides and the index.
- Pinned in `.spawn/engine.yaml` at semver 6.0.0. The clone is shallow, `--depth 1`.

### CLI (`spawn`)

- Index: [cli/INDEX.md](cli/INDEX.md). 39 files: top-level help, the verbs `events`, `api`, `numbers`, `mod`, `preview`, `bring` and `login`, 12 `client` verbs, and the `api` type shapes.

### HTTP doors

- Catalog: [http/CATALOG.md](http/CATALOG.md). 70 rows built from the 60 `me.doors` keys, 6 docs-only doors and 4 read/write variants.
- Per-door files: 18 in `http/`, one per exercised or documented door group.
- Raw bodies: 33 files in [http/raw/](http/raw/). Sensitive, see the note above.

### Guide (local AGENTS.md)

- Digest: [guide/AGENTS-digest.md](guide/AGENTS-digest.md). The digest of `/workspace/game-6/AGENTS.md` (119 lines), with the local-versus-served diff.
- Served guide: [guide/served-guide.md](guide/served-guide.md) and [guide/served-guide.guide.txt](guide/served-guide.guide.txt). These describe `@lanmower/the-savi-gallery`, not game-6.

## Totals

208 indexed files: tome 74, skills 47, engine 27, cli 39, http 18 (plus 33 raw bodies), guide 3. Details and gaps are in [COVERAGE.md](COVERAGE.md).

## Added after the first build

- [CHANGELOG.md](CHANGELOG.md): the pulls, the corrections, and the engine pin change, dated.
- [LESSONS.md](LESSONS.md): Spawn quirks and gm run friction found while building this reference.
- [guide/AGENTS-current.md](guide/AGENTS-current.md): the current AGENTS.md (game clone at b405304). Use this in place of guide/AGENTS-digest.md, which is from an older commit.
- cli/types/: all 305 API type shapes, one file each. The name list is cli/types/_names.txt.
- Identity: the world is @lanmower/the-savi-gallery, "The Savi Gallery", confirmed by lanmower. The game-6 path still resolves; use the-savi-gallery in new work.
