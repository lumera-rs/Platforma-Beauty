# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 77.6 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1596.16, p50 1283.93, p95 2356.75, p99 2396.77, max 2407.25
- Database statements: 3971 total; 19.86 per request; per API process `[1841,2130]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2356.754405,"p99Ms":2396.7682029999996,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":77.55107427767173,"peakWaitingPerProcess":[91,91],"peakLocks":371},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":21},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":21},"statePeaks":{"active":12,"idle":28,"idle in transaction":7},"lockPeaks":{"AccessShareLock":184,"ExclusiveLock":30,"RowExclusiveLock":18,"RowShareLock":138,"ShareLock":1}}`
- API pool peaks: `[{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (21 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 109.4 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 5205.34, p50 5400.71, p95 8673.22, p99 8956.30, max 9030.63
- Database statements: 21040 total; 21.04 per request; per API process `[10520,10520]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":8673.220349000001,"p99Ms":8956.298625,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":109.41348917291499,"peakWaitingPerProcess":[488,480],"peakLocks":716},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":86},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":86},"statePeaks":{"active":20,"idle":28,"idle in transaction":9},"lockPeaks":{"AccessShareLock":452,"ExclusiveLock":71,"RowExclusiveLock":27,"RowShareLock":166}}`
- API pool peaks: `[{"observedSamples":86,"configuredMax":10,"peakTotal":10,"peakWaiting":488,"minimumIdle":0},{"observedSamples":86,"configuredMax":10,"peakTotal":10,"peakWaiting":480,"minimumIdle":0}]` (86 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 72.2 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2828.91, p50 3054.34, p95 3342.79, p99 3369.71, max 3380.52
- Database statements: 9775 total; 39.10 per request; per API process `[4908,4867]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":3342.7888189999994,"p99Ms":3369.70564,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":72.1623555158499,"peakWaitingPerProcess":[116,116],"peakLocks":991},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":33},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":33},"statePeaks":{"active":19,"idle":21,"idle in transaction":9},"lockPeaks":{"AccessShareLock":611,"ExclusiveLock":71,"RowExclusiveLock":34,"RowShareLock":275}}`
- API pool peaks: `[{"observedSamples":33,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0},{"observedSamples":33,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0}]` (33 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 154.4 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4255.71, p50 4427.62, p95 6146.31, p99 6304.87, max 6320.01
- Database statements: 20205 total; 20.20 per request; per API process `[11500,8705]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":6146.306949999998,"p99Ms":6304.873004000001,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":154.40497447692107,"peakWaitingPerProcess":[1037,1115],"peakLocks":845},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":59},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":59},"statePeaks":{"active":19,"idle":20,"idle in transaction":8},"lockPeaks":{"AccessShareLock":497,"ExclusiveLock":68,"RowExclusiveLock":100,"RowShareLock":180}}`
- API pool peaks: `[{"observedSamples":59,"configuredMax":10,"peakTotal":10,"peakWaiting":1037,"minimumIdle":0},{"observedSamples":59,"configuredMax":10,"peakTotal":10,"peakWaiting":1115,"minimumIdle":0}]` (59 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.082,"executionMs":0.02,"node":"Index Scan","index":"appointments_employee_date_status_idx","nodes":["Index Scan"],"indexes":["appointments_employee_date_status_idx"],"actualRows":0,"sharedHitBlocks":12,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.084,"executionMs":0.136,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":185,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[]`

## Optimization decision

- Change: Reduced the all-admitted booking path by reusing locked facts, combining eligibility/policy reads, skipping irrelevant resource queries, returning known allocations, and transactionally batching durable communication outbox writes before worker-based delivery.
- Before: `{"report":"staging-capacity.json (previous verified profile)","scenario":"1000-distinct","databaseStatementsPerRequest":43.94,"throughputPerSecond":64.77178448584051,"p95Ms":15342.842133000002,"p99Ms":15345.600534999998,"unexpectedErrors":0}`
- After: `{"report":"staging-capacity.json","marker":"booking-load-38466","configuration":{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"},"scenario":"1000-distinct","statuses":{"201":1000},"codes":{},"timeouts":0,"unexpectedErrors":0,"latency":{"average":5205.339977006007,"p50":5400.705269000001,"p95":8673.220349000001,"p99":8956.298625,"max":9030.631703},"poolPeaks":[{"observedSamples":86,"configuredMax":10,"peakTotal":10,"peakWaiting":488,"minimumIdle":0},{"observedSamples":86,"configuredMax":10,"peakTotal":10,"peakWaiting":480,"minimumIdle":0}]}`

The optimized all-admitted path completed every arrival below the p95/p99 limits with zero unexpected errors and no increase to the 35-connection budget. Admission remains disabled by default.
