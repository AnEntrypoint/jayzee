## Kaggle physics run

Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `heclgang/jayzee-physics-goalpost` version 30. One JSON result per configuration; the table is that file.

- Budget: 16.7 ms per tick, 900 ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.
- Arena plan: 1024 players under a 1073741824 byte budget.
- Machine: Intel(R) Xeon(R) CPU @ 2.20GHz, 4 CPUs, Node v22.23.4, machine class GenuineIntel-6-79-0 (2 cores, 4 threads).
- Pushed 2026-11-11T18:24:00.020Z. Queue wait 7 s from the push to the first line of the script. Run time 335.9 s for 42 of 42 planned runs.
- engine-core-1024mib-threads.mjs, warmed: 40960 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 40960 bodies hold it (workers 2, 3, 4, 6).
- engine-core-1024mib-threads-simd.mjs, warmed: 40960 bodies hold the budget at p99 with zero ticks over budget (workers 2, 3, 4, 6); in the steady window alone 40960 bodies hold it (workers 2, 3, 4, 6).
- engine-core-1024mib-threads.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 40960 bodies hold it (workers 2, 3, 6).
- engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 40960 bodies hold it (workers 1, 2, 3, 4, 6).
- cap65536 build of engine-core-1024mib-threads-simd.mjs, warmed: 65536 bodies hold the budget at p99 with zero ticks over budget (workers 3, 4, 6); in the steady window alone 65536 bodies hold it (workers 3, 4, 6).
- cap65536 build of engine-core-1024mib-threads-simd.mjs, cold: no body count holds the budget at p99 with zero ticks over budget; in the steady window alone 65536 bodies hold it (workers 4).
- Refused by the arena plan: 8 workers (workers-do-not-fit).
- Runs that gave no result: none.

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads, warmed | 40960 | 1 | 4 |  | 12.895 | 19.134 | 26.043 | 21 | 8.14 / 8.55 | 14.782 | 15.901 | 0 | 13.234 | 20.741 | 21 | 283619856 | 655890960 | 1467.8 | 942 | 12.8 |
| 1024mib-threads, warmed | 40960 | 2 | 4 |  | 7.962 | 12.223 | 15.095 | 0 | 7.3 / 7.13 | 11.289 | 11.71 | 0 | 7.996 | 13.03 | 0 | 283619856 | 655956496 | 1278.6 | 885.8 | 8.7 |
| 1024mib-threads, warmed | 40960 | 3 | 4 |  | 7.39 | 11.539 | 14.084 | 0 | 6.59 / 5.68 | 8.611 | 10.268 | 0 | 7.502 | 12.151 | 0 | 283619856 | 656022032 | 1263.8 | 941 | 8.2 |
| 1024mib-threads, warmed | 40960 | 4 | 4 |  | 6.654 | 7.876 | 9.467 | 0 | 5.47 / 4.93 | 7.876 | 8.671 | 0 | 6.693 | 8.036 | 0 | 283619856 | 656087568 | 1272.2 | 872.1 | 7.5 |
| 1024mib-threads, warmed | 40960 | 6 | 4 |  | 6.784 | 8.876 | 11.141 | 0 | 8.45 / 8.52 | 9.127 | 11.141 | 0 | 6.824 | 8.844 | 0 | 283619856 | 656218640 | 1257.9 | 919.7 | 7.8 |
| 1024mib-threads-simd, warmed | 40960 | 1 | 4 |  | 10.778 | 13.005 | 17.127 | 1 | 7.68 / 7.39 | 12.807 | 13.292 | 0 | 11.067 | 13.215 | 1 | 283619856 | 655890960 | 1179 | 914.1 | 10.4 |
| 1024mib-threads-simd, warmed | 40960 | 2 | 4 |  | 6.739 | 8.183 | 8.789 | 0 | 6.59 / 6.08 | 7.73 | 7.928 | 0 | 6.916 | 8.247 | 0 | 283619856 | 655956496 | 1257.5 | 870.3 | 7.6 |
| 1024mib-threads-simd, warmed | 40960 | 3 | 4 |  | 5.969 | 10.205 | 13.473 | 0 | 5.46 / 4.78 | 12.431 | 13.473 | 0 | 5.985 | 6.843 | 0 | 283619856 | 656022032 | 1185.3 | 869.8 | 7 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.25 | 6.779 | 9.309 | 0 | 5.24 / 4.49 | 6.782 | 9.309 | 0 | 5.216 | 6.526 | 0 | 283619856 | 656087568 | 1178.2 | 861.4 | 6.4 |
| 1024mib-threads-simd, warmed | 40960 | 6 | 4 |  | 5.326 | 7.627 | 9.187 | 0 | 5.27 / 4.26 | 7.462 | 8.274 | 0 | 5.393 | 7.671 | 0 | 283619856 | 656218640 | 1234.5 | 874.7 | 6.6 |
| 1024mib-threads, cold | 40960 | 1 | 4 |  | 13.048 | 16.567 | 57.009 | 8 | 24.75 / 19.64 | 19.277 | 57.009 | 3 | 13.474 | 16.205 | 3 | 283619856 | 655890960 |  | 867.2 | 11 |
| 1024mib-threads, cold | 40960 | 2 | 4 |  | 8.183 | 10.285 | 19.742 | 2 | 19.74 / 11.62 | 13.804 | 18.405 | 1 | 8.25 | 9.734 | 0 | 283619856 | 655956496 |  | 975.4 | 7.5 |
| 1024mib-threads, cold | 40960 | 3 | 4 |  | 7.744 | 13.962 | 21.785 | 2 | 21.79 / 13.33 | 15.922 | 17.957 | 1 | 7.791 | 9.614 | 0 | 283619856 | 656022032 |  | 873.7 | 7.2 |
| 1024mib-threads, cold | 40960 | 4 | 4 |  | 6.87 | 12.892 | 22.67 | 4 | 22.67 / 12.57 | 10.539 | 20.795 | 1 | 6.971 | 13.932 | 2 | 283619856 | 656087568 |  | 901.7 | 6.6 |
| 1024mib-threads, cold | 40960 | 6 | 4 |  | 7.047 | 10.204 | 21.378 | 3 | 21.24 / 14.9 | 13.929 | 21.378 | 2 | 7.077 | 9.557 | 0 | 283619856 | 656218640 |  | 864 | 6.7 |
| 1024mib-threads-simd, cold | 40960 | 1 | 4 |  | 10.875 | 13.499 | 25.47 | 1 | 25.47 / 13.97 | 13.681 | 15.877 | 0 | 11.002 | 13.366 | 0 | 283619856 | 655890960 |  | 978.3 | 9.4 |
| 1024mib-threads-simd, cold | 40960 | 2 | 4 |  | 6.737 | 10.765 | 18.171 | 1 | 18.17 / 8.46 | 11.558 | 15.463 | 0 | 6.72 | 8.166 | 0 | 283619856 | 655956496 |  | 867.6 | 6.4 |
| 1024mib-threads-simd, cold | 40960 | 3 | 4 |  | 6.092 | 10.617 | 21.198 | 1 | 21.2 / 12.23 | 10.617 | 14.476 | 0 | 6.179 | 10.152 | 0 | 283619856 | 656022032 |  | 874.4 | 5.9 |
| 1024mib-threads-simd, cold | 40960 | 4 | 4 |  | 5.428 | 7.657 | 21.528 | 2 | 21.53 / 12.61 | 10.432 | 20.831 | 1 | 5.462 | 6.64 | 0 | 283619856 | 656087568 |  | 887 | 5.4 |
| 1024mib-threads-simd, cold | 40960 | 6 | 4 |  | 5.704 | 13.561 | 25.044 | 3 | 25.04 / 14.33 | 12.925 | 24.843 | 2 | 5.751 | 13.487 | 0 | 283619856 | 656218640 |  | 876.5 | 5.9 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 3 | 4 |  | 6.554 | 9.482 | 12.716 | 0 | 6.56 / 5.12 | 7.284 | 8.165 | 0 | 6.614 | 11.445 | 0 | 406767680 | 782940688 | 1293.6 | 929.5 | 8.5 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 4 | 4 |  | 5.822 | 6.915 | 8.642 | 0 | 5.84 / 4.77 | 6.951 | 7.5 | 0 | 5.877 | 6.915 | 0 | 406767680 | 783006224 | 1298.2 | 950.4 | 7.8 |
| cap65536 1024mib-threads-simd, warmed | 49152 | 6 | 4 |  | 6.001 | 7.792 | 8.999 | 0 | 5.84 / 4.74 | 7.911 | 8.382 | 0 | 6.036 | 7.718 | 0 | 406767680 | 783137296 | 1272.5 | 876.7 | 8 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 3 | 4 |  | 6.717 | 9.039 | 16.534 | 0 | 7.02 / 5.29 | 12.582 | 16.534 | 0 | 6.816 | 7.904 | 0 | 428111984 | 782940688 | 1184.1 | 882 | 8.6 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 4 | 4 |  | 5.718 | 9.725 | 12.942 | 0 | 5.8 / 4.56 | 11.984 | 12.942 | 0 | 5.798 | 7.552 | 0 | 428111984 | 783006224 | 1195.3 | 877.6 | 7.7 |
| cap65536 1024mib-threads-simd, warmed | 65536 | 6 | 4 |  | 6.063 | 10.816 | 16.264 | 0 | 5.92 / 5.1 | 7.62 | 7.914 | 0 | 6.173 | 12.08 | 0 | 428111984 | 783137296 | 1196.3 | 875.6 | 8.2 |
| cap65536 1024mib-threads-simd, cold | 49152 | 4 | 4 |  | 5.689 | 8.608 | 42.312 | 4 | 24.86 / 8.61 | 20.53 | 42.312 | 3 | 5.689 | 6.675 | 0 | 406767680 | 783006224 |  | 869 | 6.4 |
| cap65536 1024mib-threads-simd, cold | 65536 | 4 | 4 |  | 6.141 | 12.287 | 27.601 | 2 | 27.6 / 10.67 | 13.6 | 18.197 | 1 | 6.182 | 7.218 | 0 | 428111984 | 783006224 |  | 887.6 | 7 |

