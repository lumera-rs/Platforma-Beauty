import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Building2, Facebook, GraduationCap, Loader2, Mail, ShieldCheck } from "lucide-react";
import { useGetCurrentUser, useLogin, useRegisterBusiness } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { homeForRole } from "@/lib/role-routing";

const loginSchema = z.object({
  email: z.string().email("Unesite validnu email adresu."),
  password: z.string().min(1, "Lozinka je obavezna."),
});

const registrationSchema = z.object({
  firstName: z.string().min(1, "Ime je obavezno."),
  lastName: z.string().min(1, "Prezime je obavezno."),
  email: z.string().email("Unesite validnu email adresu."),
  password: z.string().min(8, "Lozinka mora imati najmanje 8 karaktera.").optional(),
  phone: z.string().min(6, "Unesite kontakt telefon."),
  businessType: z.enum(["SALON", "EDUCATION_CENTER"]),
  businessName: z.string().min(2, "Naziv biznisa je obavezan."),
  city: z.string().min(2, "Grad je obavezan."),
  municipality: z.string().min(2, "Opština je obavezna."),
  address: z.string().min(3, "Adresa je obavezna."),
  postalCode: z.string().min(4, "Poštanski broj je obavezan."),
});

type BusinessAuthProps = {
  initialTab: "login" | "register";
};

