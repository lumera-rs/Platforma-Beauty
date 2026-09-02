import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetCurrentUserQueryKey, useGetCurrentUser } from "@workspace/api-client-react";
import { ArrowLeft, Loader2, Phone, ShieldCheck } from "lucide-react";
import { Link } from "wouter";
import { AdminLayout } from "./layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useImmediateActionGuard } from "@/hooks/use-immediate-action-guard";

type PhoneVerificationResponse = {
  error?: string;
  developmentCode?: string;
};

export default function AdminProfile() {
  const { data: userResponse, isLoading } = useGetCurrentUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [phone, setPhone] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [phoneBusy, setPhoneBusy] = useState(false);
  const actionGuard = useImmediateActionGuard();

  useEffect(() => {
    if (userResponse?.user) setPhone(userResponse.user.phone ?? "");
  }, [userResponse?.user]);

  const requestPhoneCode = async () => {
    if (!actionGuard.begin("request-phone-code")) return;
    setPhoneBusy(true);
    try {
      const response = await fetch("/api/auth/phone-verification/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const body = await response.json() as PhoneVerificationResponse;
      if (!response.ok) {
        toast.error(body.error ?? "Kod nije poslat.");
        return;
      }
      if (body.developmentCode) setPhoneCode(body.developmentCode);
      toast.success("Kod je poslat", {
        description: body.developmentCode ? "Lokalni kod je upisan." : "Proverite SMS poruku.",
      });
    } catch {
      toast.error("Kod nije poslat", { description: "Pokušajte ponovo." });
    } finally {
      setPhoneBusy(false);
      actionGuard.end("request-phone-code");
    }
  };

  const confirmPhone = async () => {
    if (!actionGuard.begin("confirm-phone")) return;
    setPhoneBusy(true);
    try {
      const response = await fetch("/api/auth/phone-verification/confirm", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone, code: phoneCode }),
      });
      const body = await response.json() as PhoneVerificationResponse;
      if (!response.ok) {
        toast.error(body.error ?? "Broj nije potvrđen.");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      toast.success("Broj telefona je potvrđen.");
    } catch {
      toast.error("Broj nije potvrđen", { description: "Pokušajte ponovo." });
    } finally {
      setPhoneBusy(false);
      actionGuard.end("confirm-phone");
    }
  };

  return (
    <AdminLayout>
      <div className="max-w-2xl space-y-6">
        <div>
          <Button asChild variant="ghost" className="mb-4 -ml-3">
            <Link href="/admin/integracije">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Nazad na integracije
            </Link>
          </Button>
          <h1 className="text-3xl font-serif font-bold">Moj profil</h1>
          <p className="mt-2 text-muted-foreground">Upravljajte podacima svog administratorskog naloga.</p>
        </div>

        {isLoading || !userResponse?.user ? (
          <div className="flex justify-center p-12">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : (
          <>
            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-primary/10 p-2 text-primary"><Phone className="h-5 w-5" /></div>
                  <div>
                    <CardTitle>Telefon za hitna SMS upozorenja</CardTitle>
                    <CardDescription>Potvrdite broj da bi vaš nalog mogao da primi rezervno SMS upozorenje.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-profile-phone">Broj telefona</Label>
                  <Input
                    id="admin-profile-phone"
                    data-testid="admin-profile-phone"
                    type="tel"
                    autoComplete="tel"
                    placeholder="+381 64 123 4567"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-2">
                    <Label htmlFor="admin-profile-phone-code">SMS kod</Label>
                    <Input
                      id="admin-profile-phone-code"
                      data-testid="admin-profile-phone-code"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={phoneCode}
                      onChange={(event) => setPhoneCode(event.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" disabled={phoneBusy || actionGuard.isActive("request-phone-code")} onClick={requestPhoneCode}>
                    Pošalji kod
                  </Button>
                  <Button type="button" disabled={phoneBusy || actionGuard.isActive("confirm-phone") || !phoneCode} onClick={confirmPhone}>
                    Potvrdi broj
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-muted p-2"><ShieldCheck className="h-5 w-5" /></div>
                  <div>
                    <CardTitle>Podaci o nalogu</CardTitle>
                    <CardDescription>{userResponse.user.firstName} {userResponse.user.lastName} · {userResponse.user.email}</CardDescription>
                  </div>
                </div>
              </CardHeader>
            </Card>
          </>
        )}
      </div>
    </AdminLayout>
  );
}