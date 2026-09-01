import { useState } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { getApiErrorMessage, useListEducationSubscriptionPlans, useRegisterBusiness } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { homeForRole } from "@/lib/role-routing";
import { useReferralCapture } from "@/hooks/use-referral-capture";
import { ReferralContextBanner } from "@/components/referral-context-banner";
import { clearStoredReferralCode } from "@/lib/referral-storage";
import { EducationFieldHelp } from "@/components/education/education-field-help";

const eduRegistrationSchema = z.object({
  firstName: z.string().min(1, "Ime je obavezno."),
  lastName: z.string().min(1, "Prezime je obavezno."),
  email: z.string().email("Unesite ispravnu adresu e-pošte."),
  password: z.string().min(8, "Lozinka mora imati najmanje 8 karaktera."),
  phone: z.string().min(6, "Unesite kontakt telefon."),
  businessName: z.string().min(2, "Naziv edukativnog centra je obavezan."),
  pib: z.string().trim().min(1, "PIB je obavezan.").max(50, "PIB može imati najviše 50 karaktera."),
  city: z.string().min(2, "Grad je obavezan."),
  municipality: z.string().min(2, "Opština je obavezna."),
  address: z.string().min(3, "Adresa je obavezna."),
  postalCode: z.string().min(4, "Poštanski broj je obavezan."),
  websiteUrl: z.union([z.string().url("Unesite punu adresu sajta."), z.literal("")]),
  instagramUrl: z.union([z.string().url("Unesite pun Instagram link."), z.literal("")]),
  description: z.string().min(20, "Opišite programe, oblasti rada ili sertifikacije u najmanje 20 karaktera.").max(2000),
  planId: z.string().uuid("Izaberite Education plan."),
  billingCycle: z.enum(["monthly", "yearly"]),
});

type EduRegistrationValues = z.infer<typeof eduRegistrationSchema>;

