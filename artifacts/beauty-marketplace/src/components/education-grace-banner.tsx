import {
  getGetEducationSubscriptionStatusQueryKey,
  useGetCurrentUser,
  useGetEducationSubscriptionStatus,
} from "@workspace/api-client-react";
import { AlertTriangle } from "lucide-react";
import { educationGraceWarningMessage } from "@/lib/education-grace-warning";

export function EducationGraceBanner() {
  const { data: userResponse } = useGetCurrentUser();
  const user = userResponse?.user;
  const isEducationCenter = user?.role === "EDUKATIVNI_CENTAR";
  const { data: subscriptionStatus } = useGetEducationSubscriptionStatus({
    query: {
      enabled: isEducationCenter,
      queryKey: [...getGetEducationSubscriptionStatusQueryKey(), user?.id ?? "anonymous"],
      refetchOnMount: "always",
    },
  });
  const message = educationGraceWarningMessage(subscriptionStatus);

  if (!isEducationCenter || !message) return null;

  return (
    <div
      className="fixed inset-x-4 top-4 z-[100] mx-auto max-w-3xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 shadow-lg"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-testid="education-grace-banner"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <h2 className="font-semibold">Pretplata je u grace periodu</h2>
          <p className="mt-1 text-sm">{message}</p>
        </div>
      </div>
    </div>
  );
}