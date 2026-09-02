export interface CandidateReplyVariables {
  contactId: string;
  data: {
    authorReply: string;
    authorStatus: "pending" | "accepted" | "declined";
  };
}

interface CandidateReplyMutation {
  mutate: (
    variables: CandidateReplyVariables,
    options: {
      onSuccess: () => void;
      onError: () => void;
      onSettled: () => void;
    },
  ) => void;
}

interface CreateCandidateReplyHandlerOptions {
  mutation: CandidateReplyMutation;
  replyPendingRef: { current: boolean };
  onSuccess: () => void;
  onError: () => void;
}

export function createCandidateReplyHandler({
  mutation,
  replyPendingRef,
  onSuccess,
  onError,
}: CreateCandidateReplyHandlerOptions) {
  return (variables: CandidateReplyVariables) => {
    if (replyPendingRef.current) return;

    replyPendingRef.current = true;
    mutation.mutate(variables, {
      onSuccess,
      onError,
      onSettled: () => {
        replyPendingRef.current = false;
      },
    });
  };
}