export default function EducationCenterRegistration() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const registerBusiness = useRegisterBusiness();
  const { data: plans = [], isLoading: plansLoading } = useListEducationSubscriptionPlans();
  const referralCode = useReferralCapture();

  const form = useForm<EduRegistrationValues>({
    resolver: zodResolver(eduRegistrationSchema),
    defaultValues: {
      firstName: "",
      lastName: "",
      email: "",
      password: "",
      phone: "",
      businessName: "",
      pib: "",
      city: "",
      municipality: "",
      address: "",
      postalCode: "",
      websiteUrl: "",
      instagramUrl: "",
      description: "",
      planId: "",
      billingCycle: "monthly",
    },
  });

  const onSubmit = (values: EduRegistrationValues) => {
    registerBusiness.mutate({
      data: {
        ...values,
        pib: values.pib.trim(),
        businessType: "EDUCATION_CENTER",
        contactEmail: values.email,
        contactPhone: values.phone,
        contactAddress: values.address,
        websiteUrl: values.websiteUrl || undefined,
        instagramUrl: values.instagramUrl || undefined,
        referralCode,
      },
    }, {
      onSuccess: (data) => {
        clearStoredReferralCode();
        toast.success("Edukativni centar je kreiran", { description: "Dobrodošli u LUMERA Edukativnu mrežu." });
        setLocation(homeForRole(data.user.role));
      },
      onError: (error) => {
        toast.error("Registracija nije uspela", {
          description: getApiErrorMessage(
            error,
            "Proverite podatke ili pokušajte sa drugom adresom e-pošte.",
          ),
        });
      },
    });
  };

  const nextStep = async () => {
    const fieldsToValidate = ["firstName", "lastName", "email", "password", "phone"] as const;
    const isValid = await form.trigger(fieldsToValidate);
    if (isValid) setStep(2);
  };

  return (
    <BusinessLayout>
      <div className="flex-1 flex flex-col lg:flex-row bg-background">

        {/* Left side info */}
        <div className="lg:w-5/12 bg-primary text-primary-foreground p-10 md:p-16 flex flex-col justify-between relative overflow-hidden">
          <div className="absolute inset-0 opacity-10 bg-[url('https://images.unsplash.com/photo-1574015974293-817f0ebebb74?q=80&w=2673&auto=format&fit=crop')] bg-cover bg-center mix-blend-overlay"></div>

          <div className="relative z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/20 text-white text-sm font-medium mb-8">
              <GraduationCap className="w-4 h-4" />
              <span>LUMERA Edukativni Partner</span>
            </div>

            <h1 className="font-serif text-4xl md:text-5xl font-bold mb-6">
              Platforma za moderne beauty edukatore
            </h1>
            <p className="text-primary-foreground/80 text-lg mb-12">
              Kreirajte nalog svog edukativnog centra i dobijte pristup alatima za organizaciju, promociju i prodaju vaših stručnih programa.
            </p>

            <ul className="space-y-6">
              <li className="flex items-start gap-4">
                <CheckCircle2 className="w-6 h-6 text-accent shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-lg">Direktan pristup ciljnoj grupi</h4>
                  <p className="text-primary-foreground/70 text-sm mt-1">Objavljene edukacije postaju dostupne salonima i beauty profesionalcima u javnom katalogu.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <CheckCircle2 className="w-6 h-6 text-accent shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-lg">Sistem za učenje i programi uživo</h4>
                  <p className="text-primary-foreground/70 text-sm mt-1">Podrška za video-kurseve i rezervaciju mesta na majstorskim radionicama uživo.</p>
                </div>
              </li>
              <li className="flex items-start gap-4">
                <CheckCircle2 className="w-6 h-6 text-accent shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-medium text-lg">Digitalni sertifikati</h4>
                  <p className="text-primary-foreground/70 text-sm mt-1">Automatsko generisanje i dodela sertifikata vašim polaznicima po završetku obuke.</p>
                </div>
              </li>
            </ul>
          </div>

          <div className="relative z-10 mt-16 pt-8 border-t border-white/20">
            <p className="text-sm text-primary-foreground/60">
              Ukoliko ste salon koji nudi usluge klijetima, <Link href="/poslovna-registracija" className="text-white hover:underline font-medium">registrujte se ovde</Link>.
            </p>
          </div>
        </div>

        {/* Right side form */}
        <div className="lg:w-7/12 p-6 md:p-12 lg:p-20 flex flex-col justify-center">
          <div className="max-w-xl w-full mx-auto">
            <div className="mb-10">
              <h2 className="text-3xl font-serif font-bold text-foreground mb-2">Registracija Centra</h2>
              <p className="text-muted-foreground">
                Korak {step} od 2 — {step === 1 ? "Osnovni podaci" : "Detalji centra"}
              </p>
            </div>

            <ReferralContextBanner code={referralCode} />

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">

                {step === 1 && (
                  <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="firstName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Ime vlasnika/menadžera <EducationFieldHelp id="edu-registration-first-name-help" label="Ime vlasnika ili menadžera" text="Unesite lično ime osobe koja će upravljati nalogom edukativnog centra." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-first-name-help" autoComplete="given-name" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Prezime vlasnika/menadžera <EducationFieldHelp id="edu-registration-last-name-help" label="Prezime vlasnika ili menadžera" text="Unesite prezime osobe odgovorne za nalog i komunikaciju sa platformom." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-last-name-help" autoComplete="family-name" {...field} /></FormControl>
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
                          <FormLabel className="flex items-center gap-2">Poslovna e-pošta <EducationFieldHelp id="edu-registration-email-help" label="Poslovna e-pošta" text="Unesite aktivnu poslovnu adresu e-pošte na koju ćete primati obaveštenja o centru i registraciji." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-email-help" type="email" autoComplete="email" placeholder="kontakt@akademija.rs" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="planId"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Education plan <EducationFieldHelp id="edu-registration-plan-help" label="Education plan" text="Izaberite plan koji određuje mesečnu cenu i dostupne mogućnosti centra. Probni period se može iskoristiti samo jednom." /></FormLabel>
                            <FormControl>
                              <select
                                aria-describedby="edu-registration-plan-help"
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                                disabled={plansLoading}
                                {...field}
                              >
                                <option value="">{plansLoading ? "Učitavanje planova…" : "Izaberite plan"}</option>
                                {plans.map((plan) => (
                                  <option key={plan.id} value={plan.id}>{plan.name} — {plan.price.toLocaleString("sr-RS")} RSD mesečno</option>
                                ))}
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="billingCycle"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Ciklus naplate <EducationFieldHelp id="edu-registration-cycle-help" label="Ciklus naplate" text="Mesečni ciklus obnavlja se svakog meseca, a godišnji unapred obračunava dvanaest mesečnih perioda." /></FormLabel>
                            <FormControl>
                              <select aria-describedby="edu-registration-cycle-help" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" {...field}>
                                <option value="monthly">Mesečno</option>
                                <option value="yearly">Godišnje</option>
                              </select>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Kontakt telefon <EducationFieldHelp id="edu-registration-phone-help" label="Kontakt telefon" text="Unesite broj na koji platforma i zainteresovani polaznici mogu da kontaktiraju odgovornu osobu." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-phone-help" type="tel" autoComplete="tel" placeholder="+381..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Lozinka <EducationFieldHelp id="edu-registration-password-help" label="Lozinka" text="Kreirajte jedinstvenu lozinku od najmanje osam karaktera koju ne koristite na drugim nalozima." /></FormLabel>
                          <FormControl><PasswordInput aria-describedby="edu-registration-password-help" autoComplete="new-password" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Button type="button" size="lg" className="w-full h-14 mt-4 text-base" onClick={nextStep}>
                      Dalje <ChevronRight className="w-5 h-5 ml-2" />
                    </Button>
                  </div>
                )}

                {step === 2 && (
                  <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-500">
                    <FormField
                      control={form.control}
                      name="businessName"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Zvanični naziv edukativnog centra <EducationFieldHelp id="edu-registration-business-name-help" label="Zvanični naziv edukativnog centra" text="Unesite puni naziv centra pod kojim poslujete i koji će biti prikazan polaznicima." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-business-name-help" placeholder="Npr. Beauty Akademija Beograd" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="pib"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">PIB (Poreski identifikacioni broj) <EducationFieldHelp id="edu-registration-pib-help" label="PIB" text="Unesite poreski identifikacioni broj pravnog lica ili preduzetnika tačno kako je evidentiran kod nadležnog registra." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-pib-help" placeholder="123456789" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="grid gap-5 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="city"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Grad <EducationFieldHelp id="edu-registration-city-help" label="Grad" text="Unesite grad u kojem se nalazi sedište ili glavna lokacija edukativnog centra." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-city-help" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="municipality"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Opština <EducationFieldHelp id="edu-registration-municipality-help" label="Opština" text="Unesite opštinu kojoj pripada navedena adresa centra." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-municipality-help" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <div className="grid gap-5 sm:grid-cols-[1fr_120px]">
                      <FormField
                        control={form.control}
                        name="address"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Adresa centra <EducationFieldHelp id="edu-registration-address-help" label="Adresa centra" text="Unesite ulicu i kućni broj lokacije na kojoj je centar registrovan ili održava edukacije." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-address-help" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="postalCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel className="flex items-center gap-2">Poštanski broj <EducationFieldHelp id="edu-registration-postal-code-help" label="Poštanski broj" text="Unesite poštanski broj koji odgovara navedenom gradu i adresi centra." /></FormLabel>
                            <FormControl><Input aria-describedby="edu-registration-postal-code-help" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    <FormField
                      control={form.control}
                      name="websiteUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Veb sajt (opciono) <EducationFieldHelp id="edu-registration-website-help" label="Veb sajt" text="Ako centar ima sajt, unesite punu javnu adresu koja počinje sa https://." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-website-help" type="url" placeholder="https://vas-centar.rs" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="instagramUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Instagram (opciono) <EducationFieldHelp id="edu-registration-instagram-help" label="Instagram" text="Unesite pun link do javnog Instagram profila centra, a ne samo korisničko ime." /></FormLabel>
                          <FormControl><Input aria-describedby="edu-registration-instagram-help" type="url" placeholder="https://instagram.com/vas-centar" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">Programi i sertifikacije <EducationFieldHelp id="edu-registration-description-help" label="Programi i sertifikacije" text="Opišite glavne oblasti obuke, način izvođenja programa i sertifikate koje polaznici mogu da steknu." /></FormLabel>
                          <FormControl>
                            <Textarea
                              aria-describedby="edu-registration-description-help"
                              placeholder="Opišite oblasti edukacija, formate programa i sertifikacije koje nudite."
                              className="resize-none h-24"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <div className="flex gap-4 mt-8">
                      <Button type="button" variant="outline" size="lg" className="h-14 w-1/3 text-base" onClick={() => setStep(1)}>
                        Nazad
                      </Button>
                      <Button type="submit" size="lg" className="h-14 w-2/3 bg-accent text-accent-foreground hover:bg-accent/90 text-base" disabled={registerBusiness.isPending || plansLoading || plans.length === 0}>
                        {registerBusiness.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
                        Završi registraciju
                      </Button>
                    </div>
                  </div>
                )}
              </form>
            </Form>
          </div>
        </div>
      </div>
    </BusinessLayout>
  );
}
