# Booking load report

Isolated staging capacity measurement on one disposable database and the configured deployment-like API process topology; fixture/bootstrap time is excluded. Never point this destructive harness at live customer data.

Configuration and connection budget: `{"profile":"development","serverMode":"isolated Express app without unrelated schedulers/workers","apiProcesses":2,"expectedDeploymentProcesses":2,"topologyMatched":true,"poolMaxPerProcess":10,"harnessPoolMax":10,"connectionReserve":5,"databaseConnectionBudget":35,"databaseMaxConnections":100,"plannedConnections":35,"dbConnectionTimeoutMs":15000,"bookingAdmissionPerProcess":10000,"productionAdmissionDefaultPerProcess":0,"activityStateTelemetrySetup":"enabled"}`; request timeout: 30000 ms.

## Objectives

Peak-spike objectives cap both p95 and p99 at 10 seconds across 1,000 simultaneous distinct booking arrivals, with no approved capacity-rejection budget. BOOKING_CAPACITY responses count against the error objective. Production admission remains disabled by default.

Customer objectives: `{"same-slot":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"1000-distinct":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"250-groups":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"mixed-1000":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001}}`

Operational objectives: `{"same-slot":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"1000-distinct":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"250-groups":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"mixed-1000":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000}}`

## same-slot

- Requests: 200; throughput: 57.9 req/s
- Statuses: `{"201":1,"409":199}`; codes: `{}`
- Expected 409: 199; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2159.80, p50 1752.38, p95 3269.80, p99 3333.42, max 3341.13
- Database statements: 5114 total; 25.57 per request; per API process `[2041,3073]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":3269.800964,"p99Ms":3333.423629,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":150,"maximumPeakLocks":500},"observed":{"throughputPerSecond":57.869946024255746,"peakWaitingPerProcess":[91,91],"peakLocks":294},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":29},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":29},"statePeaks":{"active":11,"idle":29,"idle in transaction":2},"lockPeaks":{"AccessShareLock":189,"ExclusiveLock":31,"RowExclusiveLock":18,"RowShareLock":56}}`
- API pool peaks: `[{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0},{"observedSamples":29,"configuredMax":10,"peakTotal":10,"peakWaiting":91,"minimumIdle":0}]` (29 samples; 0 discarded)

## 1000-distinct

- Requests: 1000; throughput: 128.0 req/s
- Statuses: `{"201":1000}`; codes: `{}`
- Expected 409: 0; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4779.13, p50 5083.88, p95 7230.81, p99 7478.81, max 7540.03
- Database statements: 24040 total; 24.04 per request; per API process `[12020,12020]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":7230.813576,"p99Ms":7478.806856,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":60,"maximumPeakWaitingPerProcess":1000,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":128.01564638773206,"peakWaitingPerProcess":[460,456],"peakLocks":659},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":69},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":69},"statePeaks":{"active":19,"idle":28,"idle in transaction":8},"lockPeaks":{"AccessShareLock":445,"ExclusiveLock":68,"RowExclusiveLock":23,"RowShareLock":123}}`
- API pool peaks: `[{"observedSamples":69,"configuredMax":10,"peakTotal":10,"peakWaiting":460,"minimumIdle":0},{"observedSamples":69,"configuredMax":10,"peakTotal":10,"peakWaiting":456,"minimumIdle":0}]` (69 samples; 0 discarded)

## 250-groups

