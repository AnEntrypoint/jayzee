# Controlled 1024 run: host CPU sharing, measured

Question. Is host CPU sharing the cause of the 1024-tier long-frame stalls? The question and its predictions were fixed in docs/PENDING_VALIDATION.md before any run, in the section "Controlled 1024 run: pause and pinning (Phase A, pre-registered before any run)".

Setup. Host: AMD Ryzen 7 6800H, 8 cores, 16 logical CPUs, 15 GiB RAM. The project browser ran WebGPU on the NVIDIA GeForce RTX 3060 Laptop GPU (not a fallback adapter). Each run was engine-render.html with phase=10, tier=1024 and timed=1, one page at a time, 540 frames. The samplers ran on CPU 15.

Conditions. PAUSED runs SIGSTOPped the foreign CPU-heavy jobs of other projects (/workspace/fx and /workspace/gm) and resumed them after each run. Every paused process was back in state R after its run (see stateResumed in each run.json). The foreign set is not fixed: new worker processes start every few seconds, so the pause set was re-selected before each attempt. A PAUSED run is refused when the host busy share in the second after pausing is above 0.2. In the first matrix (controlled-1024) three of nine runs were refused by that gate (r1-P, r3-P, r3-U). The retry job (controlled-1024-retry) re-selected the set and all three passed on their second or third attempt. LIVE runs paused nothing and ran under the co-tenant load as it was.

Results, three valid runs in each cell. Stall frame means a frame above 1.5 times its run's median. Wait share is run-queue wait as a fraction of the stall time, from the renderer main thread's schedstat.

| Cell | Stall frames per run | Total | Stall time (ms) | Wait share | Median frame (ms) | p99 frame (ms) | External busy (median) |
|---|---|---|---|---|---|---|---|
| LIVE unpinned | 0, 2, 1 | 3 | 233.5 | 0.031 | 49.2 | 64.6 | 0.251 |
| PAUSED unpinned | 1, 0, 0 | 1 | 97.8 | 0.016 | 46.7 | 58.1 | 0.135 |
| PAUSED pinned 0-7 | 12, 0, 0 | 12 | 884.0 | 0.008 | 44.3 | 53.3 | 0.076 |

Every stall in every cell is classed cpu-bound: the renderer main thread was on CPU for 96 to 99% of each stall. In the pinned run r1-P the run time of its 12 stalls was 876 ms of 884 ms.

Pre-registered verdicts, from build/diag/controlled/report.json.
- cpuSharing: "partly: stalls rise with co-tenant load, but their time is not mostly run-queue wait".
- pinning: "pinning adds stall frames".

Predictions.
- P1 (co-tenant load raises stalls): holds in direction only. LIVE has 3 stall frames against 1 for PAUSED unpinned. Three runs per cell cannot separate those counts.
- P2 (at least 25% of LIVE stall time is run-queue wait): fails. The LIVE wait share is 0.031.
- P3 (pinning changes stall frames in PAUSED runs): holds, in the adding direction, but all 12 pinned stall frames come from one run (r1-P). r2-P and r3-P had none. No pinned run had fewer stalls than the unpinned cell.

Conclusion. The stalls are the renderer's own on-CPU time, not scheduler wait. Host CPU sharing in its run-queue form, which is what this probe can measure, is not supported. The earlier recorded cause, host CPU sharing, is therefore not proven, and this run argues against its wait form. Pinning is not a fix: one of three pinned runs added 12 stall frames, and none reduced them. No code change is made, and pinning is not adopted.

Not tested. Two on-CPU explanations stay open: a shared physical core (load on an SMT sibling stretches the thread's run time) and a lower CPU clock. Either one needs per-CPU frequency and sibling busy share sampled through each stall. Until that is done, the cause of the 1024 stalls is open, and no fix is verified.

Witness. build/diag/controlled/report.json (copied to docs/stall-causes/controlled-1024-report.json) is the output of scripts/browser/controlled-report.mjs over the nine valid runs. Each pinned run.json has pinApplied true. The gate scripts/check-controlled-run.mjs passes.
