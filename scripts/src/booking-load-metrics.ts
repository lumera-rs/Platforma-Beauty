export type LoadSample = { status?: number; code?: string; milliseconds: number; timeout?: boolean };

export function classifyLoadSamples(samples: readonly LoadSample[]) {
  const statuses: Record<string, number> = {};
  const codes: Record<string, number> = {};
  for (const sample of samples) {
    if (sample.status !== undefined) statuses[String(sample.status)] = (statuses[String(sample.status)] ?? 0) + 1;
    if (sample.code) codes[sample.code] = (codes[sample.code] ?? 0) + 1;
  }
  return { statuses, codes, timeouts: samples.filter((sample) => sample.timeout).length };
}

export function latencySummary(samples: readonly LoadSample[]) {
  const values = samples.map((sample) => sample.milliseconds).sort((a, b) => a - b);
  const percentile = (p: number) => values.length === 0 ? 0 : values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!;
  return {
    average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0,
    p50: percentile(.50), p95: percentile(.95), p99: percentile(.99), max: values.at(-1) ?? 0,
  };
}