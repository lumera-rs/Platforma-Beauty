import { useQueryClient } from "@tanstack/react-query";
import {
  getGetCurrentUserQueryKey,
  useGetCurrentUser,
  useUpdateEmailPreferences,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";

export function MarketingEmailPreferences() {
  const queryClient = useQueryClient();
  const { data: userResponse } = useGetCurrentUser();
  const updatePreference = useUpdateEmailPreferences();
  const { toast } = useToast();
  const user = userResponse?.user;

  if (!user) return null;

  const update = (marketingEmailsEnabled: boolean) => {
    updatePreference.mutate(
      { data: { marketingEmailsEnabled } },
      {
        onSuccess: (preference) => {
          queryClient.setQueryData(getGetCurrentUserQueryKey(), {
            ...userResponse,
            user: { ...user, marketingEmailsEnabled: preference.marketingEmailsEnabled },
          });
          toast.success(
            preference.marketingEmailsEnabled
              ? "Marketinške poruke su uključene."
              : "Marketinške poruke su isključene.",
            {
              description: "Obavezna obaveštenja o kontaktima, odgovorima i oglasima i dalje stižu.",
            },
          );
        },
        onError: () => toast.error("Podešavanje nije sačuvano", {
          description: "Pokušajte ponovo.",
        }),
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketinške poruke</CardTitle>
        <CardDescription>
          Izbor utiče samo na promotivne kampanje. Važna servisna obaveštenja o vašim oglasima i kontaktima uvek ostaju uključena.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-4 rounded-lg border p-4">
          <label htmlFor="marketing-emails-toggle" className="cursor-pointer text-sm">
            <span className="block font-medium">Želim da primam marketinške poruke</span>
            <span className="mt-1 block text-muted-foreground">Novosti, ponude i promotivne kampanje LUMERA.</span>
          </label>
          <Switch
            id="marketing-emails-toggle"
            checked={user.marketingEmailsEnabled}
            disabled={updatePreference.isPending}
            onCheckedChange={update}
            data-testid="marketing-emails-toggle"
            aria-label="Želim da primam marketinške poruke"
          />
        </div>
      </CardContent>
    </Card>
  );
}