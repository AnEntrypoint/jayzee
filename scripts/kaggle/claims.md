## Physics claim per Kaggle machine class

Written by `node scripts/kaggle/claims.mjs` from the result files of `heclgang/jayzee-physics-goalpost` named below. A row holds when every repeat has zero ticks over 16.7 ms and a p99 at or under it, warmed, 900 ticks, the whole worker tick timed. The unbudgeted reference is the build before the awake budget, with every body awake from tick 0. The class is vendor, family, model and stepping from /proc/cpuinfo.

### AuthenticAMD-23-49-0 (AMD EPYC 7B12)

- Kernel versions: 15. 2 cores, 4 threads, 2249.998 MHz, L2 1 MiB (2 instances), L3 16 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 502.1 ms, memory chase 167.9 ms, four lanes at once cost 1.017 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | candidate, awake budget 6144 | 4 | 3 | 11.537 | 11.974 | 14.039 | 0, 0, 0 | 3 of 3 | 6144 | 209 | yes |
| 12288 | candidate, awake budget 8192 | 4 | 3 | 15.333 | 16.289 | 23.242 | 0, 1, 7 | 1 of 3 | 8192 | 192 | no |
| 12288 | candidate, awake budget 8192, sleep 0.25 | 4 | 3 | 14.22 | 15.045 | 18.581 | 1, 1, 0 | 1 of 3 | 8192 | 133 | no |
| 12288 | candidate, every body awake | 4 | 3 | 19.658 | 19.874 | 21.563 | 33, 39, 36 | 0 of 3 | 12288 | 144 | no |
| 12288 | candidate, every body awake, asleep 1 | 4 | 3 | 0.118 | 0.123 | 1.013 | 0, 0, 0 | 3 of 3 | 0 | -1 | yes |
| 12288 | candidate, every body awake, sleep 0.15 | 4 | 3 | 16.381 | 16.53 | 18.779 | 5, 6, 6 | 0 of 3 | 12288 | 76 | no |
| 12288 | candidate, every body awake, sleep 0.25 | 4 | 3 | 17.187 | 17.783 | 23.259 | 16, 14, 12 | 0 of 3 | 12288 | 106 | no |
| 12288 | unbudgeted reference | 4 | 3 | 19.896 | 19.913 | 22.248 | 38, 37, 38 | 0 of 3 | 0 | 0 | no |
| 16384 | candidate, awake budget 6144 | 4 | 3 | 11.967 | 12.177 | 13.287 | 0, 0, 0 | 3 of 3 | 6144 | 254 | yes |
| 16384 | candidate, awake budget 8192 | 4 | 3 | 15.356 | 17.613 | 24.513 | 13, 3, 1 | 0 of 3 | 8192 | 200 | no |
| 16384 | candidate, awake budget 8192, sleep 0.25 | 4 | 3 | 15.186 | 15.299 | 21.723 | 1, 4, 0 | 1 of 3 | 8192 | 144 | no |
| 16384 | candidate, every body awake | 4 | 3 | 25.99 | 27.475 | 31.536 | 78, 79, 82 | 0 of 3 | 16384 | 145 | no |
| 16384 | candidate, every body awake, asleep 1 | 4 | 3 | 0.13 | 0.176 | 1.722 | 0, 0, 0 | 3 of 3 | 0 | -1 | yes |
| 16384 | candidate, every body awake, sleep 0.15 | 4 | 3 | 20.876 | 21.103 | 23.648 | 53, 55, 57 | 0 of 3 | 16384 | 76 | no |
| 16384 | candidate, every body awake, sleep 0.25 | 4 | 3 | 21.582 | 22.583 | 24.047 | 60, 60, 62 | 0 of 3 | 16384 | 83 | no |
| 16384 | unbudgeted reference | 4 | 3 | 25.472 | 25.622 | 27.637 | 79, 79, 79 | 0 of 3 | 0 | 0 | no |

### GenuineIntel-6-79-0 (Intel(R) Xeon(R) CPU @ 2.20GHz)

- Kernel versions: 16, 17, 18, 19. 2 cores, 4 threads, 2199.998 MHz, L2 512 KiB (2 instances), L3 55 MiB (1 instance), avx512 no, cgroup cpu.max 400000 100000.
- Calibration: single thread 575.4 ms, memory chase 190.2 ms, four lanes at once cost 1.034 times one lane.

| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 12288 | candidate, awake budget 4096 | 4 | 9 | 5.842 | 7.321 | 10.455 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | 9 of 9 | 4096 | 262 | yes |
| 12288 | candidate, awake budget 5120 | 4 | 9 | 7.107 | 10.478 | 14.525 | 0, 0, 0, 0, 0, 0, 0, 0, 0 | 9 of 9 | 5120 | 226 | yes |
| 12288 | candidate, awake budget 6144 | 4 | 12 | 8.972 | 13.848 | 21.507 | 0, 1, 2, 0, 0, 0, 1, 0, 0, 3, 0, 0 | 8 of 12 | 6144 | 209 | no |
| 12288 | candidate, every body awake | 1 | 4 | 33.639 | 37.215 | 40.872 | 83, 80, 79, 79 | 0 of 4 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 2 | 4 | 20.492 | 26.212 | 32.239 | 72, 39, 34, 19 | 0 of 4 | 12288 | 144 | no |
| 12288 | candidate, every body awake | 4 | 4 | 15.376 | 17.775 | 22.115 | 16, 0, 0, 1 | 2 of 4 | 12288 | 144 | no |
| 12288 | unbudgeted reference | 4 | 12 | 15.851 | 20.664 | 25.818 | 20, 7, 32, 7, 6, 1, 1, 2, 0, 6, 0, 0 | 3 of 12 | 0 | 0 | no |
| 16384 | candidate, awake budget 4096 | 4 | 9 | 7.137 | 8.769 | 41.945 | 1, 0, 0, 0, 0, 0, 0, 0, 0 | 8 of 9 | 4096 | 350 | no |
| 16384 | candidate, awake budget 5120 | 4 | 9 | 7.121 | 11.098 | 19.815 | 0, 0, 0, 1, 0, 0, 0, 0, 0 | 8 of 9 | 5120 | 293 | no |
| 16384 | candidate, awake budget 6144 | 4 | 12 | 9.035 | 16.377 | 19.58 | 0, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0 | 11 of 12 | 6144 | 254 | no |
| 16384 | candidate, every body awake | 4 | 4 | 20.913 | 29.94 | 36.75 | 84, 51, 42, 28 | 0 of 4 | 16384 | 145 | no |
| 16384 | unbudgeted reference | 4 | 12 | 21.062 | 28.272 | 39.299 | 75, 73, 85, 60, 41, 37, 46, 62, 50, 28, 19, 29 | 0 of 12 | 0 | 0 | no |
| 20480 | candidate, awake budget 4096 | 4 | 6 | 6.827 | 9.461 | 12.779 | 0, 0, 0, 0, 0, 0 | 6 of 6 | 4096 | 413 | yes |
| 20480 | candidate, awake budget 6144 | 4 | 6 | 14.093 | 22.749 | 35.276 | 6, 0, 25, 0, 0, 0 | 4 of 6 | 6144 | 296 | no |

