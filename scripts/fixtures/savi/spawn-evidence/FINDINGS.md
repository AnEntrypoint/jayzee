# Spawn-side findings (local read-only probes)

Written by spawn, 2026-11-07, for savi. Spawn has no git repo; nothing here is committed or pushed. Each claim below names its witness. Scope words are literal: SCOPED means the stated sample, not the corpus.

## Denominators (keep separate)
- 399 worlds: the /cdn/ GLB family (maps/glb-urls-all.tsv, 2416 rows, 2355 unique sha256). A LOWER BOUND for /cdn/ only.
- 2848 feed worlds: scanned for spawnfile refs, 0 found (data/feed-worlds.json; probe-scripts/scan-spawnfile.mjs; sf output in the run log).
- 256 worlds with head.json 404 (maps/head404-confirmed-worlds.txt). 3 more with head 200 and manifest 404 (maps/head-present-manifest404-worlds.txt).
- 2580 distinct manifests from the cdn-scan jsonl (data/cdn-scan-*.jsonl). This is the manifest-verification denominator, not the world denominator.

## Witnessed
- Manifest layout: a u32BE length, then the sheet JSON {"v":1,"hashes":[...]}, then u32BE-length JSON frames to EOF. Frame count equals hashes count, and frame i sha256 equals hashes[i] for 2579 of 2580 reached manifests (one exception, see the last section). Witnesses: maps/witness/manifest-chain.mjs, manifest-hashmatch.mjs, manifest-order.mjs, manifest-check.mjs. SCOPED to 3 manifests plus a 40-manifest sample (maps/witness/manifest-sample40/, 40 files, all chain EOF, 2961 frames = 2961 hashes). The full run over 2580 manifests is in data/manifests-all-results.jsonl (see its summary section below).
- resolve-adventure (GET /api/resolve-adventure?address=): found and not_found return 200 JSON. Empty or missing address returns 400 {"ok":false,"error":"Invalid query"}. Trailing slash returns 308 to the bare route, http returns 308 to https, the apex host returns 307 to www; each has body "Redirecting...". Bodies: maps/witness/ra-*.body and rb-*.body. Gone (410) NOT reached in 30 probes: OPEN.
- Name encoder, direction '/' to '~2f': witnessed on 307 distinct world.assets keys (encode(decode(key)) === key for all). The only escape present is ~2f. probe-scripts/encoder-test.mjs. ':' to '~3a' is witnessed only in savi FAULTS.md (spawnfile key), not in the probes. '~' to '~7e' has no witness.
- OPEN-013 identifiers: the two non-CDN refs appear under two identifiers, the world_uuid_nodash column and the sha256 column (maps/unverified-noncdn-refs.tsv lines 22 and 37). Not a discrepancy.
- Live page probe (lanmower/deepfall play page, 25 s): 30 matched requests to spawnfile/bigspawn hosts (play.bigspawn.net, www.spawn.co, rqr3rdr46-playco.spawnfile.io, blob: under it), glbLike empty. ONE page, filter /spawnfile|bigspawn/ only.

## Negative results
- Bucket <xx> rule: 298 distinct (xx, sha256, ext) pairs, 135 buckets. Eight name and sha hypotheses hit 0-2 times, at chance (about 1.2 each). Frame-level tests over 279 keys: 0 for frame body, whole frame, key text and value bytes. World-uuid prefix: 0 of 16. Scripts: probe-scripts/bucket-test.mjs and bucket-test3.mjs. The hypothesis set is not exhaustive. Stays UNDETERMINED.
- Spawnfile key reconstruction: FAULTS F3 elides the middle of the key, so no full key can be formed. Four bounded probes: spawnfile.io root 200 text/html; /prod/character-assets/ 404; /prod/character-assets/savi-reduced-fitted.glb 404 (empty-elision hypothesis); rqr3rdr46-playco.spawnfile.io root 200 text/html. No model bytes or glTF magic.

## Still OPEN (not promoted)
- Spawnfile key path: ELIDED in savi FAULTS F3.
- spawnfile.io bytes: UNCONFIRMED. No response returned model bytes.
- /cdn/-only host (every GLB served only from play.spawn.co/cdn/): INFERRED.
- resolve-adventure gone (410): not reached in 30 probes.
- Bucket <xx> rule: UNDETERMINED (negative as above).
- Name encoder for ':' and '~': not witnessed in the probes.
- Non-CDN refs: 83 rows, 81 HEAD 200 on retry, 1 ttf 401, 1 mp4 connect timeout (open).
- Head drift: one case observed. World 41cd46499614484ca9261ce32e257e22 head.json names manifest 3fa9a434...; re-checked 2026-11-07 with repeat GETs, manifests/3fa9a434... returns 200 application/octet-stream, 513116 bytes, so the earlier 404 unknown_world_store_key is NOT reproduced. The condition that selected that error is OPEN, because the saved bodies hold only error text with no URL. The scanned manifest 5a526ee6... still returns 200. The key reproduces only for a misspelled resource name under the same world: GET .../git/41cd46499614484ca9261ce32e257e22/head.jsn returns 404 application/json 35 bytes {"error":"unknown_world_store_key"}, and the control head.json returns 200 1673 bytes. A single observed case, not a rule.

## Manifest verification over all 2580 distinct manifests (COMPLETE)
Run: probe-scripts/verify-all-manifests.mjs, 12-way concurrency, 30 s timeout, up to 3 attempts. The job was killed once by the gm job monitor at 1343 rows (no stdout progress) and resumed from results.jsonl, which the script reads for done keys. Raw: data/manifests-all-results.jsonl (2580 lines).
Counts: rows 2580; distinct manifests 2580; HTTP 200 2580; non-200 0; network errors 0; chain ends exactly at EOF 2580; frames == hashes 2580; ordered (frame i sha256 == hashes[i]) 2579; sheet-membership (every frame sha256 in hashes) 2579; parse errors 0. Totals: 229921 hashes, 229921 frames, 566376956 bytes.
One exception: manifest d048ad0665b46944dea920d8daed8dbe85874fb4a9d8809339e88223cd853fca (GET https://play.spawn.co/world-store/manifests/d048ad06..., HTTP 200, 5804 bytes). Its sheet lists 3 hashes. Frames 0 and 1 are JSON and match hashes[0] and hashes[1]. Frame 2 is 175 bytes of non-JSON binary whose sha256 0016de86... is not in the sheet, so ordered and membership fail for that frame only. Chain still ends exactly at EOF. Not interpreted; kept as an exception.
Scope: this is a verification of all 2580 manifests that were reached by HTTP 200. It is not a claim about the 399-world denominator. The 399 and 2580 denominators are separate. The manifest-structure claim is witnessed on all 2580 reached manifests with the one exception above, so the corpus-wide claim is "2579 of 2580 fully match, 1 has a non-JSON frame 2".
