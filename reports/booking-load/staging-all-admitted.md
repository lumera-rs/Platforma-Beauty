# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"staging","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":1000,"productionAdmissionDefaultPerProcess":0}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals. The all-admitted profile proves 1,000 successful writes exceed that bound under the fixed budget; this run measures the bounded-admission level required to protect response latency. BOOKING_CAPACITY responses are intentional experiment outcomes, but no production rejection budget is approved and admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1200,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 91.2 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1374.30, p50 1402.39, p95 2021.69, p99 2047.81, max 2058.92
- Database statements: 3571 total; 17.86 per request; per API process `[1642,1929]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2021.6944680000001,"p99Ms":2047.8064970000005,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":91.16347142930812,"peakWaitingPerProcess":[91,91],"peakLocks":307},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":148,"ExclusiveLock":23,"RowExclusiveLock":19,"RowShareLock":117}}`
- API pool peaks: `[{"observedSamples":19,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":19,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (19 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 116.5 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 7051.93, p50 7855.43, p95 8458.24, p99 8479.46, max 8485.19
- Database statements: 18040 total; 18.04 per request; per API process `[9020,9020]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":8458.240494,"p99Ms":8479.458095,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":116.4717252825647,"peakWaitingPerProcess":[491,491],"peakLocks":608},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":30},"lockPeaks":{"AccessShareLock":391,"ExclusiveLock":52,"RowExclusiveLock":27,"RowShareLock":138}}`
- API pool peaks: `[{"observedSamples":81,"configuredMax":10,"peakTotal":10,"peakWaiting":491,"minimumIdle":0},{"observedSamples":81,"configuredMax":10,"peakTotal":10,"peakWaiting":491,"minimumIdle":0}]` (81 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 71.3 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2935.82, p50 3028.89, p95 3422.62, p99 3448.91, max 3451.03
- Database statements: 9400 total; 37.60 per request; per API process `[5057,4343]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":3422.6157509999994,"p99Ms":3448.914973000001,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":71.26133185335293,"peakWaitingPerProcess":[134,128],"peakLocks":700},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":419,"ExclusiveLock":50,"RowShareLock":159,"RowExclusiveLock":72}}`
- API pool peaks: `[{"observedSamples":34,"configuredMax":10,"peakTotal":10,"peakWaiting":134,"minimumIdle":0},{"observedSamples":34,"configuredMax":10,"peakTotal":10,"peakWaiting":128,"minimumIdle":0}]` (34 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 164.1 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4242.33, p50 4445.92, p95 5970.78, p99 5974.87, max 5979.88
- Database statements: 18960 total; 18.96 per request; per API process `[10750,8210]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":5970.7800080000015,"p99Ms":5974.8749800000005,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **FAIL** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1200,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":164.07136610899073,"peakWaitingPerProcess":[1034,1205],"peakLocks":756},"checks":{"throughput":true,"poolWaiting":false,"locks":true},"passed":false}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"unavailable: managed PostgreSQL reported state tracking as disabled","statePeaks":{"disabled":22},"lockPeaks":{"AccessShareLock":445,"ExclusiveLock":52,"RowExclusiveLock":95,"RowShareLock":164}}`
- API pool peaks: `[{"observedSamples":56,"configuredMax":10,"peakTotal":10,"peakWaiting":1034,"minimumIdle":0},{"observedSamples":56,"configuredMax":10,"peakTotal":10,"peakWaiting":1205,"minimumIdle":0}]` (56 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.093,"executionMs":0.023,"node":"Index Scan","index":"appointments_schedule_lookup_index","nodes":["Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":0,"sharedHitBlocks":25,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.071,"executionMs":0.126,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":178,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[{"scenario":"mixed-1000","evidence":{"observedThroughputPerSecond":164.07136610899073,"requiredP95ThroughputPerSecond":95,"requiredP99ThroughputPerSecond":99,"queryReductionUpliftPercent":0,"poolsSaturated":true,"plansIndexBackedAndFast":true,"maximumAllowedRejectedRequests":1,"minimumRejectedToReachP95AtObservedThroughput":0},"boundedAdmission":"could meet the latency objective within the error budget","queryReduction":"is not proven as the first bottleneck fix by this run","verdict":"No bottleneck fix is proven; collect another controlled comparison before changing production behavior."}]`

## Optimization decision


No production optimization applied because the baseline did not complete; correctness assertions were not weakened.

## Failure

throughput/pool/lock objectives missed: mixed-1000
+ actual - expected

+ [
+   'mixed-1000'
+ ]
- []

