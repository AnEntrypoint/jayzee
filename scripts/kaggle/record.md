## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 39. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T23:03:10.203Z. Queue wait 6 s from the push to the first line of the script. Run time 624.6 s for 42 of 42 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 4, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone none holds it.
- profile build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 4, 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.606 | 11.079 | 14.12 | 0 | 7.95 / 5.17 | 12.925 | 14.12 | 0 | 7.624 | 9.896 | 0 | 278248248 | 668400144 | 1255.2 | 1055.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.636 | 10.801 | 12.793 | 0 | 8.41 / 5.63 | 12.544 | 12.793 | 0 | 7.755 | 10.215 | 0 | 278248248 | 668400144 | 1136.3 | 1042.2 | 10.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.742 | 10.569 | 18.504 | 1 | 7.94 / 5.2 | 10.611 | 18.504 | 1 | 7.938 | 10.569 | 0 | 278248248 | 668400144 | 1159.2 | 1076.9 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.677 | 10.391 | 13.78 | 0 | 8.92 / 5.15 | 10.882 | 13.78 | 0 | 7.869 | 10.2 | 0 | 278248248 | 668400144 | 1159.3 | 1132.4 | 10.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.83 | 10.495 | 11.486 | 0 | 7.85 / 5.11 | 10.356 | 11.486 | 0 | 8.012 | 10.573 | 0 | 278248248 | 668400144 | 1224.1 | 1015.3 | 10.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.912 | 12.605 | 15.526 | 0 | 9.84 / 5.12 | 11.188 | 14.26 | 0 | 8.018 | 12.996 | 0 | 278248248 | 668400144 | 1262.8 | 1089.9 | 11 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.718 | 13.109 | 15.843 | 0 | 8.47 / 5.22 | 10.316 | 11.402 | 0 | 7.879 | 13.851 | 0 | 278248248 | 668400144 | 1157.7 | 996.7 | 10.5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.495 | 12.089 | 18.295 | 1 | 8.54 / 5.23 | 10.586 | 11.518 | 0 | 7.625 | 12.774 | 1 | 278248248 | 668400144 | 1201.2 | 1063.7 | 10.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.465 | 11.492 | 21.33 | 1 | 7.87 / 5.85 | 9.375 | 11.003 | 0 | 7.674 | 12.508 | 1 | 278248248 | 668400144 | 1161.8 | 962.5 | 10.3 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.865 | 14.159 | 17.831 | 1 | 8.64 / 5.13 | 10.702 | 11.219 | 0 | 7.955 | 15.06 | 1 | 278248248 | 668400144 | 1170 | 1040.1 | 10.8 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 14.26 | 20.835 | 22.301 | 90 | 10.75 / 6.85 | 19.209 | 21.833 | 18 | 14.556 | 20.879 | 72 | 278248248 | 668203536 | 1274.3 | 1118.1 | 16.5 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 10.213 | 14.416 | 18.725 | 1 | 10.81 / 6.45 | 14.769 | 16.676 | 0 | 10.436 | 14.222 | 1 | 278248248 | 668269072 | 1279.1 | 1018.1 | 12.9 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 8.84 | 11.77 | 12.778 | 0 | 9.33 / 5.95 | 11.77 | 12.763 | 0 | 8.931 | 11.896 | 0 | 278248248 | 668334608 | 1153.2 | 1023.4 | 11.5 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 7.782 | 10.453 | 11.197 | 0 | 8.71 / 5.04 | 10.453 | 11.194 | 0 | 7.982 | 10.567 | 0 | 278248248 | 668531216 | 1232.3 | 1047.9 | 10.7 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 9.051 | 12.839 | 17.187 | 1 | 8.74 / 5.57 | 12.167 | 12.839 | 0 | 9.302 | 13.416 | 1 | 278248248 | 668400144 | 1372.9 | 983 | 11.9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 8.465 | 14.629 | 35.042 | 4 | 35.04 / 10.69 | 14.041 | 22.226 | 1 | 8.461 | 14.748 | 2 | 278248248 | 668400144 |  | 830.5 | 10 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 1.189 | 8.563 | 12.948 | 0 | 8.22 / 5.74 | 9.916 | 12.948 | 0 | 1.111 | 2.222 | 0 | 196055280 | 668400144 | 1168.8 | 1080.6 | 5 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.838 | 11.576 | 15.882 | 0 | 8.33 / 5.03 | 15.124 | 15.882 | 0 | 7.867 | 11.048 | 0 | 405657056 | 668400144 | 1212.6 | 1059.4 | 25.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.914 | 10.412 | 14.562 | 0 | 7.28 / 4.97 | 9.945 | 10.7 | 0 | 6.93 | 11.91 | 0 | 222472736 | 668400144 | 1175.5 | 1126.6 | 8.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.703 | 8.988 | 11.117 | 0 | 7.96 / 4.69 | 8.629 | 9.359 | 0 | 6.635 | 9.031 | 0 | 222620160 | 668400144 | 1230.8 | 1046.3 | 8.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.983 | 9.27 | 11.788 | 0 | 8.56 / 5.11 | 9.06 | 10.496 | 0 | 6.989 | 9.273 | 0 | 222423696 | 668400144 | 1361.7 | 1088.8 | 8.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.711 | 11.195 | 15.769 | 0 | 7.49 / 4.57 | 13.819 | 15.769 | 0 | 6.692 | 8.775 | 0 | 222580688 | 668400144 | 1154.1 | 994.9 | 8.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.521 | 12.555 | 17.066 | 1 | 12.44 / 8.28 | 15.738 | 17.066 | 1 | 8.7 | 11.378 | 0 | 278248248 | 668400144 | 1212.4 | 1176.1 | 11.5 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.316 | 12.249 | 18.873 | 2 | 10.78 / 5.62 | 15.458 | 18.873 | 2 | 8.432 | 11.07 | 0 | 278248248 | 668400144 | 1187.8 | 1090.3 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.456 | 11.121 | 11.849 | 0 | 11.21 / 5.66 | 11.247 | 11.849 | 0 | 8.538 | 10.962 | 0 | 278248248 | 668400144 | 1196.2 | 1012.9 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.412 | 11.818 | 15.671 | 0 | 10.93 / 5.82 | 11.34 | 13.262 | 0 | 8.512 | 12.116 | 0 | 278248248 | 668400144 | 1221.4 | 997.8 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.221 | 12.793 | 22.772 | 2 | 11.2 / 5.89 | 11.6 | 12.206 | 0 | 8.2 | 13.148 | 2 | 278248248 | 668400144 | 1181.2 | 1078.4 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.342 | 13.573 | 18.675 | 1 | 12.38 / 5.77 | 11.705 | 13.34 | 0 | 8.44 | 14.157 | 1 | 278248248 | 668400144 | 1180.1 | 967.8 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.351 | 14.116 | 18.692 | 1 | 10.31 / 5.5 | 11.292 | 12.55 | 0 | 8.484 | 16.114 | 1 | 278248248 | 668400144 | 1197.8 | 1128.3 | 11.3 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.292 | 12.455 | 17.654 | 2 | 11.6 / 5.67 | 11.558 | 14.018 | 0 | 8.463 | 13.156 | 2 | 278248248 | 668400144 | 1200.3 | 996.9 | 11.1 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.388 | 12.965 | 20.709 | 1 | 10.89 / 5.57 | 15.832 | 20.709 | 1 | 8.394 | 11.01 | 0 | 278248248 | 668400144 | 1195.3 | 972.5 | 11.2 |
| profile 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 8.047 | 12.315 | 17.45 | 3 | 10.96 / 5.78 | 16.956 | 17.45 | 3 | 8.147 | 10.268 | 0 | 278248248 | 668400144 | 1174.3 | 976 | 10.8 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 13.09 | 19.025 | 1 | 0 | 13.643 | 20.069 | 1 | 21.5 |
| 128 MiB fixed | 1 | schedstat | 13.96 | 17.951 | 2 | 0 | 14.15 | 17.534 | 2 | 20.8 |
| 512 MiB fixed | 1 | schedstat | 12.446 | 15.836 | 0 | 0 | 12.71 | 16.914 | 1 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 7.999 | 9.116 | 0 | 0 | 8.505 | 11.453 | 0 | 15.6 |
