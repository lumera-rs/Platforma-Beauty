import { useValidateReferralCode, getValidateReferralCodeQueryKey } from "@workspace/api-client-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Gift } from "lucide-react";

export function ReferralContextBanner({ code }: { code?: string }) {
  const { data, isLoading } = useValidateReferralCode(code ?? "", {
    query: { enabled: !!code, queryKey: getValidateReferralCodeQueryKey(code ?? "") }
  });

  if (!code || isLoading || !data || !data.valid) return null;

  return (
    <Alert className="mb-6 border-primary/20 bg-primary/5 text-primary">
      <Gift className="h-5 w-5" />
      <AlertTitle className="font-semibold text-primary">Primenjen pozivni kod</AlertTitle>
      <AlertDescription className="text-sm">
        Registrujete se preko preporuke ({data.code}). Dobrodošli u LUMERA mrežu!
      </AlertDescription>
    </Alert>
  );
}