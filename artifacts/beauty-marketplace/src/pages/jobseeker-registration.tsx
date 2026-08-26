import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useRegisterJobseeker, useGetCurrentUser } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Briefcase } from "lucide-react";
import { homeForRole } from "@/lib/role-routing";
import { useReferralCapture } from "@/hooks/use-referral-capture";
import { ReferralContextBanner } from "@/components/referral-context-banner";
import { clearStoredReferralCode } from "@/lib/referral-storage";

function isValidPastOrPresentDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value
    && value <= new Date().toISOString().slice(0, 10);
}

const registerSchema = z.object({
  firstName: z.string().min(1, { message: "Ime je obavezno" }),
  lastName: z.string().min(1, { message: "Prezime je obavezno" }),
  email: z.string().email({ message: "Unesite validnu email adresu" }),
  phone: z.string().min(6, { message: "Unesite broj telefona" }),
  phoneVerificationCode: z.string().length(6, { message: "Unesite šestocifreni kod" }),
  dateOfBirth: z.string().refine(isValidPastOrPresentDate, { message: "Unesite ispravan datum rođenja koji nije u budućnosti" }),
  password: z.string().min(8, { message: "Lozinka mora imati najmanje 8 karaktera" }),
  passwordConfirm: z.string(),
}).refine(data => data.password === data.passwordConfirm, {
  message: "Lozinke se ne poklapaju",
  path: ["passwordConfirm"]
});

export default function JobseekerRegistration() {
  const [, setLocation] = useLocation();
  const { data: userResp, isLoading: isLoadingUser } = useGetCurrentUser();
  const { toast } = useToast();
  
  const registerMutation = useRegisterJobseeker();
  const referralCode = useReferralCapture();
  
  useEffect(() => {
    if (userResp?.user) {
      setLocation(homeForRole(userResp.user.role));
    }
  }, [userResp, setLocation]);

  const form = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", phoneVerificationCode: "", dateOfBirth: "", password: "", passwordConfirm: "" },
  });

  const onSubmit = (values: z.infer<typeof registerSchema>) => {
    const { passwordConfirm, ...registrationValues } = values;
    registerMutation.mutate({ data: { ...registrationValues, referralCode } }, {
      onSuccess: () => {
        clearStoredReferralCode();
        toast.success("Uspešna registracija", { description: "Vaš profil je kreiran!" });
        setLocation("/poslovi/nalog");
      },
      onError: () => {
        toast.error("Greška", { description: "Došlo je do greške prilikom registracije. Proverite podatke." });
      }
    });
  };

  const requestPhoneCode = async () => {
    const phone = form.getValues("phone");
    if (!phone) { form.setError("phone", { message: "Prvo unesite broj telefona." }); return; }
    const response = await fetch("/api/auth/phone-verification/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
    const result = await response.json();
    if (!response.ok) { toast.error("Kod nije poslat", { description: result.error }); return; }
    if (result.developmentCode) {
      form.setValue("phoneVerificationCode", result.developmentCode, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
    toast.success("Kod za potvrdu je poslat", { description: result.developmentCode ? "Lokalni test kod je upisan u formu." : "Proverite SMS poruku." });
  };

  if (isLoadingUser) return null;

  return (
    <Layout>
      <div className="flex-1 flex items-center justify-center p-4 py-12 bg-muted/30">
        <Card className="w-full max-w-lg shadow-xl border-border/50">
          <CardHeader className="text-center pb-6">
            <div className="mx-auto bg-primary/10 w-12 h-12 rounded-full flex items-center justify-center mb-4 text-primary">
              <Briefcase className="w-6 h-6" />
            </div>
            <CardTitle className="font-serif text-3xl font-bold">Zaposleni u beauty industriji</CardTitle>
            <CardDescription>
              Kreirajte profesionalni profil, oglasite svoje usluge i pronađite salon za rad.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReferralContextBanner code={referralCode} />
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="firstName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Ime</FormLabel>
                        <FormControl>
                          <Input autoComplete="given-name" placeholder="Ime" data-testid="input-firstname" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="lastName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Prezime</FormLabel>
                        <FormControl>
                          <Input autoComplete="family-name" placeholder="Prezime" data-testid="input-lastname" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="email" placeholder="vas@email.com" data-testid="input-email" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="dateOfBirth"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Datum rođenja</FormLabel>
                      <FormControl>
                        <Input type="date" max={new Date().toISOString().slice(0, 10)} data-testid="input-dob" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefon</FormLabel>
                      <FormControl>
                        <Input type="tel" autoComplete="tel" placeholder="+381 64 123 4567" data-testid="input-phone" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div className="flex gap-2">
                  <FormField
                    control={form.control}
                    name="phoneVerificationCode"
                    render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>SMS kod (potreban za ugovore)</FormLabel>
                        <FormControl>
                          <Input inputMode="numeric" maxLength={6} placeholder="123456" data-testid="input-sms-code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="outline" className="mt-8" onClick={requestPhoneCode} data-testid="button-request-sms">
                    Pošalji kod
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lozinka (min. 8 karaktera)</FormLabel>
                        <FormControl>
                          <PasswordInput autoComplete="new-password" data-testid="input-password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="passwordConfirm"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Potvrdite lozinku</FormLabel>
                        <FormControl>
                          <PasswordInput autoComplete="new-password" data-testid="input-password-confirm" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <Button type="submit" className="w-full h-11 text-base mt-4" disabled={registerMutation.isPending} data-testid="button-submit-register">
                  {registerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Registruj se kao radnik"}
                </Button>
              </form>
            </Form>
            
            <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
              Već imate nalog?{" "}
              <Link href="/prijava" className="font-semibold text-primary hover:underline">
                Prijavite se
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
