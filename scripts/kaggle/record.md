## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 35. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T20:53:04.732Z. Queue wait 7 s from the push to the first line of the script. Run time 299.2 s for 28 of 28 planned runs.
- reference build of engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4).
- engine-core-1024mib-threads-simd.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4, 4, 2, 3, 6, 4); in the steady window alone 131072 bodies hold it (workers 4, 4, 4, 4, 2, 3, 6, 4).
- engine-core-1024mib-threads.mjs, warmed: 131072 bodies hold the budget at p99 with zero ticks over budget (workers 4); in the steady window alone 131072 bodies hold it (workers 4).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 131072 bodies hold it (workers 4).
- Refused by the arena plan: none.
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.06 | 11.234 | 17.062 | 1 | 8.16 / 4.72 | 12.122 | 17.062 | 1 | 7.058 | 8.858 | 0 | 278248248 | 668400144 | 1211.4 | 888.4 | 9.9 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.934 | 10.924 | 18.075 | 1 | 8.3 / 4.82 | 13.118 | 18.075 | 1 | 6.942 | 8.868 | 0 | 278248248 | 668400144 | 1082.5 | 790.6 | 9.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.059 | 11.768 | 20.333 | 1 | 8.12 / 5.04 | 13.909 | 15.708 | 0 | 7.143 | 9.238 | 1 | 278248248 | 668400144 | 1149.8 | 882.3 | 9.8 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.987 | 11.644 | 19.214 | 1 | 8.53 / 4.86 | 14.261 | 19.214 | 1 | 7.062 | 9.137 | 0 | 278248248 | 668400144 | 1090.8 | 786.5 | 9.6 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.066 | 10.858 | 14.693 | 0 | 7.69 / 4.89 | 12.089 | 14.693 | 0 | 7.132 | 9.05 | 0 | 278248248 | 668400144 | 1083.8 | 786.7 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.998 | 11.563 | 15.526 | 0 | 8.32 / 5.07 | 9.245 | 10.331 | 0 | 7.147 | 12.223 | 0 | 278248248 | 668400144 | 1103.7 | 881.1 | 9.7 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 7.021 | 10.926 | 21.129 | 3 | 7.97 / 4.84 | 8.845 | 10.559 | 0 | 7.142 | 11.55 | 3 | 278248248 | 668400144 | 1118.9 | 806.3 | 9.6 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.858 | 10.526 | 16.716 | 1 | 7.49 / 4.97 | 9.22 | 10.323 | 0 | 6.953 | 11.367 | 1 | 278248248 | 668400144 | 1096.5 | 838.5 | 9.5 |
| reference 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.942 | 11.209 | 14.708 | 0 | 7.77 / 4.69 | 8.915 | 10.138 | 0 | 7.054 | 11.933 | 0 | 278248248 | 668400144 | 1139.2 | 883.8 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.912 | 11.464 | 15.202 | 0 | 8.13 / 4.69 | 8.828 | 10.069 | 0 | 7.027 | 11.883 | 0 | 278248248 | 668400144 | 1129.3 | 875.2 | 9.7 |
| 1024mib-threads-simd, warmed | 131072 | 1 | 4 |  | 12.359 | 16.496 | 21.669 | 8 | 9.51 / 6.46 | 14.646 | 14.883 | 0 | 12.7 | 18.776 | 8 | 278248248 | 668203536 | 1102.3 | 803.6 | 14.3 |
| 1024mib-threads-simd, warmed | 131072 | 2 | 4 |  | 8.798 | 11.526 | 14.507 | 0 | 8.87 / 5.52 | 12.576 | 14.065 | 0 | 8.836 | 11.364 | 0 | 278248248 | 668269072 | 1086.5 | 778.9 | 11.1 |
| 1024mib-threads-simd, warmed | 131072 | 3 | 4 |  | 7.98 | 10.368 | 13.663 | 0 | 8.39 / 5.15 | 11.746 | 13.663 | 0 | 8.111 | 10.125 | 0 | 278248248 | 668334608 | 1090.8 | 782.7 | 10.4 |
| 1024mib-threads-simd, warmed | 131072 | 6 | 4 |  | 7.185 | 9.66 | 11.326 | 0 | 8.22 / 4.95 | 9.713 | 11.326 | 0 | 7.339 | 9.553 | 0 | 278248248 | 668531216 | 1094.8 | 798.4 | 9.8 |
| 1024mib-threads, warmed | 131072 | 4 | 4 |  | 8.335 | 10.613 | 12.334 | 0 | 8.39 / 5.36 | 10.626 | 12.334 | 0 | 8.528 | 10.613 | 0 | 278248248 | 668400144 | 1171.8 | 828.1 | 10.9 |
| 1024mib-threads-simd, cold | 131072 | 4 | 4 |  | 7.408 | 10.614 | 45.208 | 4 | 45.21 / 10.07 | 16.722 | 37.129 | 3 | 7.494 | 9.435 | 0 | 278248248 | 668400144 |  | 804.4 | 8.9 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.973 | 8.936 | 10.962 | 0 | 10.96 / 5.02 | 10.607 | 10.936 | 0 | 0.939 | 1.235 | 0 | 196055280 | 668400144 | 1092.4 | 903.2 | 4.4 |
| 1024mib-threads-simd, warmed | 131072 | 4 | 4 |  | 6.862 | 9.197 | 14.72 | 0 | 7.49 / 4.9 | 9.644 | 10.666 | 0 | 6.869 | 9.197 | 0 | 405657056 | 668400144 | 1093.6 | 794.3 | 22.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.09 | 10.297 | 16.029 | 0 | 7.23 / 4.39 | 7.854 | 10.042 | 0 | 6.186 | 10.984 | 0 | 222472736 | 668400144 | 1097.7 | 798.6 | 7.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.931 | 7.177 | 8.501 | 0 | 7.43 / 4.36 | 7.177 | 7.959 | 0 | 5.911 | 7.168 | 0 | 222620160 | 668400144 | 1123.6 | 793.5 | 7.1 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.088 | 7.507 | 10.519 | 0 | 7.16 / 4.22 | 7.445 | 9.094 | 0 | 6.171 | 7.523 | 0 | 222423696 | 668400144 | 1175.2 | 794.9 | 7.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 6.107 | 9.7 | 12.056 | 0 | 7.18 / 4.48 | 11.798 | 12.056 | 0 | 6.086 | 7.409 | 0 | 222580688 | 668400144 | 1079.9 | 788.7 | 7.3 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 10.999 | 12.998 | 0 | 0 | 11.187 | 12.459 | 0 | 19.5 |
| 128 MiB fixed | 1 | schedstat | 12.963 | 15.799 | 0 | 0 | 12.988 | 16.083 | 0 | 19.6 |
| 512 MiB fixed | 1 | schedstat | 11.897 | 14.793 | 0 | 0 | 11.846 | 14.448 | 0 | 15.4 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.007 | 8 | 0 | 0 | 6.441 | 8.246 | 0 | 14.1 |
