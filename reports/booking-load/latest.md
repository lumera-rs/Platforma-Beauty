# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"development","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 74.3 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 1740.28, p50 1471.59, p95 2545.62, p99 2586.26, max 2595.80
- Database statements: 3971 total; 19.86 per request; per API process `[1841,2130]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2545.6179130000005,"p99Ms":2586.259188,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":74.32988234629907,"peakWaitingPerProcess":[91,91],"peakLocks":266},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":21},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":21},"statePeaks":{"active":12,"idle":29,"idle in transaction":2},"lockPeaks":{"AccessShareLock":178,"ExclusiveLock":31,"RowExclusiveLock":20,"RowShareLock":37}}`
- API pool peaks: `[{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":21,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (21 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 91.8 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 6058.71, p50 6317.05, p95 10343.08, p99 10682.20, max 10772.58
- Database statements: 21040 total; 21.04 per request; per API process `[10520,10520]`
- Customer objective: **FAIL** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":10343.076636000002,"p99Ms":10682.203505000001,"unexpectedErrorRate":0},"checks":{"p95":false,"p99":false,"unexpectedErrorRate":true},"passed":false}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":91.83989541260954,"peakWaitingPerProcess":[477,484],"peakLocks":703},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":102},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":102},"statePeaks":{"active":20,"idle":29,"idle in transaction":9},"lockPeaks":{"AccessShareLock":452,"ExclusiveLock":71,"RowExclusiveLock":30,"RowShareLock":150}}`
- API pool peaks: `[{"observedSamples":102,"configuredMax":10,"peakTotal":10,"peakWaiting":477,"minimumIdle":0},{"observedSamples":102,"configuredMax":10,"peakTotal":10,"peakWaiting":484,"minimumIdle":0}]` (102 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 58.8 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 3369.50, p50 3737.58, p95 4108.83, p99 4125.07, max 4126.62
- Database statements: 9775 total; 39.10 per request; per API process `[4908,4867]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":4108.831431000002,"p99Ms":4125.074764000001,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":58.849464758597954,"peakWaitingPerProcess":[116,116],"peakLocks":937},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":39},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":39},"statePeaks":{"active":17,"idle":20,"idle in transaction":8},"lockPeaks":{"AccessShareLock":582,"ExclusiveLock":71,"RowExclusiveLock":30,"RowShareLock":254}}`
- API pool peaks: `[{"observedSamples":39,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0},{"observedSamples":39,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0}]` (39 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 140.4 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4772.15, p50 4915.92, p95 6833.28, p99 6966.68, max 6989.09
- Database statements: 20205 total; 20.20 per request; per API process `[11500,8705]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":6833.279111,"p99Ms":6966.679683000002,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":140.38469339287985,"peakWaitingPerProcess":[1040,1229],"peakLocks":861},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":65},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":65},"statePeaks":{"active":19,"idle":20,"idle in transaction":7},"lockPeaks":{"AccessShareLock":511,"ExclusiveLock":68,"RowExclusiveLock":97,"RowShareLock":185}}`
- API pool peaks: `[{"observedSamples":65,"configuredMax":10,"peakTotal":10,"peakWaiting":1040,"minimumIdle":0},{"observedSamples":65,"configuredMax":10,"peakTotal":10,"peakWaiting":1229,"minimumIdle":0}]` (65 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.082,"executionMs":0.019,"node":"Index Scan","index":"appointments_employee_date_status_idx","nodes":["Index Scan"],"indexes":["appointments_employee_date_status_idx"],"actualRows":0,"sharedHitBlocks":11,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.275,"executionMs":0.166,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":186,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[{"scenario":"1000-distinct","evidence":{"observedThroughputPerSecond":91.83989541260954,"requiredP95ThroughputPerSecond":95,"requiredP99ThroughputPerSecond":99,"queryReductionUpliftPercent":7.796290005800022,"poolsSaturated":true,"plansIndexBackedAndFast":true,"maximumAllowedRejectedRequests":1,"minimumRejectedToReachP95AtObservedThroughput":32},"boundedAdmission":"cannot meet the latency objective by rejecting excess work without violating the error budget; queueing alone cannot increase throughput","queryReduction":"is the first bottleneck fix to test because service throughput must rise while indexed plans are individually fast and both pools are saturated","verdict":"Bounded admission is not a valid fix within the error target. Test query-count/round-trip reduction first; it needs at least 7.8% throughput uplift before any production query change."}]`

## Optimization decision

- Change: Raised the default pg-pool connection/acquisition timeout from 5,000 ms to 15,000 ms without increasing either API process's 10-connection pool.
- Before: `{"report":"baseline-pool-timeout.json","marker":"booking-load-16079","configuration":{"apiProcesses":2,"poolMaxPerProcess":10,"dbConnectionTimeoutMs":5000},"scenario":"1000-distinct","statuses":{"201":968,"500":32},"codes":{"INTERNAL_ERROR":32},"timeouts":0,"unexpectedErrors":32,"latency":{"average":12465.691398919009,"p50":12447.890666000001,"p95":13160.626509000002,"p99":13163.431152999998,"max":13164.276280000002},"poolPeaks":[{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":900,"minimumIdle":0},{"observedSamples":126,"configuredMax":10,"peakTotal":10,"peakWaiting":815,"minimumIdle":0}]}`
- After: `{"report":"latest.json","marker":"booking-load-37753","configuration":{"profile":"development","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":112,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"},"scenario":"1000-distinct","statuses":{"201":1000},"codes":{},"timeouts":0,"unexpectedErrors":0,"latency":{"average":6058.709313660997,"p50":6317.052069,"p95":10343.076636000002,"p99":10682.203505000001,"max":10772.580570000002},"poolPeaks":[{"observedSamples":102,"configuredMax":10,"peakTotal":10,"peakWaiting":477,"minimumIdle":0},{"observedSamples":102,"configuredMax":10,"peakTotal":10,"peakWaiting":484,"minimumIdle":0}]}`

A customer objective was missed. No production change is allowed until controlled query-reduction and bounded-admission variants identify the bottleneck without violating the error target.

## Failure

customer latency/error objectives missed: 1000-distinct
+ actual - expected

+ [
+   '1000-distinct'
+ ]
- []
