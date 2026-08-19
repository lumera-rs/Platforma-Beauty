import { Layout } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useLogin, useRegister, useGetCurrentUser } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const loginSchema = z.object({
  email: z.string().email({ message: "Unesite validnu email adresu" }),
  password: z.string().min(1, { message: "Lozinka je obavezna" }),
});

const registerSchema = z.object({
  firstName: z.string().min(1, { message: "Ime je obavezno" }),
  lastName: z.string().min(1, { message: "Prezime je obavezno" }),
  email: z.string().email({ message: "Unesite validnu email adresu" }),
  password: z.string().min(8, { message: "Lozinka mora imati najmanje 8 karaktera" }),
  role: z.enum(["CUSTOMER", "SALON_OWNER", "EDUCATION_CENTER_OWNER"]).default("CUSTOMER"),
});

export default function Login() {
  const [location, setLocation] = useLocation();
  const searchParams = new URLSearchParams(window.location.search);
  const tab = searchParams.get("tab") === "register" ? "register" : "login";
  
  const { data: userResp, isLoading: isLoadingUser } = useGetCurrentUser();
  const { toast } = useToast();
  
  const loginMutation = useLogin();
  const registerMutation = useRegister();
  
  // Redirect if already logged in
  useEffect(() => {
    if (userResp?.user) {
      if (userResp.user.role === "SALON_OWNER") setLocation("/vlasnik");
      else if (userResp.user.role === "CUSTOMER") setLocation("/moj-nalog");
      else if (userResp.user.role === "SUPER_ADMIN") setLocation("/admin");
      else setLocation("/");
    }
  }, [userResp, setLocation]);

  const loginForm = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<z.infer<typeof registerSchema>>({
    resolver: zodResolver(registerSchema),
    defaultValues: { firstName: "", lastName: "", email: "", password: "", role: "CUSTOMER" },
  });

  const onLoginSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values }, {
      onSuccess: (res) => {
        toast.success("Uspešna prijava", { description: "Dobrodošli nazad!" });
        if (res.user.role === "SALON_OWNER") setLocation("/vlasnik");
        else if (res.user.role === "CUSTOMER") setLocation("/moj-nalog");
        else setLocation("/");
      },
      onError: (err) => {
        toast.error("Greška", { description: "Neispravni podaci. Pokušajte ponovo." });
      }
    });
  };

  const onRegisterSubmit = (values: z.infer<typeof registerSchema>) => {
    registerMutation.mutate({ data: values }, {
      onSuccess: (res) => {
        toast.success("Uspešna registracija", { description: "Vaš nalog je kreiran!" });
        if (res.user.role === "SALON_OWNER") setLocation("/vlasnik");
        else if (res.user.role === "CUSTOMER") setLocation("/moj-nalog");
        else setLocation("/");
      },
      onError: (err) => {
        toast.error("Greška", { description: "Došlo je do greške prilikom registracije." });
      }
    });
  };

  if (isLoadingUser) return null; // or a spinner

  return (
    <Layout>
      <div className="flex-1 flex items-center justify-center p-4 py-12 bg-muted/30">
        <Card className="w-full max-w-md shadow-xl border-border/50">
          <CardHeader className="text-center pb-2">
            <CardTitle className="font-serif text-3xl font-bold">Dobrodošli</CardTitle>
            <CardDescription>Prijavite se ili kreirajte nalog</CardDescription>
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
                            <Input placeholder="vas@email.com" {...field} />
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
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full h-11 text-base mt-2" disabled={loginMutation.isPending}>
                      {loginMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Prijavi se"}
                    </Button>
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
                              <Input placeholder="Ime" {...field} />
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
                              <Input placeholder="Prezime" {...field} />
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
                            <Input placeholder="vas@email.com" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Lozinka (min. 8 karaktera)</FormLabel>
                          <FormControl>
                            <Input type="password" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="role"
                      render={({ field }) => (
                        <FormItem className="pt-2">
                          <FormLabel>Vrsta naloga</FormLabel>
                          <div className="grid grid-cols-2 gap-3 mt-1">
                            <label className={`border rounded-lg p-3 text-sm flex flex-col items-center gap-2 cursor-pointer transition-colors ${field.value === 'CUSTOMER' ? 'bg-primary/5 border-primary text-primary' : 'hover:bg-muted'}`}>
                              <input type="radio" value="CUSTOMER" checked={field.value === 'CUSTOMER'} onChange={(e) => field.onChange(e.target.value)} className="sr-only" />
                              <span className="font-medium">Klijent</span>
                              <span className="text-xs text-center opacity-70">Želim da zakažem termin</span>
                            </label>
                            <label className={`border rounded-lg p-3 text-sm flex flex-col items-center gap-2 cursor-pointer transition-colors ${field.value === 'SALON_OWNER' ? 'bg-primary/5 border-primary text-primary' : 'hover:bg-muted'}`}>
                              <input type="radio" value="SALON_OWNER" checked={field.value === 'SALON_OWNER'} onChange={(e) => field.onChange(e.target.value)} className="sr-only" />
                              <span className="font-medium">Partner</span>
                              <span className="text-xs text-center opacity-70">Vlasnik sam salona</span>
                            </label>
                          </div>
                        </FormItem>
                      )}
                    />
                    <Button type="submit" className="w-full h-11 text-base mt-4" disabled={registerMutation.isPending}>
                      {registerMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : "Registruj se"}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