Probes on one configuration:

| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | warm-up ms | load ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.341 | 10.334 | 14.671 | 0 | 5.1 / 4.23 | 6.775 | 8.191 | 0 | 5.401 | 11.125 | 0 | 283619856 | 656087568 | 1206.9 | 1009.1 | 6.8 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 1024x150 | 5.428 | 6.4 | 8.578 | 0 | 5.17 / 6.36 | 6.876 | 8.578 | 0 | 5.469 | 6.382 | 0 | 283619856 | 656087568 | 1049 | 878.9 | 6.4 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 512x90 | 5.389 | 6.677 | 10.272 | 0 | 5.12 / 4.71 | 7.167 | 10.272 | 0 | 5.473 | 6.645 | 0 | 283619856 | 656087568 | 1020.3 | 982.7 | 6.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 |  | 5.123 | 10.145 | 14.973 | 0 | 4.81 / 4.26 | 6.179 | 7.146 | 0 | 5.219 | 11.385 | 0 | 283619856 | 656087568 | 1212 | 886.6 | 6.5 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 1024x150 | 5.242 | 6.577 | 7.681 | 0 | 5.05 / 6.31 | 6.577 | 7.181 | 0 | 5.26 | 6.647 | 0 | 283619856 | 656087568 | 1078.2 | 880.7 | 6.3 |
| 1024mib-threads-simd, warmed | 40960 | 4 | 4 | warm run 512x90 | 5.15 | 6.144 | 7.831 | 0 | 5.69 / 4.44 | 6.41 | 7.831 | 0 | 5.19 | 6.077 | 0 | 283619856 | 656087568 | 993.8 | 943.9 | 6.2 |

Marble bowl (512 marbles, 600 ticks, 4 timed runs per tier after 1 warm run). CPU time is the main thread's run time from the scheduler statistics; wall time is beside it:

| tier | workers | clock | CPU p99 ms | CPU max ms | CPU ticks over 16.7 ms | CPU ticks over 25 ms | wall p99 ms | wall max ms | wall ticks over 16.7 ms | run s |
|---|---|---|---|---|---|---|---|---|---|---|
| 64 MiB fixed | 1 | schedstat | 15.976 | 18.999 | 4 | 0 | 15.639 | 18.537 | 3 | 20.3 |
| 128 MiB fixed | 1 | schedstat | 11.998 | 14.999 | 0 | 0 | 11.505 | 15.338 | 0 | 20.4 |
| 512 MiB fixed | 1 | schedstat | 13.851 | 17.001 | 1 | 0 | 13.896 | 16.959 | 1 | 15.9 |
| 512 MiB threaded, 2 workers | 2 | schedstat | 6.033 | 7.999 | 0 | 0 | 6.265 | 11.311 | 0 | 14.5 |
