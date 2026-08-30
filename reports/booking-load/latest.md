# Booking load report

Development/test-only measurement on one disposable database and two loopback API processes; fixture/bootstrap time is excluded and results are not production capacity planning.

Configuration: `{"apiProcesses":2,"poolMaxPerProcess":10,"dbConnectionTimeoutMs":15000}`; request timeout: 30000 ms.

## same-slot

- Requests: 200; throughput: 61.7 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2131.72, p50 2277.42, p95 3063.66, p99 3123.23, max 3140.81
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":163,"ExclusiveLock":23,"RowExclusiveLock":18,"RowShareLock":117,"ShareLock":1}}`
- API pool peaks: `[{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":92,"minimumIdle":0},{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (29 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 72.5 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 13210.58, p50 13294.25, p95 13635.60, p99 13639.88, max 13644.01
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":376,"ExclusiveLock":52,"RowExclusiveLock":180,"RowShareLock":216}}`
- API pool peaks: `[{"observedSamples":131,"configuredMax":10,"peakTotal":10,"peakWaiting":814,"minimumIdle":0},{"observedSamples":131,"configuredMax":10,"peakTotal":10,"peakWaiting":874,"minimumIdle":0}]` (131 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 68.6 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 3160.71, p50 3124.91, p95 3560.52, p99 3568.91, max 3569.67
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":482,"ExclusiveLock":53,"RowExclusiveLock":171,"RowShareLock":275}}`
- API pool peaks: `[{"observedSamples":35,"configuredMax":10,"peakTotal":10,"peakWaiting":157,"minimumIdle":0},{"observedSamples":35,"configuredMax":10,"peakTotal":10,"peakWaiting":157,"minimumIdle":0}]` (35 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 119.9 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 5058.44, p50 4691.78, p95 8233.93, p99 8236.56, max 8237.44
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":522,"ExclusiveLock":51,"RowExclusiveLock":100,"RowShareLock":190}}`
- API pool peaks: `[{"observedSamples":79,"configuredMax":10,"peakTotal":10,"peakWaiting":1040,"minimumIdle":0},{"observedSamples":79,"configuredMax":10,"peakTotal":10,"peakWaiting":1036,"minimumIdle":0}]` (79 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.085,"executionMs":0.022,"node":"Index Scan","index":"appointments_employee_date_status_idx","actualRows":0,"sharedHitBlocks":11,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.132,"executionMs":0.141,"node":"Sort","index":null,"actualRows":110,"sharedHitBlocks":192,"sharedReadBlocks":0}`

## Optimization

- Change: Raised the default pg-pool connection/acquisition timeout from 5,000 ms to 15,000 ms without increasing either API process's 10-connection pool.
- Before: `{"report":"baseline-pool-timeout.json","marker":"booking-load-16079","configuration":{"apiProcesses":2,"poolMaxPerProcess":10,"dbConnectionTimeoutMs":5000},"scenario":"1000-distinct","statuses":{"201":968,"500":32},"codes":{"INTERNAL_ERROR":32},"timeouts":0,"unexpectedErrors":32,"latency":{"average":12465.691398919009,"p50":12447.890666000001,"p95":13160.626509000002,"p99":13163.431152999998,"max":13164.276280000002},"poolPeaks":[{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":900,"minimumIdle":0},{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":815,"minimumIdle":0}]}`
- After: `{"report":"latest.json","marker":"booking-load-16264","configuration":{"apiProcesses":2,"poolMaxPerProcess":10,"dbConnectionTimeoutMs":15000},"scenario":"1000-distinct","statuses":{"201":1000},"codes":{},"timeouts":0,"unexpectedErrors":0,"latency":{"average":13210.57942567502,"p50":13294.251396,"p95":13635.603317000001,"p99":13639.883973999998,"max":13644.013362000002},"poolPeaks":[{"observedSamples":131,"configuredMax":10,"peakTotal":10,"peakWaiting":814,"minimumIdle":0},{"observedSamples":131,"configuredMax":10,"peakTotal":10,"peakWaiting":874,"minimumIdle":0}]}`

Applied only the measured pool-acquisition timeout fix. The complete 30-second run then passed without timeout, 5xx, duplicate active slots, partial groups, or cross-customer leakage. Pool size remains unchanged because increasing database connections without a connection budget would be unsafe.
