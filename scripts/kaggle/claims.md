## Physics claim per Kaggle machine class

Written by `node scripts/kaggle/claims.mjs` from the result files of `heclgang/jayzee-physics-goalpost` named below. A row holds when every repeat has zero ticks over 16.7 ms and a p99 at or under it, warmed, 900 ticks, the whole worker tick timed. The unbudgeted reference is the build before the awake budget, with every body awake from tick 0. The class is vendor, family, model and stepping from /proc/cpuinfo.

### GenuineIntel-6-79-0 (Intel(R) Xeon(R) CPU @ 2.20GHz)

- Kernel versions: 16. 2 cores, 4 threads, 2199.998 MHz, L2 512 KiB (2 instances), L3 55 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 635.7 ms, memory chase 222 ms, four lanes at once cost 0.984 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | peak awake | last awake tick | holds |
|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | candidate, awake budget 6144 | 4 | 3 | 13.524 | 13.848 | 19.199 | 0, 1, 2 | 6144 | 209 | no |
| 12288 | candidate, every body awake | 1 | 1 | 37.215 | 37.215 | 40.872 | 83 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 2 | 1 | 26.212 | 26.212 | 32.239 | 72 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 4 | 1 | 17.775 | 17.775 | 22.115 | 16 | 12288 | 144 | no |
| 12288 | unbudgeted reference | 4 | 3 | 20.019 | 20.664 | 25.818 | 20, 7, 32 | 0 | 0 | no |
| 16384 | candidate, awake budget 6144 | 4 | 3 | 12.74 | 16.377 | 19.58 | 0, 0, 6 | 6144 | 254 | no |
| 16384 | candidate, every body awake | 4 | 1 | 29.94 | 29.94 | 36.75 | 84 | 16384 | 145 | no |
| 16384 | unbudgeted reference | 4 | 3 | 27.864 | 28.272 | 35.668 | 75, 73, 85 | 0 | 0 | no |
| 20480 | candidate, awake budget 6144 | 4 | 3 | 16.234 | 22.749 | 35.276 | 6, 0, 25 | 6144 | 296 | no |

