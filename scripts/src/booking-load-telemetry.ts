export type ActivitySample = {
  states: Array<{ state: string; count: number }>;
  locks: Array<{ mode: string; count: number }>;
  apiPools: Array<{ total: number; idle: number; waiting: number; max: number } | null>;
};

export type SamplingFailure = {
  kind: "permission-denied" | "unavailable";
  source?: "pg_stat_activity" | "pg_locks";
  code?: string;
  message: string;
};

const realActivityStates = new Set([
  "active",
  "idle",
  "idle in transaction",
  "idle in transaction (aborted)",
  "fastpath function call",
]);

export function classifySamplingFailure(error: unknown): SamplingFailure {
  const candidate = error && typeof error === "object"
    ? error as { code?: unknown; message?: unknown; telemetrySource?: unknown }
    : {};
  const code = typeof candidate.code === "string" ? candidate.code : undefined;
  const rawMessage = typeof candidate.message === "string" ? candidate.message : String(error);
  const message = rawMessage.replace(/postgres(?:ql)?:\/\/[^@]*@[^\s"']*/gi, "postgres://<redacted>");
  return {
    kind: code === "42501" || /permission denied|must be superuser/i.test(message)
      ? "permission-denied"
      : "unavailable",
    ...(candidate.telemetrySource === "pg_stat_activity" || candidate.telemetrySource === "pg_locks"
      ? { source: candidate.telemetrySource }
      : {}),
    ...(code ? { code } : {}),
    message,
  };
}

export function hasRealActivityStateEvidence(scenario: any): boolean {
  const pg = scenario?.dbActivity?.pg;
  if (pg?.activityStateEvidence?.available === true) return pg.activityStateEvidence.observedSamples > 0;
  const peaks = pg?.statePeaks;
  return pg?.activityStateTelemetry === "available"
    && peaks
    && Object.entries(peaks).some(([state, count]) => realActivityStates.has(state) && Number(count) > 0);
}

export function summarizeActivity(
  samples: ActivitySample[],
  samplingFailures: SamplingFailure[],
  serverCount: number,
) {
  const statePeaks: Record<string, number> = {};
  const lockPeaks: Record<string, number> = {};
  let activityStateSamples = 0;
  let lockSamples = 0;
  for (const sample of samples) {
    const hasRealState = sample.states.some((state) => realActivityStates.has(state.state) && state.count > 0);
    if (hasRealState) activityStateSamples++;
    if (sample.locks.some((lock) => lock.count > 0)) lockSamples++;
    for (const state of sample.states) statePeaks[state.state] = Math.max(statePeaks[state.state] ?? 0, state.count);
    for (const lock of sample.locks) lockPeaks[lock.mode] = Math.max(lockPeaks[lock.mode] ?? 0, lock.count);
  }
  const permissionFailure = samplingFailures.find((failure) => failure.kind === "permission-denied");
  const onlyDisabled = Object.keys(statePeaks).length > 0
    && Object.keys(statePeaks).every((state) => state === "disabled");
  const onlyRestricted = Object.keys(statePeaks).length > 0
    && Object.keys(statePeaks).every((state) => state === "null");
  const unavailableReason = permissionFailure
    ? `permission denied${permissionFailure.code ? ` (${permissionFailure.code})` : ""}`
    : onlyDisabled
      ? "PostgreSQL activity tracking is disabled for the observed sessions"
      : onlyRestricted
        ? "PostgreSQL restricted activity state visibility for the sampler role"
        : samplingFailures.length
          ? `sampling query failed (${samplingFailures[0]!.code ?? samplingFailures[0]!.kind})`
          : "no real PostgreSQL activity states were observed";
  return {
    sampleCount: samples.length,
    samplingErrors: samplingFailures.length,
    samplingFailures,
    pg: {
      scope: "All connections and locks for the disposable database, including the harness sampler.",
      activityStateTelemetry: activityStateSamples > 0 ? "available" : `unavailable: ${unavailableReason}`,
      activityStateEvidence: {
        available: activityStateSamples > 0,
        observedSamples: activityStateSamples,
      },
      lockTelemetry: lockSamples > 0 ? "available" : "unavailable: no pg_locks rows were observed",
      lockEvidence: {
        available: lockSamples > 0,
        observedSamples: lockSamples,
      },
      statePeaks,
      lockPeaks,
    },
    apiPools: Array.from({ length: serverCount }, (_, index) => {
      const values = samples.map((sample) => sample.apiPools[index]).filter((value): value is NonNullable<typeof value> => value !== null);
      return {
        observedSamples: values.length,
        configuredMax: Math.max(0, ...values.map((value) => value.max)),
        peakTotal: Math.max(0, ...values.map((value) => value.total)),
        peakWaiting: Math.max(0, ...values.map((value) => value.waiting)),
        minimumIdle: values.length ? Math.min(...values.map((value) => value.idle)) : null,
      };
    }),
  };
}