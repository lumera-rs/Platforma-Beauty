import { useState } from "react";
import { Link, useLocation } from "wouter";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { GraduationCap, Loader2, CheckCircle2, ChevronRight } from "lucide-react";
import { useRegisterBusiness } from "@workspace/api-client-react";
import { BusinessLayout } from "@/components/business-layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/password-input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { homeForRole } from "@/lib/role-routing";

const eduRegistrationSchema = z.object({
  firstName: z.string().min(1, "Ime je obavezno."),
  lastName: z.string().min(1, "Prezime je obavezno."),
  email: z.string().email("Unesite validnu email adresu."),
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
});

type EduRegistrationValues = z.infer<typeof eduRegistrationSchema>;

export default function EducationCenterRegistration() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const registerBusiness = useRegisterBusiness();

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
      },
    }, {
      onSuccess: (data) => {
        toast.success("Edukativni centar je kreiran", { description: "Dobrodošli u LUMERA Edukativnu mrežu." });
        setLocation(homeForRole(data.user.role));
      },
      onError: (error) => {
        const message = typeof error.data === "object" && error.data && "error" in error.data
          ? String(error.data.error)
          : "Proverite podatke ili pokušajte sa drugom email adresom.";
        toast.error("Registracija nije uspela", { description: message });
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
                  <h4 className="font-medium text-lg">LMS i Live programi</h4>
                  <p className="text-primary-foreground/70 text-sm mt-1">Podrška za video kurseve i rezervaciju mesta na fizičkim masterclass događajima.</p>
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
                            <FormLabel>Ime vlasnika/menadžera</FormLabel>
                            <FormControl><Input autoComplete="given-name" {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="lastName"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Prezime vlasnika/menadžera</FormLabel>
                            <FormControl><Input autoComplete="family-name" {...field} /></FormControl>
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
                          <FormLabel>Poslovni email</FormLabel>
                          <FormControl><Input type="email" autoComplete="email" placeholder="kontakt@akademija.rs" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="phone"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kontakt telefon</FormLabel>
                          <FormControl><Input type="tel" autoComplete="tel" placeholder="+381..." {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lozinka</FormLabel>
                          <FormControl><PasswordInput autoComplete="new-password" {...field} /></FormControl>
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
                          <FormLabel>Zvanični naziv edukativnog centra</FormLabel>
                          <FormControl><Input placeholder="Npr. Beauty Akademija Beograd" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="pib"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>PIB (Poreski identifikacioni broj)</FormLabel>
                          <FormControl><Input placeholder="123456789" {...field} /></FormControl>
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
                            <FormLabel>Grad</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="municipality"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Opština</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
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
                            <FormLabel>Adresa centra</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="postalCode"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Poštanski broj</FormLabel>
                            <FormControl><Input {...field} /></FormControl>
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
                          <FormLabel>Veb sajt (opciono)</FormLabel>
                          <FormControl><Input type="url" placeholder="https://vas-centar.rs" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="instagramUrl"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Instagram (opciono)</FormLabel>
                          <FormControl><Input type="url" placeholder="https://instagram.com/vas-centar" {...field} /></FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Programi i sertifikacije</FormLabel>
                          <FormControl>
                            <Textarea 
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
                      <Button type="submit" size="lg" className="h-14 w-2/3 bg-accent text-accent-foreground hover:bg-accent/90 text-base" disabled={registerBusiness.isPending}>
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
