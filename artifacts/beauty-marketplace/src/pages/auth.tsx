import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useLogin, useRegister, useGetCurrentUser } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Facebook, Loader2, Mail } from "lucide-react";
import { homeForRole } from "@/lib/role-routing";

const loginSchema = z.object({
  email: z.string().email({ message: "Unesite validnu email adresu" }),
  password: z.string().min(1, { message: "Lozinka je obavezna" }),
});

const registerSchema = z.object({
  firstName: z.string().min(1, { message: "Ime je obavezno" }),
  lastName: z.string().min(1, { message: "Prezime je obavezno" }),
  email: z.string().email({ message: "Unesite validnu email adresu" }),
  phone: z.string().min(6, { message: "Unesite broj telefona" }),
  phoneVerificationCode: z.string().length(6, { message: "Unesite šestocifreni kod" }),
  password: z.string().min(8, { message: "Lozinka mora imati najmanje 8 karaktera" }),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const studentPortal = window.location.pathname.startsWith("/student/");
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get("tab") === "register" ? "register" : "login";
  
  const { data: userResp, isLoading: isLoadingUser } = useGetCurrentUser();
  const { toast } = useToast();
  
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  
  // Redirect if already logged in
  useEffect(() => {
    if (userResp?.user) {
      setLocation(homeForRole(userResp.user.role));
    }
  }, [userResp, setLocation]);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", phone: "", phoneVerificationCode: "", password: "" },
  });

  const onLoginSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values }, {
      onSuccess: (res) => {
        toast.success("Uspešna prijava", { description: "Dobrodošli nazad!" });
        setLocation(homeForRole(res.user.role));
      },
      onError: (err: unknown) => {
        const message = (err as { data?: { error?: string }; response?: { data?: { error?: string } } })?.data?.error
          ?? (err as { response?: { data?: { error?: string } } })?.response?.data?.error
          ?? "Neispravni podaci. Pokušajte ponovo.";
        toast.error("Greška", { description: message });
      }
    });
  };

  const onRegisterSubmit = (values: z.infer<typeof registerSchema>) => {
    const registrationValues = {
      ...values,
      phoneVerificationCode: registerForm.getValues("phoneVerificationCode"),
    };
    if (studentPortal) {
      void fetch("/api/auth/student-register", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(registrationValues) })
        .then(async (response) => ({ response, data: await response.json() }))
        .then(({ response, data }) => {
          if (!response.ok) throw new Error(data.error ?? "Registracija nije uspela.");
          toast.success("STUDENT nalog je kreiran", { description: "Dobrodošli u LUMERA Edukacije." });
          setLocation("/student/edukacije");
        })
        .catch((error: Error) => toast.error("Greška", { description: error.message }));
      return;
    }
    registerMutation.mutate({ data: registrationValues }, {
      onSuccess: (res) => {
        toast.success("Uspešna registracija", { description: "Vaš klijentski nalog je kreiran!" });
        setLocation(homeForRole(res.user.role));
      },
      onError: (err) => {
        toast.error("Greška", { description: "Došlo je do greške prilikom registracije." });
      }
    });
  };
  const requestPhoneCode = async () => {
    const phone = registerForm.getValues("phone");
    if (!phone) { registerForm.setError("phone", { message: "Prvo unesite broj telefona." }); return; }
    const response = await fetch("/api/auth/phone-verification/request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone }) });
    const result = await response.json();
    if (!response.ok) { toast.error("Kod nije poslat", { description: result.error }); return; }
    if (result.developmentCode) {
      registerForm.setValue("phoneVerificationCode", result.developmentCode, {
        shouldDirty: true,
        shouldTouch: true,
        shouldValidate: true,
      });
    }
    toast.success("Kod za potvrdu je poslat", { description: result.developmentCode ? "Lokalni test kod je upisan u formu." : "Proverite SMS poruku." });
  };

  const continueWith = (provider: "google" | "facebook") => {
    window.location.assign(`/api/auth/oauth/${provider}/start?flow=customer`);
  };

  if (isLoadingUser) return null; // or a spinner

  return (
    <Layout hideCustomerNavigation={studentPortal}>
      <div className="flex-1 flex items-center justify-center p-4 py-12 bg-muted/30">
        <Card className="w-full max-w-md shadow-xl border-border/50">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-serif text-3xl font-bold">{studentPortal ? "LUMERA Edukacije" : "Dobrodošli"}</CardTitle>
            <CardDescription>{studentPortal ? "STUDENT prijava i registracija za edukacije" : "Prijavite se ili kreirajte nalog"}</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue={tab} className="w-full">
              <TabsList className="grid w-full grid-cols-2 mb-6">
                <TabsTrigger value="login">Prijava</TabsTrigger>
                <TabsTrigger value="register">Registracija</TabsTrigger>
              </TabsList>
              
              <TabsContent value="login" className="mt-0">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(onLoginSubmit)} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="vas@email.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lozinka</FormLabel>
                          <FormControl>
                            <PasswordInput autoComplete="current-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full h-11 text-base mt-2" disabled={loginMutation.isPending}>
                      {loginMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Prijavi se"}
                    </Button>
                    <SocialButtons onContinue={continueWith} />
                  </form>
                </Form>
              </TabsContent>
              
              <TabsContent value="register" className="mt-0">
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(onRegisterSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={registerForm.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Ime</FormLabel>
                            <FormControl>
                              <Input autoComplete="given-name" placeholder="Ime" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Prezime</FormLabel>
                            <FormControl>
                              <Input autoComplete="family-name" placeholder="Prezime" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input type="email" autoComplete="email" placeholder="vas@email.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Telefon</FormLabel>
                          <FormControl>
                            <Input type="tel" autoComplete="tel" placeholder="+381 64 123 4567" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <div className="flex gap-2">
                      <FormField control={registerForm.control} name="phoneVerificationCode" render={({ field }) => <FormItem className="flex-1"><FormLabel>SMS kod</FormLabel><FormControl><Input inputMode="numeric" maxLength={6} placeholder="123456" {...field} /></FormControl><FormMessage /></FormItem>} />
                      <Button type="button" variant="outline" className="mt-8" onClick={requestPhoneCode}>Pošalji kod</Button>
                    </div>
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lozinka (min. 8 karaktera)</FormLabel>
                          <FormControl>
                            <PasswordInput autoComplete="new-password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full h-11 text-base mt-4" disabled={registerMutation.isPending}>
                      {registerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Registruj se"}
                    </Button>
                    <SocialButtons onContinue={continueWith} />
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
            <div className="mt-6 border-t pt-5 text-center text-sm text-muted-foreground">
              Imate salon ili edukativni centar?{" "}
              <Link href="/poslovna-prijava" className="font-semibold text-primary hover:underline">
                Poslovni pristup
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}

function SocialButtons({ onContinue }: { onContinue: (provider: "google" | "facebook") => void }) {
  return (
    <div className="space-y-3 pt-2">
      <div className="relative text-center text-xs text-muted-foreground before:absolute before:left-0 before:right-0 before:top-1/2 before:border-t">
        <span className="relative bg-card px-2">ili nastavite preko</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" onClick={() => onContinue("google")} aria-label="Nastavite preko Google naloga">
          <Mail className="mr-2 h-4 w-4 text-red-500" /> Google
        </Button>
        <Button type="button" variant="outline" onClick={() => onContinue("facebook")} aria-label="Nastavite preko Facebook naloga">
          <Facebook className="mr-2 h-4 w-4 text-blue-600" /> Facebook
        </Button>
      </div>
    </div>
  );
}
