export type RentalResponseStatus = "accepted" | "declined";

interface RentalResponseMutation {
  mutate: (
    variables: { requestId: string; data: { status: RentalResponseStatus } },
    options: {
      onSuccess: () => void;
      onError: () => void;
      onSettled: () => void;
    },
  ) => void;
}

interface CreateRentalResponseHandlerOptions {
  mutation: RentalResponseMutation;
  responsePendingRef: { current: boolean };
  setPendingRequestId: (requestId: string | undefined) => void;
  onSuccess: (status: RentalResponseStatus) => void;
  onError: () => void;
}

export function createRentalResponseHandler({
  mutation,
  responsePendingRef,
  setPendingRequestId,
  onSuccess,
  onError,
}: CreateRentalResponseHandlerOptions) {
  return (requestId: string, status: RentalResponseStatus) => {
    if (responsePendingRef.current) return;

    responsePendingRef.current = true;
    setPendingRequestId(requestId);
    mutation.mutate(
      { requestId, data: { status } },
      {
        onSuccess: () => onSuccess(status),
        onError,
        onSettled: () => {
          responsePendingRef.current = false;
          setPendingRequestId(undefined);
        },
      },
    );
  };
}