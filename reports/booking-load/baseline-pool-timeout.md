# Booking load report

Development/test-only measurement on one disposable database and two loopback API processes; fixture/bootstrap time is excluded and results are not production capacity planning.

Configuration: `{"apiProcesses":2,"poolMaxPerProcess":10,"dbConnectionTimeoutMs":5000}`; request timeout: 30000 ms.

## same-slot

- Requests: 200; throughput: 79.8 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1580.93, p50 1699.45, p95 2315.53, p99 2369.32, max 2386.98
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":158,"ExclusiveLock":36,"RowExclusiveLock":18,"RowShareLock":95}}`
- API pool peaks: `[{"observedSamples":22,"configuredMax":10,"peakTotal":10,"peakWaiting":92,"minimumIdle":0},{"observedSamples":22,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (22 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 75.0 req/s
- Statuses: `{"201":968,"500":32}`; codes: `{"INTERNAL_ERROR":32}`
- Expected 409: 0; unexpected errors: 32; timeouts: 0
- Latency ms: avg 12465.69, p50 12447.89, p95 13160.63, p99 13163.43, max 13164.28
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":368,"ExclusiveLock":52,"RowExclusiveLock":180,"RowShareLock":76}}`
- API pool peaks: `[{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":900,"minimumIdle":0},{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":815,"minimumIdle":0}]` (126 samples; 0 discarded)

## Integrity

`{}`

## Query plans



## Optimization


No production optimization applied because the baseline did not complete; correctness assertions were not weakened.

## Failure

Expected values to be strictly equal:

968 !== 1000