- Requests: 250; throughput: 83.6 req/s
- Statuses: `{"201":125,"409":125}`; codes: `{}`
- Expected 409: 125; unexpected errors: 0; timeouts: 0
- Latency ms: avg 2414.53, p50 2610.48, p95 2862.67, p99 2869.16, max 2877.69
- Database statements: 10275 total; 41.10 per request; per API process `[5158,5117]`
- Customer objective: **PASS** `{"targets":{"p95Ms":5000,"p99Ms":5000,"maxUnexpectedErrorRate":0},"observed":{"p95Ms":2862.6700859999983,"p99Ms":2869.157432,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":50,"maximumPeakWaitingPerProcess":250,"maximumPeakLocks":1200},"observed":{"throughputPerSecond":83.62731719445955,"peakWaitingPerProcess":[116,116],"peakLocks":882},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":28},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":28},"statePeaks":{"active":17,"idle":21,"idle in transaction":8},"lockPeaks":{"AccessShareLock":581,"ExclusiveLock":69,"RowExclusiveLock":29,"RowShareLock":203}}`
- API pool peaks: `[{"observedSamples":28,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0},{"observedSamples":28,"configuredMax":10,"peakTotal":10,"peakWaiting":116,"minimumIdle":0}]` (28 samples; 0 discarded)

## mixed-1000

- Requests: 1000; throughput: 145.1 req/s
- Statuses: `{"200":500,"201":255,"409":245}`; codes: `{}`
- Expected 409: 245; unexpected errors: 0; timeouts: 0
- Latency ms: avg 4543.91, p50 4642.39, p95 6560.38, p99 6720.46, max 6752.26
- Database statements: 21455 total; 21.45 per request; per API process `[12250,9205]`
- Customer objective: **PASS** `{"targets":{"p95Ms":10000,"p99Ms":10000,"maxUnexpectedErrorRate":0.001},"observed":{"p95Ms":6560.384915000002,"p99Ms":6720.461010000001,"unexpectedErrorRate":0},"checks":{"p95":true,"p99":true,"unexpectedErrorRate":true},"passed":true}`
- Operational objective: **PASS** `{"targets":{"minimumThroughputPerSecond":100,"maximumPeakWaitingPerProcess":1250,"maximumPeakLocks":1000},"observed":{"throughputPerSecond":145.10546122573433,"peakWaitingPerProcess":[742,680],"peakLocks":823},"checks":{"throughput":true,"poolWaiting":true,"locks":true},"passed":true}`
- DB activity peaks: `{"scope":"All connections and locks for the disposable database, including the harness sampler.","activityStateTelemetry":"available","activityStateEvidence":{"available":true,"observedSamples":60},"lockTelemetry":"available","lockEvidence":{"available":true,"observedSamples":60},"statePeaks":{"active":14,"idle":21,"idle in transaction":8},"lockPeaks":{"AccessShareLock":519,"ExclusiveLock":56,"RowExclusiveLock":96,"RowShareLock":152}}`
- API pool peaks: `[{"observedSamples":60,"configuredMax":10,"peakTotal":10,"peakWaiting":742,"minimumIdle":0},{"observedSamples":60,"configuredMax":10,"peakTotal":10,"peakWaiting":680,"minimumIdle":0}]` (60 samples; 0 discarded)

## Integrity

`{"sameSlotActive":1,"distinctAppointments":1000,"distinctCustomers":1000,"cancelledAppointments":250,"mixedSingleAppointments":250,"successfulBookingGroups":131,"partialGroups":0,"crossCustomerRows":0,"activeOverlaps":0,"markerOwned":true}`

## Query plans

- appointment overlap: `{"planningMs":0.101,"executionMs":0.03,"node":"Index Scan","index":"appointments_employee_date_status_idx","nodes":["Index Scan"],"indexes":["appointments_employee_date_status_idx"],"actualRows":0,"sharedHitBlocks":20,"sharedReadBlocks":0}`
- availability loaded appointments: `{"planningMs":0.107,"executionMs":0.207,"node":"Sort","index":null,"nodes":["Sort","Index Scan"],"indexes":["appointments_schedule_lookup_index"],"actualRows":110,"sharedHitBlocks":200,"sharedReadBlocks":0}`

Plan assessment: **PASS** — Both booking overlap and availability reads use an index-backed plan with execution time <= 50 ms.

## Bottleneck assessments

`[]`

## Optimization decision


All latency and error objectives passed. Query plans were index-backed, so no query reduction, bounded admission control, or database connection increase is justified by this run.
