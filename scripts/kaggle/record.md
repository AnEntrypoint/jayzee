## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 20. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4.
- Pushed 2026-11-11T16:26:16.997Z. Queue wait 7 s from the push to the first line of the script. Run time 201.3 s for 42 of 42 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 12288 bodies hold the budget at p99 with zero ticks over budget (workers 1, 2, 3, 4, 6); in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 12288 bodies hold it (workers 1, 2, 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, warmed: 20480 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4); in the steady window alone 20480 bodies hold it (workers 3, 4, 6).
- cap20480 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 20480 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 12288 | 1 | 4 |  | 0.082 | 15.43 | 17.401 | 1 | 8.11 / 8.64 | 16.16 | 17.401 | 1 | 0.076 | 0.209 | 0 | 111963808 | 507775504 | 1453.5 | 949.1 | 5.7 |
| 1024mib-threads, warmed | 12288 | 2 | 4 |  | 0.101 | 13.896 | 17.149 | 1 | 5.84 / 7.39 | 14.863 | 17.149 | 1 | 0.083 | 0.383 | 0 | 111963808 | 507841040 | 1239.5 | 843.6 | 4.3 |
| 1024mib-threads, warmed | 12288 | 3 | 4 |  | 0.081 | 7.829 | 9.273 | 0 | 6.19 / 5.81 | 8.915 | 9.273 | 0 | 0.076 | 0.211 | 0 | 111963808 | 507906576 | 1265.9 | 864.8 | 3.9 |
| 1024mib-threads, warmed | 12288 | 4 | 4 |  | 0.077 | 7.462 | 9.106 | 0 | 5.08 / 4.64 | 8.975 | 9.106 | 0 | 0.076 | 0.106 | 0 | 111963808 | 507972112 | 1279.2 | 835.2 | 3.7 |
| 1024mib-threads, warmed | 12288 | 6 | 4 |  | 0.078 | 8.174 | 9.8 | 0 | 9.31 / 9.22 | 8.254 | 9.8 | 0 | 0.076 | 0.123 | 0 | 111963808 | 508103184 | 1240.9 | 878.3 | 3.8 |
| 1024mib-threads-simd, warmed | 12288 | 1 | 4 |  | 0.08 | 11.606 | 13.177 | 0 | 7.34 / 8.63 | 12.474 | 13.177 | 0 | 0.076 | 0.128 | 0 | 111963808 | 507775504 | 1148.8 | 979.4 | 4.5 |
| 1024mib-threads-simd, warmed | 12288 | 2 | 4 |  | 0.08 | 6.971 | 9.154 | 0 | 4.92 / 4.83 | 7.594 | 9.154 | 0 | 0.076 | 0.169 | 0 | 111963808 | 507841040 | 1252.6 | 832.7 | 3.7 |
| 1024mib-threads-simd, warmed | 12288 | 3 | 4 |  | 0.078 | 6.682 | 7.697 | 0 | 4.8 / 4.36 | 7.326 | 7.697 | 0 | 0.076 | 0.115 | 0 | 111963808 | 507906576 | 1150.6 | 807.1 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.082 | 6.613 | 8.599 | 0 | 4.88 / 4.67 | 7.931 | 8.599 | 0 | 0.076 | 0.237 | 0 | 111963808 | 507972112 | 1157.5 | 822.8 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 6 | 4 |  | 0.077 | 6.424 | 8.275 | 0 | 6.06 / 6.51 | 6.728 | 8.275 | 0 | 0.076 | 0.14 | 0 | 111963808 | 508103184 | 1193.9 | 837.2 | 3.5 |
| 1024mib-threads, cold | 12288 | 1 | 4 |  | 0.077 | 14.906 | 22.551 | 3 | 22.55 / 11.55 | 16.273 | 19.17 | 2 | 0.076 | 0.154 | 0 | 111963808 | 507775504 |  | 815.8 | 3.7 |
| 1024mib-threads, cold | 12288 | 2 | 4 |  | 0.077 | 12.565 | 28.782 | 6 | 28.78 / 17.32 | 20.05 | 25.262 | 4 | 0.076 | 0.111 | 0 | 111963808 | 507841040 |  | 875.1 | 3 |
| 1024mib-threads, cold | 12288 | 3 | 4 |  | 0.079 | 9.021 | 24.905 | 2 | 24.9 / 9.02 | 11.722 | 17.196 | 1 | 0.076 | 0.229 | 0 | 111963808 | 507906576 |  | 927.8 | 2.8 |
| 1024mib-threads, cold | 12288 | 4 | 4 |  | 0.078 | 8.952 | 22.738 | 1 | 22.74 / 11.46 | 11.209 | 14.048 | 0 | 0.075 | 0.119 | 0 | 111963808 | 507972112 |  | 832.3 | 2.5 |
| 1024mib-threads, cold | 12288 | 6 | 4 |  | 0.08 | 9.16 | 33.873 | 1 | 33.87 / 12.31 | 11.207 | 14.678 | 0 | 0.075 | 0.151 | 0 | 111963808 | 508103184 |  | 827 | 2.7 |
| 1024mib-threads-simd, cold | 12288 | 1 | 4 |  | 0.077 | 12.716 | 24.164 | 1 | 24.16 / 11.27 | 13.95 | 15.289 | 0 | 0.076 | 0.119 | 0 | 111963808 | 507775504 |  | 907.2 | 3.4 |
| 1024mib-threads-simd, cold | 12288 | 2 | 4 |  | 0.078 | 8.668 | 22.972 | 1 | 22.97 / 11.88 | 9.101 | 15.709 | 0 | 0.076 | 0.156 | 0 | 111963808 | 507841040 |  | 830.3 | 2.5 |
| 1024mib-threads-simd, cold | 12288 | 3 | 4 |  | 0.077 | 7.692 | 24.846 | 1 | 24.85 / 10.41 | 9.472 | 14.063 | 0 | 0.076 | 0.133 | 0 | 111963808 | 507906576 |  | 897.9 | 2.4 |
| 1024mib-threads-simd, cold | 12288 | 4 | 4 |  | 0.078 | 7.923 | 23 | 2 | 23 / 12.55 | 10.2 | 18.343 | 1 | 0.076 | 0.135 | 0 | 111963808 | 507972112 |  | 849.5 | 2.3 |
| 1024mib-threads-simd, cold | 12288 | 6 | 4 |  | 0.085 | 7.963 | 34.136 | 2 | 34.14 / 10.63 | 10.606 | 20.494 | 1 | 0.077 | 0.253 | 0 | 111963808 | 508103184 |  | 859 | 2.4 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 3 | 4 |  | 0.149 | 7.671 | 8.275 | 0 | 5.22 / 5.69 | 8.025 | 8.275 | 0 | 0.132 | 2.722 | 0 | 145855280 | 550234640 | 1191.3 | 897 | 4.2 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 4 | 4 |  | 0.141 | 6.193 | 7.562 | 0 | 5.13 / 5.87 | 6.439 | 7.562 | 0 | 0.128 | 2.19 | 0 | 145855280 | 550300176 | 1239.6 | 919.1 | 3.9 |
| cap20480 1024mib-threads-simd, warmed | 16384 | 6 | 4 |  | 0.146 | 7.957 | 9.289 | 0 | 6.19 / 6.6 | 8.618 | 9.289 | 0 | 0.13 | 2.939 | 0 | 145855280 | 550431248 | 1210.9 | 839.9 | 4.1 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 3 | 4 |  | 0.17 | 9.416 | 12.068 | 0 | 5.27 / 4.7 | 11.231 | 12.068 | 0 | 0.139 | 7.571 | 0 | 148034352 | 550234640 | 1150.3 | 824 | 4.7 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 4 | 4 |  | 0.179 | 7.36 | 9.703 | 0 | 4.75 / 4.34 | 7.146 | 7.68 | 0 | 0.142 | 7.572 | 0 | 148034352 | 550300176 | 1187.6 | 843 | 4.4 |
| cap20480 1024mib-threads-simd, warmed | 20480 | 6 | 4 |  | 0.187 | 12.478 | 18.717 | 1 | 7.7 / 6.25 | 15.669 | 18.717 | 1 | 0.142 | 6.009 | 0 | 148034352 | 550431248 | 1182.8 | 829.1 | 4.6 |
| cap20480 1024mib-threads-simd, cold | 16384 | 4 | 4 |  | 0.141 | 7.933 | 25.079 | 1 | 25.08 / 12.55 | 9.575 | 12.874 | 0 | 0.128 | 2.3 | 0 | 145855280 | 550300176 |  | 833.2 | 2.7 |
| cap20480 1024mib-threads-simd, cold | 20480 | 4 | 4 |  | 0.164 | 7.02 | 26.985 | 1 | 26.98 / 9.4 | 9.151 | 11.658 | 0 | 0.139 | 5.055 | 0 | 148034352 | 550300176 |  | 832.3 | 3.1 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.08 | 9.603 | 15.528 | 0 | 4.63 / 3.96 | 12.559 | 15.528 | 0 | 0.076 | 0.138 | 0 | 111963808 | 507972112 | 1154.8 | 935.6 | 3.6 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 1024x150 | 0.079 | 6.193 | 7.713 | 0 | 5.71 / 5.83 | 7.26 | 7.713 | 0 | 0.076 | 0.211 | 0 | 111963808 | 507972112 | 1008.1 | 815.3 | 3.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 512x90 | 0.078 | 6.22 | 6.842 | 0 | 4.25 / 4.42 | 6.499 | 6.842 | 0 | 0.076 | 0.16 | 0 | 111963808 | 507972112 | 1003.6 | 945.5 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 |  | 0.08 | 8.401 | 11.286 | 0 | 4.46 / 4.48 | 9.726 | 11.286 | 0 | 0.076 | 0.116 | 0 | 111963808 | 507972112 | 1171.2 | 824.5 | 3.4 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 1024x150 | 0.078 | 6.349 | 8.313 | 0 | 4.05 / 5.22 | 7.649 | 8.313 | 0 | 0.075 | 0.153 | 0 | 111963808 | 507972112 | 991.2 | 954.5 | 3.3 |
| 1024mib-threads-simd, warmed | 12288 | 4 | 4 | warm run 512x90 | 0.081 | 5.538 | 6.533 | 0 | 5.09 / 4.67 | 6.082 | 6.533 | 0 | 0.076 | 0.244 | 0 | 111963808 | 507972112 | 940.2 | 824.8 | 3.1 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 11.899 | 13.352 | 0 | 0 | 12.378 | 14.414 | 0 | 21 |
| 128 MiB fixed | 1 | schedstat | 11.73 | 13.03 | 0 | 0 | 11.57 | 13.327 | 0 | 20.6 |
| 512 MiB fixed | 1 | schedstat | 9.962 | 12.558 | 0 | 0 | 10.146 | 12.989 | 0 | 16.7 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 9.245 | 10.274 | 0 | 0 | 10 | 12.733 | 0 | 15.3 |
