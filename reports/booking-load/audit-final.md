# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"development","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":100,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 60.8 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2003.63, p50 1391.91, p95 3193.25, p99 3237.70, max 3246.13
- Database statements: 5114 total; 25.57 per request; per API process `[2041,3073]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":3193.2535970000004,"p99Ms":3237.696351,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":60.815344136546535,"peakWaitingPerProcess":[91,91],"peakLocks":314},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":29},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":29},"statePeaks":{"active":12,"idle":29,"idle in transaction":2},"lockPeaks":{"AccessShareLock":184,"ExclusiveLock":32,"RowExclusiveLock":18,"RowShareLock":80}}`
- API pool peaks: `[{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (29 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 166.4 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 3810.75, p50 4073.11, p95 5677.84, p99 5840.55, max 5884.18
- Database statements: 23040 total; 23.04 per request; per API process `[11520,11520]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":5677.838326000001,"p99Ms":5840.546434999999,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":166.39201864182834,"peakWaitingPerProcess":[454,452],"peakLocks":674},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":54},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":54},"statePeaks":{"active":18,"idle":29,"idle in transaction":6},"lockPeaks":{"AccessShareLock":436,"ExclusiveLock":69,"RowExclusiveLock":28,"RowShareLock":141}}`
- API pool peaks: `[{"observedSamples":54,"configuredMax":10,"peakTotal":10,"peakWaiting":454,"minimumIdle":0},{"observedSamples":54,"configuredMax":10,"peakTotal":10,"peakWaiting":452,"minimumIdle":0}]` (54 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 117.3 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1675.45, p50 1845.36, p95 2054.16, p99 2056.38, max 2056.58
- Database statements: 10275 total; 41.10 per request; per API process `[5240,5035]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2054.1558320000004,"p99Ms":2056.3848880000005,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":117.33811089063047,"peakWaitingPerProcess":[116,116],"peakLocks":886},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":21},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":21},"statePeaks":{"active":17,"idle":28,"idle in transaction":7},"lockPeaks":{"AccessShareLock":586,"ExclusiveLock":71,"RowShareLock":205,"RowExclusiveLock":24}}`
- API pool peaks: `[{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0},{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0}]` (21 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 192.1 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 3462.61, p50 3491.48, p95 4964.74, p99 5071.75, max 5092.26
- Database statements: 21205 total; 21.20 per request; per API process `[12000,9205]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":4964.740549999999,"p99Ms":5071.754387999998,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":192.0889259608735,"peakWaitingPerProcess":[835,885],"peakLocks":663},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":46},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":46},"statePeaks":{"active":15,"idle":21,"idle in transaction":8},"lockPeaks":{"AccessShareLock":446,"ExclusiveLock":62,"RowExclusiveLock":57,"RowShareLock":98}}`
- API pool peaks: `[{"observedSamples":46,"configuredMax":10,"peakTotal":10,"peakWaiting":835,"minimumIdle":0},{"observedSamples":46,"configuredMax":10,"peakTotal":10,"peakWaiting":885,"minimumIdle":0}]` (46 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.103,"executionMs":0.029,"node":"Index Scan","index":"appointments_employee_date_status_idx","nodes":["Index Scan"],"indexes":["appointments_employee_date_status_idx"],"actualRows":0,"sharedHitBlocks":22,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.105,"executionMs":0.161,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":198,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[]`

## Optimization decision


All latency and error objectives passed. Query plans were index-backed, so no query reduction, bounded admission control, or database connection increase is justified by this run.
