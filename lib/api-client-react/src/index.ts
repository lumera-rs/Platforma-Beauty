export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  ApiError,
  NetworkError,
  isNetworkError,
  getApiErrorDetails,
  getApiErrorMessage,
  setBaseUrl,
  setAuthTokenGetter,
  customFetch,
  bookingCommandKey,
  clearBookingCommandKey,
  createTargetedIdempotencyKeys,
} from "./custom-fetch";
export type { ApiErrorData, ApiErrorDetails, AuthTokenGetter, CustomFetchOptions } from "./custom-fetch";
export {
  createWidgetAppointmentCommand,
  createWidgetBookingGroupCommand,
  useCreateWidgetBookingGroupCommand,
} from "./widget-booking";
export type {
  WidgetAppointmentCommand,
  WidgetBookingGroupCommand,
} from "./widget-booking";
