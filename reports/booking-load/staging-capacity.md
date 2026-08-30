# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap p95 at 16 seconds and p99 at 17 seconds for 1,000 simultaneous distinct bookings, below the outer 30-second request deadline and with explicit variance headroom. Expected business conflicts (409) are not errors; network failures and 5xx responses are.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":16000,"p99Ms":17000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1200,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 64.1 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2071.32, p50 2225.58, p95 2896.56, p99 2939.21, max 2960.55
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2896.5612760000004,"p99Ms":2939.2072770000004,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":64.05839770571595,"peakWaitingPerProcess":[91,91],"peakLocks":390},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":224,"ExclusiveLock":39,"RowShareLock":108,"ShareLock":1,"RowExclusiveLock":18}}`
- API pool peaks: `[{"observedSamples":28,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":28,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (28 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 64.8 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 14882.78, p50 15045.14, p95 15342.84, p99 15345.60, max 15347.62
- Customer objective: **PASS** `{"targets":{"p95Ms":16000,"p99Ms":17000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":15342.842133000002,"p99Ms":15345.600534999998,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":64.77178448584051,"peakWaitingPerProcess":[869,882],"peakLocks":746},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":380,"ExclusiveLock":53,"RowExclusiveLock":162,"RowShareLock":151}}`
- API pool peaks: `[{"observedSamples":145,"configuredMax":10,"peakTotal":10,"peakWaiting":869,"minimumIdle":0},{"observedSamples":145,"configuredMax":10,"peakTotal":10,"peakWaiting":882,"minimumIdle":0}]` (145 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 60.5 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 3614.60, p50 3595.11, p95 4051.60, p99 4055.62, max 4056.35
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":4051.6045099999974,"p99Ms":4055.622692000001,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":60.471796593376695,"peakWaitingPerProcess":[158,160],"peakLocks":816},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":478,"ExclusiveLock":50,"RowExclusiveLock":70,"RowShareLock":218}}`
- API pool peaks: `[{"observedSamples":40,"configuredMax":10,"peakTotal":10,"peakWaiting":158,"minimumIdle":0},{"observedSamples":40,"configuredMax":10,"peakTotal":10,"peakWaiting":160,"minimumIdle":0}]` (40 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 107.8 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 5789.13, p50 5529.00, p95 9143.01, p99 9144.35, max 9145.49
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":9143.005760999997,"p99Ms":9144.349887999997,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1200,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":107.80972416019918,"peakWaitingPerProcess":[1048,1192],"peakLocks":662},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":417,"ExclusiveLock":47,"RowExclusiveLock":90,"RowShareLock":108}}`
- API pool peaks: `[{"observedSamples":88,"configuredMax":10,"peakTotal":10,"peakWaiting":1048,"minimumIdle":0},{"observedSamples":88,"configuredMax":10,"peakTotal":10,"peakWaiting":1192,"minimumIdle":0}]` (88 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.148,"executionMs":0.024,"node":"Index Scan","index":"appointments_schedule_lookup_index","nodes":["Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":0,"sharedHitBlocks":21,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.119,"executionMs":0.145,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":186,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[]`

## Optimization decision


All latency and error objectives passed. Query plans were index-backed, so no query reduction, bounded admission control, or database connection increase is justified by this run.