export default function BusinessAuth({ initialTab }: BusinessAuthProps) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { data: currentUser, isLoading } = useGetCurrentUser();
  const login = useLogin();
  const register = useRegisterBusiness();
  const oauthBusiness = new URLSearchParams(window.location.search).get("oauth") === "1";

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });
  const registrationForm = useForm<z.infer<typeof registrationSchema>>({
    resolver: zodResolver(registrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      phone: "",
      businessType: "SALON",
      businessName: "",
      city: "",
      municipality: "",
      address: "",
      postalCode: "",
    },
  });

  useEffect(() => {
    if (!currentUser?.user) return;
    if (oauthBusiness && currentUser.user.role === "CUSTOMER") {
      registrationForm.reset({
        ...registrationForm.getValues(),
        firstName: currentUser.user.firstName,
        lastName: currentUser.user.lastName,
        email: currentUser.user.email,
        password: undefined,
      });
      return;
    }
    setLocation(homeForRole(currentUser.user.role));
  }, [currentUser, oauthBusiness, registrationForm, setLocation]);

  const continueWith = (provider: "google" | "facebook") => {
    window.location.assign(`/api/auth/oauth/${provider}/start?flow=business`);
  };

  if (isLoading) {
    return (
      <BusinessLayout>
        <div className="flex min-h-[60vh] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </BusinessLayout>
    );
  }

  return (
    <BusinessLayout>
      <section className="relative flex-1 overflow-hidden bg-foreground py-12 md:py-20">
        <div className="container relative mx-auto grid max-w-6xl gap-10 px-4 lg:grid-cols-[0.8fr_1.2fr] lg:items-start">
          <div className="pt-8 text-background lg:sticky lg:top-28">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-sm text-accent">
              <ShieldCheck className="h-4 w-4" />
              Odvojen i bezbedan poslovni pristup
            </div>
            <h1 className="mb-5 font-serif text-4xl font-bold leading-tight text-white md:text-5xl">
              Vaš LUMERA poslovni prostor.
            </h1>
            <p className="max-w-md text-lg leading-relaxed text-background/75">
              Salonima i edukativnim centrima dajemo namenski onboarding, poslovni portal i pristup alatima bez mešanja sa klijentskim nalogom.
            </p>
            <div className="mt-10 hidden space-y-4 text-sm text-background/75 lg:block">
              <p className="flex items-center gap-3"><Building2 className="h-5 w-5 text-accent" /> Salon, tim, usluge i kalendar na jednom mestu</p>
              <p className="flex items-center gap-3"><GraduationCap className="h-5 w-5 text-accent" /> Poseban profil za edukativne centre</p>
            </div>
          </div>

          <Card className="border-border/60 shadow-2xl">
            <CardHeader className="text-center">
              <CardTitle className="font-serif text-3xl">LUMERA Biznis</CardTitle>
              <CardDescription>Prijavite se ili otvorite novi poslovni nalog.</CardDescription>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue={initialTab}>
                <TabsList className="mb-7 grid w-full grid-cols-2">
                  <TabsTrigger value="login">Prijava</TabsTrigger>
                  <TabsTrigger value="register">Registracija</TabsTrigger>
                </TabsList>

                <TabsContent value="login">
                  <Form {...loginForm}>
                    <form
                      className="space-y-5"
                      onSubmit={loginForm.handleSubmit((values) => {
                        login.mutate({ data: values }, {
                          onSuccess: (response) => {
                            toast.success("Uspešna prijava", { description: "Otvaramo vaš poslovni prostor." });
                            setLocation(homeForRole(response.user.role));
                          },
                          onError: () => toast.error("Prijava nije uspela", { description: "Proverite email i lozinku." }),
                        });
                      })}
                    >
                      <FormField
                        control={loginForm.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl><Input type="email" autoComplete="email" placeholder="ime@biznis.rs" {...field} /></FormControl>
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
                            <FormControl><Input type="password" autoComplete="current-password" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <Button type="submit" className="h-12 w-full" disabled={login.isPending}>
                        {login.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Prijavi se u poslovni portal
                      </Button>
                      <BusinessSocialButtons onContinue={continueWith} />
                    </form>
                  </Form>
                </TabsContent>

                <TabsContent value="register">
                  <Form {...registrationForm}>
                    <form
                      className="space-y-5"
                      onSubmit={registrationForm.handleSubmit((values) => {
                        if (!oauthBusiness && !values.password) {
                          registrationForm.setError("password", { message: "Lozinka je obavezna." });
                          return;
                        }
                        register.mutate({ data: values }, {
                          onSuccess: (response) => {
                            toast.success("Poslovni nalog je kreiran", { description: "Dobrodošli u LUMERA Biznis." });
                            setLocation(homeForRole(response.user.role));
                          },
                          onError: () => toast.error("Registracija nije uspela", { description: "Proverite podatke ili pokušajte sa drugom email adresom." }),
                        });
                      })}
                    >
                      <FormField
                        control={registrationForm.control}
                        name="businessType"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Tip biznisa</FormLabel>
                            <FormControl>
                              <select
                                {...field}
                                className="flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                <option value="SALON">Salon ili wellness centar</option>
                                <option value="EDUCATION_CENTER">Edukativni centar</option>
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField
                          control={registrationForm.control}
                          name="firstName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Ime</FormLabel>
                              <FormControl><Input autoComplete="given-name" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registrationForm.control}
                          name="lastName"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Prezime</FormLabel>
                              <FormControl><Input autoComplete="family-name" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <FormField
                        control={registrationForm.control}
                        name="businessName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Naziv biznisa</FormLabel>
                            <FormControl><Input autoComplete="organization" placeholder="Naziv salona ili centra" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField
                          control={registrationForm.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Poslovni email</FormLabel>
                              <FormControl><Input type="email" autoComplete="email" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registrationForm.control}
                          name="phone"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Kontakt telefon</FormLabel>
                              <FormControl><Input type="tel" autoComplete="tel" placeholder="+381 6x..." {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-5 sm:grid-cols-2">
                        <FormField
                          control={registrationForm.control}
                          name="city"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Grad</FormLabel>
                              <FormControl><Input autoComplete="address-level2" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registrationForm.control}
                          name="municipality"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Opština</FormLabel>
                              <FormControl><Input autoComplete="address-level3" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      <div className="grid gap-5 sm:grid-cols-[1fr_150px]">
                        <FormField
                          control={registrationForm.control}
                          name="address"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Adresa</FormLabel>
                              <FormControl><Input autoComplete="street-address" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={registrationForm.control}
                          name="postalCode"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Poštanski broj</FormLabel>
                              <FormControl><Input autoComplete="postal-code" inputMode="numeric" {...field} /></FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      {!oauthBusiness && <FormField
                        control={registrationForm.control}
                        name="password"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Lozinka</FormLabel>
                            <FormControl><Input type="password" autoComplete="new-password" value={field.value ?? ""} onChange={field.onChange} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />}
                      {oauthBusiness && <p className="rounded-md bg-primary/5 p-3 text-sm text-muted-foreground">Google/Facebook je već potvrdio vaš identitet. Dovršite podatke o biznisu bez nove lozinke.</p>}
                      <Button type="submit" className="h-12 w-full" disabled={register.isPending}>
                        {register.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Kreiraj poslovni nalog
                      </Button>
                      <BusinessSocialButtons onContinue={continueWith} />
                    </form>
                  </Form>
                </TabsContent>
              </Tabs>
              <div className="mt-7 border-t pt-5 text-center text-sm text-muted-foreground">
                Tražite termin ili edukaciju?{" "}
                <Link href="/prijava" className="font-semibold text-primary hover:underline">Klijentski pristup</Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </BusinessLayout>
  );
}

function BusinessSocialButtons({ onContinue }: { onContinue: (provider: "google" | "facebook") => void }) {
  return (
    <div className="space-y-3 pt-2">
      <div className="relative text-center text-xs text-muted-foreground before:absolute before:left-0 before:right-0 before:top-1/2 before:border-t">
        <span className="relative bg-card px-2">ili nastavite preko</span>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Button type="button" variant="outline" onClick={() => onContinue("google")}><Mail className="mr-2 h-4 w-4 text-red-500" /> Google</Button>
        <Button type="button" variant="outline" onClick={() => onContinue("facebook")}><Facebook className="mr-2 h-4 w-4 text-blue-600" /> Facebook</Button>
      </div>
    </div>
  );
}