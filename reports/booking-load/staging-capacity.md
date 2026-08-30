# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 83.6 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1507.73, p50 1384.93, p95 2213.26, p99 2253.57, max 2266.46
- Database statements: 3571 total; 17.86 per request; per API process `[1642,1929]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2213.261782,"p99Ms":2253.571741,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":83.63254664541414,"peakWaitingPerProcess":[91,91],"peakLocks":319},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","statePeaks":{"disabled":30,"null":1},"lockPeaks":{"AccessShareLock":152,"ExclusiveLock":21,"RowExclusiveLock":18,"RowShareLock":127,"ShareLock":1}}`
- API pool peaks: `[{"observedSamples":20,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":20,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (20 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 119.4 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4954.39, p50 5187.16, p95 7956.72, p99 8218.14, max 8284.18
- Database statements: 18040 total; 18.04 per request; per API process `[9020,9020]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":7956.720670999999,"p99Ms":8218.142856999999,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":119.40392352530847,"peakWaitingPerProcess":[491,468],"peakLocks":588},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":373,"ExclusiveLock":51,"RowExclusiveLock":24,"RowShareLock":140}}`
- API pool peaks: `[{"observedSamples":78,"configuredMax":10,"peakTotal":10,"peakWaiting":491,"minimumIdle":0},{"observedSamples":78,"configuredMax":10,"peakTotal":10,"peakWaiting":468,"minimumIdle":0}]` (78 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 78.2 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2745.14, p50 2694.47, p95 3130.96, p99 3136.16, max 3137.25
- Database statements: 9400 total; 37.60 per request; per API process `[4763,4637]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":3130.9580160000023,"p99Ms":3136.1639399999985,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":78.22163432260287,"peakWaitingPerProcess":[137,156],"peakLocks":875},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":484,"ExclusiveLock":53,"RowExclusiveLock":63,"RowShareLock":275}}`
- API pool peaks: `[{"observedSamples":31,"configuredMax":10,"peakTotal":10,"peakWaiting":137,"minimumIdle":0},{"observedSamples":31,"configuredMax":10,"peakTotal":10,"peakWaiting":156,"minimumIdle":0}]` (31 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 139.4 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4646.74, p50 4784.02, p95 6881.10, p99 7066.48, max 7087.55
- Database statements: 18960 total; 18.96 per request; per API process `[10750,8210]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":6881.100279999999,"p99Ms":7066.476122,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":139.36176427870703,"peakWaitingPerProcess":[1018,1144],"peakLocks":789},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":446,"ExclusiveLock":53,"RowExclusiveLock":100,"RowShareLock":190}}`
- API pool peaks: `[{"observedSamples":65,"configuredMax":10,"peakTotal":10,"peakWaiting":1018,"minimumIdle":0},{"observedSamples":65,"configuredMax":10,"peakTotal":10,"peakWaiting":1144,"minimumIdle":0}]` (65 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.094,"executionMs":0.025,"node":"Index Scan","index":"appointments_schedule_lookup_index","nodes":["Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":0,"sharedHitBlocks":22,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.069,"executionMs":0.135,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":189,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[]`

## Optimization decision

- Change: Reduced the all-admitted booking path by reusing locked facts, combining eligibility/policy reads, skipping irrelevant resource queries, returning known allocations, and transactionally batching durable communication outbox writes before worker-based delivery.
- Before: `{"report":"staging-capacity.json (previous verified profile)","scenario":"1000-distinct","databaseStatementsPerRequest":43.94,"throughputPerSecond":64.77178448584051,"p95Ms":15342.842133000002,"p99Ms":15345.600534999998,"unexpectedErrors":0}`
- After: `{"report":"staging-capacity.json","marker":"booking-load-16014","configuration":{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0},"scenario":"1000-distinct","statuses":{"201":1000},"codes":{},"timeouts":0,"unexpectedErrors":0,"latency":{"average":4954.389844912001,"p50":5187.163868,"p95":7956.720670999999,"p99":8218.142856999999,"max":8284.175578},"poolPeaks":[{"observedSamples":78,"configuredMax":10,"peakTotal":10,"peakWaiting":491,"minimumIdle":0},{"observedSamples":78,"configuredMax":10,"peakTotal":10,"peakWaiting":468,"minimumIdle":0}]}`

The optimized all-admitted path completed every arrival below the p95/p99 limits with zero unexpected errors and no increase to the 35-connection budget. Admission remains disabled by default.
