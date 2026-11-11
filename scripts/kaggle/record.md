## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 38. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T22:34:45.115Z. Queue wait 7 s from the push to the first line of the script. Run time 608.6 s for 58 of 58 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 2); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.422 | 10.824 | 32.632 | 1 | 8.3 / 7.77 | 13.324 | 32.632 | 1 | 6.419 | 8.485 | 0 | 278248248 | 668400144 | 1239.4 | 987.5 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.319 | 9.763 | 11.716 | 0 | 7.94 / 4.76 | 10.902 | 11.716 | 0 | 6.349 | 8.43 | 0 | 278248248 | 668400144 | 1131.7 | 1037.2 | 9.2 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.627 | 11.303 | 44.303 | 2 | 8.12 / 4.73 | 12.385 | 44.303 | 1 | 6.645 | 9.004 | 1 | 278248248 | 668400144 | 1245.5 | 1071.9 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.627 | 11.97 | 19.217 | 1 | 8 / 4.71 | 12.901 | 19.217 | 1 | 6.701 | 8.869 | 0 | 278248248 | 668400144 | 1150.7 | 1002.9 | 9.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.463 | 11.153 | 51.366 | 2 | 8.36 / 5.08 | 15.386 | 51.366 | 2 | 6.459 | 8.298 | 0 | 278248248 | 668400144 | 1156.8 | 1062.3 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.284 | 10.553 | 42.85 | 1 | 7.96 / 4.74 | 10.553 | 42.85 | 1 | 6.358 | 10.731 | 0 | 278248248 | 668400144 | 1138.3 | 1076.8 | 9.3 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.375 | 10.784 | 30.322 | 1 | 8.01 / 4.78 | 9.395 | 30.322 | 1 | 6.495 | 11.331 | 0 | 278248248 | 668400144 | 1210.9 | 1050.8 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.385 | 10.917 | 14.704 | 0 | 8.21 / 4.66 | 9.312 | 14.704 | 0 | 6.471 | 11.221 | 0 | 278248248 | 668400144 | 1149.8 | 1018.5 | 9.4 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.359 | 11.209 | 14.839 | 0 | 8.05 / 4.48 | 8.819 | 11.19 | 0 | 6.455 | 11.972 | 0 | 278248248 | 668400144 | 1252.5 | 1010.1 | 9.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.441 | 10.853 | 12.925 | 0 | 8.11 / 4.77 | 9.381 | 12.669 | 0 | 6.572 | 11.369 | 0 | 278248248 | 668400144 | 1151.8 | 1020.5 | 9.4 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 11.057 | 16.844 | 42.811 | 10 | 9.69 / 6.15 | 12.751 | 42.811 | 1 | 11.709 | 17.475 | 9 | 278248248 | 668203536 | 1155.1 | 980.1 | 13.5 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.722 | 12.584 | 15.499 | 0 | 8.68 / 5.32 | 11.685 | 12.584 | 0 | 8.827 | 13.459 | 0 | 278248248 | 668269072 | 1175.5 | 1007.2 | 11.4 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.485 | 10.933 | 33.248 | 1 | 8.47 / 5.45 | 13.449 | 33.248 | 1 | 7.509 | 9.486 | 0 | 278248248 | 668334608 | 1159.6 | 1054.4 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 6.566 | 10.793 | 16.911 | 1 | 8.14 / 4.78 | 14.752 | 16.911 | 1 | 6.623 | 8.713 | 0 | 278248248 | 668531216 | 1190.3 | 1012.3 | 9.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 8.068 | 13.263 | 21.793 | 2 | 8.79 / 5.58 | 16.384 | 21.793 | 2 | 8.172 | 10.081 | 0 | 278248248 | 668400144 | 1270.5 | 1024.9 | 11 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 6.604 | 12.403 | 30.451 | 2 | 30.45 / 8.59 | 14.493 | 24.783 | 1 | 6.657 | 8.675 | 0 | 278248248 | 668400144 |  | 877.6 | 8.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.799 | 6.436 | 8.255 | 0 | 8.25 / 4.25 | 6.795 | 8.197 | 0 | 0.781 | 1.143 | 0 | 196055280 | 668400144 | 1147.5 | 1032.6 | 4.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.564 | 9.21 | 24.379 | 1 | 7.99 / 4.78 | 8.859 | 24.379 | 1 | 6.604 | 9.213 | 0 | 405657056 | 668400144 | 1239.8 | 1028.2 | 21.9 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.002 | 7.478 | 8.801 | 0 | 8.05 / 4.22 | 7.811 | 8.801 | 0 | 6.01 | 7.374 | 0 | 222472736 | 668400144 | 1213 | 1110.5 | 7.6 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.665 | 6.993 | 7.638 | 0 | 7.56 / 4.21 | 7.084 | 7.638 | 0 | 5.645 | 6.891 | 0 | 222620160 | 668400144 | 1194.5 | 1024.5 | 7.2 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.974 | 9.546 | 11.583 | 0 | 7.53 / 4.38 | 10.18 | 11.072 | 0 | 5.976 | 7.368 | 0 | 222423696 | 668400144 | 1143.9 | 971.5 | 7.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.734 | 9.784 | 15.707 | 0 | 7.46 / 4.17 | 7.188 | 15.707 | 0 | 5.695 | 10.794 | 0 | 222580688 | 668400144 | 1155.8 | 1048.2 | 7.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.28 | 12.216 | 20.612 | 1 | 10.57 / 5.2 | 9.957 | 20.612 | 1 | 7.42 | 13.622 | 0 | 278248248 | 668400144 | 1205.2 | 1044.1 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.308 | 11.944 | 26.809 | 4 | 10.95 / 5.37 | 10.282 | 26.809 | 1 | 7.43 | 13.051 | 3 | 278248248 | 668400144 | 1215.4 | 1065.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 12.404 | 22.878 | 1 | 11.33 / 5.28 | 10.705 | 22.878 | 1 | 7.279 | 13.93 | 0 | 278248248 | 668400144 | 1227.3 | 1021.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.999 | 11.669 | 19.693 | 2 | 10.24 / 5.21 | 9.59 | 19.693 | 1 | 7.161 | 13.042 | 1 | 278248248 | 668400144 | 1271.5 | 1033.2 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.14 | 11.524 | 16.724 | 1 | 10.09 / 5.4 | 9.762 | 10.912 | 0 | 7.181 | 12.385 | 1 | 278248248 | 668400144 | 1214.5 | 1198.5 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.249 | 12.026 | 16.905 | 1 | 10.92 / 5.45 | 9.883 | 11.184 | 0 | 7.314 | 12.539 | 1 | 278248248 | 668400144 | 1197.7 | 968.1 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.175 | 12.54 | 17.415 | 2 | 12.23 / 5.36 | 9.506 | 13.711 | 0 | 7.27 | 12.984 | 2 | 278248248 | 668400144 | 1211 | 1032.9 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.355 | 11.092 | 16.218 | 0 | 10.81 / 5.32 | 9.834 | 15.861 | 0 | 7.468 | 11.55 | 0 | 278248248 | 668400144 | 1218.6 | 1083.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.366 | 12.969 | 19.087 | 2 | 10.95 / 5.49 | 9.786 | 14.713 | 0 | 7.518 | 13.786 | 2 | 278248248 | 668400144 | 1197.6 | 1030.2 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.391 | 11.526 | 15.795 | 0 | 9.96 / 5.56 | 10.397 | 12.112 | 0 | 7.484 | 11.591 | 0 | 278248248 | 668400144 | 1193 | 1059.7 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.447 | 10.931 | 19.141 | 1 | 10.68 / 5.35 | 13.65 | 19.141 | 1 | 7.543 | 9.494 | 0 | 278248248 | 668400144 | 1233.8 | 1067.3 | 10.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.432 | 11.645 | 17.093 | 1 | 11.59 / 5.42 | 14.937 | 17.093 | 1 | 7.519 | 9.709 | 0 | 278248248 | 668400144 | 1218.1 | 1030 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.125 | 12.797 | 17.689 | 2 | 10.91 / 5.63 | 15.073 | 17.689 | 2 | 7.162 | 10.055 | 0 | 278248248 | 668400144 | 1208.6 | 1144.2 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.151 | 11.559 | 19.136 | 1 | 10.79 / 5.48 | 14.385 | 19.136 | 1 | 7.218 | 9.325 | 0 | 278248248 | 668400144 | 1198.1 | 940.7 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.219 | 13.215 | 17.458 | 2 | 11.7 / 5.2 | 14.309 | 17.458 | 2 | 7.312 | 9.918 | 0 | 278248248 | 668400144 | 1188.1 | 1118 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.115 | 12.177 | 25.38 | 1 | 10.97 / 5.35 | 15.402 | 25.38 | 1 | 7.156 | 9.259 | 0 | 278248248 | 668400144 | 1189 | 1017.4 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.527 | 10.064 | 12.999 | 0 | 12.67 / 6.13 | 10.654 | 12.999 | 0 | 7.632 | 9.928 | 0 | 278248248 | 668400144 | 1181.8 | 1017.8 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.217 | 9.397 | 10.79 | 0 | 10.65 / 5.34 | 9.353 | 10.79 | 0 | 7.379 | 9.397 | 0 | 278248248 | 668400144 | 1201.5 | 1119.8 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.598 | 9.979 | 11.026 | 0 | 10.63 / 5.27 | 9.534 | 10.719 | 0 | 7.845 | 10.226 | 0 | 278248248 | 668400144 | 1186.6 | 1029.8 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.339 | 9.676 | 11.912 | 0 | 11.54 / 5.56 | 10.071 | 11.4 | 0 | 7.344 | 9.563 | 0 | 278248248 | 668400144 | 1234.9 | 1223.4 | 10.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.034 | 9.442 | 13.912 | 0 | 10.39 / 5.44 | 9.845 | 13.912 | 0 | 7.067 | 8.817 | 0 | 278248248 | 668400144 | 1283.5 | 961.9 | 10.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.461 | 9.805 | 12.772 | 0 | 10.59 / 5.25 | 9.575 | 12.772 | 0 | 7.59 | 9.805 | 0 | 278248248 | 668400144 | 1277.9 | 966.1 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.295 | 10.294 | 12.088 | 0 | 10.74 / 5.13 | 9.802 | 10.378 | 0 | 7.379 | 10.395 | 0 | 278248248 | 668400144 | 1238.3 | 911.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.328 | 12.766 | 20.92 | 1 | 11.3 / 5.44 | 10.66 | 12.264 | 0 | 7.33 | 13.483 | 1 | 278248248 | 668400144 | 1185.4 | 925.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.435 | 12.463 | 16.77 | 1 | 11.53 / 5.23 | 9.982 | 11.015 | 0 | 7.527 | 14.263 | 1 | 278248248 | 668400144 | 1193 | 892.6 | 10.4 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.267 | 12.82 | 17.257 | 1 | 11.13 / 5.52 | 9.536 | 13.348 | 0 | 7.368 | 13.3 | 1 | 278248248 | 668400144 | 1210.4 | 900.8 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.277 | 12.41 | 17.216 | 1 | 11.24 / 5.48 | 9.3 | 12.403 | 0 | 7.372 | 14.392 | 1 | 278248248 | 668400144 | 1221.6 | 902.4 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.371 | 11.238 | 17.184 | 2 | 10.94 / 5.39 | 9.283 | 11.008 | 0 | 7.503 | 13.957 | 2 | 278248248 | 668400144 | 1212 | 911.5 | 10.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.253 | 11.079 | 15.601 | 0 | 10.97 / 5.36 | 9.525 | 10.671 | 0 | 7.342 | 12.446 | 0 | 278248248 | 668400144 | 1198 | 895.9 | 10.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.133 | 11.67 | 14.584 | 0 | 12.01 / 5.24 | 9.179 | 11.924 | 0 | 7.223 | 12.198 | 0 | 278248248 | 668400144 | 1214 | 901.5 | 10.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.993 | 15.001 | 0 | 0 | 11.64 | 14.777 | 0 | 19.6 |
| 128 MiB fixed | 1 | schedstat | 11.02 | 12.011 | 0 | 0 | 11.059 | 12.243 | 0 | 19.8 |
| 512 MiB fixed | 1 | schedstat | 9.47 | 11 | 0 | 0 | 9.289 | 10.344 | 0 | 15.5 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.021 | 9 | 0 | 0 | 6.01 | 9.006 | 0 | 14 |
