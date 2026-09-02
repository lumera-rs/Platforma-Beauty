export function isRetryableBeautyJobDetailError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      return status >= 500 || status === 408 || status === 429;
    }
  }

  return true;
}

export function shouldRetryBeautyJobDetail(failureCount: number, error: unknown): boolean {
  return isRetryableBeautyJobDetailError(error) && failureCount < 3;
}

export function shouldRetryBeautyJobDetailOnMount(query: { state: { error: unknown } }): boolean {
  return isRetryableBeautyJobDetailError(query.state.error);
}