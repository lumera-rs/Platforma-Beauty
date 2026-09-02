import {
  useMutation,
  type UseMutationOptions,
  type UseMutationResult,
} from "@tanstack/react-query";
import {
  createWidgetAppointment,
  createWidgetBookingGroup,
  type CreateWidgetBookingGroupMutationError,
} from "./generated/api";
import type {
  BookingGroup,
  WidgetAppointmentCreate,
  WidgetAppointmentCreated,
  WidgetBookingGroupCreate,
  WidgetBookingIdempotencyKeyParameter,
} from "./generated/api.schemas";

export type WidgetAppointmentCommand = {
  slug: string;
  data: WidgetAppointmentCreate;
  idempotencyKey: WidgetBookingIdempotencyKeyParameter;
};

export type WidgetBookingGroupCommand = {
  slug: string;
  data: WidgetBookingGroupCreate;
  idempotencyKey: WidgetBookingIdempotencyKeyParameter;
};

export function createWidgetAppointmentCommand(
  command: WidgetAppointmentCommand,
): Promise<WidgetAppointmentCreated> {
  return createWidgetAppointment(command.slug, command.data, {
    headers: { "Idempotency-Key": command.idempotencyKey },
  });
}

export function createWidgetBookingGroupCommand(
  command: WidgetBookingGroupCommand,
): Promise<BookingGroup> {
  return createWidgetBookingGroup(command.slug, command.data, {
    headers: { "Idempotency-Key": command.idempotencyKey },
  });
}

export function useCreateWidgetBookingGroupCommand<TContext = unknown>(
  options?: UseMutationOptions<
    BookingGroup,
    CreateWidgetBookingGroupMutationError,
    WidgetBookingGroupCommand,
    TContext
  >,
): UseMutationResult<
  BookingGroup,
  CreateWidgetBookingGroupMutationError,
  WidgetBookingGroupCommand,
  TContext
> {
  return useMutation({
    mutationFn: createWidgetBookingGroupCommand,
    ...options,
  });
}